/**
 * 🔍 Sentry Error Tracking Service Integration
 * Free tier: 5,000 errors/month, 1 user, 1 project
 * Use case: Real-time error tracking, performance monitoring, issue resolution
 */

const Sentry = require('@sentry/node');
const { ProfilingIntegration } = require('@sentry/profiling-node');
const logger = require('../../utils/logger');

class SentryErrorTracking {
  constructor() {
    this.dsn = process.env.SENTRY_DSN;
    this.environment = process.env.NODE_ENV || 'development';
    this.initialized = false;
    
    if (this.dsn) {
      this.init();
    } else {
      logger.warn('Sentry DSN not configured - error tracking disabled');
    }
  }

  /**
   * Initialize Sentry SDK
   */
  init() {
    try {
      Sentry.init({
        dsn: this.dsn,
        environment: this.environment,
        release: process.env.APP_VERSION || '1.0.0',
        
        // Performance monitoring
        tracesSampleRate: this.environment === 'production' ? 0.1 : 1.0,
        
        // Profiling
        profilesSampleRate: this.environment === 'production' ? 0.1 : 1.0,
        
        // Enhanced integrations
        integrations: [
          new ProfilingIntegration(),
          new Sentry.Integrations.Http({ tracing: true }),
          new Sentry.Integrations.Express({ app: null }),
          new Sentry.Integrations.Postgres(),
          new Sentry.Integrations.Redis(),
        ],
        
        // Before send hook for filtering
        beforeSend(event, hint) {
          // Filter out known non-critical errors
          if (event.exception) {
            const error = hint.originalException;
            
            // Skip certain error types in development
            if (process.env.NODE_ENV === 'development') {
              if (error?.code === 'ECONNREFUSED' || 
                  error?.code === 'ENOTFOUND' ||
                  error?.message?.includes('connect ECONNREFUSED')) {
                return null;
              }
            }
            
            // Skip rate limiting errors
            if (error?.status === 429 || 
                error?.message?.includes('Too Many Requests')) {
              return null;
            }
          }
          
          return event;
        },
        
        // Enhanced context capture
        beforeBreadcrumb(breadcrumb) {
          // Filter sensitive data from breadcrumbs
          if (breadcrumb.category === 'http' && breadcrumb.data) {
            delete breadcrumb.data.token;
            delete breadcrumb.data.password;
            delete breadcrumb.data.authorization;
          }
          return breadcrumb;
        }
      });
      
      this.initialized = true;
      logger.info('Sentry error tracking initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Sentry', error);
    }
  }

  /**
   * Capture exception with enhanced context
   * @param {Error} error - Error object
   * @param {Object} context - Additional context
   * @returns {string} - Event ID
   */
  captureException(error, context = {}) {
    if (!this.initialized) {
      logger.error('Sentry not initialized - logging error locally', error);
      return null;
    }

    return Sentry.withScope((scope) => {
      // Set user context
      if (context.user) {
        scope.setUser({
          id: context.user.id,
          email: context.user.email,
          username: context.user.username
        });
      }

      // Set request context
      if (context.request) {
        scope.setContext('request', {
          method: context.request.method,
          url: context.request.url,
          headers: this.sanitizeHeaders(context.request.headers),
          ip: context.request.ip,
          userAgent: context.request.get('User-Agent')
        });
      }

      // Set additional context
      if (context.extra) {
        Object.keys(context.extra).forEach(key => {
          scope.setExtra(key, context.extra[key]);
        });
      }

      // Set tags
      if (context.tags) {
        Object.keys(context.tags).forEach(key => {
          scope.setTag(key, context.tags[key]);
        });
      }

      // Set level
      if (context.level) {
        scope.setLevel(context.level);
      }

      // Add fingerprint for grouping
      if (context.fingerprint) {
        scope.setFingerprint(context.fingerprint);
      }

      return Sentry.captureException(error);
    });
  }

