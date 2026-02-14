const User = require('../models/User');
const OtpVerification = require('../models/OtpVerification');
const smsService = require('../services/smsService');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { sendPasswordResetEmail } = require('../utils/emailService');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// @desc    Register user (Step 1 - Send OTP)
// @route   POST /api/auth/register
// @access  Public
exports.register = async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;
    console.log('Register request received:', { name, email, phone });

    // Validate required fields
    if (!name || !email || !password || !phone) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields'
      });
    }

    // Validate phone number format
    if (!smsService.validatePhoneNumber(phone)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid phone number'
      });
    }

    // Check if user already exists (only check ACTIVE users)
    const existingUser = await User.findOne({ 
      $or: [
        { email: email.toLowerCase(), isActive: true }, 
        { phone, isActive: true }
      ] 
    });
    
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email or phone number already exists'
      });
    }

    // Check if there's a soft-deleted user with same email or phone
    const softDeletedUser = await User.findOne({ 
      $or: [{ email: email.toLowerCase() }, { phone }],
      isActive: false
    });

    if (softDeletedUser) {
      console.log(`Found soft-deleted user for ${email || phone}, will reactivate after verification`);
    }

    // Store user data temporarily in OtpVerification for later use
    // Delete any existing records for this phone/email
    await OtpVerification.deleteMany({ 
      $or: [{ phone }, { email: email.toLowerCase() }] 
    });

    // Create a temporary record to store user data (without OTP yet)
    const tempRecord = await OtpVerification.create({
      phone,
      otp: '000000', // Placeholder, will be updated when OTP is sent
      email: email.toLowerCase(),
      userData: { 
        name: name.trim(), 
        email: email.toLowerCase(), 
        password, 
        phone 
      },
      isReactivation: !!softDeletedUser,
      existingUserId: softDeletedUser?._id,
      verified: false
    });

    // Return success - frontend will handle phone verification
    res.status(200).json({
      success: true,
      message: 'Registration data validated successfully',
      data: {
        phone: phone,
        email: email.toLowerCase(),
        name: name.trim(),
        tempId: tempRecord._id
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred'
    });
  }
};

// @desc    Verify OTP and complete registration
// @route   POST /api/auth/verify-otp
// @access  Public
exports.verifyOTP = async (req, res) => {
  try {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Phone number and OTP are required'
      });
    }

    // Find OTP record
    const otpRecord = await OtpVerification.findOne({ 
      phone, 
      verified: false 
    });

    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP'
      });
    }

    // Check if too many attempts
    if (otpRecord.attempts >= 3) {
      await OtpVerification.findByIdAndDelete(otpRecord._id);
      return res.status(400).json({
        success: false,
        message: 'Too many failed attempts. Please request a new OTP.'
      });
    }

    // Verify OTP
    if (otpRecord.otp !== otp) {
      // Increment attempts
      otpRecord.attempts += 1;
      await otpRecord.save();
      
      return res.status(400).json({
        success: false,
        message: `Invalid OTP. ${3 - otpRecord.attempts} attempts remaining.`
      });
    }

    let user;
    const { name, email, password, phone: userPhone } = otpRecord.userData;

    // Check if this is reactivating a soft-deleted user
    if (otpRecord.isReactivation && otpRecord.existingUserId) {
      // Reactivate and update existing user
      user = await User.findByIdAndUpdate(
        otpRecord.existingUserId,
        {
          name,
          email,
          password, // This will be hashed by the pre-save middleware
          phone: userPhone,
          isActive: true,
          verified: true,
          updatedAt: new Date()
        },
        { new: true }
      );
      
      console.log(`Reactivated soft-deleted user: ${email}`);
    } else {
      // Create new user
      user = await User.create({
        name,
        email,
        password,
        phone: userPhone,
        verified: true,
        isActive: true
      });
      
      console.log(`Created new user: ${email}`);
    }

    // Mark OTP as verified and delete
    await OtpVerification.findByIdAndDelete(otpRecord._id);

    // Generate JWT token
    const token = user.getSignedJwtToken();

    res.status(201).json({
      success: true,
      message: 'Phone number verified and account created successfully',
      data: {
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          phone: user.phone,
          verified: user.verified
        },
        token
      }
    });

  } catch (error) {
    console.error('OTP verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred'
    });
  }
};

