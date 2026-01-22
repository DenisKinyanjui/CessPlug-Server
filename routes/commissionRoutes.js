// routes/commissionRoutes.js - UPDATED with validation middleware

const express = require('express');
const {
  getAgentCommissions,
  getCommissionStats,
  getPayoutRequests,
  createPayoutRequest,
  getCommissionById,
  getAllCommissions,
  getAllPayoutRequests,
  processPayoutRequest,
  getCommissionAnalytics,
  // Enhanced methods
  getPayoutStatsEnhanced,
  getPayoutAnalyticsEnhanced,
  bulkProcessPayouts,
  sendPayoutNotification,
  exportPayoutData,
  debugAgentCommissions
} = require('../controllers/commissionController');

const { protect, authorize } = require('../middleware/auth');

// IMPORT NEW VALIDATION MIDDLEWARE
const { 
  validatePayoutRequest,
  validatePayoutSettingsAccess,
  validateWindowStatusAccess 
} = require('../middleware/payoutValidation');

const router = express.Router();

// All routes require authentication
router.use(protect);

// IMPORTANT: Put specific admin routes FIRST before parameterized routes

// Admin payout stats route (most specific first)
router.get('/admin/payout-stats', authorize('admin'), getPayoutStatsEnhanced);

// Admin payout analytics route
router.get('/admin/payout-analytics', authorize('admin'), getPayoutAnalyticsEnhanced);

// Bulk payout processing route
router.put('/admin/payout-requests/bulk-process', authorize('admin'), bulkProcessPayouts);

// Export payout data route
router.get('/admin/payout-requests/export', authorize('admin'), exportPayoutData);

// Admin get all payout requests route
router.get('/admin/payout-requests', authorize('admin'), getAllPayoutRequests);

// Admin get all commissions route
router.get('/admin/all', authorize('admin'), getAllCommissions);

// Admin analytics route
router.get('/admin/analytics', authorize('admin'), getCommissionAnalytics);

// Agent routes (specific before parameterized)
router.get('/stats', authorize('agent'), getCommissionStats);

// Payout request routes
router.route('/payout-requests')
  .get(authorize('agent'), getPayoutRequests)
  // UPDATED: Add validation middleware to payout request creation
  .post(authorize('agent'), validatePayoutRequest, createPayoutRequest);

// Payout request processing and notification routes (specific ID-based routes)
router.put('/payout-requests/:id/process', authorize('admin'), processPayoutRequest);
router.post('/payout-requests/:id/notify', authorize('admin'), sendPayoutNotification);

// Agent commission routes
router.get('/', authorize('agent'), getAgentCommissions);

// Parameterized routes (MUST come LAST)
router.get('/:id', authorize('agent', 'admin'), getCommissionById);

module.exports = router;