  /**
   * Capture message with context
   * @param {string} message - Message to capture
   * @param {string} level - Message level (info, warning, error, etc.)
   * @param {Object} context - Additional context
   * @returns {string} - Event ID
   */
  captureMessage(message, level = 'info', context = {}) {
    if (!this.initialized) {
      logger[level]('Sentry not initialized - logging message locally', message);
      return null;
    }

    return Sentry.withScope((scope) => {
      scope.setLevel(level);
      
      if (context.user) {
        scope.setUser(context.user);
      }
      
      if (context.extra) {
        Object.keys(context.extra).forEach(key => {
          scope.setExtra(key, context.extra[key]);
        });
      }
      
      if (context.tags) {
        Object.keys(context.tags).forEach(key => {
          scope.setTag(key, context.tags[key]);
        });
      }

      return Sentry.captureMessage(message, level);
    });
  }

  /**
   * Add breadcrumb for debugging context
   * @param {Object} breadcrumb - Breadcrumb data
   */
  addBreadcrumb(breadcrumb) {
    if (!this.initialized) return;

    Sentry.addBreadcrumb({
      message: breadcrumb.message,
      category: breadcrumb.category || 'manual',
      level: breadcrumb.level || 'info',
      data: breadcrumb.data || {},
      timestamp: breadcrumb.timestamp || Date.now() / 1000
    });
  }

  /**
   * Start performance transaction
   * @param {Object} context - Transaction context
   * @returns {Object} - Transaction object
   */
  startTransaction(context) {
    if (!this.initialized) return null;

    return Sentry.startTransaction({
      name: context.name,
      op: context.operation || 'custom',
      description: context.description,
      tags: context.tags,
      data: context.data
    });
  }

  /**
   * Track virtual number OTP events
   * @param {string} eventType - Type of OTP event
   * @param {Object} data - Event data
   */
  trackOTPEvent(eventType, data) {
    this.addBreadcrumb({
      message: `OTP ${eventType}`,
      category: 'otp',
      level: 'info',
      data: {
        eventType,
        phoneNumber: this.maskPhoneNumber(data.phoneNumber),
        provider: data.provider,
        success: data.success,
        errorCode: data.errorCode,
        duration: data.duration
      }
    });

    // Capture errors
    if (!data.success && data.error) {
      this.captureException(data.error, {
        tags: {
          service: 'virtual-numbers',
          operation: 'otp',
          provider: data.provider
        },
        extra: {
          phoneNumber: this.maskPhoneNumber(data.phoneNumber),
          eventType,
          errorCode: data.errorCode
        }
      });
    }
  }

  /**
   * Track document processing events
   * @param {string} eventType - Type of document event
   * @param {Object} data - Event data
   */
  trackDocumentEvent(eventType, data) {
    this.addBreadcrumb({
      message: `Document ${eventType}`,
      category: 'document',
      level: 'info',
      data: {
        eventType,
        documentId: data.documentId,
        fileSize: data.fileSize,
        fileType: data.fileType,
        processingTime: data.processingTime,
        success: data.success
      }
    });

    // Track performance for document processing
    if (data.transaction) {
      const span = data.transaction.startChild({
        op: 'document.process',
        description: `Processing ${data.fileType} document`
      });
      
      span.setData('fileSize', data.fileSize);
      span.setData('documentId', data.documentId);
      
      if (data.success) {
        span.setStatus('ok');
      } else {
        span.setStatus('internal_error');
      }
      
      span.finish();
    }
  }

  /**
   * Track blockchain operations
   * @param {string} operation - Blockchain operation
   * @param {Object} data - Operation data
   */
  trackBlockchainEvent(operation, data) {
    this.addBreadcrumb({
      message: `Blockchain ${operation}`,
      category: 'blockchain',
      level: 'info',
      data: {
        operation,
        network: data.network,
        contractAddress: data.contractAddress,
        transactionHash: data.transactionHash,
        gasUsed: data.gasUsed,
        success: data.success
      }
    });

    // Track blockchain errors
    if (!data.success && data.error) {
      this.captureException(data.error, {
        tags: {
          service: 'blockchain',
          operation,
          network: data.network
        },
        extra: {
          contractAddress: data.contractAddress,
          transactionHash: data.transactionHash,
          gasUsed: data.gasUsed
        }
      });
    }
  }

