/**
 * 📱🔐 Temporary Real Numbers for Social Media Verification
 * Provides temporary real phone numbers specifically optimized for social media account verification
 * Supports all major platforms with intelligent SMS routing and verification tracking
 */

const virtualNumbersService = require('./virtualNumbers');
const logger = require('../utils/logger');
const crypto = require('crypto');

class TempNumbersSocialMedia {
  constructor() {
    this.activeNumbers = new Map(); // numberKey -> numberData
    this.userNumbers = new Map(); // userId -> Set of numberKeys
    this.platformNumbers = new Map(); // platform -> Set of numberKeys
    this.verificationSessions = new Map(); // sessionId -> verificationData
    this.messageHistory = new Map(); // numberKey -> messages[]
    this.initialized = false;
    
    this.init();
  }

  /**
   * Initialize the service
   */
  async init() {
    try {
      // Start cleanup routines
      this.startCleanupRoutines();
      
      // Initialize platform-specific configurations
      this.setupPlatformConfigs();
      
      this.initialized = true;
      logger.info('Temporary numbers for social media service initialized');
    } catch (error) {
      logger.error('Failed to initialize temp numbers service', error);
    }
  }

  /**
   * Setup platform-specific configurations
   */
  setupPlatformConfigs() {
    this.platformConfigs = {
      'twitter': {
        name: 'Twitter/X',
        verificationTimeout: 300, // 5 minutes
        retryLimit: 3,
        preferredCountries: ['US', 'UK', 'CA'],
        blockedCountries: ['CN', 'IR', 'KP'], // Some platforms block certain countries
        estimatedVerificationTime: 30, // seconds
        supportedFeatures: ['sms', 'voice']
      },
      'facebook': {
        name: 'Facebook',
        verificationTimeout: 600, // 10 minutes
        retryLimit: 5,
        preferredCountries: ['US', 'UK', 'CA', 'AU'],
        blockedCountries: ['CN'],
        estimatedVerificationTime: 45,
        supportedFeatures: ['sms', 'voice']
      },
      'instagram': {
        name: 'Instagram',
        verificationTimeout: 300,
        retryLimit: 3,
        preferredCountries: ['US', 'UK', 'CA'],
        blockedCountries: ['CN'],
        estimatedVerificationTime: 30,
        supportedFeatures: ['sms']
      },
      'tiktok': {
        name: 'TikTok',
        verificationTimeout: 300,
        retryLimit: 2,
        preferredCountries: ['US', 'UK', 'CA', 'AU'],
        blockedCountries: [],
        estimatedVerificationTime: 60,
        supportedFeatures: ['sms', 'voice']
      },
      'whatsapp': {
        name: 'WhatsApp',
        verificationTimeout: 300,
        retryLimit: 1, // WhatsApp is strict about retries
        preferredCountries: ['US', 'UK', 'CA'],
        blockedCountries: [],
        estimatedVerificationTime: 30,
        supportedFeatures: ['sms', 'voice']
      },
      'telegram': {
        name: 'Telegram',
        verificationTimeout: 180,
        retryLimit: 3,
        preferredCountries: ['US', 'UK', 'CA', 'DE'],
        blockedCountries: ['CN', 'IR'],
        estimatedVerificationTime: 20,
        supportedFeatures: ['sms']
      },
      'discord': {
        name: 'Discord',
        verificationTimeout: 600,
        retryLimit: 5,
        preferredCountries: ['US', 'UK', 'CA'],
        blockedCountries: [],
        estimatedVerificationTime: 30,
        supportedFeatures: ['sms']
      },
      'snapchat': {
        name: 'Snapchat',
        verificationTimeout: 300,
        retryLimit: 3,
        preferredCountries: ['US', 'UK', 'CA'],
        blockedCountries: [],
        estimatedVerificationTime: 45,
        supportedFeatures: ['sms']
      },
      'linkedin': {
        name: 'LinkedIn',
        verificationTimeout: 600,
        retryLimit: 5,
        preferredCountries: ['US', 'UK', 'CA', 'AU', 'DE'],
        blockedCountries: [],
        estimatedVerificationTime: 60,
        supportedFeatures: ['sms', 'voice']
      },
      'reddit': {
        name: 'Reddit',
        verificationTimeout: 300,
        retryLimit: 3,
        preferredCountries: ['US', 'UK', 'CA'],
        blockedCountries: [],
        estimatedVerificationTime: 30,
        supportedFeatures: ['sms']
      },
      'pinterest': {
        name: 'Pinterest',
        verificationTimeout: 300,
        retryLimit: 3,
        preferredCountries: ['US', 'UK', 'CA'],
        blockedCountries: [],
        estimatedVerificationTime: 45,
        supportedFeatures: ['sms']
      },
      'youtube': {
        name: 'YouTube',
        verificationTimeout: 300,
        retryLimit: 3,
        preferredCountries: ['US', 'UK', 'CA'],
        blockedCountries: [],
        estimatedVerificationTime: 30,
        supportedFeatures: ['sms', 'voice']
      }
    };
  }

