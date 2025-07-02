/**
 * 📧➡️📱 Email-to-SMS Bridge Service
 * Converts incoming emails to SMS messages with intelligent content processing
 * Supports multiple email sources and SMS delivery providers
 */

const nodemailer = require('nodemailer');
const { simpleParser } = require('mailparser');
const virtualNumbersService = require('./virtualNumbers');
const logger = require('../utils/logger');
const crypto = require('crypto');

class EmailToSMSBridge {
  constructor() {
    this.emailAccounts = new Map();
    this.forwardingRules = new Map();
    this.smsProviders = virtualNumbersService;
    this.initialized = false;
    
    this.init();
  }

  /**
   * Initialize email-to-SMS bridge service
   */
  async init() {
    try {
      // Initialize email accounts for receiving emails
      await this.setupEmailAccounts();
      
      // Start email monitoring
      this.startEmailMonitoring();
      
      this.initialized = true;
      logger.info('Email-to-SMS bridge service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize email-to-SMS bridge', error);
    }
  }

  /**
   * Setup email accounts for receiving emails
   */
  async setupEmailAccounts() {
    // Setup multiple email receiving methods
    const emailConfigs = [
      {
        id: 'primary',
        type: 'imap',
        host: process.env.EMAIL_BRIDGE_IMAP_HOST || 'imap.gmail.com',
        port: 993,
        secure: true,
        auth: {
          user: process.env.EMAIL_BRIDGE_USER,
          pass: process.env.EMAIL_BRIDGE_PASS
        }
      },
      {
        id: 'webhook',
        type: 'webhook',
        endpoint: '/api/email-bridge/webhook',
        apiKey: process.env.EMAIL_BRIDGE_API_KEY
      }
    ];

    for (const config of emailConfigs) {
      this.emailAccounts.set(config.id, config);
      logger.info(`Email account configured: ${config.id} (${config.type})`);
    }
  }

  /**
   * Start monitoring emails for conversion
   */
  startEmailMonitoring() {
    // Monitor IMAP accounts
    this.monitorIMAPAccount('primary');
    
    // Setup webhook endpoints (handled in routes)
    logger.info('Email monitoring started for all configured accounts');
  }

  /**
   * Monitor IMAP account for new emails
   * @param {string} accountId - Email account ID
   */
  async monitorIMAPAccount(accountId) {
    const account = this.emailAccounts.get(accountId);
    if (!account || account.type !== 'imap') return;

    try {
      const { ImapFlow } = require('imapflow');
      
      const client = new ImapFlow({
        host: account.host,
        port: account.port,
        secure: account.secure,
        auth: account.auth,
        logger: false
      });

      // Connect to email server
      await client.connect();
      
      // Listen for new emails
      client.on('exists', async (data) => {
        logger.info(`New email detected in ${accountId}:`, data);
        await this.processNewEmails(client, accountId);
      });

      // Keep connection alive
      setInterval(async () => {
        try {
          await client.noop();
        } catch (error) {
          logger.error('IMAP keep-alive failed', error);
          // Reconnect logic here
        }
      }, 60000); // 1 minute

      logger.info(`IMAP monitoring started for account: ${accountId}`);
    } catch (error) {
      logger.error(`Failed to monitor IMAP account ${accountId}`, error);
    }
  }

  /**
   * Process new emails and convert to SMS
   * @param {Object} client - IMAP client
   * @param {string} accountId - Account ID
   */
  async processNewEmails(client, accountId) {
    try {
      // Get unseen emails
      const messages = client.fetch('UNSEEN', {
        envelope: true,
        source: true
      });

      for await (const message of messages) {
        await this.processEmailMessage(message, accountId);
      }
    } catch (error) {
      logger.error('Failed to process new emails', error);
    }
  }

