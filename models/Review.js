const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: true
  },
  rating: {
    type: Number,
    required: true,
    min: [1, 'Rating must be at least 1'],
    max: [5, 'Rating cannot be more than 5']
  },
  comment: {
    type: String,
    required: true,
    maxlength: [500, 'Comment cannot be more than 500 characters']
  },
  title: {
    type: String,
    maxlength: [100, 'Title cannot be more than 100 characters']
  },
  verified: {
    type: Boolean,
    default: false
  },
  helpful: {
    type: Number,
    default: 0
  },
  visible: {
    type: Boolean,
    default: true
  },
  flagged: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Ensure one review per user per product
reviewSchema.index({ product: 1, user: 1 }, { unique: true });

// Populate user details
reviewSchema.pre(/^find/, function(next) {
  this.populate({
    path: 'user',
    select: 'name avatar'
  }).populate({
    path: 'product',
    select: 'name images'
  });
  next();
});

module.exports = mongoose.model('Review', reviewSchema);