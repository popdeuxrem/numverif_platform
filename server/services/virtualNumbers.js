import twilio from 'twilio';
import axios from 'axios';
import crypto from 'crypto';
import speakeasy from 'speakeasy';
import qrcode from 'qrcode';
import { redis } from '../index.js';
import { logger } from '../index.js';

class VirtualNumberService {
  constructor() {
    // Initialize multiple SMS providers for redundancy
    this.twilioClient = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
    
    this.providers = {
      twilio: this.twilioClient,
      messagebird: axios.create({
        baseURL: 'https://rest.messagebird.com',
        headers: {
          'Authorization': `AccessKey ${process.env.MESSAGEBIRD_API_KEY}`
        }
      }),
      vonage: axios.create({
        baseURL: 'https://rest.nexmo.com',
        headers: {
          'Authorization': `Bearer ${process.env.VONAGE_API_KEY}`
        }
      }),
      plivo: axios.create({
        baseURL: 'https://api.plivo.com/v1',
        auth: {
          username: process.env.PLIVO_AUTH_ID,
          password: process.env.PLIVO_AUTH_TOKEN
        }
      })
    };

    this.virtualNumberPools = new Map();
    this.otpAttempts = new Map();
    this.phoneVerificationSessions = new Map();
    
    this.initializeVirtualNumbers();
  }

  // Initialize virtual number pools for different countries
  async initializeVirtualNumbers() {
    try {
      logger.info('Initializing virtual number pools...');
      
      const countries = [
        { code: 'US', prefix: '+1' },
        { code: 'GB', prefix: '+44' },
        { code: 'CA', prefix: '+1' },
        { code: 'AU', prefix: '+61' },
        { code: 'DE', prefix: '+49' },
        { code: 'FR', prefix: '+33' },
        { code: 'IN', prefix: '+91' },
        { code: 'JP', prefix: '+81' },
        { code: 'BR', prefix: '+55' },
        { code: 'MX', prefix: '+52' }
      ];

      for (const country of countries) {
        await this.initializeCountryNumbers(country);
      }
      
      logger.info('Virtual number pools initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize virtual number pools:', error);
    }
  }

  async initializeCountryNumbers(country) {
    try {
      // Get available numbers from Twilio
      const availableNumbers = await this.twilioClient.availablePhoneNumbers(country.code)
        .mobile
        .list({ limit: 50 });

      // Purchase a pool of numbers for this country
      const purchasedNumbers = [];
      for (let i = 0; i < Math.min(5, availableNumbers.length); i++) {
        try {
          const number = await this.twilioClient.incomingPhoneNumbers
            .create({
              phoneNumber: availableNumbers[i].phoneNumber,
              smsUrl: `${process.env.SERVER_URL}/api/webhooks/sms`,
              voiceUrl: `${process.env.SERVER_URL}/api/webhooks/voice`
            });
          
          purchasedNumbers.push({
            number: number.phoneNumber,
            sid: number.sid,
            country: country.code,
            provider: 'twilio',
            status: 'available',
            createdAt: new Date()
          });
        } catch (error) {
          logger.warn(`Failed to purchase number for ${country.code}:`, error.message);
        }
      }

      this.virtualNumberPools.set(country.code, purchasedNumbers);
      logger.info(`Initialized ${purchasedNumbers.length} virtual numbers for ${country.code}`);
    } catch (error) {
      logger.error(`Failed to initialize numbers for ${country.code}:`, error);
    }
  }

  // Get available virtual number for a country
  async getVirtualNumber(countryCode, userId) {
    try {
      const pool = this.virtualNumberPools.get(countryCode) || [];
      const availableNumber = pool.find(num => num.status === 'available');
      
      if (!availableNumber) {
        // Try to get more numbers
        await this.initializeCountryNumbers({ code: countryCode });
        const updatedPool = this.virtualNumberPools.get(countryCode) || [];
        const newAvailableNumber = updatedPool.find(num => num.status === 'available');
        
        if (!newAvailableNumber) {
          throw new Error(`No virtual numbers available for country ${countryCode}`);
        }
        return this.assignNumber(newAvailableNumber, userId);
      }
      
      return this.assignNumber(availableNumber, userId);
    } catch (error) {
      logger.error('Failed to get virtual number:', error);
      throw error;
    }
  }

  async assignNumber(numberObj, userId) {
    numberObj.status = 'assigned';
    numberObj.assignedTo = userId;
    numberObj.assignedAt = new Date();
    
    // Store assignment in Redis
    await redis.setex(
      `virtual_number:${numberObj.number}`,
      3600, // 1 hour expiry
      JSON.stringify({
        userId,
        assignedAt: new Date(),
        number: numberObj.number
      })
    );
    
    return {
      number: numberObj.number,
      countryCode: numberObj.country,
      expiresAt: new Date(Date.now() + 3600000) // 1 hour from now
    };
  }