// @desc    Resend OTP (LEGACY)
// @route   POST /api/auth/resend-otp
// @access  Public
exports.resendOTP = async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }

    // Find existing OTP record
    const otpRecord = await OtpVerification.findOne({ phone, verified: false });

    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        message: 'No pending verification found for this phone number'
      });
    }

    // Generate new OTP
    const newOTP = smsService.generateOTP();
    
    // Update OTP record
    otpRecord.otp = newOTP;
    otpRecord.attempts = 0; // Reset attempts
    otpRecord.expiresAt = new Date(Date.now() + 10 * 60 * 1000); // Extend expiry
    await otpRecord.save();

    // Send new OTP
    try {
      await smsService.sendOTP(phone, newOTP, otpRecord.userData.name);
      
      res.status(200).json({
        success: true,
        message: 'New OTP sent successfully'
      });
    } catch (smsError) {
      return res.status(500).json({
        success: false,
        message: 'Failed to send OTP. Please try again.'
      });
    }

  } catch (error) {
    console.error('Resend OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred'
    });
  }
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide an email and password'
      });
    }

    // CHANGE THIS LINE - Add populate for pickup station
    const user = await User.findOne({ email: email.toLowerCase(), isActive: true })
      .select('+password')
      .populate('pickupStation', 'name address city state postalCode coordinates operatingHours capacity');
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    const isMatch = await user.matchPassword(password);
    
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    const token = user.getSignedJwtToken();

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          verified: user.verified,
          phone: user.phone,
          isPhoneVerified: user.isPhoneVerified,
          pickupStation: user.pickupStation // This should now be populated
        },
        token
      }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Google Sign-In
