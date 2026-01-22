const express = require('express');
const {
  getFlashDeals,
  createFlashDeal,
  removeFlashDeal
} = require('../controllers/dealController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.get('/flash', getFlashDeals);
router.post('/flash', protect, authorize('admin'), createFlashDeal);
router.delete('/flash/:productId', protect, authorize('admin'), removeFlashDeal);

module.exports = router;