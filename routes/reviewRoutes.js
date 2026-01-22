const express = require('express');
const reviewController = require('../controllers/reviewController');
const { protect, admin } = require('../middleware/auth');

const router = express.Router();

// User routes
router.post('/:productId', protect, reviewController.createReview);
router.get('/:productId', reviewController.getProductReviews);
router.get('/:productId/can-review', protect, reviewController.canReviewProduct);
router.delete('/:reviewId', protect, reviewController.deleteReview);

// Admin routes
router.get('/admin/all', protect, admin, reviewController.getAllReviews);
router.get('/admin/stats', protect, admin, reviewController.getReviewStats);
router.patch('/admin/:reviewId/visibility', protect, admin, reviewController.updateReviewVisibility);
router.patch('/admin/:reviewId/flag', protect, admin, reviewController.flagReview);
router.delete('/admin/:reviewId', protect, admin, reviewController.deleteReviewAdmin); 

module.exports = router;