  /**
   * Track security events
   * @param {string} eventType - Security event type
   * @param {Object} data - Event data
   */
  trackSecurityEvent(eventType, data) {
    this.addBreadcrumb({
      message: `Security ${eventType}`,
      category: 'security',
      level: eventType.includes('failed') ? 'warning' : 'info',
      data: {
        eventType,
        userId: data.userId,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        success: data.success
      }
    });

    // High priority security events
    if (eventType.includes('failed') || eventType.includes('breach')) {
      this.captureMessage(`Security event: ${eventType}`, 'warning', {
        tags: {
          service: 'security',
          eventType
        },
        extra: {
          userId: data.userId,
          ipAddress: data.ipAddress,
          attempts: data.attempts,
          timeWindow: data.timeWindow
        }
      });
    }
  }

  /**
   * Set user context
   * @param {Object} user - User data
   */
  setUser(user) {
    if (!this.initialized) return;

    Sentry.setUser({
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      subscription: user.subscription
    });
  }

  /**
   * Set extra context
   * @param {string} key - Context key
   * @param {any} value - Context value
   */
  setExtra(key, value) {
    if (!this.initialized) return;
    Sentry.setExtra(key, value);
  }

  /**
   * Set tag
   * @param {string} key - Tag key
   * @param {string} value - Tag value
   */
  setTag(key, value) {
    if (!this.initialized) return;
    Sentry.setTag(key, value);
  }

  /**
   * Express middleware for error handling
   * @returns {Function} - Express middleware
   */
  getErrorHandler() {
    if (!this.initialized) {
      return (error, req, res, next) => {
        logger.error('Express error (Sentry not initialized)', error);
        next(error);
      };
    }

    return Sentry.Handlers.errorHandler({
      shouldHandleError(error) {
        // Only send 4xx and 5xx errors to Sentry
        return error.status >= 400;
      }
    });
  }

  /**
   * Express middleware for request tracking
   * @returns {Function} - Express middleware
   */
  getRequestHandler() {
    if (!this.initialized) {
      return (req, res, next) => next();
    }

    return Sentry.Handlers.requestHandler({
      user: ['id', 'email', 'username'],
      request: ['headers', 'method', 'query_string', 'url'],
      serverName: false
    });
  }

  /**
   * Express middleware for tracing
   * @returns {Function} - Express middleware
   */
  getTracingHandler() {
    if (!this.initialized) {
      return (req, res, next) => next();
    }

    return Sentry.Handlers.tracingHandler();
  }

  /**
   * Flush pending events
   * @param {number} timeout - Timeout in milliseconds
   * @returns {Promise<boolean>} - Success status
   */
  async flush(timeout = 2000) {
    if (!this.initialized) return true;
    
    try {
      return await Sentry.flush(timeout);
    } catch (error) {
      logger.error('Failed to flush Sentry events', error);
      return false;
    }
  }

  /**
   * Get health status
   * @returns {Object} - Health status
   */
  healthCheck() {
    return {
      status: this.initialized ? 'healthy' : 'unhealthy',
      message: this.initialized ? 'Sentry error tracking active' : 'Sentry not configured',
      dsn: this.dsn ? 'configured' : 'missing',
      environment: this.environment
    };
  }

  /**
   * Utility: Sanitize HTTP headers
   * @param {Object} headers - HTTP headers
   * @returns {Object} - Sanitized headers
   */
  sanitizeHeaders(headers) {
    const sanitized = { ...headers };
    
    // Remove sensitive headers
    delete sanitized.authorization;
    delete sanitized.cookie;
    delete sanitized['x-api-key'];
    delete sanitized['x-auth-token'];
    
    return sanitized;
  }

  /**
   * Utility: Mask phone number for privacy
   * @param {string} phoneNumber - Phone number
   * @returns {string} - Masked phone number
   */
  maskPhoneNumber(phoneNumber) {
    if (!phoneNumber) return 'unknown';
    
    // Keep country code and last 4 digits
    if (phoneNumber.length > 8) {
      const countryCode = phoneNumber.substring(0, 3);
      const lastDigits = phoneNumber.substring(phoneNumber.length - 4);
      const maskedMiddle = '*'.repeat(phoneNumber.length - 7);
      return `${countryCode}${maskedMiddle}${lastDigits}`;
    }
    
    return phoneNumber.substring(0, 2) + '*'.repeat(phoneNumber.length - 2);
  }
}

module.exports = new SentryErrorTracking();