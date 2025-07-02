/**
 * 📧➡️📱 Email-to-SMS Bridge API Routes
 * RESTful endpoints for managing email-to-SMS conversions and social media forwarding
 */

const express = require('express');
const router = express.Router();
const emailToSMSBridge = require('../services/email-to-sms-bridge');
const { authenticateToken } = require('../middleware/auth');
const { body, param, query, validationResult } = require('express-validator');
const logger = require('../utils/logger');

/**
 * @swagger
 * components:
 *   schemas:
 *     EmailToSMSRule:
 *       type: object
 *       properties:
 *         name:
 *           type: string
 *         targetPhoneNumber:
 *           type: string
 *         senderFilters:
 *           type: array
 *           items:
 *             type: object
 *         template:
 *           type: string
 */

/**
 * @swagger
 * /api/email-to-sms/rules:
 *   post:
 *     summary: Create email-to-SMS forwarding rule
 *     tags: [Email to SMS]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - targetPhoneNumber
 *             properties:
 *               name:
 *                 type: string
 *                 description: Rule name
 *               targetPhoneNumber:
 *                 type: string
 *                 description: SMS destination number
 *               senderFilters:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     type:
 *                       type: string
 *                       enum: [exact, domain, contains]
 *                     value:
 *                       type: string
 *               subjectFilters:
 *                 type: array
 *                 items:
 *                   type: object
 *               contentFilters:
 *                 type: array
 *                 items:
 *                   type: object
 *               template:
 *                 type: string
 *                 description: SMS message template
 *               maxSMSLength:
 *                 type: integer
 *                 default: 160
 */
router.post('/rules', 
  authenticateToken,
  [
    body('name').trim().notEmpty().withMessage('Rule name is required'),
    body('targetPhoneNumber').isMobilePhone().withMessage('Valid phone number is required'),
    body('senderFilters').optional().isArray(),
    body('subjectFilters').optional().isArray(),
    body('contentFilters').optional().isArray(),
    body('template').optional().isString(),
    body('maxSMSLength').optional().isInt({ min: 50, max: 320 })
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const {
        name,
        targetPhoneNumber,
        senderFilters = [],
        subjectFilters = [],
        contentFilters = [],
        template,
        maxSMSLength = 160,
        priority = 'normal',
        preferredProvider
      } = req.body;

      const ruleId = emailToSMSBridge.createForwardingRule({
        name,
        targetPhoneNumber,
        senderFilters,
        subjectFilters,
        contentFilters,
        template,
        maxSMSLength,
        priority,
        preferredProvider,
        userId: req.user.id
      });

      res.json({
        success: true,
        message: 'Email-to-SMS forwarding rule created successfully',
        data: {
          ruleId,
          name,
          targetPhoneNumber: targetPhoneNumber.replace(/(\d{3})\d{4}(\d{3})/, '$1****$2') // Mask number
        }
      });

    } catch (error) {
      logger.error('Failed to create email-to-SMS rule', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create forwarding rule'
      });
    }
  }
);

/**
 * @swagger
 * /api/email-to-sms/social-media:
 *   post:
 *     summary: Setup email forwarding for social media notifications
 *     tags: [Email to SMS]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - platform
 *               - phoneNumber
 *             properties:
 *               platform:
 *                 type: string
 *                 enum: [twitter, facebook, instagram, linkedin, tiktok, snapchat, discord, telegram, whatsapp, reddit]
 *               phoneNumber:
 *                 type: string
 *               notificationTypes:
 *                 type: array
 *                 items:
 *                   type: string
 */
router.post('/social-media',
  authenticateToken,
  [
    body('platform').isIn(['twitter', 'facebook', 'instagram', 'linkedin', 'tiktok', 'snapchat', 'discord', 'telegram', 'whatsapp', 'reddit']).withMessage('Valid platform is required'),
    body('phoneNumber').isMobilePhone().withMessage('Valid phone number is required'),
    body('notificationTypes').optional().isArray()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const {
        platform,
        phoneNumber,
        notificationTypes = ['all']
      } = req.body;

      const result = emailToSMSBridge.setupSocialMediaForwarding({
        userId: req.user.id,
        platform,
        phoneNumber,
        notificationTypes
      });

      res.json({
        success: true,
        message: `Social media email forwarding setup for ${platform}`,
        data: {
          platform,
          forwardingEmail: result.forwardingEmail,
          ruleId: result.ruleId,
          instructions: result.instructions,
          setupSteps: [
            `1. Copy this email address: ${result.forwardingEmail}`,
            `2. Go to ${platform} notification settings`,
            `3. Add the email address to receive notifications`,
            `4. Configure which notifications you want as SMS`,
            `5. Test by triggering a notification`
          ]
        }
      });

    } catch (error) {
      logger.error('Failed to setup social media forwarding', error);
      res.status(500).json({
        success: false,
        error: 'Failed to setup social media forwarding'
      });
    }
  }
);

