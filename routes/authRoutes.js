const express = require('express');
const {
  register,
  verifyOTP,
  resendOTP,
  login,
  getProfile,
  updateProfile,
  updateProfileSecure,
  forgotPassword,
  resetPassword,
  changePassword, // Add this import
  testSMS,
  verifySetupToken,
  setupAgentPassword,

  googleLogin,
  verifyGooglePhone,
  verifyPhoneAfterGoogle,
  resendGooglePhoneOtp,
  completeGooglePhoneVerification,
  
  sendOTP,
  verifyTermiiOTP,
  completeRegistration,
  checkBalance,

  // Address management functions
  addAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress
} = require('../controllers/authController');
const { protect } = require('../middleware/auth');

const router = express.Router();

// Basic authentication routes
router.post('/register', register);
router.post('/verify-otp', verifyOTP);
router.post('/resend-otp', resendOTP);
router.post('/login', login);
router.get('/profile', protect, getProfile);
router.put('/profile', protect, updateProfile);
router.put('/profile/secure-update', protect, updateProfileSecure);
router.post('/forgot-password', forgotPassword);
router.put('/reset-password/:token', resetPassword);
router.put('/change-password', protect, changePassword);

// Agent setup routes (NEW)
router.get('/verify-setup-token/:token', verifySetupToken);
router.post('/setup-password', setupAgentPassword);

// Google Sign-In routes
router.post('/google-login', googleLogin);
router.post('/verify-google-phone', verifyGooglePhone);
router.post('/verify-phone-after-google', verifyPhoneAfterGoogle);
router.post('/resend-google-phone-otp', resendGooglePhoneOtp);
router.post('/complete-google-phone-verification', completeGooglePhoneVerification);

// Termii-specific routes
router.post('/send-otp', sendOTP);
router.post('/verify-termii-otp', verifyTermiiOTP);
router.post('/complete-registration', completeRegistration);

// Address management routes
router.post('/addresses', protect, addAddress);
router.put('/addresses/:addressId', protect, updateAddress);
router.delete('/addresses/:addressId', protect, deleteAddress);
router.put('/addresses/:addressId/default', protect, setDefaultAddress);

// Development and testing routes
if (process.env.NODE_ENV === 'development') {
  router.post('/test-sms', testSMS);
  router.get('/check-balance', checkBalance);
}

module.exports = router;