const Review = require('../models/Review');
const Product = require('../models/Product');
const Order = require('../models/Order');

// @desc    Create product review
// @route   POST /api/reviews/:productId
// @access  Private
exports.createReview = async (req, res) => {
  try {
    const { rating, comment, title } = req.body;
    const productId = req.params.productId;

    // Check if product exists
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Check if user has purchased this product
    const hasPurchased = await Order.findOne({
      user: req.user.id,
      'orderItems.product': productId,
      isPaid: true,
      status: { $in: ['processing', 'shipped', 'delivered'] }
    });

    if (!hasPurchased) {
      return res.status(403).json({
        success: false,
        message: 'You can only review products you have purchased'
      });
    }

    // Check if user already reviewed this product
    const existingReview = await Review.findOne({
      product: productId,
      user: req.user.id
    });

    if (existingReview) {
      return res.status(400).json({
        success: false,
        message: 'You have already reviewed this product'
      });
    }

    const review = await Review.create({
      product: productId,
      user: req.user.id,
      name: req.user.name,
      rating,
      comment,
      title,
      verified: true // Mark as verified purchase since we checked
    });

    // Update product rating
    await updateProductRating(productId);

    res.status(201).json({
      success: true,
      message: 'Review created successfully',
      data: { review }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get product reviews
// @route   GET /api/reviews/:productId
// @access  Public
exports.getProductReviews = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const reviews = await Review.find({ 
      product: req.params.productId,
      visible: { $ne: false } // Only show visible reviews to public
    })
      .populate('user', 'name avatar')
      .populate('product', 'name images')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Review.countDocuments({ 
      product: req.params.productId,
      visible: { $ne: false }
    });

    res.json({
      success: true,
      data: {
        reviews,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get all reviews for admin
// @route   GET /api/reviews/admin/all
// @access  Private/Admin
exports.getAllReviews = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Build filter object
    const filter = {};
    
    // Search filter - search in user name, product name, comment, and title
    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search, 'i');
      
      // First, find matching products
      const matchingProducts = await Product.find({ name: searchRegex }, '_id');
      const productIds = matchingProducts.map(p => p._id);
      
      // Then find matching users
      const User = require('../models/User');
      const matchingUsers = await User.find({ name: searchRegex }, '_id');
      const userIds = matchingUsers.map(u => u._id);
      
      filter.$or = [
        { comment: searchRegex },
        { title: searchRegex },
        { product: { $in: productIds } },
        { user: { $in: userIds } }
      ];
    }

    // Rating filter
    if (req.query.rating) {
      filter.rating = parseInt(req.query.rating);
    }

    // Status filter
    if (req.query.status) {
      switch (req.query.status) {
        case 'visible':
          filter.visible = { $ne: false };
          break;
        case 'hidden':
          filter.visible = false;
          break;
        case 'flagged':
          filter.flagged = true;
          break;
      }
    }

    // Date range filter
    if (req.query.startDate || req.query.endDate) {
      filter.createdAt = {};
      if (req.query.startDate) {
        filter.createdAt.$gte = new Date(req.query.startDate);
      }
      if (req.query.endDate) {
        filter.createdAt.$lte = new Date(req.query.endDate);
      }
    }

    const reviews = await Review.find(filter)
      .populate('user', 'name avatar')
      .populate('product', 'name images')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Review.countDocuments(filter);

    res.json({
      success: true,
      data: {
        reviews,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get review statistics for admin
// @route   GET /api/reviews/admin/stats
// @access  Private/Admin
exports.getReviewStats = async (req, res) => {
  try {
    const totalReviews = await Review.countDocuments();
    
    // Calculate average rating
    const ratingStats = await Review.aggregate([
      {
        $group: {
          _id: null,
          averageRating: { $avg: '$rating' },
          totalReviews: { $sum: 1 }
        }
      }
    ]);

    // Get rating breakdown
    const ratingBreakdown = await Review.aggregate([
      {
        $group: {
          _id: '$rating',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);

    // Convert rating breakdown to object format
    const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    ratingBreakdown.forEach(item => {
      breakdown[item._id] = item.count;
    });

    res.json({
      success: true,
      data: {
        totalReviews,
        averageRating: ratingStats.length > 0 ? Math.round(ratingStats[0].averageRating * 10) / 10 : 0,
        ratingBreakdown: breakdown
      }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Update review visibility
// @route   PATCH /api/reviews/admin/:reviewId/visibility
// @access  Private/Admin
exports.updateReviewVisibility = async (req, res) => {
  try {
    const { visible } = req.body;
    const review = await Review.findByIdAndUpdate(
      req.params.reviewId,
      { visible },
      { new: true }
    )
    .populate('user', 'name avatar')
    .populate('product', 'name images');

    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    res.json({
      success: true,
      message: 'Review visibility updated successfully',
      data: { review }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Flag/unflag review
// @route   PATCH /api/reviews/admin/:reviewId/flag
// @access  Private/Admin
exports.flagReview = async (req, res) => {
  try {
    const { flagged } = req.body;
    const review = await Review.findByIdAndUpdate(
      req.params.reviewId,
      { flagged },
      { new: true }
    )
    .populate('user', 'name avatar')
    .populate('product', 'name images');

    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    res.json({
      success: true,
      message: `Review ${flagged ? 'flagged' : 'unflagged'} successfully`,
      data: { review }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Delete review (Admin)
// @route   DELETE /api/reviews/admin/:reviewId
// @access  Private/Admin
exports.deleteReviewAdmin = async (req, res) => {
  try {
    const review = await Review.findById(req.params.reviewId);

    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    const productId = review.product;
    await Review.findByIdAndDelete(req.params.reviewId);

    // Update product rating
    await updateProductRating(productId);

    res.json({
      success: true,
      message: 'Review deleted successfully'
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Check if user can review product
// @route   GET /api/reviews/:productId/can-review
// @access  Private
exports.canReviewProduct = async (req, res) => {
  try {
    const productId = req.params.productId;

    // Check if user has purchased this product
    const hasPurchased = await Order.findOne({
      user: req.user.id,
      'orderItems.product': productId,
      isPaid: true,
      status: { $in: ['processing', 'shipped', 'delivered'] }
    });

    if (!hasPurchased) {
      return res.json({
        success: true,
        canReview: false,
        reason: 'purchase_required'
      });
    }

    // Check if user already reviewed this product
    const existingReview = await Review.findOne({
      product: productId,
      user: req.user.id
    });

    if (existingReview) {
      return res.json({
        success: true,
        canReview: false,
        reason: 'already_reviewed'
      });
    }

    res.json({
      success: true,
      canReview: true
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Delete review (User)
// @route   DELETE /api/reviews/:reviewId
// @access  Private
exports.deleteReview = async (req, res) => {
  try {
    const review = await Review.findById(req.params.reviewId);

    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    // Check if user owns the review or is admin
    if (review.user.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this review'
      });
    }

    const productId = review.product;
    await Review.findByIdAndDelete(req.params.reviewId);

    // Update product rating
    await updateProductRating(productId);

    res.json({
      success: true,
      message: 'Review deleted successfully'
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// Helper function to update product rating
const updateProductRating = async (productId) => {
  const reviews = await Review.find({ 
    product: productId,
    visible: { $ne: false } // Only count visible reviews
  });
  
  if (reviews.length === 0) {
    await Product.findByIdAndUpdate(productId, {
      rating: 0,
      numReviews: 0
    });
  } else {
    const averageRating = reviews.reduce((acc, review) => acc + review.rating, 0) / reviews.length;
    
    await Product.findByIdAndUpdate(productId, {
      rating: Math.round(averageRating * 10) / 10,
      numReviews: reviews.length
    });
  }
};