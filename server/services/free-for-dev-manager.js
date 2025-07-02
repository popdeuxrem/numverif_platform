/**
 * 🆓 Free-for.dev Services Manager
 * Central coordination point for all free-tier service integrations
 * Manages service health, usage monitoring, and failover strategies
 */

const logger = require('../utils/logger');

// Import all free-for.dev service integrations
const emailOctopusService = require('./email/emailoctopus-service');
const sentryErrorTracking = require('./monitoring/sentry-error-tracking');
const backblazeB2Service = require('./storage/backblaze-b2');

class FreeForDevManager {
  constructor() {
    this.services = new Map();
    this.healthCheckInterval = null;
    this.usageStats = new Map();
    this.initialized = false;
    
    this.initializeServices();
  }

  /**
   * Initialize all free-for.dev services
   */
  async initializeServices() {
    try {
      // Register all services with their configurations
      this.registerService('emailoctopus', {
        service: emailOctopusService,
        name: 'EmailOctopus Newsletter Service',
        freeLimit: '10,000 emails/month, 2,500 subscribers',
        category: 'email',
        priority: 'high',
        healthCheck: () => emailOctopusService.healthCheck()
      });

      this.registerService('sentry', {
        service: sentryErrorTracking,
        name: 'Sentry Error Tracking',
        freeLimit: '5,000 errors/month',
        category: 'monitoring',
        priority: 'critical',
        healthCheck: () => sentryErrorTracking.healthCheck()
      });

      this.registerService('backblaze-b2', {
        service: backblazeB2Service,
        name: 'Backblaze B2 Storage',
        freeLimit: '10GB storage, 1GB downloads/day',
        category: 'storage',
        priority: 'medium',
        healthCheck: () => backblazeB2Service.healthCheck()
      });

      // Additional services can be added here as they're implemented
      this.registerPlannedServices();

      // Start health monitoring
      this.startHealthMonitoring();
      
      this.initialized = true;
      logger.info('Free-for.dev services manager initialized', {
        servicesCount: this.services.size,
        categories: this.getServiceCategories()
      });

    } catch (error) {
      logger.error('Failed to initialize free-for.dev services manager', error);
    }
  }

  /**
   * Register a service with the manager
   * @param {string} id - Service ID
   * @param {Object} config - Service configuration
   */
  registerService(id, config) {
    this.services.set(id, {
      id,
      ...config,
      status: 'unknown',
      lastHealthCheck: null,
      usageCount: 0,
      errorCount: 0,
      lastError: null
    });

    // Initialize usage tracking
    this.usageStats.set(id, {
      daily: { count: 0, date: new Date().toDateString() },
      monthly: { count: 0, month: new Date().getMonth() },
      total: 0
    });

    logger.info(`Registered free service: ${config.name}`);
  }

  /**
   * Register planned services (not yet implemented)
   */
  registerPlannedServices() {
    // These are placeholders for services that will be implemented
    const plannedServices = [
      {
        id: 'auth0',
        name: 'Auth0 SSO Service',
        freeLimit: '7,000 active users',
        category: 'authentication',
        priority: 'high',
        status: 'planned'
      },
      {
        id: 'huggingface',
        name: 'Hugging Face NLP',
        freeLimit: '30k input characters/month',
        category: 'ai',
        priority: 'medium',
        status: 'planned'
      },
      {
        id: 'tatum',
        name: 'Tatum Blockchain API',
        freeLimit: 'Unlimited calls at 5 req/sec',
        category: 'blockchain',
        priority: 'medium',
        status: 'planned'
      },
      {
        id: 'pusher',
        name: 'Pusher Real-time Messaging',
        freeLimit: '200k messages/day, 100 connections',
        category: 'realtime',
        priority: 'medium',
        status: 'planned'
      },
      {
        id: 'newrelic',
        name: 'New Relic APM',
        freeLimit: '100GB data/month',
        category: 'monitoring',
        priority: 'high',
        status: 'planned'
      }
    ];

    plannedServices.forEach(service => {
      this.services.set(service.id, {
        ...service,
        service: null,
        healthCheck: () => ({ status: 'planned', message: 'Service not yet implemented' })
      });
    });
  }

