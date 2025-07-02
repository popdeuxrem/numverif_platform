/**
 * 🆓 Free-for.dev Services API Routes
 * Endpoints for managing and monitoring free-tier service integrations
 */

const express = require('express');
const router = express.Router();
const freeForDevManager = require('../services/free-for-dev-manager');
const emailOctopusService = require('../services/email/emailoctopus-service');
const backblazeB2Service = require('../services/storage/backblaze-b2');
const sentryErrorTracking = require('../services/monitoring/sentry-error-tracking');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const logger = require('../utils/logger');

/**
 * @swagger
 * components:
 *   schemas:
 *     FreeServiceHealth:
 *       type: object
 *       properties:
 *         overall:
 *           type: string
 *           enum: [healthy, degraded, unhealthy]
 *         totalServices:
 *           type: integer
 *         activeServices:
 *           type: integer
 *         plannedServices:
 *           type: integer
 *         services:
 *           type: array
 *           items:
 *             type: object
 */

/**
 * @swagger
 * /api/free-services/health:
 *   get:
 *     summary: Get health status of all free services
 *     tags: [Free Services]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Health status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/FreeServiceHealth'
 */
router.get('/health', authenticateToken, async (req, res) => {
  try {
    const healthStatus = freeForDevManager.getHealthStatus();
    
    // Track usage
    freeForDevManager.trackUsage('health_check');
    
    res.json({
      success: true,
      data: healthStatus
    });
  } catch (error) {
    logger.error('Failed to get free services health status', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve health status'
    });
  }
});

/**
 * @swagger
 * /api/free-services/usage:
 *   get:
 *     summary: Get usage statistics for all free services
 *     tags: [Free Services]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Usage statistics retrieved successfully
 */
router.get('/usage', authenticateToken, async (req, res) => {
  try {
    const usageStats = freeForDevManager.getUsageStatistics();
    
    res.json({
      success: true,
      data: usageStats
    });
  } catch (error) {
    logger.error('Failed to get free services usage statistics', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve usage statistics'
    });
  }
});

/**
 * @swagger
 * /api/free-services/report:
 *   get:
 *     summary: Generate comprehensive usage report
 *     tags: [Free Services]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Usage report generated successfully
 */
router.get('/report', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const report = freeForDevManager.generateUsageReport();
    
    res.json({
      success: true,
      data: report
    });
  } catch (error) {
    logger.error('Failed to generate usage report', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate usage report'
    });
  }
});

/**
 * @swagger
 * /api/free-services/recommendations:
 *   get:
 *     summary: Get service optimization recommendations
 *     tags: [Free Services]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Recommendations retrieved successfully
 */
router.get('/recommendations', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const recommendations = freeForDevManager.getServiceRecommendations();
    
    res.json({
      success: true,
      data: recommendations
    });
  } catch (error) {
    logger.error('Failed to get service recommendations', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve recommendations'
    });
  }
});

/**
 * @swagger
 * /api/free-services/email/subscribe:
 *   post:
 *     summary: Subscribe user to email notifications
 *     tags: [Free Services - Email]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 */
router.post('/email/subscribe', authenticateToken, async (req, res) => {
  try {
    const { email, firstName, lastName, tags } = req.body;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email address is required'
      });
    }

    const result = await emailOctopusService.addSubscriber(email, {
      firstName,
      lastName,
      tags
    });

    // Track usage
    freeForDevManager.trackUsage('emailoctopus');

    if (result.success) {
      res.json({
        success: true,
        message: 'Successfully subscribed to notifications',
        data: {
          subscriberId: result.subscriberId
        }
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
        message: result.message
      });
    }
  } catch (error) {
    logger.error('Failed to subscribe user to email notifications', error);
    res.status(500).json({
      success: false,
      error: 'Failed to subscribe to notifications'
    });
  }
});

/**
 * @swagger
 * /api/free-services/email/unsubscribe:
 *   post:
 *     summary: Unsubscribe user from email notifications
 *     tags: [Free Services - Email]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 */