  /**
   * Get a temporary number for social media verification
   * @param {Object} options - Configuration options
   * @returns {Promise<Object>} - Number allocation result
   */
  async getTempNumber(options) {
    try {
      const {
        userId,
        platform,
        country = 'US',
        duration = 1800, // 30 minutes default
        purpose = 'verification'
      } = options;

      // Validate platform
      if (!this.platformConfigs[platform.toLowerCase()]) {
        throw new Error(`Unsupported platform: ${platform}`);
      }

      const platformConfig = this.platformConfigs[platform.toLowerCase()];
      
      // Check if country is allowed for this platform
      if (platformConfig.blockedCountries.includes(country)) {
        throw new Error(`Country ${country} is not supported for ${platform}`);
      }

      // Try preferred countries first, then fallback to requested country
      const countriesToTry = [
        ...platformConfig.preferredCountries.filter(c => c === country),
        country,
        ...platformConfig.preferredCountries.filter(c => c !== country)
      ];

      let numberResult = null;
      let lastError = null;

      for (const tryCountry of countriesToTry) {
        try {
          numberResult = await virtualNumbersService.getVirtualNumber(tryCountry, {
            purpose: 'temp_verification',
            platform: platform,
            duration: duration
          });
          
          if (numberResult.success) {
            break;
          }
        } catch (error) {
          lastError = error;
          logger.warn(`Failed to get number for ${tryCountry}, trying next option`, error);
        }
      }

      if (!numberResult || !numberResult.success) {
        throw lastError || new Error('No available numbers for any supported country');
      }

      // Generate unique key for this number
      const numberKey = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + (duration * 1000));

      // Store number data
      const numberData = {
        key: numberKey,
        phoneNumber: numberResult.phoneNumber,
        country: numberResult.country,
        provider: numberResult.provider,
        platform: platform.toLowerCase(),
        userId: userId,
        purpose: purpose,
        createdAt: new Date(),
        expiresAt: expiresAt,
        status: 'active',
        verificationAttempts: 0,
        maxRetries: platformConfig.retryLimit,
        verificationTimeout: platformConfig.verificationTimeout,
        lastActivityAt: new Date(),
        receivedMessages: [],
        metadata: {
          estimatedVerificationTime: platformConfig.estimatedVerificationTime,
          supportedFeatures: platformConfig.supportedFeatures
        }
      };

      // Store in maps
      this.activeNumbers.set(numberKey, numberData);
      
      if (!this.userNumbers.has(userId)) {
        this.userNumbers.set(userId, new Set());
      }
      this.userNumbers.get(userId).add(numberKey);
      
      if (!this.platformNumbers.has(platform.toLowerCase())) {
        this.platformNumbers.set(platform.toLowerCase(), new Set());
      }
      this.platformNumbers.get(platform.toLowerCase()).add(numberKey);

      logger.info('Temporary number allocated for social media verification', {
        numberKey,
        platform,
        country: numberResult.country,
        userId,
        expiresAt
      });

      return {
        success: true,
        numberKey: numberKey,
        phoneNumber: numberResult.phoneNumber,
        country: numberResult.country,
        platform: platform,
        expiresAt: expiresAt,
        estimatedVerificationTime: platformConfig.estimatedVerificationTime,
        maxRetries: platformConfig.retryLimit,
        instructions: this.getVerificationInstructions(platform, numberResult.phoneNumber)
      };

    } catch (error) {
      logger.error('Failed to get temporary number for social media', error);
      throw error;
    }
  }

  /**
   * Wait for verification SMS and extract code
   * @param {string} numberKey - Number key
   * @param {Object} options - Wait options
   * @returns {Promise<Object>} - Verification result
   */
  async waitForVerificationSMS(numberKey, options = {}) {
    try {
      const {
        timeout = 300000, // 5 minutes default
        pollInterval = 5000, // 5 seconds
        expectedCodeLength = 6
      } = options;

      const numberData = this.activeNumbers.get(numberKey);
      if (!numberData) {
        throw new Error('Invalid number key or number expired');
      }

      if (numberData.status !== 'active') {
        throw new Error(`Number is not active (status: ${numberData.status})`);
      }

      const startTime = Date.now();
      const sessionId = crypto.randomUUID();

      // Create verification session
      const verificationSession = {
        sessionId,
        numberKey,
        platform: numberData.platform,
        startTime,
        timeout,
        status: 'waiting',
        attempts: 0
      };

      this.verificationSessions.set(sessionId, verificationSession);

      // Start monitoring for SMS
      return new Promise((resolve, reject) => {
        const checkInterval = setInterval(async () => {
          try {
            // Check if timeout exceeded
            if (Date.now() - startTime > timeout) {
              clearInterval(checkInterval);
              this.verificationSessions.delete(sessionId);
              reject(new Error('Verification timeout - no SMS received'));
              return;
            }

            // Check for new messages
            const messages = await this.getReceivedMessages(numberKey);
            const newMessages = messages.filter(msg => 
              new Date(msg.receivedAt) > new Date(startTime)
            );

            for (const message of newMessages) {
              const extractedCode = this.extractVerificationCode(
                message.content, 
                expectedCodeLength
              );

              if (extractedCode) {
                clearInterval(checkInterval);
                verificationSession.status = 'completed';
                verificationSession.verificationCode = extractedCode;
                verificationSession.completedAt = new Date();

                // Update number data
                numberData.lastActivityAt = new Date();
                numberData.verificationAttempts++;

                logger.info('Verification code extracted successfully', {
                  numberKey,
                  platform: numberData.platform,
                  codeLength: extractedCode.length,
                  sessionId
                });

                resolve({
                  success: true,
                  verificationCode: extractedCode,
                  message: message.content,
                  receivedAt: message.receivedAt,
                  sessionId: sessionId,
                  platform: numberData.platform
                });
                return;
              }
            }

            // Update last activity
            numberData.lastActivityAt = new Date();

          } catch (error) {
            clearInterval(checkInterval);
            this.verificationSessions.delete(sessionId);
            reject(error);
          }
        }, pollInterval);

        // Cleanup on timeout
        setTimeout(() => {
          clearInterval(checkInterval);
          if (this.verificationSessions.has(sessionId)) {
            this.verificationSessions.delete(sessionId);
            reject(new Error('Verification timeout'));
          }
        }, timeout);
      });

    } catch (error) {
      logger.error('Failed to wait for verification SMS', error);
      throw error;
    }
  }

  /**
   * Extract verification code from SMS content
   * @param {string} content - SMS content
   * @param {number} expectedLength - Expected code length
   * @returns {string|null} - Extracted code or null
   */
  extractVerificationCode(content, expectedLength = 6) {
    // Common patterns for verification codes
    const patterns = [
      // Exact length numeric codes
      new RegExp(`\\b\\d{${expectedLength}}\\b`),
      // Codes with spaces or dashes
      new RegExp(`\\b\\d{${Math.floor(expectedLength/2)}}[\\s-]\\d{${Math.ceil(expectedLength/2)}}\\b`),
      // Codes preceded by common keywords
      /(?:code|verification|verify|otp|pin)[\s:]*(\d{4,8})/i,
      // Codes in brackets or parentheses
      /[\[\(](\d{4,8})[\]\)]/,
      // Codes at the beginning of message
      /^(\d{4,8})\b/,
      // Generic numeric patterns
      /\b(\d{4,8})\b/
    ];

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) {
        let code = match[1] || match[0];
        // Remove spaces and dashes
        code = code.replace(/[\s-]/g, '');
        
        // Check if length matches expected (with some tolerance)
        if (code.length >= expectedLength - 1 && code.length <= expectedLength + 2) {
          return code;
        }
      }
    }

    return null;
  }

  /**
   * Get received messages for a temporary number
   * @param {string} numberKey - Number key
   * @returns {Promise<Array>} - Received messages
   */
  async getReceivedMessages(numberKey) {
    try {
      const numberData = this.activeNumbers.get(numberKey);
      if (!numberData) {
        throw new Error('Invalid number key');
      }

      // Get messages from virtual numbers service
      const messages = await virtualNumbersService.getReceivedMessages(
        numberData.phoneNumber
      );

      // Store in message history
      this.messageHistory.set(numberKey, messages);
      
      // Update number data
      numberData.receivedMessages = messages;
      numberData.lastActivityAt = new Date();

      return messages.map(msg => ({
        id: msg.id,
        from: msg.from,
        content: msg.content,
        receivedAt: msg.receivedAt,
        platform: this.guessPlatformFromSender(msg.from)
      }));

    } catch (error) {
      logger.error('Failed to get received messages', error);
      throw error;
    }
  }

  /**
   * Release a temporary number
   * @param {string} numberKey - Number key
   * @param {string} userId - User ID (for authorization)
   * @returns {Promise<Object>} - Release result
   */
  async releaseTempNumber(numberKey, userId) {
    try {
      const numberData = this.activeNumbers.get(numberKey);
      if (!numberData) {
        throw new Error('Number not found');
      }

      if (numberData.userId !== userId) {
        throw new Error('Unauthorized - not your number');
      }

      // Release number from provider
      await virtualNumbersService.releaseVirtualNumber(numberData.phoneNumber);

      // Clean up from maps
      this.activeNumbers.delete(numberKey);
      
      if (this.userNumbers.has(userId)) {
        this.userNumbers.get(userId).delete(numberKey);
      }
      
      if (this.platformNumbers.has(numberData.platform)) {
        this.platformNumbers.get(numberData.platform).delete(numberKey);
      }

      this.messageHistory.delete(numberKey);

      logger.info('Temporary number released', {
        numberKey,
        userId,
        platform: numberData.platform,
        duration: Date.now() - numberData.createdAt.getTime()
      });

      return {
        success: true,
        message: 'Number released successfully',
        usageDuration: Date.now() - numberData.createdAt.getTime()
      };

    } catch (error) {
      logger.error('Failed to release temporary number', error);
      throw error;
    }
  }

  /**
   * Get user's active temporary numbers
   * @param {string} userId - User ID
   * @returns {Array} - Active numbers
   */
  getUserActiveNumbers(userId) {
    const userNumberKeys = this.userNumbers.get(userId) || new Set();
    const activeNumbers = [];

    for (const numberKey of userNumberKeys) {
      const numberData = this.activeNumbers.get(numberKey);
      if (numberData && numberData.status === 'active') {
        activeNumbers.push({
          numberKey: numberKey,
          phoneNumber: this.maskPhoneNumber(numberData.phoneNumber),
          platform: numberData.platform,
          country: numberData.country,
          createdAt: numberData.createdAt,
          expiresAt: numberData.expiresAt,
          verificationAttempts: numberData.verificationAttempts,
          maxRetries: numberData.maxRetries,
          hasReceivedMessages: numberData.receivedMessages.length > 0
        });
      }
    }

    return activeNumbers;
  }

  /**
   * Get platform statistics
   * @returns {Object} - Platform usage statistics
   */
  getPlatformStatistics() {
    const stats = {
      totalActiveNumbers: this.activeNumbers.size,
      platformBreakdown: {},
      recentActivity: [],
      successRates: {}
    };

    // Calculate platform breakdown
    for (const [platform, numberKeys] of this.platformNumbers.entries()) {
      const activeCount = Array.from(numberKeys).filter(key => 
        this.activeNumbers.has(key) && 
        this.activeNumbers.get(key).status === 'active'
      ).length;

      stats.platformBreakdown[platform] = {
        active: activeCount,
        total: numberKeys.size
      };
    }

    // Calculate success rates (simplified)
    for (const [platform, config] of Object.entries(this.platformConfigs)) {
      const platformNumbers = Array.from(this.activeNumbers.values())
        .filter(n => n.platform === platform);
      
      const successful = platformNumbers.filter(n => n.verificationAttempts > 0).length;
      const total = platformNumbers.length;
      
      stats.successRates[platform] = total > 0 ? (successful / total * 100).toFixed(1) : 0;
    }

    return stats;
  }

  /**
   * Get verification instructions for a platform
   * @param {string} platform - Platform name
   * @param {string} phoneNumber - Phone number
   * @returns {string} - Instructions
   */
  getVerificationInstructions(platform, phoneNumber) {
    const instructions = {
      'twitter': `1. Go to Twitter/X signup or verification page\n2. Enter this number: ${phoneNumber}\n3. Wait for SMS code (usually 30-60 seconds)\n4. The code will be automatically extracted`,
      
      'facebook': `1. Go to Facebook signup or verification page\n2. Enter this number: ${phoneNumber}\n3. Request SMS verification\n4. Code will be automatically detected`,
      
      'instagram': `1. Open Instagram app or website\n2. Go to verification settings\n3. Enter this number: ${phoneNumber}\n4. Request SMS code`,
      
      'whatsapp': `1. Install WhatsApp and start setup\n2. Enter this number: ${phoneNumber}\n3. Request SMS verification\n⚠️ Note: WhatsApp only allows 1 retry attempt`,
      
      'telegram': `1. Install Telegram and start setup\n2. Enter this number: ${phoneNumber}\n3. Wait for SMS code (usually very fast)`,
      
      'discord': `1. Go to Discord verification settings\n2. Enter this number: ${phoneNumber}\n3. Request SMS verification`,
      
      'default': `1. Go to ${platform} verification page\n2. Enter this number: ${phoneNumber}\n3. Request SMS verification\n4. Code will be automatically extracted`
    };

    return instructions[platform.toLowerCase()] || instructions['default'];
  }

  /**
   * Guess platform from SMS sender
   * @param {string} sender - SMS sender
   * @returns {string} - Guessed platform
   */
  guessPlatformFromSender(sender) {
    const senderLower = sender.toLowerCase();
    
    const patterns = {
      'twitter': ['twitter', 'twtr', '40404'],
      'facebook': ['facebook', 'fb', '32665'],
      'instagram': ['instagram', 'ig'],
      'whatsapp': ['whatsapp', 'wa'],
      'telegram': ['telegram', 'tg'],
      'discord': ['discord'],
      'linkedin': ['linkedin'],
      'tiktok': ['tiktok']
    };

    for (const [platform, keywords] of Object.entries(patterns)) {
      if (keywords.some(keyword => senderLower.includes(keyword))) {
        return platform;
      }
    }

    return 'unknown';
  }

  /**
   * Start cleanup routines for expired numbers
   */
  startCleanupRoutines() {
    // Clean up expired numbers every 5 minutes
    setInterval(() => {
      this.cleanupExpiredNumbers();
    }, 5 * 60 * 1000);

    // Clean up old verification sessions every hour
    setInterval(() => {
      this.cleanupOldSessions();
    }, 60 * 60 * 1000);
  }

  /**
   * Clean up expired numbers
   */
  async cleanupExpiredNumbers() {
    const now = new Date();
    const expiredKeys = [];

    for (const [numberKey, numberData] of this.activeNumbers.entries()) {
      if (numberData.expiresAt < now) {
        expiredKeys.push(numberKey);
      }
    }

    for (const numberKey of expiredKeys) {
      try {
        const numberData = this.activeNumbers.get(numberKey);
        
        // Release from provider
        await virtualNumbersService.releaseVirtualNumber(numberData.phoneNumber);
        
        // Clean up from maps
        this.activeNumbers.delete(numberKey);
        this.userNumbers.get(numberData.userId)?.delete(numberKey);
        this.platformNumbers.get(numberData.platform)?.delete(numberKey);
        this.messageHistory.delete(numberKey);

        logger.info('Expired temporary number cleaned up', {
          numberKey,
          platform: numberData.platform,
          userId: numberData.userId
        });
      } catch (error) {
        logger.error('Failed to cleanup expired number', error);
      }
    }

    if (expiredKeys.length > 0) {
      logger.info(`Cleaned up ${expiredKeys.length} expired temporary numbers`);
    }
  }

  /**
   * Clean up old verification sessions
   */
  cleanupOldSessions() {
    const now = Date.now();
    const oldSessions = [];

    for (const [sessionId, session] of this.verificationSessions.entries()) {
      // Remove sessions older than 1 hour
      if (now - session.startTime > 3600000) {
        oldSessions.push(sessionId);
      }
    }

    for (const sessionId of oldSessions) {
      this.verificationSessions.delete(sessionId);
    }

    if (oldSessions.length > 0) {
      logger.debug(`Cleaned up ${oldSessions.length} old verification sessions`);
    }
  }

  /**
   * Utility: Mask phone number for privacy
   * @param {string} phoneNumber - Phone number
   * @returns {string} - Masked number
   */
  maskPhoneNumber(phoneNumber) {
    if (!phoneNumber || phoneNumber.length < 8) return phoneNumber;
    return phoneNumber.substring(0, 4) + '***' + phoneNumber.substring(phoneNumber.length - 3);
  }

  /**
   * Health check
   * @returns {Object} - Health status
   */
  healthCheck() {
    return {
      status: this.initialized ? 'healthy' : 'unhealthy',
      activeNumbers: this.activeNumbers.size,
      activeSessions: this.verificationSessions.size,
      supportedPlatforms: Object.keys(this.platformConfigs).length,
      lastCleanup: new Date()
    };
  }
}

module.exports = new TempNumbersSocialMedia();