const mongoose = require('mongoose');

const otpVerificationSchema = new mongoose.Schema({
  phone: {
    type: String,
    required: true,
    index: true
  },
  otp: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true
  },
  userData: {
    name: String,
    email: String,
    password: String,
    phone: String
  },
  attempts: {
    type: Number,
    default: 0
  },
  verified: {
    type: Boolean,
    default: false
  },
  // New fields for handling reactivation
  isReactivation: {
    type: Boolean,
    default: false
  },
  existingUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  expiresAt: {
    type: Date,
    default: Date.now,
    expires: 600 // 10 minutes
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('OtpVerification', otpVerificationSchema);