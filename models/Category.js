const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please add a category name'],
    trim: true,
    maxlength: [50, 'Category name cannot be more than 50 characters']
  },
  slug: {
    type: String,
    required: [true, 'Slug is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^[a-z0-9-]+$/, 'Slug must contain only lowercase letters, numbers, and hyphens']
  },
  description: {
    type: String,
    maxlength: [500, 'Description cannot be more than 500 characters'],
    default: ''
  },
  image: {
    type: String,
    default: ''
  },
  parent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    default: null
  },
  status: {
    type: String,
    enum: {
      values: ['active', 'inactive'],
      message: 'Status must be either active or inactive'
    },
    default: 'active'
  },
  // Legacy field for backward compatibility
  isActive: {
    type: Boolean,
    default: true
  },
  // Order field for drag-and-drop reordering
  order: {
    type: Number,
    default: 0,
    min: 0
  },
  // Optional: Common specs that products in this category typically have
  // This is just for reference/suggestions, not enforced
  commonSpecs: [{
    name: {
      type: String,
      trim: true
    },
    unit: {
      type: String,
      trim: true,
      default: ''
    },
    category: {
      type: String,
      trim: true,
      default: 'General'
    }
  }]
}, {
  timestamps: true
});

// Index for performance
categorySchema.index({ parent: 1 });
categorySchema.index({ status: 1 });
categorySchema.index({ order: 1 }); // Add index for order field

// Pre-save middleware to sync status and isActive
categorySchema.pre('save', function(next) {
  // Sync status with isActive for backward compatibility
  this.isActive = this.status === 'active';
  next();
});

// Pre-save middleware to set order for new categories
categorySchema.pre('save', async function(next) {
  if (this.isNew && this.order === 0) {
    // Find the highest order value and increment by 1
    const lastCategory = await this.constructor.findOne({}, {}, { sort: { order: -1 } });
    this.order = lastCategory ? lastCategory.order + 1 : 1;
  }
  next();
});

// Pre-update middleware to handle slug uniqueness
categorySchema.pre('findOneAndUpdate', async function(next) {
  const update = this.getUpdate();
  
  if (update.slug) {
    const existingCategory = await this.model.findOne({ 
      slug: update.slug,
      _id: { $ne: this.getQuery()._id }
    });
    
    if (existingCategory) {
      const error = new Error('Slug already exists');
      error.name = 'ValidationError';
      return next(error);
    }
  }
  
  // Sync status with isActive if status is being updated
  if (update.status) {
    update.isActive = update.status === 'active';
  }
  
  next();
});

// Virtual for backward compatibility
categorySchema.virtual('parentCategory').get(function() {
  return this.parent;
});

// Transform function for JSON output
categorySchema.set('toJSON', {
  transform: function(doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

module.exports = mongoose.model('Category', categorySchema);