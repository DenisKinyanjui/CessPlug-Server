const mongoose = require('mongoose');

const payoutRequestSchema = new mongoose.Schema({
  agentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: [1, 'Payout amount must be at least 1']
  },
  method: {
    type: String,
    enum: ['mpesa', 'bank'],
    required: true
  },
  accountDetails: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'paid', 'rejected', 'on_hold'],
    default: 'pending'
  },
  requestedAt: {
    type: Date,
    default: Date.now
  },
  processedAt: {
    type: Date
  },
  processedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  notes: {
    type: String,
    default: ''
  },
  rejectionReason: {
    type: String
  },
  // Commission IDs that were paid out with this request
  commissionIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Commission'
  }],
  // Enhanced metadata for auto-approval tracking
  metadata: {
    settingsVersion: String,
    processingFee: Number,
    validatedAt: Date,
    validationWarnings: [String],
    autoApproved: {
      type: Boolean,
      default: false
    },
    autoApprovalThreshold: Number,
    autoPaid: {
      type: Boolean,
      default: false
    },
    autoProcessedAt: Date,
    originalRequestAmount: Number // Track original amount before fees
  }
}, {
  timestamps: true
});

// Indexes for better query performance
payoutRequestSchema.index({ agentId: 1, status: 1 });
payoutRequestSchema.index({ agentId: 1, createdAt: -1 });
payoutRequestSchema.index({ status: 1, createdAt: -1 });
payoutRequestSchema.index({ 'metadata.autoApproved': 1 });
payoutRequestSchema.index({ 'metadata.autoPaid': 1 });

// Virtual for formatted amount
payoutRequestSchema.virtual('formattedAmount').get(function() {
  return `KSh ${this.amount.toLocaleString()}`;
});

// Virtual to check if this was auto-processed
payoutRequestSchema.virtual('isAutoProcessed').get(function() {
  return this.metadata && (this.metadata.autoApproved || this.metadata.autoPaid);
});

// Instance method to auto-approve payout
payoutRequestSchema.methods.autoApprove = function(systemUserId) {
  this.status = 'approved';
  this.processedAt = new Date();
  this.processedBy = systemUserId;
  this.notes = this.notes ? `${this.notes}; Auto-approved based on admin settings` : 'Auto-approved based on admin settings';
  
  if (this.metadata) {
    this.metadata.autoApproved = true;
    this.metadata.autoProcessedAt = new Date();
  } else {
    this.metadata = {
      autoApproved: true,
      autoProcessedAt: new Date()
    };
  }
  
  return this.save();
};

// Instance method to auto-pay payout
payoutRequestSchema.methods.autoPay = function(commissionIds = []) {
  this.status = 'paid';
  this.processedAt = new Date();
  this.commissionIds = commissionIds;
  this.notes = this.notes ? `${this.notes}; Auto-paid` : 'Auto-paid based on admin settings';
  
  if (this.metadata) {
    this.metadata.autoPaid = true;
    this.metadata.autoProcessedAt = new Date();
  } else {
    this.metadata = {
      autoPaid: true,
      autoProcessedAt: new Date()
    };
  }
  
  return this.save();
};

// Instance method to approve payout (existing method, enhanced)
payoutRequestSchema.methods.approve = function(processedBy) {
  this.status = 'approved';
  this.processedAt = new Date();
  this.processedBy = processedBy;
  this.notes = this.notes ? `${this.notes}; Manually approved` : 'Manually approved by admin';
  return this.save();
};

// Instance method to mark as paid (existing method, enhanced)
payoutRequestSchema.methods.markAsPaid = function(processedBy) {
  this.status = 'paid';
  this.processedAt = new Date();
  this.processedBy = processedBy;
  this.notes = this.notes ? `${this.notes}; Manually marked as paid` : 'Manually marked as paid by admin';
  return this.save();
};

// Instance method to reject payout
payoutRequestSchema.methods.reject = function(reason, processedBy) {
  this.status = 'rejected';
  this.rejectionReason = reason;
  this.processedAt = new Date();
  this.processedBy = processedBy;
  return this.save();
};

// Instance method to put on hold
payoutRequestSchema.methods.putOnHold = function(processedBy, reason) {
  this.status = 'on_hold';
  this.processedAt = new Date();
  this.processedBy = processedBy;
  if (reason) this.notes = reason;
  return this.save();
};

