// routes/payoutSettingsRoutes.js - Complete file with auto-approval functionality

const express = require('express');
const {
  getPayoutSettings,
  updatePayoutSettings,
  setGlobalPayoutHold,
  setAgentPayoutHold,
  checkPayoutWindow,
  getAgentPayoutHistory,
  validateWithdrawalRequest,
  getAutoApprovalAnalytics,
  updateAutoApprovalSettings
} = require('../controllers/payoutSettingsController');

const { protect, authorize } = require('../middleware/auth');

// Import validation middleware
const { 
  validatePayoutSettingsAccess,
  validateWindowStatusAccess 
} = require('../middleware/payoutValidation');

const router = express.Router();

// All routes require authentication
router.use(protect);

// Core payout settings routes
router.route('/')
  .get(validatePayoutSettingsAccess, getPayoutSettings) // Allow agents to read settings
  .put(authorize('admin'), updatePayoutSettings); // Admin-only for updates

// Global payout control routes (admin only)
router.put('/global-hold', authorize('admin'), setGlobalPayoutHold);

// Payout window status check (accessible by agents and admins)
router.get('/window-status', validateWindowStatusAccess, checkPayoutWindow);

// Withdrawal validation (accessible by agents and admins)
router.post('/validate-withdrawal', validateWithdrawalRequest);

// Auto-approval management routes (admin only)
router.get('/auto-approval-stats', authorize('admin'), getAutoApprovalAnalytics);
router.put('/auto-approval', authorize('admin'), updateAutoApprovalSettings);

// Agent-specific payout management routes (admin only)
router.put('/agents/:agentId/payout-hold', authorize('admin'), setAgentPayoutHold);
router.get('/agents/:agentId/payout-history', authorize('admin'), getAgentPayoutHistory);

module.exports = router;