/**
 * @swagger
 * /api/email-to-sms/webhook:
 *   post:
 *     summary: Webhook endpoint for email services (SendGrid, Mailgun, etc.)
 *     tags: [Email to SMS]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 */
router.post('/webhook', async (req, res) => {
  try {
    // Verify webhook authenticity (implement based on email service)
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== process.env.EMAIL_BRIDGE_API_KEY) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized webhook request'
      });
    }

    const result = await emailToSMSBridge.processWebhookEmail(req.body);

    res.json({
      success: result.success,
      message: result.message
    });

  } catch (error) {
    logger.error('Failed to process webhook email', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process webhook email'
    });
  }
});

/**
 * @swagger
 * /api/email-to-sms/test:
 *   post:
 *     summary: Test email-to-SMS conversion with sample email
 *     tags: [Email to SMS]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - from
 *               - subject
 *               - content
 *               - targetPhoneNumber
 *             properties:
 *               from:
 *                 type: string
 *               subject:
 *                 type: string
 *               content:
 *                 type: string
 *               targetPhoneNumber:
 *                 type: string
 */
router.post('/test',
  authenticateToken,
  [
    body('from').isEmail().withMessage('Valid email address is required'),
    body('subject').trim().notEmpty().withMessage('Subject is required'),
    body('content').trim().notEmpty().withMessage('Content is required'),
    body('targetPhoneNumber').isMobilePhone().withMessage('Valid phone number is required')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const { from, subject, content, targetPhoneNumber } = req.body;

      // Create temporary test rule
      const testRuleId = emailToSMSBridge.createForwardingRule({
        name: `Test rule for ${req.user.id}`,
        targetPhoneNumber,
        senderFilters: [{ type: 'exact', value: from }],
        template: 'TEST: {subject}\nFrom: {from}\n{content}',
        maxSMSLength: 160,
        userId: req.user.id,
        temporary: true
      });

      // Simulate email processing
      const emailData = {
        from,
        subject,
        text: content,
        date: new Date()
      };

      const rule = { 
        targetPhoneNumber,
        template: 'TEST: {subject}\nFrom: {from}\n{content}',
        maxSMSLength: 160
      };

      // Generate SMS content
      const smsContent = emailToSMSBridge.generateSMSContent(emailData, rule);

      res.json({
        success: true,
        message: 'Email-to-SMS conversion tested successfully',
        data: {
          testRuleId,
          emailData: {
            from,
            subject,
            content: content.substring(0, 100) + (content.length > 100 ? '...' : '')
          },
          smsPreview: smsContent,
          smsLength: smsContent.length,
          estimatedParts: Math.ceil(smsContent.length / 160),
          note: 'This is a preview. No SMS was actually sent.'
        }
      });

    } catch (error) {
      logger.error('Failed to test email-to-SMS conversion', error);
      res.status(500).json({
        success: false,
        error: 'Failed to test conversion'
      });
    }
  }
);

/**
 * @swagger
 * /api/email-to-sms/statistics:
 *   get:
 *     summary: Get email-to-SMS conversion statistics
 *     tags: [Email to SMS]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [1d, 7d, 30d, 90d]
 *         description: Statistics period
 */
router.get('/statistics',
  authenticateToken,
  [
    query('period').optional().isIn(['1d', '7d', '30d', '90d'])
  ],
  async (req, res) => {
    try {
      const { period = '7d' } = req.query;

      const statistics = await emailToSMSBridge.getConversionStatistics({
        userId: req.user.id,
        period
      });

      res.json({
        success: true,
        data: {
          period,
          ...statistics,
          costSavings: {
            estimatedEmailChecks: statistics.totalConversions * 10,
            estimatedSMSCost: statistics.totalConversions * 0.01,
            automationValue: statistics.totalConversions * 0.25
          }
        }
      });

    } catch (error) {
      logger.error('Failed to get email-to-SMS statistics', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve statistics'
      });
    }
  }
);

/**
 * @swagger
 * /api/email-to-sms/platforms:
 *   get:
 *     summary: Get supported social media platforms
 *     tags: [Email to SMS]
 *     responses:
 *       200:
 *         description: List of supported platforms
 */