// Instance method to release from hold
payoutRequestSchema.methods.releaseFromHold = function(processedBy, reason) {
  this.status = 'pending';
  this.processedAt = new Date();
  this.processedBy = processedBy;
  if (reason) this.notes = reason;
  return this.save();
};

// Static method to get auto-approval statistics
payoutRequestSchema.statics.getAutoApprovalStats = async function(startDate, endDate) {
  const matchCriteria = {};
  
  if (startDate || endDate) {
    matchCriteria.createdAt = {};
    if (startDate) matchCriteria.createdAt.$gte = new Date(startDate);
    if (endDate) matchCriteria.createdAt.$lte = new Date(endDate);
  }

  const stats = await this.aggregate([
    { $match: matchCriteria },
    {
      $group: {
        _id: null,
        totalRequests: { $sum: 1 },
        autoApprovedCount: {
          $sum: {
            $cond: [{ $eq: ['$metadata.autoApproved', true] }, 1, 0]
          }
        },
        autoPaidCount: {
          $sum: {
            $cond: [{ $eq: ['$metadata.autoPaid', true] }, 1, 0]
          }
        },
        manualApprovedCount: {
          $sum: {
            $cond: [
              { 
                $and: [
                  { $eq: ['$status', 'approved'] },
                  { $ne: ['$metadata.autoApproved', true] }
                ]
              }, 
              1, 
              0
            ]
          }
        },
        manualPaidCount: {
          $sum: {
            $cond: [
              { 
                $and: [
                  { $eq: ['$status', 'paid'] },
                  { $ne: ['$metadata.autoPaid', true] }
                ]
              }, 
              1, 
              0
            ]
          }
        },
        totalAutoApprovedAmount: {
          $sum: {
            $cond: [
              { $eq: ['$metadata.autoApproved', true] }, 
              '$amount', 
              0
            ]
          }
        },
        totalAutoPaidAmount: {
          $sum: {
            $cond: [
              { $eq: ['$metadata.autoPaid', true] }, 
              '$amount', 
              0
            ]
          }
        }
      }
    }
  ]);

  return stats[0] || {
    totalRequests: 0,
    autoApprovedCount: 0,
    autoPaidCount: 0,
    manualApprovedCount: 0,
    manualPaidCount: 0,
    totalAutoApprovedAmount: 0,
    totalAutoPaidAmount: 0
  };
};

// Static method to check auto-approval eligibility
payoutRequestSchema.statics.checkAutoApprovalEligibility = async function(agentId, amount) {
  const PayoutSettings = require('./PayoutSettings');
  const User = require('./User');
  
  try {
    const settings = await PayoutSettings.findOne();
    const agent = await User.findById(agentId);
    
    if (!settings || !agent) {
      return {
        eligible: false,
        reason: 'Settings or agent not found'
      };
    }

    // Check basic eligibility
    if (settings.requireManagerApproval) {
      return {
        eligible: false,
        reason: 'Manager approval required for all payouts'
      };
    }

    if (amount > settings.autoApprovalThreshold) {
      return {
        eligible: false,
        reason: `Amount exceeds auto-approval threshold of KSh ${settings.autoApprovalThreshold.toLocaleString()}`
      };
    }

    // Check agent-specific restrictions
    if (agent.payoutHold && agent.payoutHold.isHeld) {
      return {
        eligible: false,
        reason: 'Agent has payout hold'
      };
    }

    // Check for existing pending requests
    const existingPending = await this.findOne({
      agentId,
      status: { $in: ['pending', 'approved'] }
    });

    if (existingPending) {
      return {
        eligible: false,
        reason: 'Agent has existing pending payout request'
      };
    }

    return {
      eligible: true,
      reason: 'Eligible for auto-approval',
      threshold: settings.autoApprovalThreshold
    };
  } catch (error) {
    console.error('Error checking auto-approval eligibility:', error);
    return {
      eligible: false,
      reason: 'Error checking eligibility'
    };
  }
};

// Populate related data on find queries
payoutRequestSchema.pre(/^find/, function(next) {
  this.populate({
    path: 'agentId',
    select: 'name email phone'
  }).populate({
    path: 'processedBy',
    select: 'name email'
  });
  next();
});

module.exports = mongoose.model('PayoutRequest', payoutRequestSchema);