router.post('/email/unsubscribe', authenticateToken, async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email address is required'
      });
    }

    const result = await emailOctopusService.removeSubscriber(email);

    // Track usage
    freeForDevManager.trackUsage('emailoctopus');

    if (result.success) {
      res.json({
        success: true,
        message: 'Successfully unsubscribed from notifications'
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
        message: result.message
      });
    }
  } catch (error) {
    logger.error('Failed to unsubscribe user from email notifications', error);
    res.status(500).json({
      success: false,
      error: 'Failed to unsubscribe from notifications'
    });
  }
});

/**
 * @swagger
 * /api/free-services/email/send-update:
 *   post:
 *     summary: Send platform update notification
 *     tags: [Free Services - Email]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - version
 *             properties:
 *               version:
 *                 type: string
 *               features:
 *                 type: array
 *                 items:
 *                   type: string
 *               bugFixes:
 *                 type: array
 *                 items:
 *                   type: string
 *               improvements:
 *                 type: array
 *                 items:
 *                   type: string
 */
router.post('/email/send-update', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { version, features, bugFixes, improvements } = req.body;
    
    if (!version) {
      return res.status(400).json({
        success: false,
        error: 'Version is required'
      });
    }

    const result = await emailOctopusService.sendPlatformUpdate({
      version,
      features: features || [],
      bugFixes: bugFixes || [],
      improvements: improvements || [],
      releaseDate: new Date()
    });

    // Track usage
    freeForDevManager.trackUsage('emailoctopus');

    res.json({
      success: true,
      message: 'Platform update notification sent successfully',
      data: {
        campaignId: result.campaignId
      }
    });
  } catch (error) {
    logger.error('Failed to send platform update notification', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send platform update notification'
    });
  }
});

/**
 * @swagger
 * /api/free-services/storage/upload:
 *   post:
 *     summary: Upload file to backup storage
 *     tags: [Free Services - Storage]
 *     security:
 *       - bearerAuth: []
 *     consumes:
 *       - multipart/form-data
 *     parameters:
 *       - in: formData
 *         name: file
 *         type: file
 *         required: true
 *         description: File to upload
 */
router.post('/storage/upload', authenticateToken, async (req, res) => {
  try {
    if (!req.files || !req.files.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }

    const file = req.files.file;
    const userId = req.user.id;
    
    // Generate secure filename
    const fileName = backblazeB2Service.generateSecureFileName(
      file.name, 
      `user-${userId}-`
    );

    const result = await backblazeB2Service.uploadFile(
      file.data,
      fileName,
      {
        contentType: file.mimetype,
        metadata: {
          'user-id': userId,
          'original-name': file.name,
          'upload-date': new Date().toISOString()
        },
        folderPath: 'user-uploads'
      }
    );

    // Track usage
    freeForDevManager.trackUsage('backblaze-b2');

    res.json({
      success: true,
      message: 'File uploaded successfully to backup storage',
      data: {
        fileId: result.fileId,
        fileName: result.fileName,
        size: result.size,
        url: result.url
      }
    });
  } catch (error) {
    logger.error('Failed to upload file to backup storage', error);
    res.status(500).json({
      success: false,
      error: 'Failed to upload file to backup storage'
    });
  }
});

/**
 * @swagger
 * /api/free-services/storage/list:
 *   get:
 *     summary: List user's files in backup storage
 *     tags: [Free Services - Storage]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Maximum number of files to return
 */
router.get('/storage/list', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 50;
    
    const files = await backblazeB2Service.listFiles({
      prefix: `user-uploads/user-${userId}-`,
      maxFileCount: limit
    });

    // Track usage
    freeForDevManager.trackUsage('backblaze-b2');

    res.json({
      success: true,
      data: {
        files: files.map(file => ({
          fileId: file.fileId,
          fileName: file.fileName.replace(`user-uploads/user-${userId}-`, ''),
          size: file.size,
          uploadTimestamp: file.uploadTimestamp,
          contentType: file.contentType
        })),
        total: files.length
      }
    });
  } catch (error) {
    logger.error('Failed to list files from backup storage', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list files from backup storage'
    });
  }
});