router.get('/platforms', async (req, res) => {
  try {
    const platforms = [
      {
        id: 'twitter',
        name: 'Twitter/X',
        icon: '🐦',
        notificationTypes: ['mentions', 'messages', 'follows', 'likes', 'retweets'],
        setupDifficulty: 'easy',
        avgSetupTime: '2 minutes'
      },
      {
        id: 'facebook',
        name: 'Facebook',
        icon: '📘',
        notificationTypes: ['messages', 'friend_requests', 'comments', 'likes', 'events'],
        setupDifficulty: 'easy',
        avgSetupTime: '3 minutes'
      },
      {
        id: 'instagram',
        name: 'Instagram',
        icon: '📷',
        notificationTypes: ['messages', 'follows', 'likes', 'comments'],
        setupDifficulty: 'medium',
        avgSetupTime: '5 minutes'
      },
      {
        id: 'linkedin',
        name: 'LinkedIn',
        icon: '💼',
        notificationTypes: ['messages', 'connections', 'job_alerts', 'company_updates'],
        setupDifficulty: 'easy',
        avgSetupTime: '3 minutes'
      },
      {
        id: 'discord',
        name: 'Discord',
        icon: '🎮',
        notificationTypes: ['messages', 'mentions', 'server_updates'],
        setupDifficulty: 'easy',
        avgSetupTime: '2 minutes'
      },
      {
        id: 'telegram',
        name: 'Telegram',
        icon: '📬',
        notificationTypes: ['messages', 'channel_updates', 'bot_notifications'],
        setupDifficulty: 'medium',
        avgSetupTime: '4 minutes'
      },
      {
        id: 'tiktok',
        name: 'TikTok',
        icon: '🎵',
        notificationTypes: ['messages', 'follows', 'likes', 'comments'],
        setupDifficulty: 'medium',
        avgSetupTime: '5 minutes'
      },
      {
        id: 'snapchat',
        name: 'Snapchat',
        icon: '👻',
        notificationTypes: ['messages', 'story_replies', 'friend_requests'],
        setupDifficulty: 'hard',
        avgSetupTime: '10 minutes'
      },
      {
        id: 'reddit',
        name: 'Reddit',
        icon: '🤖',
        notificationTypes: ['messages', 'comment_replies', 'mentions', 'post_replies'],
        setupDifficulty: 'easy',
        avgSetupTime: '3 minutes'
      },
      {
        id: 'whatsapp',
        name: 'WhatsApp Business',
        icon: '💚',
        notificationTypes: ['business_messages', 'status_updates'],
        setupDifficulty: 'medium',
        avgSetupTime: '5 minutes'
      }
    ];

    res.json({
      success: true,
      data: {
        platforms,
        totalSupported: platforms.length,
        features: [
          'Real-time email-to-SMS conversion',
          'Automatic code extraction',
          'Custom message templates',
          'Multi-platform support',
          'Usage analytics and reporting'
        ]
      }
    });

  } catch (error) {
    logger.error('Failed to get supported platforms', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve platforms'
    });
  }
});

/**
 * @swagger
 * /api/email-to-sms/inbox/{platform}:
 *   get:
 *     summary: Get received emails for a specific platform
 *     tags: [Email to SMS]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: platform
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 */
router.get('/inbox/:platform',
  authenticateToken,
  [
    param('platform').isAlpha().withMessage('Valid platform name is required'),
    query('limit').optional().isInt({ min: 1, max: 100 })
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const { platform } = req.params;
      const { limit = 20 } = req.query;

      // This would query your database for received emails/conversions
      // For now, returning mock data
      const mockEmails = Array.from({ length: Math.min(limit, 10) }, (_, i) => ({
        id: `email_${i + 1}`,
        platform,
        from: `${platform}-notifications@${platform}.com`,
        subject: `${platform} notification ${i + 1}`,
        receivedAt: new Date(Date.now() - (i * 3600000)),
        converted: Math.random() > 0.2,
        smsContent: `🔔 ${platform.toUpperCase()}: New notification`,
        deliveryStatus: Math.random() > 0.1 ? 'delivered' : 'failed'
      }));

      res.json({
        success: true,
        data: {
          platform,
          emails: mockEmails,
          total: mockEmails.length,
          summary: {
            received: mockEmails.length,
            converted: mockEmails.filter(e => e.converted).length,
            delivered: mockEmails.filter(e => e.deliveryStatus === 'delivered').length
          }
        }
      });

    } catch (error) {
      logger.error('Failed to get platform inbox', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve inbox'
      });
    }
  }
);

/**
 * @swagger
 * /api/email-to-sms/health:
 *   get:
 *     summary: Get email-to-SMS service health status
 *     tags: [Email to SMS]
 *     security:
 *       - bearerAuth: []
 */
router.get('/health', authenticateToken, async (req, res) => {
  try {
    const health = {
      status: emailToSMSBridge.initialized ? 'healthy' : 'unhealthy',
      emailAccounts: emailToSMSBridge.emailAccounts.size,
      forwardingRules: emailToSMSBridge.forwardingRules.size,
      features: [
        'IMAP email monitoring',
        'Webhook email processing',
        'Social media integration',
        'Custom forwarding rules',
        'SMS template customization'
      ],
      lastCheck: new Date()
    };

    res.json({
      success: true,
      data: health
    });

  } catch (error) {
    logger.error('Failed to get email-to-SMS health status', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get health status'
    });
  }
});

module.exports = router;