  /**
   * Start periodic health monitoring
   */
  startHealthMonitoring() {
    // Check health every 5 minutes
    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthChecks();
    }, 5 * 60 * 1000);

    // Perform initial health check
    this.performHealthChecks();
  }

  /**
   * Stop health monitoring
   */
  stopHealthMonitoring() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Perform health checks on all services
   */
  async performHealthChecks() {
    logger.info('Performing health checks on free-for.dev services');

    for (const [serviceId, serviceConfig] of this.services.entries()) {
      if (serviceConfig.status === 'planned' || !serviceConfig.healthCheck) {
        continue;
      }

      try {
        const healthResult = await serviceConfig.healthCheck();
        
        serviceConfig.status = healthResult.status;
        serviceConfig.lastHealthCheck = new Date();
        serviceConfig.healthMessage = healthResult.message;

        if (healthResult.status === 'unhealthy') {
          serviceConfig.errorCount++;
          serviceConfig.lastError = healthResult.message;
          
          logger.warn(`Service ${serviceId} is unhealthy`, {
            service: serviceConfig.name,
            message: healthResult.message
          });

          // Send alert for critical services
          if (serviceConfig.priority === 'critical') {
            await this.sendServiceAlert(serviceId, 'unhealthy', healthResult.message);
          }
        } else {
          logger.debug(`Service ${serviceId} is healthy`);
        }

      } catch (error) {
        serviceConfig.status = 'error';
        serviceConfig.errorCount++;
        serviceConfig.lastError = error.message;
        serviceConfig.lastHealthCheck = new Date();

        logger.error(`Health check failed for service ${serviceId}`, error);
      }
    }
  }

  /**
   * Track service usage
   * @param {string} serviceId - Service ID
   * @param {number} count - Usage count (default: 1)
   */
  trackUsage(serviceId, count = 1) {
    const serviceConfig = this.services.get(serviceId);
    if (!serviceConfig) {
      logger.warn(`Attempted to track usage for unknown service: ${serviceId}`);
      return;
    }

    // Update service usage count
    serviceConfig.usageCount += count;

    // Update usage statistics
    const stats = this.usageStats.get(serviceId);
    if (stats) {
      const today = new Date().toDateString();
      const currentMonth = new Date().getMonth();

      // Reset daily counter if new day
      if (stats.daily.date !== today) {
        stats.daily = { count: 0, date: today };
      }

      // Reset monthly counter if new month
      if (stats.monthly.month !== currentMonth) {
        stats.monthly = { count: 0, month: currentMonth };
      }

      stats.daily.count += count;
      stats.monthly.count += count;
      stats.total += count;

      logger.debug(`Usage tracked for ${serviceId}`, {
        service: serviceConfig.name,
        dailyUsage: stats.daily.count,
        monthlyUsage: stats.monthly.count
      });
    }
  }

  /**
   * Get service by ID
   * @param {string} serviceId - Service ID
   * @returns {Object|null} - Service configuration
   */
  getService(serviceId) {
    return this.services.get(serviceId) || null;
  }

  /**
   * Get services by category
   * @param {string} category - Service category
   * @returns {Array} - Services in category
   */
  getServicesByCategory(category) {
    return Array.from(this.services.values())
      .filter(service => service.category === category);
  }

  /**
   * Get all service categories
   * @returns {Array} - Unique categories
   */
  getServiceCategories() {
    return [...new Set(Array.from(this.services.values()).map(s => s.category))];
  }

  /**
   * Get overall health status
   * @returns {Object} - Health summary
   */
  getHealthStatus() {
    const services = Array.from(this.services.values());
    const activeServices = services.filter(s => s.status !== 'planned');
    
    const healthySvcs = activeServices.filter(s => s.status === 'healthy');
    const unhealthySvcs = activeServices.filter(s => s.status === 'unhealthy');
    const errorSvcs = activeServices.filter(s => s.status === 'error');

    return {
      overall: unhealthySvcs.length === 0 && errorSvcs.length === 0 ? 'healthy' : 'degraded',
      totalServices: services.length,
      activeServices: activeServices.length,
      plannedServices: services.length - activeServices.length,
      healthy: healthySvcs.length,
      unhealthy: unhealthySvcs.length,
      errors: errorSvcs.length,
      lastCheck: new Date(),
      services: services.map(s => ({
        id: s.id,
        name: s.name,
        status: s.status,
        category: s.category,
        priority: s.priority,
        usageCount: s.usageCount,
        lastHealthCheck: s.lastHealthCheck
      }))
    };
  }

  /**
   * Get usage statistics
   * @returns {Object} - Usage summary
   */
  getUsageStatistics() {
    const stats = {};
    
    for (const [serviceId, usage] of this.usageStats.entries()) {
      const service = this.services.get(serviceId);
      stats[serviceId] = {
        serviceName: service.name,
        category: service.category,
        freeLimit: service.freeLimit,
        usage: {
          today: usage.daily.count,
          thisMonth: usage.monthly.count,
          total: usage.total
        },
        status: service.status
      };
    }

    return {
      summary: stats,
      lastUpdated: new Date()
    };
  }

  /**
   * Send service alert
   * @param {string} serviceId - Service ID
   * @param {string} alertType - Alert type
   * @param {string} message - Alert message
   */
  async sendServiceAlert(serviceId, alertType, message) {
    try {
      const service = this.services.get(serviceId);
      if (!service) return;

      // Use Sentry to track service issues
      if (sentryErrorTracking.initialized) {
        sentryErrorTracking.captureMessage(
          `Free service ${alertType}: ${service.name}`,
          'warning',
          {
            tags: {
              serviceId,
              alertType,
              category: service.category,
              priority: service.priority
            },
            extra: {
              message,
              freeLimit: service.freeLimit
            }
          }
        );
      }

      // Could also send to email service if configured
      logger.warn(`Service alert: ${service.name} - ${alertType}`, {
        serviceId,
        message,
        priority: service.priority
      });

    } catch (error) {
      logger.error('Failed to send service alert', error);
    }
  }

  /**
   * Generate usage report
   * @returns {Object} - Detailed usage report
   */
  generateUsageReport() {
    const report = {
      reportDate: new Date(),
      totalServices: this.services.size,
      categories: {},
      serviceSummary: []
    };

    // Group by category
    for (const service of this.services.values()) {
      if (!report.categories[service.category]) {
        report.categories[service.category] = {
          totalServices: 0,
          activeServices: 0,
          healthyServices: 0
        };
      }

      const categoryStats = report.categories[service.category];
      categoryStats.totalServices++;
      
      if (service.status !== 'planned') {
        categoryStats.activeServices++;
        if (service.status === 'healthy') {
          categoryStats.healthyServices++;
        }
      }

      // Add to service summary
      const usage = this.usageStats.get(service.id);
      report.serviceSummary.push({
        id: service.id,
        name: service.name,
        category: service.category,
        status: service.status,
        freeLimit: service.freeLimit,
        usage: usage ? {
          daily: usage.daily.count,
          monthly: usage.monthly.count,
          total: usage.total
        } : null,
        errorCount: service.errorCount,
        lastHealthCheck: service.lastHealthCheck
      });
    }

    return report;
  }

  /**
   * Get service recommendations
   * @returns {Array} - Recommendations for optimization
   */
  getServiceRecommendations() {
    const recommendations = [];
    
    for (const service of this.services.values()) {
      const usage = this.usageStats.get(service.id);
      
      // Check for high usage
      if (usage && usage.monthly.count > 0) {
        // This is a simplified check - real implementation would parse limits
        if (service.freeLimit.includes('1000') && usage.monthly.count > 800) {
          recommendations.push({
            type: 'usage_warning',
            serviceId: service.id,
            serviceName: service.name,
            message: `Approaching monthly limit for ${service.name}`,
            suggestion: 'Consider monitoring usage more closely or upgrading to paid tier'
          });
        }
      }

      // Check for persistent errors
      if (service.errorCount > 5) {
        recommendations.push({
          type: 'reliability_concern',
          serviceId: service.id,
          serviceName: service.name,
          message: `High error count for ${service.name}`,
          suggestion: 'Review service configuration and logs'
        });
      }

      // Check for unused services
      if (service.status === 'healthy' && service.usageCount === 0) {
        recommendations.push({
          type: 'unused_service',
          serviceId: service.id,
          serviceName: service.name,
          message: `Service ${service.name} is configured but unused`,
          suggestion: 'Consider removing or starting to use this service'
        });
      }
    }

    return recommendations;
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    this.stopHealthMonitoring();
    logger.info('Free-for.dev services manager cleaned up');
  }
}

module.exports = new FreeForDevManager();