// @route   POST /api/auth/google-login
// @access  Public
exports.googleLogin = async (req, res) => {
  try {
    const { credential } = req.body;

    if (!credential) {
      return res.status(400).json({
        success: false,
        message: 'Google credential is required'
      });
    }

    // Verify Google ID token
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;

    if (!email || !googleId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Google credential'
      });
    }

    // Check if user exists by email or googleId
    let user = await User.findOne({
      $or: [
        { email: email.toLowerCase(), isActive: true },
        { googleId, isActive: true }
      ]
    });

    if (!user) {
      // Create new Google user (without phone initially)
      user = await User.create({
        name,
        email: email.toLowerCase(),
        googleId,
        avatar: picture || '',
        verified: true, // Google users are email-verified
        isActive: true,
        isPhoneVerified: false
      });

      console.log(`Created new Google user: ${email}`);
    } else if (!user.googleId) {
      // Link existing email user to Google account
      user.googleId = googleId;
      user.verified = true;
      if (picture && !user.avatar) {
        user.avatar = picture;
      }
      await user.save();
      
      console.log(`Linked existing user to Google: ${email}`);
    }

    // Check if phone verification is required
    if (!user.phone || !user.isPhoneVerified) {
      return res.status(200).json({
        success: true,
        requirePhoneVerification: true,
        data: {
          userId: user._id,
          email: user.email,
          name: user.name
        },
        message: 'Phone verification required to complete account setup'
      });
    }

    // Generate JWT token for fully verified user
    const token = user.getSignedJwtToken();

    return res.status(200).json({
      success: true,
      requirePhoneVerification: false,
      data: {
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          avatar: user.avatar,
          phone: user.phone,
          verified: user.verified,
          isPhoneVerified: user.isPhoneVerified
        },
        token
      },
      message: 'Google sign-in successful'
    });

  } catch (error) {
    console.error('Google login error:', error);
    
    return res.status(500).json({
      success: false,
      message: 'Google authentication failed',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// @desc    Request phone verification for Google user
// @route   POST /api/auth/verify-google-phone
// @access  Public
exports.verifyGooglePhone = async (req, res) => {
  try {
    const { userId, phone } = req.body;

    console.log('verifyGooglePhone request received:', { userId, phone });

    // Validate required fields
    if (!userId || !phone) {
      return res.status(400).json({
        success: false,
        message: 'User ID and phone number are required'
      });
    }

    // Validate phone number format
    if (!smsService.validatePhoneNumber(phone)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid phone number'
      });
    }

    // Find the Google user
    const user = await User.findById(userId);
    if (!user || !user.googleId) {
      return res.status(404).json({
        success: false,
        message: 'Google user not found'
      });
    }

    // Check if phone is already taken by another user
    const formattedPhone = smsService.formatPhoneNumber(phone);
    const existingUser = await User.findOne({ 
      phone: { $in: [phone, formattedPhone] },
      isActive: true, 
      _id: { $ne: userId } 
    });
    
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'This phone number is already registered'
      });
    }

    console.log('Phone formatting:', {
      original: phone,
      formatted: formattedPhone,
      userId: userId
    });

    // Clean up any existing verification records for this user/phone/email
    await OtpVerification.deleteMany({
      $or: [
        { phone: formattedPhone },
        { email: user.email },
        { 'userData.userId': userId }
      ]
    });

    // Create a simplified verification record
    const tempRecord = await OtpVerification.create({
      phone: formattedPhone,
      otp: '000000', // Placeholder for Termii flow
      email: user.email,
      userData: {
        userId: userId,
        phone: formattedPhone,
        originalPhone: phone,
        userName: user.name,
        email: user.email,
        isGooglePhoneVerification: true
      },
      verified: false,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000) // 30 minutes
    });

    console.log('Created temp record for Google phone verification:', {
      tempId: tempRecord._id,
      phone: tempRecord.phone,
      originalPhone: phone,
      userId: userId,
      email: user.email,
      userData: { phone: formattedPhone }
    });

    res.status(200).json({
      success: true,
      message: 'Phone verification initiated',
      data: {
        phone: formattedPhone,
        tempId: tempRecord._id
      }
    });

  } catch (error) {
    console.error('verifyGooglePhone error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during verification setup',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Complete Google phone verification after Termii OTP verification
// @route   POST /api/auth/complete-google-phone-verification
// @access  Public
exports.completeGooglePhoneVerification = async (req, res) => {
  try {
    const { phone, verificationData, userId } = req.body;

    console.log('Completion request:', { 
      phone, 
      userId, 
      msisdn: verificationData?.msisdn 
    });

    // Validate required fields
    if (!phone || !verificationData?.verified || !userId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required verification data'
      });
    }

    // Format phone numbers consistently
    const formattedPhone = smsService.formatPhoneNumber(phone);
    const msisdn = verificationData.msisdn 
      ? smsService.formatPhoneNumber(verificationData.msisdn) 
      : formattedPhone;

    console.log('Phone formatting in completion:', { 
      original: phone, 
      formatted: formattedPhone,
      msisdn: msisdn
    });

    // Verify user exists first
    const user = await User.findById(userId);
    if (!user?.googleId) {
      return res.status(404).json({
        success: false,
        message: 'Google user account not found'
      });
    }

    console.log('User found:', { id: user._id, email: user.email, googleId: !!user.googleId });

    // Simplified search - look for records that match the phone numbers and are unverified
    // We'll try multiple approaches to find the record
    let tempRecord = null;

    // Search approach 1: By formatted phone number
    tempRecord = await OtpVerification.findOne({ 
      phone: formattedPhone, 
      verified: false 
    });
    
    console.log('Search 1 - formatted phone:', tempRecord ? 'Found' : 'Not found');

    // Search approach 2: By msisdn if different from formatted phone
    if (!tempRecord && msisdn !== formattedPhone) {
      tempRecord = await OtpVerification.findOne({ 
        phone: msisdn, 
        verified: false 
      });
      console.log('Search 2 - msisdn phone:', tempRecord ? 'Found' : 'Not found');
    }

    // Search approach 3: By user email (as backup)
    if (!tempRecord) {
      tempRecord = await OtpVerification.findOne({ 
        email: user.email, 
        verified: false 
      });
      console.log('Search 3 - user email:', tempRecord ? 'Found' : 'Not found');
    }

    // Search approach 4: Look for any unverified record related to this user
    if (!tempRecord) {
      // Check if userData contains userId or other identifiers
      tempRecord = await OtpVerification.findOne({
        $and: [
          { verified: false },
          {
            $or: [
              { 'userData.userId': userId },
              { 'userData.email': user.email },
              { phone: { $in: [formattedPhone, msisdn] } }
            ]
          }
        ]
      });
      console.log('Search 4 - comprehensive search:', tempRecord ? 'Found' : 'Not found');
    }

    // Debug: Show all available records for this user
    if (!tempRecord) {
      const allUserRecords = await OtpVerification.find({
        $or: [
          { email: user.email },
          { 'userData.userId': userId },
          { 'userData.email': user.email }
        ]
      });

      console.log('No temp record found. Available records for debugging:');
      console.log('All records for user:', allUserRecords.map(r => ({
        id: r._id,
        phone: r.phone,
        email: r.email,
        verified: r.verified,
        userData: r.userData,
        createdAt: r.createdAt
      })));

      // Try to find the most recent unverified record for this email
      const recentRecord = await OtpVerification.findOne({
        email: user.email,
        verified: false
      }).sort({ createdAt: -1 });

      if (recentRecord) {
        console.log('Found recent unverified record, using it:', {
          id: recentRecord._id,
          phone: recentRecord.phone,
          email: recentRecord.email
        });
        tempRecord = recentRecord;
      }
    }

    if (!tempRecord) {
      return res.status(400).json({
        success: false,
        message: 'Phone verification session not found. Please try again.',
        debug: process.env.NODE_ENV === 'development' ? {
          searchCriteria: {
            formattedPhone,
            msisdn,
            userId,
            userEmail: user.email
          }
        } : undefined
      });
    }

    console.log('Found temp record:', {
      id: tempRecord._id,
      phone: tempRecord.phone,
      email: tempRecord.email,
      userData: tempRecord.userData
    });

    // Update user with verified phone
    user.phone = msisdn; // Use Termii's msisdn as canonical format
    user.isPhoneVerified = true;
    await user.save();

    console.log('Updated user with phone:', { phone: user.phone, isPhoneVerified: user.isPhoneVerified });

    // Clean up verification record
    await OtpVerification.findByIdAndDelete(tempRecord._id);
    console.log('Cleaned up temp record');

    // Generate auth token
    const token = user.getSignedJwtToken();

    res.status(200).json({
      success: true,
      message: 'Phone verification completed',
      data: {
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          isPhoneVerified: true,
          role: user.role,
          verified: user.verified
        },
        token
      }
    });

  } catch (error) {
    console.error('Completion error:', {
      error: error.message,
      stack: error.stack,
      requestBody: req.body
    });

    res.status(500).json({
      success: false,
      message: 'Failed to complete verification',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Verify phone after Google sign-in
// @route   POST /api/auth/verify-phone-after-google
// @access  Public
exports.verifyPhoneAfterGoogle = async (req, res) => {
  try {
    const { userId, phone, otp } = req.body;

    if (!userId || !phone || !otp) {
      return res.status(400).json({
        success: false,
        message: 'User ID, phone number, and OTP are required'
      });
    }

    // Find the Google user
    const user = await User.findById(userId);
    if (!user || !user.googleId) {
      return res.status(404).json({
        success: false,
        message: 'Google user not found'
      });
    }

    // Find OTP record
    const otpRecord = await OtpVerification.findOne({ 
      phone, 
      verified: false,
      'userData.isGooglePhoneVerification': true,
      'userData.userId': userId
    });

    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP'
      });
    }

    // Check attempts
    if (otpRecord.attempts >= 3) {
      await OtpVerification.findByIdAndDelete(otpRecord._id);
      return res.status(400).json({
        success: false,
        message: 'Too many failed attempts. Please request a new OTP.'
      });
    }

    // Verify OTP
    if (otpRecord.otp !== otp) {
      otpRecord.attempts += 1;
      await otpRecord.save();
      
      return res.status(400).json({
        success: false,
        message: `Invalid OTP. ${3 - otpRecord.attempts} attempts remaining.`
      });
    }

    // Update user with verified phone
    user.phone = phone;
    user.isPhoneVerified = true;
    await user.save();

    // Clean up OTP record
    await OtpVerification.findByIdAndDelete(otpRecord._id);

    // Generate JWT token
    const token = user.getSignedJwtToken();

    res.status(200).json({
      success: true,
      message: 'Phone number verified successfully',
      data: {
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          avatar: user.avatar,
          phone: user.phone,
          verified: user.verified,
          isPhoneVerified: user.isPhoneVerified
        },
        token
      }
    });

  } catch (error) {
    console.error('Google phone verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred'
    });
  }
};

