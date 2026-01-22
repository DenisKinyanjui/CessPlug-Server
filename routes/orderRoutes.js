const express = require('express');
const {
  createOrder,
  getMyOrders,
  getOrderById,
  updateOrderToPaid,
  updateOrderStatus,
  getOrders,
  updateOrderToDelivered,
  getFrequentlyBought,
  getProductSales,
  getProductSalesStats,
  getOrdersByStation,
  getMyStationOrders,
  // NEW: Commission-related endpoints
  getCommissionPreview,
  getCurrentCommissionRates
} = require('../controllers/orderController');
const { protect, authorize, admin } = require('../middleware/auth');

const router = express.Router();

// Public route for frequently bought products
router.get('/frequently-bought', getFrequentlyBought);

// NEW: Commission rates endpoint (accessible by agents and admins)
router.get('/commission-rates', protect, authorize('agent', 'admin'), getCurrentCommissionRates);

// NEW: Commission preview endpoint (accessible by agents and admins)
router.get('/commission-preview', protect, authorize('agent', 'admin'), getCommissionPreview);

// Protected routes
router.use(protect);

router.route('/')
  .post(createOrder)
  .get(authorize('admin'), getOrders);

router.get('/my', getMyOrders);

// Agent-specific routes for pickup station orders
router.get('/my-station', authorize('agent'), getMyStationOrders);
router.get('/station/:stationId', authorize('admin', 'agent'), getOrdersByStation);

// Product sales data route (Admin only)
router.get('/product/:productId/sales', authorize('admin'), getProductSales);
router.get('/products/sales', authorize('admin'), getProductSalesStats);

router.route('/:id')
  .get(getOrderById);

router.put('/:id/pay', updateOrderToPaid);
router.put('/:id/status', authorize('admin', 'agent'), updateOrderStatus);
router.put('/:id/deliver', authorize('admin'), updateOrderToDelivered);

module.exports = router;