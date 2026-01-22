// routes/agentStatsRoutes.js
const express = require('express');
const {
  getAgentStats,
  getAgentOrders,
  getAgentAnalytics
} = require('../controllers/agentStatsController');
const { protect, admin } = require('../middleware/auth');

const router = express.Router();

// All routes require admin authentication
router.use(protect);
router.use(admin);

// Agent statistics routes
router.get('/:id/stats', getAgentStats);
router.get('/:id/orders', getAgentOrders);
router.get('/:id/analytics', getAgentAnalytics);

module.exports = router;