// @desc    Resend OTP for Google phone verification
// @route   POST /api/auth/resend-google-phone-otp
// @access  Public
exports.resendGooglePhoneOtp = async (req, res) => {
  try {
    const { userId, phone } = req.body;

    if (!userId || !phone) {
      return res.status(400).json({
        success: false,
        message: 'User ID and phone number are required'
      });
    }

    // Find the Google user
    const user = await User.findById(userId);
    if (!user || !user.googleId) {
      return res.status(404).json({
        success: false,
        message: 'Google user not found'
      });
    }

    // Find existing OTP record
    const otpRecord = await OtpVerification.findOne({ 
      phone, 
      verified: false,
      'userData.isGooglePhoneVerification': true,
      'userData.userId': userId
    });

    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        message: 'No pending phone verification found'
      });
    }

    // Generate new OTP
    const newOTP = smsService.generateOTP();
    
    // Update OTP record
    otpRecord.otp = newOTP;
    otpRecord.attempts = 0;
    otpRecord.expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await otpRecord.save();

    // Send new OTP
    try {
      if (process.env.NODE_ENV === 'development' && process.env.SKIP_SMS === 'true') {
        console.log(`[DEV MODE] Resent Google Phone OTP for ${phone}: ${newOTP}`);
        
        return res.status(200).json({
          success: true,
          message: 'New verification code sent (Development Mode)',
          devOtp: newOTP
        });
      }

      await smsService.sendOTP(phone, newOTP, user.name);
      
      res.status(200).json({
        success: true,
        message: 'New verification code sent successfully'
      });
    } catch (smsError) {
      console.error('SMS Error for resending Google phone OTP:', smsError);
      return res.status(500).json({
        success: false,
        message: 'Failed to send verification code. Please try again.'
      });
    }

  } catch (error) {
    console.error('Resend Google phone OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred'
    });
  }
};

