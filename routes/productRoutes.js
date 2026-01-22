const express = require('express');
const {
  getProducts,
  getAdminProducts,
  getProduct,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  getProductStats,       // Add this import
  getSpecValues,
  getAllSpecs,
  getAllBrands,
  getPriceRange,
  getNewArrivals,        
  getFeaturedProducts,   
  getPopularProducts,     
} = require('../controllers/productController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

// IMPORTANT: More specific routes should come BEFORE general routes

// Routes for specs (must come before /:id to avoid conflicts)
router.route('/specs')
  .get(getAllSpecs);

router.route('/specs/:specName')
  .get(getSpecValues);

// Route for brands
router.route('/brands')
  .get(getAllBrands);

// Route for price range
router.route('/price-range')
  .get(getPriceRange);

// Special product collection routes (must come before /:id)
router.route('/new-arrivals')
  .get(getNewArrivals);

router.route('/featured')
  .get(getFeaturedProducts);

router.route('/popular')
  .get(getPopularProducts);

// Route to get product by slug - must come before /:id to avoid conflicts
router.route('/slug/:slug')
  .get(getProduct);

// Admin routes (must come before general routes)
router.route('/admin/stats')
  .get(protect, authorize('admin'), getProductStats);

router.route('/admin/all')
  .get(protect, authorize('admin'), getAdminProducts);

// Main product routes
router.route('/')
  .get(getProducts)
  .post(protect, authorize('admin'), createProduct);

// Routes with ID parameter should come after specific routes
router.route('/:id')
  .get(getProductById)
  .put(protect, authorize('admin'), updateProduct)
  .delete(protect, authorize('admin'), deleteProduct);

// Debug route to inspect product specifications
router.get('/inspect/:id', async (req, res) => {
  try {
    const Product = require('../models/Product');
    const product = await Product.findById(req.params.id);
    res.json({
      success: true,
      data: {
        specifications: product.specifications
      }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;