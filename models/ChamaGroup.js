const mongoose = require('mongoose');

const chamaMemberSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  position: {
    type: Number,
    required: true,
    min: 1,
    max: 10
  },
  joinedAt: {
    type: Date,
    default: Date.now
  }
});

const chamaGroupSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Chama group name is required'],
    trim: true,
    unique: true
  },
  description: {
    type: String,
    default: ''
  },
  weeklyContribution: {
    type: Number,
    required: true,
    default: 500,
    min: [100, 'Weekly contribution must be at least 100']
  },
  maxMembers: {
    type: Number,
    required: true,
    default: 10,
    min: [2, 'Minimum 2 members required'],
    max: [10, 'Maximum 10 members allowed']
  },
  members: [chamaMemberSchema],
  currentWeek: {
    type: Number,
    default: 1,
    min: 1,
    max: 10
  },
  currentTurnPosition: {
    type: Number,
    required: true,
    default: 1,
    min: 1,
    max: 10
  },
  startDate: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: ['draft', 'active', 'completed', 'paused'],
    default: 'draft'
  },
  activatedAt: {
    type: Date
  },
  completedAt: {
    type: Date
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Track contribution cycle
  contributionWindow: {
    startDate: {
      type: Date
    },
    endDate: {
      type: Date
    }
  },
  notes: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

// Index for faster queries
chamaGroupSchema.index({ status: 1 });
chamaGroupSchema.index({ 'members.userId': 1 });
chamaGroupSchema.index({ createdBy: 1 });
chamaGroupSchema.index({ name: 1 });

// Virtual to get member count
chamaGroupSchema.virtual('memberCount').get(function() {
  return this.members.length;
});

// Pre-save middleware to validate maxMembers
chamaGroupSchema.pre('save', function(next) {
  if (this.members.length > this.maxMembers) {
    return next(new Error(`Cannot exceed maximum members of ${this.maxMembers}`));
  }
  next();
});

module.exports = mongoose.model('ChamaGroup', chamaGroupSchema);