// @desc    Send OTP using Termii OTP endpoint
// @route   POST /api/auth/send-otp
// @access  Public
exports.sendOTP = async (req, res) => {
  try {
    const { phone, userName = 'User' } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }

    // Validate phone number format
    if (!smsService.validatePhoneNumber(phone)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid phone number'
      });
    }

    // Send OTP using Termii's dedicated OTP endpoint
    const result = await smsService.sendOTPViaTermiiOTP(phone, userName);

    res.status(200).json({
      success: true,
      message: 'OTP sent successfully',
      data: {
        pinId: result.pinId,
        phone: phone,
        balance: result.balance,
        smsStatus: result.smsStatus
      }
    });

  } catch (error) {
    console.error('Send OTP error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to send OTP'
    });
  }
};

// @desc    Verify OTP using Termii verification endpoint and complete registration
// @route   POST /api/auth/verify-termii-otp
// @access  Public
exports.verifyTermiiOTP = async (req, res) => {
  try {
    const { pinId, pin } = req.body;

    if (!pinId || !pin) {
      return res.status(400).json({
        success: false,
        message: 'Pin ID and PIN are required'
      });
    }

    // Verify OTP using Termii's verification endpoint
    const result = await smsService.verifyOTPViaTermii(pinId, pin);

    if (!result.success || !result.verified) {
      return res.status(400).json({
        success: false,
        message: 'Invalid verification code. Please try again.',
        data: {
          verified: false,
          msisdn: result.msisdn
        }
      });
    }

    res.status(200).json({
      success: true,
      message: 'OTP verified successfully',
      data: {
        verified: result.verified,
        msisdn: result.msisdn
      }
    });

  } catch (error) {
    console.error('Verify Termii OTP error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'OTP verification failed'
    });
  }
};

// @desc    Complete registration after phone verification
// @route   POST /api/auth/complete-registration
// @access  Public
exports.completeRegistration = async (req, res) => {
  try {
    const { phone, verificationData } = req.body;

    if (!phone || !verificationData || !verificationData.verified) {
      return res.status(400).json({
        success: false,
        message: 'Phone verification is required'
      });
    }

    // Find the temporary user data
    const tempRecord = await OtpVerification.findOne({ 
      phone, 
      verified: false 
    });

    if (!tempRecord || !tempRecord.userData) {
      return res.status(400).json({
        success: false,
        message: 'Registration session not found. Please start registration again.'
      });
    }

    const { name, email, password, phone: userPhone } = tempRecord.userData;

    let user;

    // Check if this is reactivating a soft-deleted user
    if (tempRecord.isReactivation && tempRecord.existingUserId) {
      // Reactivate and update existing user
      user = await User.findByIdAndUpdate(
        tempRecord.existingUserId,
        {
          name,
          email,
          password, // This will be hashed by the pre-save middleware
          phone: userPhone,
          isActive: true,
          verified: true,
          isPhoneVerified: true,
          updatedAt: new Date()
        },
        { new: true }
      );
      
      console.log(`Reactivated soft-deleted user: ${email}`);
    } else {
      // Create new user
      user = await User.create({
        name,
        email,
        password,
        phone: userPhone,
        verified: true,
        isActive: true,
        isPhoneVerified: true
      });
      
      console.log(`Created new user: ${email}`);
    }

    // Clean up temporary record
    await OtpVerification.findByIdAndDelete(tempRecord._id);

    // Generate JWT token
    const token = user.getSignedJwtToken();

    res.status(201).json({
      success: true,
      message: 'Registration completed successfully',
      data: {
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          phone: user.phone,
          verified: user.verified,
          isPhoneVerified: user.isPhoneVerified
        },
        token
      }
    });

  } catch (error) {
    console.error('Complete registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred'
    });
  }
};


// @desc    Check Termii balance
// @route   GET /api/auth/check-balance
// @access  Public (Development only)
exports.checkBalance = async (req, res) => {
  try {
    const balance = await smsService.checkBalance();
    
    res.status(200).json({
      success: true,
      message: 'Balance retrieved successfully',
      data: balance
    });

  } catch (error) {
    console.error('Check balance error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to check balance'
    });
  }
};

// @desc    Test SMS functionality
// @route   POST /api/auth/test-sms
// @access  Public (Development only)
exports.testSMS = async (req, res) => {
  try {
    const { phone } = req.body;
    
    if (!phone) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }

    // Test connection first
    try {
      await smsService.testConnection();
    } catch (connError) {
      return res.status(500).json({
        success: false,
        message: 'SMS service connection failed',
        error: connError.message
      });
    }

    // Try sending a test OTP
    const testOtp = smsService.generateOTP();
    await smsService.sendOTP(phone, testOtp, 'Test User');
    
    res.json({
      success: true,
      message: 'Test SMS sent successfully',
      otp: process.env.NODE_ENV === 'development' ? testOtp : 'Check your phone'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'SMS test failed',
      error: error.message
    });
  }
};

