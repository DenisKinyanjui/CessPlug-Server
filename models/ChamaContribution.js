const mongoose = require('mongoose');

const chamaContributionSchema = new mongoose.Schema({
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
  weekNumber: {
    type: Number,
    required: true,
    min: 1,
    max: 10
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  paid: {
    type: Boolean,
    default: false
  },
  paidAt: {
    type: Date
  },
  paymentMethod: {
    type: String,
    enum: ['mpesa', 'cash', 'bank_transfer'],
    required: function() {
      return this.paid === true;
    }
  },
  transactionId: {
    type: String,
    default: ''
  },
  notes: {
    type: String,
    default: ''
  },
  recordedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Compound index to prevent duplicate contributions for same user, chama, week
chamaContributionSchema.index({ userId: 1, chamaGroupId: 1, weekNumber: 1 }, { unique: true });
chamaContributionSchema.index({ chamaGroupId: 1, weekNumber: 1 });
chamaContributionSchema.index({ paid: 1 });
chamaContributionSchema.index({ userId: 1 });

module.exports = mongoose.model('ChamaContribution', chamaContributionSchema);
