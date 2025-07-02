/**
 * 📧 EmailOctopus Service Integration
 * Free tier: 2,500 subscribers, 10,000 emails/month
 * Use case: Platform updates, security alerts, user notifications
 */

const axios = require('axios');
const logger = require('../../utils/logger');

class EmailOctopusService {
  constructor() {
    this.apiKey = process.env.EMAILOCTOPUS_API_KEY;
    this.defaultListId = process.env.EMAILOCTOPUS_LIST_ID;
    this.baseURL = 'https://emailoctopus.com/api/1.6';
    
    if (!this.apiKey) {
      logger.warn('EmailOctopus API key not configured');
    }
  }

  /**
   * Add subscriber to mailing list
   * @param {string} email - Subscriber email
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} - Subscription result
   */
  async addSubscriber(email, options = {}) {
    try {
      const {
        listId = this.defaultListId,
        firstName = '',
        lastName = '',
        tags = [],
        status = 'SUBSCRIBED',
        customFields = {}
      } = options;

      if (!listId) {
        throw new Error('EmailOctopus list ID not configured');
      }

      const data = {
        api_key: this.apiKey,
        email_address: email,
        status: status,
        fields: {
          FirstName: firstName,
          LastName: lastName,
          ...customFields
        },
        tags: tags
      };

      const response = await axios.post(
        `${this.baseURL}/lists/${listId}/contacts`,
        data
      );

      logger.info(`EmailOctopus: Subscriber ${email} added to list ${listId}`);
      return {
        success: true,
        data: response.data,
        subscriberId: response.data.id
      };

    } catch (error) {
      logger.error('EmailOctopus: Failed to add subscriber', {
        email,
        error: error.response?.data || error.message
      });
      
      // Handle specific errors
      if (error.response?.status === 409) {
        return {
          success: false,
          error: 'EMAIL_ALREADY_EXISTS',
          message: 'Email address already exists in the list'
        };
      }
      
      throw error;
    }
  }

  /**
   * Send campaign to list
   * @param {Object} campaignData - Campaign configuration
   * @returns {Promise<Object>} - Campaign result
   */
  async sendCampaign(campaignData) {
    try {
      const {
        listId = this.defaultListId,
        subject,
        content,
        fromName = 'VaultText Platform',
        fromEmail = 'noreply@vaulttext.com',
        scheduleAt = null
      } = campaignData;

      if (!subject || !content) {
        throw new Error('Subject and content are required');
      }

      const data = {
        api_key: this.apiKey,
        name: `${subject} - ${new Date().toISOString()}`,
        subject: subject,
        content: {
          html: content.html || content,
          plain_text: content.text || content.replace(/<[^>]*>/g, '')
        },
        from: {
          name: fromName,
          email_address: fromEmail
        },
        to: [listId]
      };

      // Create campaign
      const campaignResponse = await axios.post(
        `${this.baseURL}/campaigns`,
        data
      );

      const campaignId = campaignResponse.data.id;

      // Send campaign (or schedule if specified)
      const sendEndpoint = scheduleAt 
        ? `${this.baseURL}/campaigns/${campaignId}/send`
        : `${this.baseURL}/campaigns/${campaignId}/send`;

      const sendData = scheduleAt 
        ? { api_key: this.apiKey, send_at: scheduleAt }
        : { api_key: this.apiKey };

      const sendResponse = await axios.post(sendEndpoint, sendData);

      logger.info(`EmailOctopus: Campaign sent successfully`, {
        campaignId,
        subject,
        listId
      });

      return {
        success: true,
        campaignId,
        data: sendResponse.data
      };

    } catch (error) {
      logger.error('EmailOctopus: Failed to send campaign', {
        error: error.response?.data || error.message
      });
      throw error;
    }
  }

  /**
   * Get list statistics
   * @param {string} listId - List ID
   * @returns {Promise<Object>} - List stats
   */
  async getListStats(listId = this.defaultListId) {
    try {
      const response = await axios.get(
        `${this.baseURL}/lists/${listId}?api_key=${this.apiKey}`
      );

      const stats = {
        totalSubscribers: response.data.counts.subscribed,
        unsubscribed: response.data.counts.unsubscribed,
        pending: response.data.counts.pending,
        name: response.data.name,
        created: response.data.created_at
      };

      logger.info('EmailOctopus: Retrieved list statistics', stats);
      return stats;

    } catch (error) {
      logger.error('EmailOctopus: Failed to get list stats', {
        listId,
        error: error.response?.data || error.message
      });
      throw error;
    }
  }

  /**
   * Remove subscriber from list
   * @param {string} email - Subscriber email
   * @param {string} listId - List ID
   * @returns {Promise<Object>} - Removal result
   */
  async removeSubscriber(email, listId = this.defaultListId) {
    try {
      // First find the subscriber
      const contact = await this.findSubscriber(email, listId);
      if (!contact) {
        return {
          success: false,
          error: 'SUBSCRIBER_NOT_FOUND',
          message: 'Subscriber not found in the list'
        };
      }

      // Remove subscriber
      await axios.delete(
        `${this.baseURL}/lists/${listId}/contacts/${contact.id}?api_key=${this.apiKey}`
      );

      logger.info(`EmailOctopus: Subscriber ${email} removed from list ${listId}`);
      return {
        success: true,
        message: 'Subscriber removed successfully'
      };

    } catch (error) {
      logger.error('EmailOctopus: Failed to remove subscriber', {
        email,
        listId,
        error: error.response?.data || error.message
      });
      throw error;
    }
  }