  /**
   * Process individual email message
   * @param {Object} message - Email message
   * @param {string} accountId - Account ID
   */
  async processEmailMessage(message, accountId) {
    try {
      // Parse email content
      const parsed = await simpleParser(message.source);
      
      // Extract relevant information
      const emailData = {
        messageId: message.uid,
        from: parsed.from.text,
        to: parsed.to?.text || '',
        subject: parsed.subject || '',
        text: parsed.text || '',
        html: parsed.html || '',
        date: parsed.date,
        attachments: parsed.attachments || []
      };

      // Check forwarding rules
      const forwardingRule = this.findForwardingRule(emailData);
      if (!forwardingRule) {
        logger.debug('No forwarding rule found for email', {
          from: emailData.from,
          subject: emailData.subject
        });
        return;
      }

      // Convert to SMS
      await this.convertEmailToSMS(emailData, forwardingRule);

    } catch (error) {
      logger.error('Failed to process email message', error);
    }
  }

  /**
   * Convert email to SMS message
   * @param {Object} emailData - Parsed email data
   * @param {Object} rule - Forwarding rule
   */
  async convertEmailToSMS(emailData, rule) {
    try {
      // Generate SMS content based on rule
      const smsContent = this.generateSMSContent(emailData, rule);
      
      // Send SMS
      const smsResult = await this.smsProviders.sendSMS({
        phoneNumber: rule.targetPhoneNumber,
        message: smsContent,
        provider: rule.preferredProvider || 'auto',
        options: {
          priority: rule.priority || 'normal',
          retryAttempts: 3
        }
      });

      // Log the conversion
      logger.info('Email converted to SMS successfully', {
        emailFrom: emailData.from,
        emailSubject: emailData.subject,
        targetPhone: this.maskPhoneNumber(rule.targetPhoneNumber),
        smsId: smsResult.messageId,
        provider: smsResult.provider
      });

      // Store conversion record
      await this.storeConversionRecord({
        emailData,
        rule,
        smsResult,
        timestamp: new Date()
      });

    } catch (error) {
      logger.error('Failed to convert email to SMS', error);
    }
  }

  /**
   * Generate SMS content from email
   * @param {Object} emailData - Email data
   * @param {Object} rule - Forwarding rule
   * @returns {string} - SMS content
   */
  generateSMSContent(emailData, rule) {
    const maxLength = rule.maxSMSLength || 160;
    let content = '';

    // Build content based on rule template
    if (rule.template) {
      content = rule.template
        .replace('{from}', this.extractEmailAddress(emailData.from))
        .replace('{subject}', emailData.subject)
        .replace('{content}', emailData.text)
        .replace('{date}', emailData.date.toLocaleString());
    } else {
      // Default template
      const fromEmail = this.extractEmailAddress(emailData.from);
      const subject = emailData.subject ? `📧 ${emailData.subject}` : '📧 New Email';
      const preview = this.extractTextPreview(emailData.text, 100);
      
      content = `${subject}\nFrom: ${fromEmail}\n${preview}`;
    }

    // Truncate if too long
    if (content.length > maxLength) {
      content = content.substring(0, maxLength - 3) + '...';
    }

    return content;
  }

  /**
   * Find applicable forwarding rule for email
   * @param {Object} emailData - Email data
   * @returns {Object|null} - Forwarding rule or null
   */
  findForwardingRule(emailData) {
    for (const [ruleId, rule] of this.forwardingRules.entries()) {
      if (this.matchesRule(emailData, rule)) {
        return { ...rule, id: ruleId };
      }
    }
    return null;
  }

