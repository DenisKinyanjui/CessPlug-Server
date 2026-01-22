// models/User.js - Complete User model with payout management features
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const addressSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['Home', 'Work', 'Other'],
    default: 'Home'
  },
  name: {
    type: String,
    required: true
  },
  address: {
    type: String,
    required: true
  },
  city: {
    type: String,
    required: true
  },
  country: {
    type: String,
    required: true
  },
  postalCode: {
    type: String,
    default: ''
  },
  phone: {
    type: String,
    default: ''
  },
  isDefault: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

const userSchema = new mongoose.Schema({
  // Basic user information
  name: {
    type: String,
    required: [true, 'Please add a name'],
    trim: true,
    maxlength: [50, 'Name cannot be more than 50 characters']
  },
  email: {
    type: String,
    required: [true, 'Please add an email'],
    unique: true,
    lowercase: true,
    match: [
      /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
      'Please add a valid email'
    ]
  },
  password: {
    type: String,
    required: function() {
      return !this.googleId; // Password not required for Google users
    },
    minlength: [8, 'Password must be at least 8 characters'],
    select: false
  },
  role: {
    type: String,
    enum: ['user', 'agent', 'admin'],
    default: 'user'
  },
  phone: {
    type: String,
    trim: true
  },
  avatar: {
    type: String,
    default: ''
  },
  
  // Account status
  isActive: {
    type: Boolean,
    default: true
  },
  verified: {
    type: Boolean,
    default: false
  },
  isPhoneVerified: {
    type: Boolean,
    default: false
  },
  
  // Google authentication
  googleId: {
    type: String,
    sparse: true
  },
  
  // Address information
  address: {
    street: { type: String, default: '' },
    city: { type: String, default: '' },
    state: { type: String, default: '' },
    zipCode: { type: String, default: '' },
    country: { type: String, default: '' }
  },
  addresses: [addressSchema],
  
  // Agent-specific fields
  pickupStation: {
    type: mongoose.Schema.ObjectId,
    ref: 'PickupStation',
    required: function() {
      return this.role === 'agent';
    }
  },
  
  // NEW: Payout management fields (for agents)
  payoutHold: {
    isHeld: {
      type: Boolean,
      default: false
    },
    reason: {
      type: String,
      default: ''
    },
    setBy: {
      type: mongoose.Schema.ObjectId,
      ref: 'User'
    },
    setAt: {
      type: Date
    }
  },
  
  // NEW: Payout preferences (for agents)
  payoutPreferences: {
    preferredMethod: {
      type: String,
      enum: ['mpesa', 'bank'],
      default: 'mpesa'
    },
    defaultAccountDetails: {
      type: String,
      default: ''
    },
    minimumAutoWithdrawal: {
      type: Number,
      min: 0,
      default: 0 // 0 means no auto-withdrawal
    },
    notificationPreferences: {
      emailOnCommission: {
        type: Boolean,
        default: true
      },
      emailOnPayout: {
        type: Boolean,
        default: true
      },
      smsOnPayout: {
        type: Boolean,
        default: false
      }
    }
  },
  
  // NEW: Rate limiting for payouts
  payoutLimits: {
    dailyRequestCount: {
      type: Number,
      default: 0
    },
    lastRequestDate: {
      type: Date
    },
    dailyRequestAmount: {
      type: Number,
      default: 0
    },
    weeklyRequestCount: {
      type: Number,
      default: 0
    },
    weeklyRequestAmount: {
      type: Number,
      default: 0
    },
    lastWeeklyReset: {
      type: Date
    }
  },
  
  // NEW: Agent performance metrics
  agentMetrics: {
    totalCommissionsEarned: {
      type: Number,
      default: 0
    },
    totalPayoutsReceived: {
      type: Number,
      default: 0
    },
    averagePayoutAmount: {
      type: Number,
      default: 0
    },
    lastPayoutDate: {
      type: Date
    },
    ordersHandled: {
      type: Number,
      default: 0
    },
    customerSatisfactionRating: {
      type: Number,
      min: 0,
      max: 5,
      default: 0
    }
  },
  
  // NEW: Agent compliance and verification
  agentCompliance: {
    kycVerified: {
      type: Boolean,
      default: false
    },
    kycVerificationDate: {
      type: Date
    },
    documentsUploaded: {
      type: Boolean,
      default: false
    },
    complianceScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    lastComplianceCheck: {
      type: Date
    },
    riskLevel: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium'
    }
  },
  
  // Password reset
  resetPasswordToken: String,
  resetPasswordExpire: Date,
  
  // Two-factor authentication
  twoFactorSecret: {
    type: String,
    select: false
  },
  twoFactorEnabled: {
    type: Boolean,
    default: false
  },
  
  // Login tracking
  lastLogin: {
    type: Date
  },
  loginAttempts: {
    type: Number,
    default: 0
  },
  lockUntil: {
    type: Date
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better performance
userSchema.index({ email: 1 });
userSchema.index({ phone: 1 });
userSchema.index({ role: 1, isActive: 1 });
userSchema.index({ pickupStation: 1 });
userSchema.index({ googleId: 1 }, { sparse: true });
userSchema.index({ resetPasswordToken: 1 });
userSchema.index({ 'payoutHold.isHeld': 1 });
userSchema.index({ 'payoutLimits.lastRequestDate': 1 });

// Virtual for full name display
userSchema.virtual('fullName').get(function() {
  return this.name;
});

// Virtual for account lock status
userSchema.virtual('isLocked').get(function() {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

// Virtual for payout eligibility
userSchema.virtual('payoutEligible').get(function() {
  if (this.role !== 'agent') return false;
  if (this.payoutHold && this.payoutHold.isHeld) return false;
  if (!this.isActive || !this.verified) return false;
  return true;
});

// Pre-save middleware to hash password
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) {
    next();
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Pre-save middleware to set default address
userSchema.pre('save', function(next) {
  // Ensure only one default address
  if (this.addresses && this.addresses.length > 0) {
    let hasDefault = false;
    this.addresses.forEach(addr => {
      if (addr.isDefault) {
        if (hasDefault) {
          addr.isDefault = false;
        } else {
          hasDefault = true;
        }
      }
    });
    
    // If no default address, set the first one as default
    if (!hasDefault && this.addresses.length > 0) {
      this.addresses[0].isDefault = true;
    }
  }
  next();
});

// Instance method to sign JWT and return
userSchema.methods.getSignedJwtToken = function() {
  return jwt.sign(
    { 
      id: this._id,
      role: this.role,
      email: this.email
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRE || '30d'
    }
  );
};

// Instance method to match user entered password to hashed password in database
userSchema.methods.matchPassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Instance method to generate and hash password token
userSchema.methods.getResetPasswordToken = function() {
  // Generate token
  const resetToken = crypto.randomBytes(20).toString('hex');

  // Hash token and set to resetPasswordToken field
  this.resetPasswordToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');

  // Set expire
  this.resetPasswordExpire = Date.now() + 10 * 60 * 1000; // 10 minutes

  return resetToken;
};

// NEW: Instance method to check if agent can request payout
userSchema.methods.canRequestPayout = function() {
  if (this.role !== 'agent') {
    return {
      allowed: false,
      reason: 'Only agents can request payouts'
    };
  }
  
  if (!this.isActive) {
    return {
      allowed: false,
      reason: 'Account is inactive'
    };
  }
  
  if (!this.verified) {
    return {
      allowed: false,
      reason: 'Account is not verified'
    };
  }
  
  if (this.payoutHold && this.payoutHold.isHeld) {
    return {
      allowed: false,
      reason: `Payouts are on hold: ${this.payoutHold.reason}`
    };
  }
  
  // Check if account is locked
  if (this.isLocked) {
    return {
      allowed: false,
      reason: 'Account is temporarily locked'
    };
  }
  
  return {
    allowed: true,
    reason: 'Agent can request payouts'
  };
};

// NEW: Instance method to reset daily payout limits
userSchema.methods.resetDailyPayoutLimits = function() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  if (!this.payoutLimits.lastRequestDate || 
      this.payoutLimits.lastRequestDate < today) {
    this.payoutLimits.dailyRequestCount = 0;
    this.payoutLimits.dailyRequestAmount = 0;
    this.payoutLimits.lastRequestDate = new Date();
  }
  
  // Reset weekly limits (every Monday)
  const monday = new Date();
  monday.setDate(monday.getDate() - monday.getDay() + 1);
  monday.setHours(0, 0, 0, 0);
  
  if (!this.payoutLimits.lastWeeklyReset || 
      this.payoutLimits.lastWeeklyReset < monday) {
    this.payoutLimits.weeklyRequestCount = 0;
    this.payoutLimits.weeklyRequestAmount = 0;
    this.payoutLimits.lastWeeklyReset = new Date();
  }
};

// NEW: Instance method to increment payout request count
userSchema.methods.incrementPayoutRequest = function(amount) {
  this.resetDailyPayoutLimits();
  this.payoutLimits.dailyRequestCount += 1;
  this.payoutLimits.dailyRequestAmount += amount;
  this.payoutLimits.weeklyRequestCount += 1;
  this.payoutLimits.weeklyRequestAmount += amount;
  return this.save();
};

// NEW: Instance method to check payout request limits
userSchema.methods.checkPayoutLimits = function(amount, settings) {
  this.resetDailyPayoutLimits();
  
  const limits = {
    dailyRequestLimit: settings?.maxPayoutsPerDay || 5,
    dailyAmountLimit: settings?.maxPayoutAmountPerDay || 100000,
    weeklyRequestLimit: settings?.maxPayoutsPerWeek || 20,
    weeklyAmountLimit: settings?.maxPayoutAmountPerWeek || 300000
  };
  
  const errors = [];
  
  // Check daily limits
  if (this.payoutLimits.dailyRequestCount >= limits.dailyRequestLimit) {
    errors.push(`Daily request limit exceeded (${limits.dailyRequestLimit} requests per day)`);
  }
  
  if (this.payoutLimits.dailyRequestAmount + amount > limits.dailyAmountLimit) {
    errors.push(`Daily amount limit exceeded (KSh ${limits.dailyAmountLimit.toLocaleString()} per day)`);
  }
  
  // Check weekly limits
  if (this.payoutLimits.weeklyRequestCount >= limits.weeklyRequestLimit) {
    errors.push(`Weekly request limit exceeded (${limits.weeklyRequestLimit} requests per week)`);
  }
  
  if (this.payoutLimits.weeklyRequestAmount + amount > limits.weeklyAmountLimit) {
    errors.push(`Weekly amount limit exceeded (KSh ${limits.weeklyAmountLimit.toLocaleString()} per week)`);
  }
  
  return {
    allowed: errors.length === 0,
    errors,
    remainingDaily: {
      requests: Math.max(0, limits.dailyRequestLimit - this.payoutLimits.dailyRequestCount),
      amount: Math.max(0, limits.dailyAmountLimit - this.payoutLimits.dailyRequestAmount)
    },
    remainingWeekly: {
      requests: Math.max(0, limits.weeklyRequestLimit - this.payoutLimits.weeklyRequestCount),
      amount: Math.max(0, limits.weeklyAmountLimit - this.payoutLimits.weeklyRequestAmount)
    }
  };
};

// NEW: Instance method to update agent metrics
userSchema.methods.updateAgentMetrics = function(commission, payout) {
  if (commission) {
    this.agentMetrics.totalCommissionsEarned += commission.amount;
    this.agentMetrics.ordersHandled += 1;
  }
  
  if (payout) {
    this.agentMetrics.totalPayoutsReceived += payout.amount;
    this.agentMetrics.lastPayoutDate = new Date();
    
    // Calculate average payout amount
    const totalPayouts = this.agentMetrics.totalPayoutsReceived;
    if (totalPayouts > 0) {
      this.agentMetrics.averagePayoutAmount = this.agentMetrics.totalCommissionsEarned / totalPayouts;
    }
  }
  
  return this.save();
};

// NEW: Instance method to set payout hold
userSchema.methods.setPayoutHold = function(isHeld, reason, setBy) {
  this.payoutHold = {
    isHeld,
    reason: reason || '',
    setBy,
    setAt: new Date()
  };
  return this.save();
};

// NEW: Instance method to release payout hold
userSchema.methods.releasePayoutHold = function() {
  this.payoutHold = {
    isHeld: false,
    reason: '',
    setBy: null,
    setAt: null
  };
  return this.save();
};

// Instance method to handle failed login attempts
userSchema.methods.incLoginAttempts = function() {
  // If we have a previous lock that has expired, restart at 1
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $unset: {
        lockUntil: 1
      },
      $set: {
        loginAttempts: 1
      }
    });
  }
  
  const updates = { $inc: { loginAttempts: 1 } };
  
  // Lock account after 5 attempts for 2 hours
  if (this.loginAttempts + 1 >= 5 && !this.isLocked) {
    updates.$set = {
      lockUntil: Date.now() + 2 * 60 * 60 * 1000 // 2 hours
    };
  }
  
  return this.updateOne(updates);
};

