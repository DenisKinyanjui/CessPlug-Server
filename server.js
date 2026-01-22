const express = require('express');
require('dotenv').config();
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const connectDB = require('./config/database');

// Route imports
const authRoutes = require('./routes/authRoutes');
const productRoutes = require('./routes/productRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const brandRoutes = require('./routes/brandRoutes');
const cartRoutes = require('./routes/cartRoutes');
const orderRoutes = require('./routes/orderRoutes');
const mpesaRoutes = require('./routes/mpesa');
const dealRoutes = require('./routes/dealRoutes');
const reviewRoutes = require('./routes/reviewRoutes');
const adminRoutes = require('./routes/adminRoutes');
const bannerRoutes = require('./routes/bannerRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const pickupStationRoutes = require('./routes/pickupStationRoutes');
const commissionRoutes = require('./routes/commissionRoutes');
const payoutSettingsRoutes = require('./routes/payoutSettingsRoutes');

const { validateConfig } = require('./services/mpesa');

const app = express();

// Initialize database connection
const initializeApp = async () => {
  try {
    // Connect to database first
    await connectDB();
    
    // Security middleware
    app.use(helmet());
    app.use(cors({
      origin: [
        process.env.CLIENT_URL ||
        'http://127.0.0.1:3000', 
        'http://127.0.0.1:3001',
        'http://127.0.0.1:3002',
        'https://vinskyshopping.com',
        'https://admin.vinskyshopping.com',
        'https://agents.vinskyshopping.com',
        'https://www.vinskyshopping.co.ke'
      ],
      credentials: true
    }));

    // Rate limiting
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 1000, // limit each IP to 1000 requests per windowMs
      message: {
        success: false,
        message: 'Too many requests from this IP, please try again later'
      }
    });
    app.use('/api/', limiter);

    // Body parser middleware
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    app.get('/', (req, res) => {
      res.send('API is running...');
    });

    // Static files
    app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

    // Routes - CORRECTED ORDER AND REGISTRATION
    app.use('/api/auth', authRoutes);
    app.use('/api/products', productRoutes);
    app.use('/api/categories', categoryRoutes);
    app.use('/api/brands', brandRoutes);
    app.use('/api/cart', cartRoutes);
    app.use('/api/orders', orderRoutes);
    app.use('/api/mpesa', mpesaRoutes);
    app.use('/api/deals', dealRoutes);
    app.use('/api/reviews', reviewRoutes);
    app.use('/api/banners', bannerRoutes);
    app.use('/api/upload', uploadRoutes);
    app.use('/api/pickup-stations', pickupStationRoutes);

    // Commission routes (handles /api/commissions/*)
    app.use('/api/commissions', commissionRoutes);

    // FIXED: Admin settings routes (handles /api/admin/payout-settings/*)
    const adminSettingsRoutes = require('./routes/adminSettingsRoutes');
    app.use('/api/admin', adminSettingsRoutes);

    // General admin routes (must come AFTER specific admin routes)
    app.use('/api/admin', adminRoutes);

    // Health check with updated route information
    app.get('/api/health', (req, res) => {
      res.json({ 
        status: 'OK', 
        message: 'Vinsky Shopping API is running!',
        database: 'Connected',
        timestamp: new Date().toISOString(),
        routes: {
          commissions: '/api/commissions/*',
          payoutSettings: '/api/admin/payout-settings/*', 
          adminGeneral: '/api/admin/*',
          // NEW: Agent statistics routes
          agentStats: '/api/admin/agents/:id/stats',
          agentOrders: '/api/admin/agents/:id/orders'
        }
      });
    });

    // Add test route for debugging
    app.get('/api/test', (req, res) => {
      res.json({
        success: true,
        message: 'Server connection test successful',
        timestamp: new Date().toISOString()
      });
    });

    // NEW: Test route specifically for agent stats endpoints
    app.get('/api/test/agent-stats', (req, res) => {
      res.json({
        success: true,
        message: 'Agent statistics endpoints are available',
        endpoints: {
          agentStats: 'GET /api/admin/agents/:id/stats',
          agentOrders: 'GET /api/admin/agents/:id/orders'
        },
        sampleUsage: {
          stats: 'GET /api/admin/agents/507f1f77bcf86cd799439011/stats',
          orders: 'GET /api/admin/agents/507f1f77bcf86cd799439011/orders?page=1&limit=10'
        },
        requiredAuth: 'Admin JWT token in Authorization header',
        timestamp: new Date().toISOString()
      });
    });

    // Error handling middleware
    app.use((err, req, res, next) => {
      console.error('Error occurred:', err.stack);
      res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? err.stack : 'Something went wrong'
      });
    });

    // 404 handler with better debugging including new routes
    app.use((req, res) => {
      console.log(`404 - Route not found: ${req.method} ${req.path}`);
      res.status(404).json({
        success: false,
        message: 'Route not found',
        path: req.path,
        method: req.method,
        availableRoutes: [
          'GET /api/commissions/admin/payout-requests',
          'GET /api/commissions/admin/payout-stats', 
          'GET /api/admin/payout-settings/',
          'GET /api/admin/payout-settings/window-status',
          'GET /api/admin/agents/:id/stats',           // NEW
          'GET /api/admin/agents/:id/orders',          // NEW
          'GET /api/health',
          'GET /api/test',
          'GET /api/test/agent-stats'                  // NEW
        ]
      });
    });

    // Start server
    const PORT = process.env.PORT || 5000;
    const server = app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    });

    // Validate M-Pesa configuration on server start
    if (!validateConfig()) {
      console.log('M-Pesa configuration is incomplete. M-Pesa payments will not work.');
    }

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('SIGTERM received, shutting down gracefully');
      server.close(() => {
        console.log('Process terminated');
      });
    });

  } catch (error) {
    console.error('Failed to initialize application:', error);
    process.exit(1);
  }
};

// Initialize the application
initializeApp();