  // Release virtual number back to pool
  async releaseVirtualNumber(phoneNumber) {
    try {
      // Find the number in pools
      for (const [countryCode, pool] of this.virtualNumberPools) {
        const numberIndex = pool.findIndex(num => num.number === phoneNumber);
        if (numberIndex !== -1) {
          pool[numberIndex].status = 'available';
          delete pool[numberIndex].assignedTo;
          delete pool[numberIndex].assignedAt;
          
          // Remove from Redis
          await redis.del(`virtual_number:${phoneNumber}`);
          
          logger.info(`Released virtual number ${phoneNumber}`);
          return true;
        }
      }
      return false;
    } catch (error) {
      logger.error('Failed to release virtual number:', error);
      throw error;
    }
  }

  // Generate and send OTP
  async sendOTP(phoneNumber, purpose = 'verification', options = {}) {
    try {
      const sessionId = crypto.randomUUID();
      const otp = this.generateOTP(options.length || 6);
      const expiresAt = new Date(Date.now() + (options.expiryMinutes || 10) * 60000);
      
      // Store OTP session
      const session = {
        sessionId,
        phoneNumber,
        otp,
        purpose,
        attempts: 0,
        maxAttempts: options.maxAttempts || 3,
        expiresAt,
        createdAt: new Date(),
        verified: false
      };
      
      await redis.setex(
        `otp_session:${sessionId}`,
        (options.expiryMinutes || 10) * 60,
        JSON.stringify(session)
      );

      // Send OTP via multiple providers for redundancy
      const message = options.customMessage || 
        `Your VaultText verification code is: ${otp}. This code expires in ${options.expiryMinutes || 10} minutes. Do not share this code with anyone.`;
      
      let sent = false;
      const providers = ['twilio', 'messagebird', 'vonage'];
      
      for (const provider of providers) {
        try {
          await this.sendSMSViaProvider(provider, phoneNumber, message);
          sent = true;
          logger.info(`OTP sent successfully via ${provider} to ${phoneNumber}`);
          break;
        } catch (error) {
          logger.warn(`Failed to send OTP via ${provider}:`, error.message);
          continue;
        }
      }
      
      if (!sent) {
        throw new Error('Failed to send OTP via any provider');
      }
      
      // Track attempt
      await this.trackOTPAttempt(phoneNumber, 'sent');
      
      return {
        sessionId,
        message: 'OTP sent successfully',
        expiresAt,
        phoneNumber: this.maskPhoneNumber(phoneNumber)
      };
    } catch (error) {
      logger.error('Failed to send OTP:', error);
      throw error;
    }
  }

  async sendSMSViaProvider(provider, phoneNumber, message) {
    switch (provider) {
      case 'twilio':
        return await this.twilioClient.messages.create({
          body: message,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: phoneNumber
        });
        
      case 'messagebird':
        return await this.providers.messagebird.post('/messages', {
          recipients: [phoneNumber],
          originator: 'VaultText',
          body: message
        });
        
      case 'vonage':
        return await this.providers.vonage.post('/sms/json', {
          from: 'VaultText',
          to: phoneNumber.replace('+', ''),
          text: message
        });
        
      case 'plivo':
        return await this.providers.plivo.post('/Message/', {
          src: process.env.PLIVO_PHONE_NUMBER,
          dst: phoneNumber,
          text: message
        });
        
      default:
        throw new Error(`Unknown SMS provider: ${provider}`);
    }
  }

  // Verify OTP
  async verifyOTP(sessionId, otpCode, phoneNumber) {
    try {
      const sessionData = await redis.get(`otp_session:${sessionId}`);
      if (!sessionData) {
        throw new Error('Invalid or expired OTP session');
      }
      
      const session = JSON.parse(sessionData);
      
      // Check if session is expired
      if (new Date() > new Date(session.expiresAt)) {
        await redis.del(`otp_session:${sessionId}`);
        throw new Error('OTP has expired');
      }
      
      // Check if already verified
      if (session.verified) {
        throw new Error('OTP has already been verified');
      }
      
      // Check phone number match
      if (session.phoneNumber !== phoneNumber) {
        throw new Error('Phone number mismatch');
      }
      
      // Increment attempts
      session.attempts += 1;
      
      // Check max attempts
      if (session.attempts > session.maxAttempts) {
        await redis.del(`otp_session:${sessionId}`);
        await this.trackOTPAttempt(phoneNumber, 'max_attempts_exceeded');
        throw new Error('Maximum verification attempts exceeded');
      }
      
      // Verify OTP
      if (session.otp !== otpCode) {
        await redis.setex(
          `otp_session:${sessionId}`,
          Math.floor((new Date(session.expiresAt) - new Date()) / 1000),
          JSON.stringify(session)
        );
        await this.trackOTPAttempt(phoneNumber, 'failed_verification');
        throw new Error('Invalid OTP code');
      }
      
      // Mark as verified
      session.verified = true;
      session.verifiedAt = new Date();
      
      await redis.setex(
        `otp_session:${sessionId}`,
        300, // Keep verified session for 5 minutes
        JSON.stringify(session)
      );
      
      await this.trackOTPAttempt(phoneNumber, 'verified');
      
      return {
        success: true,
        message: 'OTP verified successfully',
        sessionId,
        verifiedAt: session.verifiedAt
      };
    } catch (error) {
      logger.error('OTP verification failed:', error);
      throw error;
    }
  }

