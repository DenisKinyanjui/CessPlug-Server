// routes/adminSettingsRoutes.js
const express = require('express');
const {
  getPayoutSettings,
  updatePayoutSettings,
  setGlobalPayoutHold,
  checkPayoutWindow,
  setAgentPayoutHold,
  getAgentPayoutHistory,
  validateWithdrawalRequest
} = require('../controllers/adminSettingsController');

const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

// All routes require authentication
router.use(protect);

// READ-ONLY routes accessible by both agents and admins
router.get('/payout-settings', authorize('agent', 'admin'), getPayoutSettings);
router.get('/payout-settings/window-status', authorize('agent', 'admin'), checkPayoutWindow);

// NEW: Validation route accessible by both agents and admins
router.post('/payout-settings/validate-withdrawal', authorize('agent', 'admin'), validateWithdrawalRequest);

// ADMIN-ONLY routes for modifying settings
router.put('/payout-settings', authorize('admin'), updatePayoutSettings);
router.put('/payout-settings/global-hold', authorize('admin'), setGlobalPayoutHold);
router.put('/payout-settings/agents/:agentId/payout-hold', authorize('admin'), setAgentPayoutHold);
router.get('/payout-settings/agents/:agentId/payout-history', authorize('admin'), getAgentPayoutHistory);

module.exports = router;