// @desc    Get current user profile
// @route   GET /api/auth/profile
// @access  Private
exports.getProfile = async (req, res) => {
  try {
    // CHANGE THIS LINE - Add populate for pickup station
    const user = await User.findById(req.user.id)
      .populate('pickupStation', 'name address city state postalCode coordinates operatingHours capacity');
    
    res.json({
      success: true,
      data: {
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          avatar: user.avatar,
          phone: user.phone,
          address: user.address,
          addresses: user.addresses,
          verified: user.verified,
          isPhoneVerified: user.isPhoneVerified,
          pickupStation: user.pickupStation // This should now be populated
        }
      }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Update user profile
// @route   PUT /api/auth/profile
// @access  Private
exports.updateProfile = async (req, res) => {
  try {
    const fieldsToUpdate = {
      name: req.body.name,
      email: req.body.email,
      phone: req.body.phone,
      address: req.body.address
    };

    const user = await User.findByIdAndUpdate(req.user.id, fieldsToUpdate, {
      new: true,
      runValidators: true
    });

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          avatar: user.avatar,
          phone: user.phone,
          address: user.address,
          verified: user.verified
        }
      }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Update user profile with password verification (for sensitive changes)
// @route   PUT /api/auth/profile/secure-update
// @access  Private
exports.updateProfileSecure = async (req, res) => {
  try {
    const { currentPassword, phone, ...otherFields } = req.body;

    if (!currentPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current password is required for this update'
      });
    }

    // Get user with password field for verification
    const user = await User.findById(req.user.id).select('+password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Verify current password
    const isCurrentPasswordCorrect = await user.matchPassword(currentPassword);

    if (!isCurrentPasswordCorrect) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Additional validation for phone number if being updated
    if (phone) {
      // Validate phone number format (adjust regex as needed)
      const phoneRegex = /^(\+254|254|0)[17]\d{8}$/;
      if (!phoneRegex.test(phone)) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid phone number format'
        });
      }

      // Check if phone is already taken by another user
      const existingUser = await User.findOne({ 
        phone, 
        isActive: true, 
        _id: { $ne: req.user.id } 
      });
      
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'This phone number is already registered by another user'
        });
      }
    }

    // Prepare fields to update
    const fieldsToUpdate = {};
    if (phone) fieldsToUpdate.phone = phone;
    
    // Add other fields that might be updated securely
    Object.keys(otherFields).forEach(key => {
      if (['name', 'email'].includes(key)) {
        fieldsToUpdate[key] = otherFields[key];
      }
    });

    // Update user profile
    const updatedUser = await User.findByIdAndUpdate(
      req.user.id, 
      fieldsToUpdate, 
      {
        new: true,
        runValidators: true
      }
    ).populate('pickupStation', 'name address city state postalCode coordinates operatingHours capacity');

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Log the secure update for audit purposes
    console.log(`Secure profile update for user ${req.user.id}:`, Object.keys(fieldsToUpdate));

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        user: {
          _id: updatedUser._id,
          name: updatedUser.name,
          email: updatedUser.email,
          role: updatedUser.role,
          avatar: updatedUser.avatar,
          phone: updatedUser.phone,
          address: updatedUser.address,
          addresses: updatedUser.addresses,
          verified: updatedUser.verified,
          isPhoneVerified: updatedUser.isPhoneVerified,
          pickupStation: updatedUser.pickupStation
        }
      }
    });
  } catch (error) {
    console.error('Secure profile update error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to update profile'
    });
  }
};

exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    const user = await User.findOne({ email: email.toLowerCase(), isActive: true });

    if (!user) {
      // Don't reveal if user doesn't exist for security
      return res.status(200).json({
        success: true,
        message: 'If an account exists with this email, a reset link has been sent'
      });
    }

    // Generate reset token using the User model method
    const resetToken = user.getResetPasswordToken();
    
    // Save the user with reset token fields
    await user.save({ validateBeforeSave: false });

    // Send email with user role parameter
    const emailResult = await sendPasswordResetEmail(user.email, resetToken, user.name, user.role);

    if (!emailResult.success) {
      // Clear reset token fields if email fails
      user.resetPasswordToken = undefined;
      user.resetPasswordExpire = undefined;
      await user.save({ validateBeforeSave: false });
      
      console.error('Failed to send reset email:', emailResult.error);
      return res.status(500).json({
        success: false,
        message: 'Failed to send reset email. Please try again later.'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Password reset link sent to your email'
    });

  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred'
    });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    console.log('Reset password attempt with token:', token);

    if (!token || !password) {
      return res.status(400).json({
        success: false,
        message: 'Token and new password are required'
      });
    }

    // Validate password strength
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters long'
      });
    }

    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
      return res.status(400).json({
        success: false,
        message: 'Password must contain at least one uppercase letter, one lowercase letter, and one number'
      });
    }

    // Hash the token to match what's stored in database
    const hashedToken = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');

    console.log('Looking for user with hashed token:', hashedToken);

    // Find user by hashed token and check if token hasn't expired
    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpire: { $gt: Date.now() },
      isActive: true
    }).select('+password');

    if (!user) {
      console.log('No user found with valid reset token');
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token'
      });
    }

    console.log('Found user for password reset:', user.email);

    // Set new password (will be hashed by pre-save middleware)
    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    
    await user.save();

    console.log('Password updated successfully for user:', user.email);

    // For agents, mark as verified since they've completed the setup
    if (user.role === 'agent' && !user.verified) {
      user.verified = true;
      await user.save({ validateBeforeSave: false });
    }

    // Fetch user with populated pickupStation for agents
    let userResponse;
    if (user.role === 'agent') {
      userResponse = await User.findById(user._id)
        .populate('pickupStation', 'name address city state postalCode')
        .select('-password');
    } else {
      userResponse = user;
    }

    // Generate new JWT token for immediate login
    const authToken = user.getSignedJwtToken();

    res.status(200).json({
      success: true,
      message: 'Password reset successful',
      data: {
        token: authToken,
        user: {
          _id: userResponse._id,
          name: userResponse.name,
          email: userResponse.email,
          role: userResponse.role,
          verified: userResponse.verified,
          phone: userResponse.phone,
          isPhoneVerified: userResponse.isPhoneVerified,
          pickupStation: userResponse.pickupStation || null
        }
      }
    });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred during password reset'
    });
  }
};

// @desc    Change user password
// @route   PUT /api/auth/change-password
// @access  Private
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current password and new password are required'
      });
    }

    // Validate new password strength
    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 8 characters long'
      });
    }

    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(newPassword)) {
      return res.status(400).json({
        success: false,
        message: 'New password must contain at least one uppercase letter, one lowercase letter, and one number'
      });
    }

    // Get user with password field
    const user = await User.findById(req.user.id).select('+password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if current password is correct
    const isCurrentPasswordCorrect = await user.matchPassword(currentPassword);

    if (!isCurrentPasswordCorrect) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Check if new password is different from current password
    const isSamePassword = await user.matchPassword(newPassword);
    if (isSamePassword) {
      return res.status(400).json({
        success: false,
        message: 'New password must be different from current password'
      });
    }

    // Update password (will be hashed by pre-save middleware)
    user.password = newPassword;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while changing password'
    });
  }
};

// @desc    Add new address
// @route   POST /api/auth/addresses
// @access  Private
exports.addAddress = async (req, res) => {
  try {
    const { type, name, address, city, country, postalCode, phone, isDefault } = req.body;

    if (!name || !address || !city || !country) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields (name, address, city, country)'
      });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // If setting as default, unset other defaults
    if (isDefault) {
      user.addresses.forEach(addr => {
        addr.isDefault = false;
      });
    }

    // Create new address
    const newAddress = {
      type: type || 'Home',
      name,
      address,
      city,
      country,
      postalCode: postalCode || '',
      phone: phone || user.phone || '',
      isDefault: isDefault || false
    };

    user.addresses.push(newAddress);
    await user.save();

    res.status(201).json({
      success: true,
      message: 'Address added successfully',
      data: {
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          avatar: user.avatar,
          phone: user.phone,
          address: user.address,
          addresses: user.addresses,
          verified: user.verified,
          isPhoneVerified: user.isPhoneVerified
        }
      }
    });

  } catch (error) {
    console.error('Add address error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred'
    });
  }
};

// @desc    Update address
// @route   PUT /api/auth/addresses/:addressId
// @access  Private
exports.updateAddress = async (req, res) => {
  try {
    const { addressId } = req.params;
    const { type, name, address, city, country, postalCode, phone, isDefault } = req.body;

    if (!name || !address || !city || !country) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields (name, address, city, country)'
      });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Find the address to update
    const addressToUpdate = user.addresses.id(addressId);
    if (!addressToUpdate) {
      return res.status(404).json({
        success: false,
        message: 'Address not found'
      });
    }

    // If setting as default, unset other defaults
    if (isDefault) {
      user.addresses.forEach(addr => {
        addr.isDefault = false;
      });
    }

    // Update address fields
    addressToUpdate.type = type || addressToUpdate.type;
    addressToUpdate.name = name;
    addressToUpdate.address = address;
    addressToUpdate.city = city;
    addressToUpdate.country = country;
    addressToUpdate.postalCode = postalCode || '';
    addressToUpdate.phone = phone || user.phone || '';
    addressToUpdate.isDefault = isDefault || false;

    await user.save();

    res.json({
      success: true,
      message: 'Address updated successfully',
      data: {
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          avatar: user.avatar,
          phone: user.phone,
          address: user.address,
          addresses: user.addresses,
          verified: user.verified,
          isPhoneVerified: user.isPhoneVerified
        }
      }
    });

  } catch (error) {
    console.error('Update address error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred'
    });
  }
};