  // Generate secure OTP
  generateOTP(length = 6) {
    if (length === 6) {
      return Math.floor(100000 + Math.random() * 900000).toString();
    }
    
    const digits = '0123456789';
    let otp = '';
    for (let i = 0; i < length; i++) {
      otp += digits[Math.floor(Math.random() * digits.length)];
    }
    return otp;
  }

  // Generate TOTP for enhanced security
  generateTOTP(secret) {
    return speakeasy.totp({
      secret: secret,
      encoding: 'base32',
      time: 30,
      window: 2
    });
  }

  // Generate QR code for TOTP setup
  async generateTOTPQRCode(userEmail, secret) {
    const otpUrl = speakeasy.otpauthURL({
      secret: secret,
      label: encodeURIComponent(userEmail),
      name: 'VaultText Advanced Platform',
      issuer: 'VaultText'
    });
    
    return await qrcode.toDataURL(otpUrl);
  }

  // Track OTP attempts for analytics and security
  async trackOTPAttempt(phoneNumber, event) {
    const key = `otp_tracking:${phoneNumber}:${new Date().toISOString().split('T')[0]}`;
    await redis.hincrby(key, event, 1);
    await redis.expire(key, 86400 * 7); // Keep for 7 days
  }

  // Get OTP statistics
  async getOTPStats(phoneNumber, days = 7) {
    const stats = {};
    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const key = `otp_tracking:${phoneNumber}:${date.toISOString().split('T')[0]}`;
      const dayStats = await redis.hgetall(key);
      stats[date.toISOString().split('T')[0]] = dayStats;
    }
    return stats;
  }

  // Mask phone number for privacy
  maskPhoneNumber(phoneNumber) {
    if (phoneNumber.length <= 4) return phoneNumber;
    return phoneNumber.substring(0, 3) + '*'.repeat(phoneNumber.length - 6) + phoneNumber.substring(phoneNumber.length - 3);
  }

  // Bulk SMS functionality
  async sendBulkSMS(phoneNumbers, message, options = {}) {
    const results = [];
    const batchSize = options.batchSize || 100;
    
    for (let i = 0; i < phoneNumbers.length; i += batchSize) {
      const batch = phoneNumbers.slice(i, i + batchSize);
      const batchPromises = batch.map(async (phoneNumber) => {
        try {
          await this.sendSMSViaProvider('twilio', phoneNumber, message);
          return { phoneNumber, status: 'sent', timestamp: new Date() };
        } catch (error) {
          return { phoneNumber, status: 'failed', error: error.message, timestamp: new Date() };
        }
      });
      
      const batchResults = await Promise.allSettled(batchPromises);
      results.push(...batchResults.map(result => result.value || result.reason));
      
      // Add delay between batches to respect rate limits
      if (i + batchSize < phoneNumbers.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    return results;
  }

  // Voice call verification as backup
  async sendVoiceOTP(phoneNumber, otp) {
    try {
      const twiml = `
        <Response>
          <Say voice="alice" language="en-US">
            Your VaultText verification code is: ${otp.split('').join(', ')}. 
            I repeat, your verification code is: ${otp.split('').join(', ')}.
          </Say>
        </Response>
      `;
      
      await this.twilioClient.calls.create({
        twiml,
        to: phoneNumber,
        from: process.env.TWILIO_PHONE_NUMBER
      });
      
      logger.info(`Voice OTP sent to ${phoneNumber}`);
      return true;
    } catch (error) {
      logger.error('Failed to send voice OTP:', error);
      throw error;
    }
  }

  // WhatsApp integration for OTP
  async sendWhatsAppOTP(phoneNumber, otp) {
    try {
      await this.twilioClient.messages.create({
        body: `Your VaultText verification code is: ${otp}. This code expires in 10 minutes.`,
        from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
        to: `whatsapp:${phoneNumber}`
      });
      
      logger.info(`WhatsApp OTP sent to ${phoneNumber}`);
      return true;
    } catch (error) {
      logger.error('Failed to send WhatsApp OTP:', error);
      throw error;
    }
  }

  // Clean up expired sessions and numbers
  async cleanup() {
    try {
      // Release expired virtual numbers
      for (const [countryCode, pool] of this.virtualNumberPools) {
        pool.forEach(async (number) => {
          if (number.status === 'assigned' && number.assignedAt) {
            const hoursSinceAssignment = (new Date() - new Date(number.assignedAt)) / (1000 * 60 * 60);
            if (hoursSinceAssignment >= 1) { // Release after 1 hour
              await this.releaseVirtualNumber(number.number);
            }
          }
        });
      }
      
      logger.info('Virtual number cleanup completed');
    } catch (error) {
      logger.error('Cleanup failed:', error);
    }
  }
}

export default new VirtualNumberService();