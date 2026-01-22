// models/PayoutSettings.js - Updated with fixed delivery commission
const mongoose = require('mongoose');

const payoutSettingsSchema = new mongoose.Schema({
  // Withdrawal limits
  minWithdrawalAmount: {
    type: Number,
    required: true,
    min: [1, 'Minimum withdrawal amount must be at least 1'],
    default: 100
  },
  maxWithdrawalAmount: {
    type: Number,
    required: true,
    min: [1, 'Maximum withdrawal amount must be at least 1'],
    default: 50000
  },
  
  // Commission rates configuration - UPDATED
  commissionRates: {
    // CHANGED: Fixed amount per delivery (not percentage)
    deliveryAmount: {
      type: Number,
      min: [0, 'Delivery commission amount cannot be negative'],
      default: 200 // KSh 200 per delivery
    },
    // UNCHANGED: Percentage for agent orders
    agentOrder: {
      type: Number,
      min: [0, 'Agent order commission rate cannot be negative'],
      max: [1, 'Agent order commission rate cannot exceed 100%'],
      default: 0.03 // 3%
    }
  },
  
  // Payout schedule configuration
  payoutSchedule: {
    enabled: {
      type: Boolean,
      default: false
    },
    dayOfWeek: {
      type: Number,
      min: 0,
      max: 6, // 0 = Sunday, 6 = Saturday
      default: 5 // Friday
    },
    startTime: {
      type: String,
      default: '07:00',
      match: [/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format (HH:MM)']
    },
    endTime: {
      type: String,
      default: '23:59',
      match: [/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format (HH:MM)']
    }
  },
  
  // Global payout controls
  globalPayoutHold: {
    type: Boolean,
    default: false
  },
  holdReason: {
    type: String,
    default: ''
  },
  
  // Processing fee (deducted from payouts)
  processingFee: {
    type: Number,
    min: [0, 'Processing fee cannot be negative'],
    default: 0
  },
  
  // Auto-approval settings
  autoApprovalThreshold: {
    type: Number,
    min: [0, 'Auto approval threshold cannot be negative'],
    default: 1000
  },
  requireManagerApproval: {
    type: Boolean,
    default: false
  },
  
  // Notification settings
  notificationSettings: {
    emailOnRequest: {
      type: Boolean,
      default: true
    },
    emailOnApproval: {
      type: Boolean,
      default: true
    },
    emailOnPayment: {
      type: Boolean,
      default: true
    },
    smsOnPayment: {
      type: Boolean,
      default: false
    }
  },
  
  // Security settings
  requireTwoFactorForLargePayouts: {
    type: Boolean,
    default: false
  },
  twoFactorThreshold: {
    type: Number,
    min: [0, 'Two factor threshold cannot be negative'],
    default: 10000
  },
  
  // Rate limiting
  maxPayoutsPerDay: {
    type: Number,
    min: [1, 'Must allow at least 1 payout per day'],
    default: 5
  },
  maxPayoutAmountPerDay: {
    type: Number,
    min: [1, 'Daily payout limit must be at least 1'],
    default: 100000
  },
  
  // Audit trail
  lastModifiedBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'User'
  },
  modificationHistory: [{
    modifiedBy: {
      type: mongoose.Schema.ObjectId,
      ref: 'User'
    },
    modifiedAt: {
      type: Date,
      default: Date.now
    },
    changes: {
      type: mongoose.Schema.Types.Mixed
    },
    reason: {
      type: String
    }
  }]
}, {
  timestamps: true
});

// Validation to ensure min is less than max
payoutSettingsSchema.pre('save', function(next) {
  if (this.minWithdrawalAmount >= this.maxWithdrawalAmount) {
    next(new Error('Minimum withdrawal amount must be less than maximum withdrawal amount'));
  }
  
  if (this.payoutSchedule.startTime >= this.payoutSchedule.endTime) {
    next(new Error('Start time must be before end time'));
  }
  
  next();
});

// Static method to get current settings (create default if none exist)
payoutSettingsSchema.statics.getCurrentSettings = async function() {
  let settings = await this.findOne();
  
  if (!settings) {
    settings = await this.create({
      minWithdrawalAmount: 100,
      maxWithdrawalAmount: 50000,
      commissionRates: {
        deliveryAmount: 200, // KSh 200 per delivery
        agentOrder: 0.03 // 3%
      },
      payoutSchedule: {
        enabled: false,
        dayOfWeek: 5,
        startTime: '07:00',
        endTime: '23:59'
      },
      globalPayoutHold: false,
      processingFee: 0,
      autoApprovalThreshold: 1000,
      requireManagerApproval: false
    });
  }
  
  return settings;
};

// Instance method to check if payouts are currently allowed
payoutSettingsSchema.methods.arePayoutsAllowed = function() {
  if (this.globalPayoutHold) {
    return {
      allowed: false,
      reason: 'Global payout hold is active'
    };
  }
  
  if (!this.payoutSchedule.enabled) {
    return {
      allowed: true,
      reason: 'Payout scheduling is disabled'
    };
  }
  
  const now = new Date();
  const currentDay = now.getDay();
  const currentTime = now.toTimeString().substr(0, 5);
  
  const isCorrectDay = currentDay === this.payoutSchedule.dayOfWeek;
  const isWithinTimeRange = currentTime >= this.payoutSchedule.startTime && 
                           currentTime <= this.payoutSchedule.endTime;
  
  if (!isCorrectDay) {
    return {
      allowed: false,
      reason: `Payouts are only allowed on ${this.getDayName(this.payoutSchedule.dayOfWeek)}`
    };
  }
  
  if (!isWithinTimeRange) {
    return {
      allowed: false,
      reason: `Payouts are only allowed between ${this.payoutSchedule.startTime} and ${this.payoutSchedule.endTime}`
    };
  }
  
  return {
    allowed: true,
    reason: 'Within payout window'
  };
};

// Helper method to get day name
payoutSettingsSchema.methods.getDayName = function(dayNumber) {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[dayNumber] || 'Unknown';
};

// Instance method to validate withdrawal amount
payoutSettingsSchema.methods.validateWithdrawalAmount = function(amount) {
  const errors = [];
  
  if (amount < this.minWithdrawalAmount) {
    errors.push(`Minimum withdrawal amount is KSh ${this.minWithdrawalAmount}`);
  }
  
  if (amount > this.maxWithdrawalAmount) {
    errors.push(`Maximum withdrawal amount is KSh ${this.maxWithdrawalAmount}`);
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

// Instance method to calculate processing fee
payoutSettingsSchema.methods.calculateProcessingFee = function(amount) {
  return this.processingFee;
};

// Instance method to check if amount requires manager approval
payoutSettingsSchema.methods.requiresManagerApproval = function(amount) {
  return this.requireManagerApproval && amount > this.autoApprovalThreshold;
};

// UPDATED: Instance method to calculate commission based on current rates
payoutSettingsSchema.methods.calculateCommission = function(orderTotal, commissionType, deliveryCount = 1) {
  if (commissionType === 'delivery') {
    // Fixed amount per delivery (not percentage-based)
    return this.commissionRates.deliveryAmount * deliveryCount;
  } else {
    // Percentage-based for agent orders
    const rate = this.commissionRates.agentOrder || 0.03;
    return Math.round(orderTotal * rate);
  }
};

// UPDATED: Instance method to get commission rates
payoutSettingsSchema.methods.getCommissionRates = function() {
  return {
    deliveryAmount: this.commissionRates.deliveryAmount,
    agentOrder: this.commissionRates.agentOrder
  };
};

// UPDATED: Virtual for formatted schedule
payoutSettingsSchema.virtual('formattedSchedule').get(function() {
  if (!this.payoutSchedule.enabled) {
    return 'Always available';
  }
  
  return `${this.getDayName(this.payoutSchedule.dayOfWeek)} ${this.payoutSchedule.startTime} - ${this.payoutSchedule.endTime}`;
});

// UPDATED: Virtual for formatted commission rates
payoutSettingsSchema.virtual('formattedCommissionRates').get(function() {
  return {
    deliveryAmount: `KSh ${this.commissionRates.deliveryAmount.toLocaleString()}`,
    agentOrder: `${(this.commissionRates.agentOrder * 100).toFixed(1)}%`
  };
});

// Ensure virtuals are included in JSON output
payoutSettingsSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('PayoutSettings', payoutSettingsSchema);