// @desc    Delete address
// @route   DELETE /api/auth/addresses/:addressId
// @access  Private
exports.deleteAddress = async (req, res) => {
  try {
    const { addressId } = req.params;

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Find the address to delete
    const addressToDelete = user.addresses.id(addressId);
    if (!addressToDelete) {
      return res.status(404).json({
        success: false,
        message: 'Address not found'
      });
    }

    // If deleting default address, clear the main address field
    if (addressToDelete.isDefault) {
      user.address = {
        street: '',
        city: '',
        state: '',
        zipCode: '',
        country: ''
      };
    }

    // Remove the address
    user.addresses.pull(addressId);
    await user.save();

    res.json({
      success: true,
      message: 'Address deleted successfully',
      data: {
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          avatar: user.avatar,
          phone: user.phone,
          address: user.address,
          addresses: user.addresses,
          verified: user.verified,
          isPhoneVerified: user.isPhoneVerified
        }
      }
    });

  } catch (error) {
    console.error('Delete address error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred'
    });
  }
};

// @desc    Set address as default
// @route   PUT /api/auth/addresses/:addressId/default
// @access  Private
exports.setDefaultAddress = async (req, res) => {
  try {
    const { addressId } = req.params;

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Find the address to set as default
    const addressToSetDefault = user.addresses.id(addressId);
    if (!addressToSetDefault) {
      return res.status(404).json({
        success: false,
        message: 'Address not found'
      });
    }

    // Unset all other defaults
    user.addresses.forEach(addr => {
      addr.isDefault = false;
    });

    // Set this address as default
    addressToSetDefault.isDefault = true;

    await user.save();

    res.json({
      success: true,
      message: 'Default address updated successfully',
      data: {
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          avatar: user.avatar,
          phone: user.phone,
          address: user.address,
          addresses: user.addresses,
          verified: user.verified,
          isPhoneVerified: user.isPhoneVerified
        }
      }
    });

  } catch (error) {
    console.error('Set default address error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred'
    });
  }
};

// @desc    Verify agent setup token
// @route   GET /api/auth/verify-setup-token/:token
// @access  Public
exports.verifySetupToken = async (req, res) => {
  try {
    const { token } = req.params;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Setup token is required'
      });
    }

    // Hash the token to match what's stored in database
    const hashedToken = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');

    // Find user by hashed token and check if token hasn't expired
    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpire: { $gt: Date.now() },
      role: 'agent',
      isActive: true,
      verified: false
    }).select('name email role');

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired setup token'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Setup token is valid',
      data: {
        user: {
          name: user.name,
          email: user.email,
          role: user.role
        }
      }
    });

  } catch (error) {
    console.error('Verify setup token error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred during token verification'
    });
  }
};

// @desc    Setup agent password
// @route   POST /api/auth/setup-password
// @access  Public
exports.setupAgentPassword = async (req, res) => {
  try {
    const { token, password } = req.body;

    console.log('Setup agent password attempt with token:', token);

    if (!token || !password) {
      return res.status(400).json({
        success: false,
        message: 'Token and password are required'
      });
    }

    // Validate password strength
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters long'
      });
    }

    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
      return res.status(400).json({
        success: false,
        message: 'Password must contain at least one uppercase letter, one lowercase letter, and one number'
      });
    }

    // Hash the token to match what's stored in database
    const hashedToken = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');

    console.log('Looking for agent with hashed token:', hashedToken);

    // Find user by hashed token and check if token hasn't expired
    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpire: { $gt: Date.now() },
      role: 'agent',
      isActive: true,
      verified: false
    }).select('+password');

    if (!user) {
      console.log('No agent found with valid setup token');
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired setup token'
      });
    }

    console.log('Found agent for password setup:', user.email);

    // Set new password and activate account
    user.password = password; // Will be hashed by pre-save middleware
    user.verified = true; // Account is now verified
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    
    await user.save();

    console.log('Password setup completed successfully for agent:', user.email);

    // Generate new JWT token for immediate login
    const authToken = user.getSignedJwtToken();

    res.status(200).json({
      success: true,
      message: 'Password setup successful. Welcome to CessPlug!',
      data: {
        token: authToken,
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          verified: user.verified,
          phone: user.phone,
          isPhoneVerified: user.isPhoneVerified
        }
      }
    });

  } catch (error) {
    console.error('Setup agent password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred during password setup'
    });
  }
};