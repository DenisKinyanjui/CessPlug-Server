const mongoose = require('mongoose');

const chamaRedemptionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  chamaGroupId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChamaGroup',
    required: true
  },
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true
  },
  weekNumber: {
    type: Number,
    required: true,
    min: 1,
    max: 10
  },
  amountRedeemed: {
    type: Number,
    required: true,
    min: 0
  },
  // Amount that had to be paid via other methods (e.g., M-Pesa)
  amountOutsideChama: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'cancelled'],
    default: 'pending'
  },
  cancelReason: {
    type: String,
    default: ''
  },
  notes: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

// Indexes for queries
chamaRedemptionSchema.index({ userId: 1, chamaGroupId: 1 });
chamaRedemptionSchema.index({ orderId: 1 });
chamaRedemptionSchema.index({ chamaGroupId: 1 });
chamaRedemptionSchema.index({ status: 1 });

module.exports = mongoose.model('ChamaRedemption', chamaRedemptionSchema);
