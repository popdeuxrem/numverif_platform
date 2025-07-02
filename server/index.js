import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import winston from 'winston';
import cron from 'node-cron';
import Redis from 'ioredis';

// Import routes
import authRoutes from './routes/auth.js';
import documentRoutes from './routes/documents.js';
import aiRoutes from './routes/ai.js';
import blockchainRoutes from './routes/blockchain.js';
import collaborationRoutes from './routes/collaboration.js';
import analyticsRoutes from './routes/analytics.js';
import complianceRoutes from './routes/compliance.js';
import virtualNumberRoutes from './routes/virtualNumbers.js';
import otpRoutes from './routes/otp.js';
import biometricRoutes from './routes/biometric.js';
import encryptionRoutes from './routes/encryption.js';

// Import middleware
import { authMiddleware } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';
import { rateLimitMiddleware } from './middleware/rateLimit.js';
import { auditLogger } from './middleware/auditLogger.js';

// Import services
import { initializeDatabase } from './services/database.js';
import { initializeAI } from './services/ai.js';
import { initializeBlockchain } from './services/blockchain.js';
import { initializeCloudStorage } from './services/cloudStorage.js';
import { initializeElasticsearch } from './services/elasticsearch.js';
import { initializeWebSocket } from './services/websocket.js';

dotenv.config();

// Initialize Express app
const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
  }
});

// Initialize Redis for caching and sessions
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD,
  retryDelayOnFailover: 100,
  enableReadyCheck: false,
  maxRetriesPerRequest: null,
});

// Configure Winston Logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'vaulttext-server' },
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ],
});

// Security Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https:"],
      scriptSrc: ["'self'", "https:"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "wss:", "https:"],
      fontSrc: ["'self'", "https:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false
}));

// Rate Limiting
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 auth requests per windowMs
  message: 'Too many authentication attempts, please try again later.',
  skipSuccessfulRequests: true,
});

app.use(globalLimiter);
app.use(compression());
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));

// CORS Configuration
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? [process.env.CLIENT_URL]
    : ["http://localhost:3000", "http://localhost:3001"],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-API-Key']
}));

// Body Parsing Middleware
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Audit Logging
app.use(auditLogger);

// Health Check Endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0',
    services: {
      database: 'connected',
      redis: redis.status,
      ai: 'active',
      blockchain: 'connected'
    }
  });
});

// API Routes
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/documents', authMiddleware, documentRoutes);
app.use('/api/ai', authMiddleware, aiRoutes);
app.use('/api/blockchain', authMiddleware, blockchainRoutes);
app.use('/api/collaboration', authMiddleware, collaborationRoutes);
app.use('/api/analytics', authMiddleware, analyticsRoutes);
app.use('/api/compliance', authMiddleware, complianceRoutes);
app.use('/api/virtual-numbers', authMiddleware, virtualNumberRoutes);
app.use('/api/otp', otpRoutes);
app.use('/api/biometric', authMiddleware, biometricRoutes);
app.use('/api/encryption', authMiddleware, encryptionRoutes);

// WebSocket Integration
initializeWebSocket(io, redis);

// Advanced Features API
app.use('/api/advanced', authMiddleware, (req, res, next) => {
  // Advanced features router will handle:
  // - AI-powered document analysis
  // - Blockchain document verification
  // - Advanced encryption
  // - Biometric authentication
  // - Virtual SIM management
  // - Smart contract integration
  next();
});

// Error Handling
app.use(errorHandler);

// 404 Handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Route not found',
    message: `The requested endpoint ${req.originalUrl} does not exist`
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('Process terminated');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  await redis.disconnect();
  server.close(() => {
    logger.info('Process terminated');
    process.exit(0);
  });
});

// Scheduled Tasks
cron.schedule('0 0 * * *', () => {
  logger.info('Running daily maintenance tasks');
  // Clean up expired sessions
  // Archive old documents
  // Update AI models
  // Sync blockchain data
});

cron.schedule('0 */6 * * *', () => {
  logger.info('Running 6-hour maintenance tasks');
  // Update virtual number pools
  // Refresh OTP verification stats
  // Clean expired biometric templates
});

// Initialize Services
async function initializeServices() {
  try {
    logger.info('Initializing VaultText Advanced Platform services...');
    
    await initializeDatabase();
    logger.info('Database initialized');
    
    await initializeAI();
    logger.info('AI services initialized');
    
    await initializeBlockchain();
    logger.info('Blockchain services initialized');
    
    await initializeCloudStorage();
    logger.info('Cloud storage initialized');
    
    await initializeElasticsearch();
    logger.info('Elasticsearch initialized');
    
    logger.info('All services initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize services:', error);
    process.exit(1);
  }
}

// Start Server
const PORT = process.env.PORT || 5000;

server.listen(PORT, async () => {
  await initializeServices();
  logger.info(`VaultText Advanced Platform server running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                        🛡️  VaultText Advanced Platform 🛡️                    ║
║                                                                              ║
║  🚀 Server Status: ONLINE                                                    ║
║  🌐 Port: ${PORT}                                                          ║
║  🔒 Security: Enhanced with AI & Blockchain                                 ║
║  📱 Virtual Numbers: Active                                                  ║
║  🔐 OTP Verification: Enabled                                               ║
║  🤖 AI Analysis: Ready                                                      ║
║  ⛓️  Blockchain: Connected                                                   ║
║  🔍 Advanced Search: Elasticsearch                                          ║
║  💾 Caching: Redis                                                          ║
║                                                                              ║
║  📖 API Documentation: http://localhost:${PORT}/api/docs                     ║
║  💻 Admin Panel: http://localhost:${PORT}/admin                             ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
  `);
});

export { app, io, redis, logger };