// Instance method to reset login attempts
userSchema.methods.resetLoginAttempts = function() {
  return this.updateOne({
    $unset: {
      loginAttempts: 1,
      lockUntil: 1
    },
    $set: {
      lastLogin: new Date()
    }
  });
};

// Static method to find agents by pickup station
userSchema.statics.findAgentsByStation = function(stationId) {
  return this.find({
    role: 'agent',
    pickupStation: stationId,
    isActive: true
  }).populate('pickupStation', 'name address city state');
};

// Static method to get agent performance stats
userSchema.statics.getAgentPerformanceStats = function(agentId, startDate, endDate) {
  return this.aggregate([
    { $match: { _id: agentId, role: 'agent' } },
    {
      $lookup: {
        from: 'commissions',
        localField: '_id',
        foreignField: 'agentId',
        as: 'commissions',
        pipeline: [
          {
            $match: {
              createdAt: {
                $gte: startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
                $lte: endDate || new Date()
              }
            }
          }
        ]
      }
    },
    {
      $lookup: {
        from: 'payoutrequests',
        localField: '_id',
        foreignField: 'agentId',
        as: 'payouts',
        pipeline: [
          {
            $match: {
              status: 'paid',
              createdAt: {
                $gte: startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
                $lte: endDate || new Date()
              }
            }
          }
        ]
      }
    },
    {
      $project: {
        name: 1,
        email: 1,
        agentMetrics: 1,
        totalCommissions: { $sum: '$commissions.amount' },
        totalPayouts: { $sum: '$payouts.amount' },
        commissionCount: { $size: '$commissions' },
        payoutCount: { $size: '$payouts' }
      }
    }
  ]);
};

module.exports = mongoose.model('User', userSchema);