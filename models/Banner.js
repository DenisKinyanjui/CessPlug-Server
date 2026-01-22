const mongoose = require('mongoose');

const bannerSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Please add a banner title'],
    trim: true,
    maxlength: [100, 'Title cannot be more than 100 characters']
  },
  subtitle: {
    type: String,
    maxlength: [200, 'Subtitle cannot be more than 200 characters']
  },
  image: {
    type: String,
    required: [true, 'Please add a banner image']
  },
  link: {
    type: String,
    default: ''
  },
  buttonText: {
    type: String,
    default: 'Shop Now'
  },
  position: {
    type: String,
    enum: ['hero', 'category', 'promotion', 'footer'],
    default: 'hero'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  startDate: {
    type: Date,
    default: Date.now
  },
  endDate: {
    type: Date
  },
  priority: {
    type: Number,
    default: 0
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

// Sort by priority and creation date
bannerSchema.index({ priority: -1, createdAt: -1 });

// Populate creator details
bannerSchema.pre(/^find/, function(next) {
  this.populate({
    path: 'createdBy',
    select: 'name email'
  });
  next();
});

module.exports = mongoose.model('Banner', bannerSchema);