const express = require('express');
const {
  getCategories,
  getAdminCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
  getParentCategories,
  reorderCategories
} = require('../controllers/categoryController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

// IMPORTANT: More specific routes should come BEFORE general routes

// Admin route to get all categories (including inactive)
router.get('/admin/all', protect, authorize('admin'), getAdminCategories);

// Admin route to reorder categories
router.put('/reorder', protect, authorize('admin'), reorderCategories);

// Route to get parent categories for dropdown
router.get('/parents', getParentCategories);

// Public routes
router.get('/', getCategories);
router.get('/:id', getCategoryById);

// Admin routes
router.post('/', protect, authorize('admin'), createCategory);
router.put('/:id', protect, authorize('admin'), updateCategory);
router.delete('/:id', protect, authorize('admin'), deleteCategory);

module.exports = router;