/**
 * @swagger
 * /api/free-services/storage/stats:
 *   get:
 *     summary: Get storage usage statistics
 *     tags: [Free Services - Storage]
 *     security:
 *       - bearerAuth: []
 */
router.get('/storage/stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const stats = await backblazeB2Service.getStorageStats();

    // Track usage
    freeForDevManager.trackUsage('backblaze-b2');

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    logger.error('Failed to get storage statistics', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve storage statistics'
    });
  }
});

/**
 * @swagger
 * /api/free-services/monitoring/track-event:
 *   post:
 *     summary: Track custom event for monitoring
 *     tags: [Free Services - Monitoring]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - eventType
 *               - category
 *             properties:
 *               eventType:
 *                 type: string
 *               category:
 *                 type: string
 *               data:
 *                 type: object
 *               level:
 *                 type: string
 *                 enum: [info, warning, error]
 */
router.post('/monitoring/track-event', authenticateToken, async (req, res) => {
  try {
    const { eventType, category, data, level } = req.body;
    const userId = req.user.id;
    
    if (!eventType || !category) {
      return res.status(400).json({
        success: false,
        error: 'Event type and category are required'
      });
    }

    // Add breadcrumb for tracking
    sentryErrorTracking.addBreadcrumb({
      message: `Custom event: ${eventType}`,
      category: category,
      level: level || 'info',
      data: {
        userId,
        eventType,
        ...data
      }
    });

    // Track usage
    freeForDevManager.trackUsage('sentry');

    res.json({
      success: true,
      message: 'Event tracked successfully'
    });
  } catch (error) {
    logger.error('Failed to track custom event', error);
    res.status(500).json({
      success: false,
      error: 'Failed to track event'
    });
  }
});

/**
 * @swagger
 * /api/free-services/categories:
 *   get:
 *     summary: Get all service categories
 *     tags: [Free Services]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Service categories retrieved successfully
 */
router.get('/categories', authenticateToken, async (req, res) => {
  try {
    const categories = freeForDevManager.getServiceCategories();
    
    res.json({
      success: true,
      data: {
        categories,
        total: categories.length
      }
    });
  } catch (error) {
    logger.error('Failed to get service categories', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve service categories'
    });
  }
});

/**
 * @swagger
 * /api/free-services/category/{category}:
 *   get:
 *     summary: Get services by category
 *     tags: [Free Services]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: category
 *         required: true
 *         schema:
 *           type: string
 *         description: Service category
 */
router.get('/category/:category', authenticateToken, async (req, res) => {
  try {
    const { category } = req.params;
    const services = freeForDevManager.getServicesByCategory(category);
    
    res.json({
      success: true,
      data: {
        category,
        services: services.map(s => ({
          id: s.id,
          name: s.name,
          status: s.status,
          freeLimit: s.freeLimit,
          priority: s.priority,
          usageCount: s.usageCount
        })),
        total: services.length
      }
    });
  } catch (error) {
    logger.error('Failed to get services by category', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve services by category'
    });
  }
});

/**
 * @swagger
 * /api/free-services/service/{serviceId}:
 *   get:
 *     summary: Get specific service details
 *     tags: [Free Services]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: serviceId
 *         required: true
 *         schema:
 *           type: string
 *         description: Service ID
 */
router.get('/service/:serviceId', authenticateToken, async (req, res) => {
  try {
    const { serviceId } = req.params;
    const service = freeForDevManager.getService(serviceId);
    
    if (!service) {
      return res.status(404).json({
        success: false,
        error: 'Service not found'
      });
    }

    // Get usage stats for this service
    const usageStats = freeForDevManager.getUsageStatistics();
    const serviceUsage = usageStats.summary[serviceId];

    res.json({
      success: true,
      data: {
        id: service.id,
        name: service.name,
        status: service.status,
        category: service.category,
        priority: service.priority,
        freeLimit: service.freeLimit,
        usageCount: service.usageCount,
        errorCount: service.errorCount,
        lastHealthCheck: service.lastHealthCheck,
        lastError: service.lastError,
        usage: serviceUsage?.usage || null
      }
    });
  } catch (error) {
    logger.error('Failed to get service details', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve service details'
    });
  }
});

module.exports = router;