  /**
   * Check if email matches forwarding rule
   * @param {Object} emailData - Email data
   * @param {Object} rule - Forwarding rule
   * @returns {boolean} - Match result
   */
  matchesRule(emailData, rule) {
    // Check sender filters
    if (rule.senderFilters) {
      const fromEmail = this.extractEmailAddress(emailData.from);
      const matchesSender = rule.senderFilters.some(filter => {
        if (filter.type === 'exact') {
          return fromEmail.toLowerCase() === filter.value.toLowerCase();
        } else if (filter.type === 'domain') {
          return fromEmail.toLowerCase().endsWith(filter.value.toLowerCase());
        } else if (filter.type === 'contains') {
          return fromEmail.toLowerCase().includes(filter.value.toLowerCase());
        }
        return false;
      });
      if (!matchesSender) return false;
    }

    // Check subject filters
    if (rule.subjectFilters) {
      const matchesSubject = rule.subjectFilters.some(filter => {
        if (filter.type === 'contains') {
          return emailData.subject.toLowerCase().includes(filter.value.toLowerCase());
        } else if (filter.type === 'startsWith') {
          return emailData.subject.toLowerCase().startsWith(filter.value.toLowerCase());
        }
        return false;
      });
      if (!matchesSubject) return false;
    }

    // Check content filters
    if (rule.contentFilters) {
      const matchesContent = rule.contentFilters.some(filter => {
        return emailData.text.toLowerCase().includes(filter.value.toLowerCase());
      });
      if (!matchesContent) return false;
    }

    return true;
  }

  /**
   * Create email-to-SMS forwarding rule
   * @param {Object} ruleConfig - Rule configuration
   * @returns {string} - Rule ID
   */
  createForwardingRule(ruleConfig) {
    const ruleId = crypto.randomUUID();
    
    const rule = {
      id: ruleId,
      name: ruleConfig.name,
      targetPhoneNumber: ruleConfig.targetPhoneNumber,
      senderFilters: ruleConfig.senderFilters || [],
      subjectFilters: ruleConfig.subjectFilters || [],
      contentFilters: ruleConfig.contentFilters || [],
      template: ruleConfig.template,
      maxSMSLength: ruleConfig.maxSMSLength || 160,
      priority: ruleConfig.priority || 'normal',
      preferredProvider: ruleConfig.preferredProvider,
      enabled: ruleConfig.enabled !== false,
      createdAt: new Date(),
      userId: ruleConfig.userId
    };

    this.forwardingRules.set(ruleId, rule);
    
    logger.info('Email-to-SMS forwarding rule created', {
      ruleId,
      name: rule.name,
      targetPhone: this.maskPhoneNumber(rule.targetPhoneNumber)
    });

    return ruleId;
  }

  /**
   * Process webhook email (for services like SendGrid, Mailgun)
   * @param {Object} webhookData - Webhook payload
   * @returns {Promise<Object>} - Processing result
   */
  async processWebhookEmail(webhookData) {
    try {
      // Normalize webhook data based on provider
      const emailData = this.normalizeWebhookData(webhookData);
      
      // Find and apply forwarding rules
      const forwardingRule = this.findForwardingRule(emailData);
      if (!forwardingRule) {
        return {
          success: false,
          message: 'No forwarding rule found for this email'
        };
      }

      // Convert to SMS
      await this.convertEmailToSMS(emailData, forwardingRule);

      return {
        success: true,
        message: 'Email converted to SMS successfully'
      };
    } catch (error) {
      logger.error('Failed to process webhook email', error);
      throw error;
    }
  }

  /**
   * Setup email forwarding for social media notifications
   * @param {Object} config - Social media forwarding config
   * @returns {string} - Unique email address for forwarding
   */
  setupSocialMediaForwarding(config) {
    const {
      userId,
      platform, // 'twitter', 'facebook', 'instagram', 'linkedin', etc.
      phoneNumber,
      notificationTypes = ['all'] // 'mentions', 'messages', 'follows', etc.
    } = config;

    // Generate unique email address for this user/platform
    const uniqueId = crypto.randomBytes(8).toString('hex');
    const forwardingEmail = `${platform}-${uniqueId}@${process.env.EMAIL_BRIDGE_DOMAIN}`;

    // Create forwarding rule
    const ruleId = this.createForwardingRule({
      name: `${platform} notifications for user ${userId}`,
      targetPhoneNumber: phoneNumber,
      senderFilters: [
        { type: 'domain', value: this.getSocialMediaDomain(platform) },
        { type: 'contains', value: 'noreply' }
      ],
      template: `🔔 ${platform.toUpperCase()}: {subject}\n{content}`,
      maxSMSLength: 160,
      priority: 'normal',
      userId: userId,
      platform: platform,
      notificationTypes: notificationTypes
    });

    logger.info('Social media email forwarding setup', {
      userId,
      platform,
      forwardingEmail,
      ruleId
    });

    return {
      forwardingEmail,
      ruleId,
      instructions: this.getSocialMediaSetupInstructions(platform, forwardingEmail)
    };
  }

