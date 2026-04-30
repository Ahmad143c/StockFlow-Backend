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

const rawAllowedOrigins = process.env.ALLOWED_ORIGINS || '';
const defaultOrigins = process.env.NODE_ENV === 'production' ? ['https://stockflow-orcin-nine.vercel.app'] : ['http://localhost:3000'];
const allowedOrigins = rawAllowedOrigins.trim()
  ? rawAllowedOrigins.split(',').map(origin => origin.trim()).filter(Boolean)
  : defaultOrigins;
const allowAnyOrigin = process.env.NODE_ENV === 'production' && !rawAllowedOrigins.trim();

// CORS configuration – allow localhost and configured origins
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    // If no ALLOWED_ORIGINS are configured in production, allow any origin.
    if (allowAnyOrigin) {
      return callback(null, true);
    }

    // Check if origin is in allowed list
    const isAllowed = allowedOrigins.some(allowedOrigin => {
      if (allowedOrigin instanceof RegExp) {
        return allowedOrigin.test(origin);
      }
      return allowedOrigin === origin;
    });

    if (isAllowed) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: true
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

if (!process.env.MONGO_URI) {
  console.error('Missing required environment variable: MONGO_URI');
  process.exit(1);
}

console.log('Attempting to connect to MongoDB...');
mongoose.connect(process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
  socketTimeoutMS: 45000, // Close sockets after 45s of inactivity
})
  .then(() => console.log('MongoDB connected successfully'))
  .catch(err => {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  });


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

app.use('/api/auth', require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/upload', require('./routes/upload'));
app.use('/api/users', require('./routes/users'));
app.use('/api/purchase-orders', require('./routes/purchaseOrders'));
app.use('/api/vendors', require('./routes/vendors'));
app.use('/api/sales', require('./routes/sales'));

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
const HOST = process.env.HOST || '0.0.0.0';

console.log(`Starting server on ${HOST}:${PORT}...`);
app.listen(PORT, HOST, () => {
  console.log(`✅ Server running successfully on ${HOST}:${PORT}`);
  console.log(`📡 Health check available at: http://${HOST}:${PORT}/health`);
});

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
