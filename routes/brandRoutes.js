const express = require('express');
const {
  getBrands,
  getBrand,
  createBrand,
  updateBrand,
  deleteBrand,
  getAdminBrands
} = require('../controllers/brandController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

// IMPORTANT: More specific routes should come BEFORE general routes
// Admin route to get all brands (including inactive) - must come before /:id
router.route('/admin/all')
  .get(protect, authorize('admin'), getAdminBrands);

// Public routes
router.route('/')
  .get(getBrands)
  .post(protect, authorize('admin'), createBrand);

// Routes with ID parameter should come after specific routes
router.route('/:id')
  .get(getBrand)
  .put(protect, authorize('admin'), updateBrand)
  .delete(protect, authorize('admin'), deleteBrand);

module.exports = router;