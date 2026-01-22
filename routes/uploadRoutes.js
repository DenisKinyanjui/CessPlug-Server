const express = require('express');
const router = express.Router();
const uploadController = require('../controllers/uploadController');
const { protect } = require('../middleware/auth');
const adminMiddleware = require('../middleware/admin');

// Single image upload - accessible to authenticated users
router.post(
  '/single',
  protect,
  uploadController.uploadImage,
  uploadController.handleUpload
);

// Admin-only single image upload (alternative route)
router.post(
  '/admin/single',
  protect,
  adminMiddleware,
  uploadController.uploadImage,
  uploadController.handleUpload
);

// Multiple images upload - accessible to authenticated users
router.post(
  '/multiple',
  protect,
  uploadController.uploadImages,
  uploadController.handleUpload
);

// Admin-only multiple images upload (alternative route)
router.post(
  '/admin/multiple',
  protect,
  adminMiddleware,
  uploadController.uploadImages,
  uploadController.handleUpload
);

// Delete image - accessible to authenticated users
router.delete('/', protect, uploadController.deleteImage);

// Admin-only delete image (alternative route)
router.delete('/admin', protect, adminMiddleware, uploadController.deleteImage);

module.exports = router;