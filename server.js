const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();


const path = require('path');
const app = express();

// Trust proxy for Railway
app.set('trust proxy', 1);

// Body parsing middleware with error handling
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'https://stockflow-sand.vercel.app',
  process.env.CLIENT_URL
].filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.vercel.app')) {
      callback(null, true);
    } else {
      callback(null, true); // Allow during transition/debugging or fallback
    }
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
// express-cors middleware already handles preflight; explicit app.options('*')
// registration triggers a path-to-regexp error with '*' so we omit it.

app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP for API
  crossOriginEmbedderPolicy: false
}));

const uploadsPath = process.env.UPLOADS_PATH || 'uploads';
app.use('/uploads', express.static(path.join(__dirname, uploadsPath)));

let databaseReady;

if (!process.env.MONGO_URI) {
  const message = 'Missing required environment variable: MONGO_URI';
  console.error(message);
  databaseReady = Promise.reject(new Error(message));
  // Avoid an unhandled rejection before the request middleware consumes it.
  databaseReady.catch(() => {});
} else {
  console.log('Attempting to connect to MongoDB...');
  databaseReady = mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  })
    .then(async () => {
      console.log('MongoDB connected successfully');
      try {
        const AccountingService = require('./services/accountingService');
        await AccountingService.seedDefaultAccounts();
        console.log('Default accounts seeded/verified');
      } catch (seedErr) {
        console.error('Error seeding accounts:', seedErr.message);
      }
    })
    .catch(err => {
      console.error('MongoDB connection error:', err.message);
      throw err;
    });
  databaseReady.catch(() => {});
}


// basic root endpoint for health-checks / info
app.get('/', (req, res) => {
  res.json({
    status: 'running',
    message: 'StockFlow API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Health check endpoint for Railway
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// Vercel invokes the exported app per request. Wait for the shared connection
// attempt rather than terminating the serverless runtime when MongoDB is not
// configured or cannot be reached.
app.use('/api', async (req, res, next) => {
  try {
    await databaseReady;
    next();
  } catch (error) {
    res.status(503).json({
      message: 'Database connection is unavailable',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/upload', require('./routes/upload'));
app.use('/api/users', require('./routes/users'));
app.use('/api/purchase-orders', require('./routes/purchaseOrders'));
app.use('/api/vendors', require('./routes/vendors'));
app.use('/api/sales', require('./routes/sales'));
app.use('/api/customers', require('./routes/customerRoutes'));
app.use('/api/accounting', require('./routes/glRoutes'));

// 404 handler - must be after all other routes
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Global error handler:', err);
  res.status(500).json({
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

const PORT = process.env.PORT || 5000;

// Start a listener whenever this file is executed directly (local development
// and Railway). Vercel imports the Express app as a serverless handler, so it
// must not create its own listener there.
if (require.main === module) {
  console.log(`Starting server on port ${PORT}...`);
  app.listen(PORT, () => {
    console.log(`✅ Server running successfully on port ${PORT}`);
    console.log(`📡 Health check available at: http://localhost:${PORT}/health`);
  });
}

module.exports = app;

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit the process in production, just log the error
  if (process.env.NODE_ENV === 'development') {
    process.exit(1);
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Don't exit the process in production, just log the error
  if (process.env.NODE_ENV === 'development') {
    process.exit(1);
  }
});