  /**
   * Find subscriber by email
   * @param {string} email - Subscriber email
   * @param {string} listId - List ID
   * @returns {Promise<Object|null>} - Subscriber data or null
   */
  async findSubscriber(email, listId = this.defaultListId) {
    try {
      const response = await axios.get(
        `${this.baseURL}/lists/${listId}/contacts?api_key=${this.apiKey}&limit=100`
      );

      const subscriber = response.data.data.find(
        contact => contact.email_address === email
      );

      return subscriber || null;

    } catch (error) {
      logger.error('EmailOctopus: Failed to find subscriber', {
        email,
        listId,
        error: error.response?.data || error.message
      });
      return null;
    }
  }

  /**
   * Send security alert email
   * @param {string} email - Recipient email
   * @param {Object} alertData - Alert information
   * @returns {Promise<Object>} - Send result
   */
  async sendSecurityAlert(email, alertData) {
    try {
      const {
        alertType,
        message,
        ipAddress,
        userAgent,
        timestamp = new Date()
      } = alertData;

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>VaultText Security Alert</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #dc3545; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background: #f8f9fa; }
            .alert-box { background: #fff3cd; border: 1px solid #ffeeba; padding: 15px; margin: 15px 0; border-radius: 5px; }
            .footer { text-align: center; padding: 20px; color: #6c757d; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🛡️ VaultText Security Alert</h1>
            </div>
            <div class="content">
              <h2>Security Event Detected</h2>
              <div class="alert-box">
                <strong>Alert Type:</strong> ${alertType}<br>
                <strong>Time:</strong> ${timestamp.toISOString()}<br>
                <strong>IP Address:</strong> ${ipAddress || 'Unknown'}<br>
                <strong>User Agent:</strong> ${userAgent || 'Unknown'}
              </div>
              <p><strong>Details:</strong></p>
              <p>${message}</p>
              <p>If this was not you, please secure your account immediately by:</p>
              <ul>
                <li>Changing your password</li>
                <li>Enabling two-factor authentication</li>
                <li>Reviewing your account activity</li>
                <li>Contacting our support team</li>
              </ul>
            </div>
            <div class="footer">
              <p>This is an automated security alert from VaultText Platform</p>
              <p>If you have questions, contact us at security@vaulttext.com</p>
            </div>
          </div>
        </body>
        </html>
      `;

      // For security alerts, we might want to send directly rather than through campaigns
      // This would require a transactional email service like Resend
      logger.info('EmailOctopus: Security alert prepared', {
        email,
        alertType,
        timestamp
      });

      return {
        success: true,
        message: 'Security alert email prepared',
        content: htmlContent
      };

    } catch (error) {
      logger.error('EmailOctopus: Failed to prepare security alert', {
        email,
        alertType: alertData.alertType,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Send platform update notification
   * @param {Object} updateData - Update information
   * @returns {Promise<Object>} - Campaign result
   */
  async sendPlatformUpdate(updateData) {
    try {
      const {
        version,
        features = [],
        bugFixes = [],
        improvements = [],
        releaseDate = new Date()
      } = updateData;

      const subject = `🚀 VaultText Platform Update v${version}`;
      
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>VaultText Platform Update</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #007bff; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; }
            .feature-list { background: #f8f9fa; padding: 15px; margin: 15px 0; border-radius: 5px; }
            .feature-item { margin: 10px 0; }
            .footer { text-align: center; padding: 20px; color: #6c757d; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🚀 Platform Update v${version}</h1>
              <p>Released on ${releaseDate.toLocaleDateString()}</p>
            </div>
            <div class="content">
              <p>We're excited to share the latest updates to the VaultText platform!</p>
              
              ${features.length > 0 ? `
                <h3>✨ New Features</h3>
                <div class="feature-list">
                  ${features.map(feature => `<div class="feature-item">• ${feature}</div>`).join('')}
                </div>
              ` : ''}
              
              ${improvements.length > 0 ? `
                <h3>🔧 Improvements</h3>
                <div class="feature-list">
                  ${improvements.map(improvement => `<div class="feature-item">• ${improvement}</div>`).join('')}
                </div>
              ` : ''}
              
              ${bugFixes.length > 0 ? `
                <h3>🐛 Bug Fixes</h3>
                <div class="feature-list">
                  ${bugFixes.map(fix => `<div class="feature-item">• ${fix}</div>`).join('')}
                </div>
              ` : ''}
              
              <p>Thank you for using VaultText! We're committed to continuously improving your experience.</p>
            </div>
            <div class="footer">
              <p>VaultText Advanced Platform</p>
              <p><a href="https://vaulttext.com">Visit our website</a> | <a href="https://docs.vaulttext.com">Documentation</a></p>
            </div>
          </div>
        </body>
        </html>
      `;

      return await this.sendCampaign({
        subject,
        content: {
          html: htmlContent
        },
        fromName: 'VaultText Team'
      });

    } catch (error) {
      logger.error('EmailOctopus: Failed to send platform update', {
        version: updateData.version,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Health check for EmailOctopus service
   * @returns {Promise<Object>} - Health status
   */
  async healthCheck() {
    try {
      if (!this.apiKey) {
        return {
          status: 'unhealthy',
          message: 'EmailOctopus API key not configured'
        };
      }

      // Try to get account info
      const response = await axios.get(
        `${this.baseURL}/lists?api_key=${this.apiKey}&limit=1`
      );

      return {
        status: 'healthy',
        message: 'EmailOctopus service is operational',
        listsCount: response.data.data.length
      };

    } catch (error) {
      return {
        status: 'unhealthy',
        message: error.response?.data?.error?.message || error.message
      };
    }
  }
}

module.exports = new EmailOctopusService();