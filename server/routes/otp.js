import express from 'express';
import { body, param, query, validationResult } from 'express-validator';
import rateLimit from 'express-rate-limit';
import VirtualNumberService from '../services/virtualNumbers.js';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth.js';
import { logger } from '../index.js';

const router = express.Router();

// Rate limiting for OTP endpoints
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 OTP requests per windowMs
  message: 'Too many OTP requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 verification attempts per windowMs
  message: 'Too many verification attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Validation middleware
const validatePhoneNumber = [
  body('phoneNumber')
    .matches(/^\+[1-9]\d{1,14}$/)
    .withMessage('Invalid phone number format. Use E.164 format (e.g., +1234567890)'),
];

const validateOTP = [
  body('otp')
    .isLength({ min: 4, max: 8 })
    .isNumeric()
    .withMessage('OTP must be 4-8 digits'),
  body('sessionId')
    .isUUID()
    .withMessage('Invalid session ID'),
];

const validateCountryCode = [
  body('countryCode')
    .isLength({ min: 2, max: 2 })
    .isAlpha()
    .toUpperCase()
    .withMessage('Country code must be 2 letters (e.g., US, GB, IN)'),
];

// Error handler for validation
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array()
    });
  }
  next();
};

/**
 * @route   POST /api/otp/send
 * @desc    Send OTP to phone number
 * @access  Public (with rate limiting)
 */
router.post('/send', 
  otpLimiter,
  validatePhoneNumber,
  [
    body('purpose')
      .optional()
      .isIn(['verification', 'login', 'password_reset', 'phone_verification', 'transaction_approval'])
      .withMessage('Invalid purpose'),
    body('options.length')
      .optional()
      .isInt({ min: 4, max: 8 })
      .withMessage('OTP length must be between 4 and 8'),
    body('options.expiryMinutes')
      .optional()
      .isInt({ min: 1, max: 60 })
      .withMessage('Expiry must be between 1 and 60 minutes'),
    body('options.maxAttempts')
      .optional()
      .isInt({ min: 1, max: 10 })
      .withMessage('Max attempts must be between 1 and 10'),
    body('options.customMessage')
      .optional()
      .isLength({ max: 160 })
      .withMessage('Custom message must not exceed 160 characters'),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { phoneNumber, purpose = 'verification', options = {} } = req.body;
      
      logger.info(`OTP send request for ${phoneNumber}, purpose: ${purpose}`);
      
      const result = await VirtualNumberService.sendOTP(phoneNumber, purpose, options);
      
      res.status(200).json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error('Failed to send OTP:', error);
      res.status(400).json({
        error: 'Failed to send OTP',
        message: error.message
      });
    }
  }
);

/**
 * @route   POST /api/otp/verify
 * @desc    Verify OTP
 * @access  Public (with rate limiting)
 */
router.post('/verify',
  verifyLimiter,
  validatePhoneNumber,
  validateOTP,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { sessionId, otp, phoneNumber } = req.body;
      
      logger.info(`OTP verification attempt for ${phoneNumber}, session: ${sessionId}`);
      
      const result = await VirtualNumberService.verifyOTP(sessionId, otp, phoneNumber);
      
      res.status(200).json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error('OTP verification failed:', error);
      res.status(400).json({
        error: 'OTP verification failed',
        message: error.message
      });
    }
  }
);

/**
 * @route   POST /api/otp/resend
 * @desc    Resend OTP for existing session
 * @access  Public (with rate limiting)
 */
router.post('/resend',
  otpLimiter,
  [
    body('sessionId')
      .isUUID()
      .withMessage('Invalid session ID'),
    body('method')
      .optional()
      .isIn(['sms', 'voice', 'whatsapp'])
      .withMessage('Invalid resend method'),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { sessionId, method = 'sms' } = req.body;
      
      // Get session data to extract phone number
      const sessionData = await redis.get(`otp_session:${sessionId}`);
      if (!sessionData) {
        return res.status(400).json({
          error: 'Invalid session',
          message: 'Session not found or expired'
        });
      }
      
      const session = JSON.parse(sessionData);
      
      let result;
      switch (method) {
        case 'voice':
          await VirtualNumberService.sendVoiceOTP(session.phoneNumber, session.otp);
          result = { message: 'OTP sent via voice call' };
          break;
        case 'whatsapp':
          await VirtualNumberService.sendWhatsAppOTP(session.phoneNumber, session.otp);
          result = { message: 'OTP sent via WhatsApp' };
          break;
        default:
          result = await VirtualNumberService.sendOTP(session.phoneNumber, session.purpose, {
            length: session.otp.length,
            expiryMinutes: Math.ceil((new Date(session.expiresAt) - new Date()) / 60000)
          });
      }
      
      res.status(200).json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error('Failed to resend OTP:', error);
      res.status(400).json({
        error: 'Failed to resend OTP',
        message: error.message
      });
    }
  }
);

