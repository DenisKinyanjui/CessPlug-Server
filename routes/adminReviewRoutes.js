// adminReviewRoutes.js
const express = require('express');
const router = express.Router(); // This creates the router instance
const {
  getAllReviews,
  getReviewStats,
  updateReviewVisibility,
  flagReview,
  deleteReview
} = require('../controllers/reviewController');
const { protect, admin } = require('../middleware/auth');

// Apply middleware
router.use(protect);
router.use(admin);

// Define routes
router.get('/', getAllReviews);
router.get('/stats', getReviewStats);
router.patch('/:reviewId/visibility', updateReviewVisibility);
router.patch('/:reviewId/flag', flagReview);
router.delete('/:reviewId', deleteReview);

// Make sure this is the last line
module.exports = router; // This exports the router