  /**
   * Get social media domain for filtering
   * @param {string} platform - Social media platform
   * @returns {string} - Email domain
   */
  getSocialMediaDomain(platform) {
    const domains = {
      'twitter': 'twitter.com',
      'facebook': 'facebook.com',
      'instagram': 'instagram.com',
      'linkedin': 'linkedin.com',
      'tiktok': 'tiktok.com',
      'snapchat': 'snapchat.com',
      'discord': 'discord.com',
      'telegram': 'telegram.org',
      'whatsapp': 'whatsapp.com',
      'reddit': 'reddit.com'
    };
    return domains[platform.toLowerCase()] || 'unknown.com';
  }

  /**
   * Get setup instructions for social media platform
   * @param {string} platform - Platform name
   * @param {string} email - Forwarding email
   * @returns {string} - Setup instructions
   */
  getSocialMediaSetupInstructions(platform, email) {
    const instructions = {
      'twitter': `1. Go to Settings → Notifications → Email notifications
2. Enter this email: ${email}
3. Select notification types you want forwarded to SMS`,
      
      'facebook': `1. Go to Settings → Notifications → Email
2. Add this email: ${email}
3. Configure which notifications to receive`,
      
      'instagram': `1. Go to Settings → Notifications → Email Notifications
2. Enter this email: ${email}
3. Choose notification preferences`,
      
      'linkedin': `1. Go to Settings → Communications → Email frequency
2. Set email to: ${email}
3. Select professional updates you want as SMS`
    };

    return instructions[platform.toLowerCase()] || 
           `Add ${email} to your ${platform} notification settings`;
  }

  /**
   * Get statistics for email-to-SMS conversions
   * @param {Object} filters - Query filters
   * @returns {Object} - Statistics
   */
  async getConversionStatistics(filters = {}) {
    // This would query your database for conversion records
    // For now, returning mock data structure
    return {
      totalConversions: 1234,
      todayConversions: 45,
      successRate: 98.5,
      averageDeliveryTime: '2.3s',
      topSourceDomains: [
        { domain: 'twitter.com', count: 456 },
        { domain: 'facebook.com', count: 321 },
        { domain: 'linkedin.com', count: 234 }
      ],
      providerDistribution: {
        'twilio': 45,
        'messagebird': 30,
        'vonage': 25
      },
      dailyTrend: [
        // Last 7 days conversion counts
      ]
    };
  }

  /**
   * Utility functions
   */
  extractEmailAddress(fromField) {
    const match = fromField.match(/<([^>]+)>/);
    return match ? match[1] : fromField;
  }

  extractTextPreview(text, maxLength = 100) {
    if (!text) return '';
    return text.length > maxLength ? 
           text.substring(0, maxLength) + '...' : text;
  }

  maskPhoneNumber(phoneNumber) {
    if (!phoneNumber || phoneNumber.length < 8) return phoneNumber;
    return phoneNumber.substring(0, 3) + '***' + phoneNumber.substring(phoneNumber.length - 4);
  }

  normalizeWebhookData(webhookData) {
    // Normalize different webhook formats (SendGrid, Mailgun, etc.)
    // This is a simplified version - would need specific implementations
    return {
      from: webhookData.from || webhookData.sender,
      to: webhookData.to || webhookData.recipient,
      subject: webhookData.subject,
      text: webhookData.text || webhookData['body-plain'],
      html: webhookData.html || webhookData['body-html'],
      date: new Date(webhookData.timestamp || Date.now())
    };
  }

  async storeConversionRecord(record) {
    // Store conversion record in database for analytics
    // Implementation would depend on your database choice
    logger.debug('Conversion record stored', {
      timestamp: record.timestamp,
      success: record.smsResult.success
    });
  }
}

module.exports = new EmailToSMSBridge();