/**
 * @route   GET /api/otp/virtual-number/:countryCode
 * @desc    Get virtual number for country
 * @access  Protected
 */
router.get('/virtual-number/:countryCode',
  authMiddleware,
  [
    param('countryCode')
      .isLength({ min: 2, max: 2 })
      .isAlpha()
      .toUpperCase()
      .withMessage('Invalid country code'),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { countryCode } = req.params;
      const userId = req.user.id;
      
      const virtualNumber = await VirtualNumberService.getVirtualNumber(countryCode, userId);
      
      res.status(200).json({
        success: true,
        data: virtualNumber
      });
    } catch (error) {
      logger.error('Failed to get virtual number:', error);
      res.status(400).json({
        error: 'Failed to get virtual number',
        message: error.message
      });
    }
  }
);

/**
 * @route   DELETE /api/otp/virtual-number/:phoneNumber
 * @desc    Release virtual number
 * @access  Protected
 */
router.delete('/virtual-number/:phoneNumber',
  authMiddleware,
  [
    param('phoneNumber')
      .matches(/^\+[1-9]\d{1,14}$/)
      .withMessage('Invalid phone number format'),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { phoneNumber } = req.params;
      
      const released = await VirtualNumberService.releaseVirtualNumber(phoneNumber);
      
      if (!released) {
        return res.status(404).json({
          error: 'Virtual number not found',
          message: 'The specified virtual number was not found or not assigned to you'
        });
      }
      
      res.status(200).json({
        success: true,
        message: 'Virtual number released successfully'
      });
    } catch (error) {
      logger.error('Failed to release virtual number:', error);
      res.status(400).json({
        error: 'Failed to release virtual number',
        message: error.message
      });
    }
  }
);

/**
 * @route   POST /api/otp/bulk-sms
 * @desc    Send bulk SMS messages
 * @access  Protected
 */
router.post('/bulk-sms',
  authMiddleware,
  [
    body('phoneNumbers')
      .isArray({ min: 1, max: 1000 })
      .withMessage('Phone numbers must be an array with 1-1000 numbers'),
    body('phoneNumbers.*')
      .matches(/^\+[1-9]\d{1,14}$/)
      .withMessage('Invalid phone number format in array'),
    body('message')
      .isLength({ min: 1, max: 160 })
      .withMessage('Message must be 1-160 characters'),
    body('options.batchSize')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Batch size must be between 1 and 100'),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { phoneNumbers, message, options = {} } = req.body;
      
      logger.info(`Bulk SMS request for ${phoneNumbers.length} numbers`);
      
      const results = await VirtualNumberService.sendBulkSMS(phoneNumbers, message, options);
      
      const summary = {
        total: results.length,
        sent: results.filter(r => r.status === 'sent').length,
        failed: results.filter(r => r.status === 'failed').length
      };
      
      res.status(200).json({
        success: true,
        data: {
          summary,
          results
        }
      });
    } catch (error) {
      logger.error('Bulk SMS failed:', error);
      res.status(400).json({
        error: 'Bulk SMS failed',
        message: error.message
      });
    }
  }
);

/**
 * @route   GET /api/otp/stats/:phoneNumber
 * @desc    Get OTP statistics for phone number
 * @access  Protected
 */
router.get('/stats/:phoneNumber',
  authMiddleware,
  [
    param('phoneNumber')
      .matches(/^\+[1-9]\d{1,14}$/)
      .withMessage('Invalid phone number format'),
    query('days')
      .optional()
      .isInt({ min: 1, max: 30 })
      .withMessage('Days must be between 1 and 30'),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { phoneNumber } = req.params;
      const days = parseInt(req.query.days) || 7;
      
      const stats = await VirtualNumberService.getOTPStats(phoneNumber, days);
      
      res.status(200).json({
        success: true,
        data: {
          phoneNumber: VirtualNumberService.maskPhoneNumber(phoneNumber),
          period: `${days} days`,
          stats
        }
      });
    } catch (error) {
      logger.error('Failed to get OTP stats:', error);
      res.status(400).json({
        error: 'Failed to get OTP stats',
        message: error.message
      });
    }
  }
);

