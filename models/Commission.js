const mongoose = require('mongoose');

const commissionSchema = new mongoose.Schema({
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true
  },
  agentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['delivery', 'agent_order'],
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: [0, 'Commission amount cannot be negative']
  },
  status: {
    type: String,
    enum: ['pending', 'paid', 'cancelled'],
    default: 'pending'
  },
  orderTotal: {
    type: Number,
    required: true
  },
  // UPDATED: More flexible commission rate field
  commissionRate: {
    type: Number,
    required: true,
    min: 0
    // No max limit since delivery can be fixed amount
  },
  // NEW: Track if this is a fixed amount or percentage
  isFixedAmount: {
    type: Boolean,
    default: false
  },
  // NEW: For delivery commissions, track number of items delivered
  deliveryCount: {
    type: Number,
    default: 1,
    min: 1
  },
  description: {
    type: String,
    default: ''
  },
  paidAt: {
    type: Date
  },
  cancelledAt: {
    type: Date
  },
  // Reference to payout request if commission was paid via payout
  payoutRequestId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PayoutRequest'
  },
  // Track which settings version was used for this commission
  settingsVersion: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PayoutSettings'
  }
}, {
  timestamps: true
});

// Indexes for better query performance
commissionSchema.index({ agentId: 1, status: 1 });
commissionSchema.index({ agentId: 1, createdAt: -1 });
commissionSchema.index({ orderId: 1 });
commissionSchema.index({ type: 1, status: 1 });

// Virtual for formatted amount
commissionSchema.virtual('formattedAmount').get(function() {
  return `KSh ${this.amount.toLocaleString()}`;
});

// UPDATED: Static method to calculate commission amount using current settings
commissionSchema.statics.calculateCommission = async function(orderTotal, type, deliveryCount = 1) {
  try {
    const PayoutSettings = require('./PayoutSettings');
    const settings = await PayoutSettings.getCurrentSettings();
    
    let amount, rate, isFixedAmount;
    
    if (type === 'delivery') {
      // Fixed amount per delivery
      amount = settings.commissionRates.deliveryAmount * deliveryCount;
      rate = settings.commissionRates.deliveryAmount; // Store the fixed amount as rate
      isFixedAmount = true;
    } else {
      // Percentage-based for agent orders
      rate = settings.commissionRates.agentOrder || 0.03;
      amount = Math.round(orderTotal * rate);
      isFixedAmount = false;
    }
    
    return {
      amount,
      rate,
      isFixedAmount,
      deliveryCount,
      settingsId: settings._id
    };
  } catch (error) {
    console.error('Error calculating commission:', error);
    
    // Fallback to default values if settings can't be loaded
    let amount, rate, isFixedAmount;
    
    if (type === 'delivery') {
      amount = 200 * deliveryCount; // Default KSh 200 per delivery
      rate = 200;
      isFixedAmount = true;
    } else {
      rate = 0.03; // Default 3% for agent orders
      amount = Math.round(orderTotal * rate);
      isFixedAmount = false;
    }
    
    return {
      amount,
      rate,
      isFixedAmount,
      deliveryCount,
      settingsId: null
    };
  }
};

// Instance method to mark as paid
commissionSchema.methods.markAsPaid = function(payoutRequestId = null) {
  this.status = 'paid';
  this.paidAt = new Date();
  if (payoutRequestId) {
    this.payoutRequestId = payoutRequestId;
  }
  return this.save();
};

// Instance method to cancel
commissionSchema.methods.cancel = function() {
  this.status = 'cancelled';
  this.cancelledAt = new Date();
  return this.save();
};

// UPDATED: Virtual for commission display
commissionSchema.virtual('commissionDisplay').get(function() {
  if (this.type === 'delivery') {
    return {
      type: 'Fixed Amount',
      display: `KSh ${this.amount.toLocaleString()}`,
      calculation: this.deliveryCount > 1 
        ? `KSh ${(this.amount / this.deliveryCount).toLocaleString()} × ${this.deliveryCount} deliveries`
        : `KSh ${this.amount.toLocaleString()} per delivery`
    };
  } else {
    return {
      type: 'Percentage',
      display: `${(this.commissionRate * 100).toFixed(1)}%`,
      calculation: `KSh ${this.orderTotal.toLocaleString()} × ${(this.commissionRate * 100).toFixed(1)}% = KSh ${this.amount.toLocaleString()}`
    };
  }
});

// Populate related data on find queries
commissionSchema.pre(/^find/, function(next) {
  this.populate({
    path: 'orderId',
    select: 'orderNumber totalPrice status createdAt deliveryMethod'
  }).populate({
    path: 'agentId',
    select: 'name email phone'
  }).populate({
    path: 'settingsVersion',
    select: 'commissionRates version'
  });
  next();
});

module.exports = mongoose.model('Commission', commissionSchema);