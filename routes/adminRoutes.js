const express = require('express');
const {
  getDashboardStats,
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
  getAllProductsAdmin,
  updateOrderStatus
} = require('../controllers/adminController');
const {
  getAllBannersAdmin,
  createBanner,
  updateBanner,
  deleteBanner,
  getBannerById,
} = require('../controllers/bannerController');
const {
  getAllAgents,
  getAgentById,
  createAgent,
  createAgentWithStation,
  updateAgent,
  updateAgentWithStation,
  deleteAgent,
  // NEW: Add these imports for agent statistics
  getAgentStatistics,
  getAgentOrdersList
} = require('../controllers/agentController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

// Apply admin middleware to all routes
router.use(protect);
router.use(authorize('admin'));

// Dashboard stats
router.get('/stats', getDashboardStats);

// User management
router.get('/users', getAllUsers);
router.get('/users/:id', getUserById);
router.put('/users/:id', updateUser);
router.delete('/users/:id', deleteUser);

// Product management (admin view)
router.get('/products', getAllProductsAdmin);

// Order management
router.put('/orders/:id/status', updateOrderStatus);

// Banner management
router.get('/banners', getAllBannersAdmin);
router.post('/banners', createBanner);
router.put('/banners/:id', updateBanner);
router.delete('/banners/:id', deleteBanner);
router.get('/banners/:id', getBannerById);

// Agent management
router.get('/agents', getAllAgents);
router.get('/agents/:id', getAgentById);
router.post('/agents', createAgent);
router.post('/agents/with-station', createAgentWithStation);
router.put('/agents/:id', updateAgent);
router.put('/agents/:id/with-station', updateAgentWithStation);
router.delete('/agents/:id', deleteAgent);

// NEW: Agent statistics and orders routes
router.get('/agents/:id/stats', getAgentStatistics);
router.get('/agents/:id/orders', getAgentOrdersList);

module.exports = router;