/**
 * @route   POST /api/otp/totp/setup
 * @desc    Setup TOTP (Time-based OTP) for enhanced security
 * @access  Protected
 */
router.post('/totp/setup',
  authMiddleware,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const userEmail = req.user.email;
      
      // Generate TOTP secret
      const secret = speakeasy.generateSecret({
        name: encodeURIComponent(userEmail),
        issuer: 'VaultText Advanced Platform'
      });
      
      // Generate QR code
      const qrCodeUrl = await VirtualNumberService.generateTOTPQRCode(userEmail, secret.base32);
      
      // Store secret temporarily (user needs to verify setup)
      await redis.setex(`totp_setup:${userId}`, 300, secret.base32); // 5 minutes
      
      res.status(200).json({
        success: true,
        data: {
          secret: secret.base32,
          qrCode: qrCodeUrl,
          backupCodes: [], // Could generate backup codes here
          message: 'Scan the QR code with your authenticator app and verify to complete setup'
        }
      });
    } catch (error) {
      logger.error('TOTP setup failed:', error);
      res.status(400).json({
        error: 'TOTP setup failed',
        message: error.message
      });
    }
  }
);

/**
 * @route   POST /api/otp/totp/verify-setup
 * @desc    Verify TOTP setup
 * @access  Protected
 */
router.post('/totp/verify-setup',
  authMiddleware,
  [
    body('token')
      .isLength({ min: 6, max: 6 })
      .isNumeric()
      .withMessage('TOTP token must be 6 digits'),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { token } = req.body;
      const userId = req.user.id;
      
      // Get temporary secret
      const secret = await redis.get(`totp_setup:${userId}`);
      if (!secret) {
        return res.status(400).json({
          error: 'Setup session expired',
          message: 'Please start the TOTP setup process again'
        });
      }
      
      // Verify token
      const verified = speakeasy.totp.verify({
        secret,
        encoding: 'base32',
        token,
        window: 2
      });
      
      if (!verified) {
        return res.status(400).json({
          error: 'Invalid token',
          message: 'The TOTP token is incorrect'
        });
      }
      
      // Save secret permanently (in real app, save to database)
      await redis.setex(`totp_secret:${userId}`, 0, secret); // No expiry
      await redis.del(`totp_setup:${userId}`);
      
      res.status(200).json({
        success: true,
        message: 'TOTP setup completed successfully'
      });
    } catch (error) {
      logger.error('TOTP verification failed:', error);
      res.status(400).json({
        error: 'TOTP verification failed',
        message: error.message
      });
    }
  }
);

/**
 * @route   POST /api/otp/totp/verify
 * @desc    Verify TOTP token
 * @access  Protected
 */
router.post('/totp/verify',
  authMiddleware,
  [
    body('token')
      .isLength({ min: 6, max: 6 })
      .isNumeric()
      .withMessage('TOTP token must be 6 digits'),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { token } = req.body;
      const userId = req.user.id;
      
      // Get user's TOTP secret
      const secret = await redis.get(`totp_secret:${userId}`);
      if (!secret) {
        return res.status(400).json({
          error: 'TOTP not configured',
          message: 'Please set up TOTP first'
        });
      }
      
      // Verify token
      const verified = speakeasy.totp.verify({
        secret,
        encoding: 'base32',
        token,
        window: 2
      });
      
      if (!verified) {
        return res.status(400).json({
          error: 'Invalid token',
          message: 'The TOTP token is incorrect'
        });
      }
      
      res.status(200).json({
        success: true,
        message: 'TOTP token verified successfully'
      });
    } catch (error) {
      logger.error('TOTP verification failed:', error);
      res.status(400).json({
        error: 'TOTP verification failed',
        message: error.message
      });
    }
  }
);

/**
 * @route   GET /api/otp/health
 * @desc    Health check for OTP service
 * @access  Public
 */
router.get('/health', async (req, res) => {
  try {
    const providers = ['twilio', 'messagebird', 'vonage'];
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      providers: {}
    };
    
    // Check each provider (simplified check)
    for (const provider of providers) {
      try {
        // In a real implementation, you'd ping each provider's API
        health.providers[provider] = 'available';
      } catch (error) {
        health.providers[provider] = 'unavailable';
      }
    }
    
    res.status(200).json(health);
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});

export default router;