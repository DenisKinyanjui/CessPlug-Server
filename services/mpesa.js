const axios = require('axios');

// M-Pesa configuration
const MPESA_CONFIG = {
  consumerKey: process.env.MPESA_CONSUMER_KEY,
  consumerSecret: process.env.MPESA_CONSUMER_SECRET,
  businessShortCode: process.env.MPESA_BUSINESS_SHORTCODE,
  passkey: process.env.MPESA_PASSKEY,
  environment: process.env.MPESA_ENVIRONMENT || 'sandbox', // 'sandbox' or 'production'
  callbackUrl: process.env.MPESA_CALLBACK_URL || 'https://02c5379f2610.ngrok-free.app/api/mpesa/callback'
};

// M-Pesa API URLs
const MPESA_URLS = {
  sandbox: {
    oauth: 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
    stkpush: 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest'
  },
  production: {
    oauth: 'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
    stkpush: 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest'
  }
};

// Generate timestamp in the format YYYYMMDDHHmmss
const generateTimestamp = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  const second = String(now.getSeconds()).padStart(2, '0');
  
  return `${year}${month}${day}${hour}${minute}${second}`;
};

// Generate password for STK Push
const generatePassword = (timestamp) => {
  const data = MPESA_CONFIG.businessShortCode + MPESA_CONFIG.passkey + timestamp;
  return Buffer.from(data).toString('base64');
};

// Generate access token
exports.generateToken = async () => {
  try {
    const auth = Buffer.from(
      `${MPESA_CONFIG.consumerKey}:${MPESA_CONFIG.consumerSecret}`
    ).toString('base64');

    const response = await axios.get(
      MPESA_URLS[MPESA_CONFIG.environment].oauth,
      {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    if (response.data && response.data.access_token) {
      return response.data.access_token;
    }

    console.error('Failed to generate token:', response.data);
    return null;
  } catch (error) {
    console.error('Token generation error:', error.response?.data || error.message);
    return null;
  }
};

// Initiate STK Push request
exports.initiateSTKPushRequest = async ({
  token,
  phoneNumber,
  amount,
  orderId,
  accountReference
}) => {
  try {
    const timestamp = generateTimestamp();
    const password = generatePassword(timestamp);

    const requestBody = {
      BusinessShortCode: MPESA_CONFIG.businessShortCode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.ceil(amount), // Ensure whole number
      PartyA: phoneNumber,
      PartyB: MPESA_CONFIG.businessShortCode,
      PhoneNumber: phoneNumber,
      CallBackURL: MPESA_CONFIG.callbackUrl,
      AccountReference: accountReference,
      TransactionDesc: `Payment for order ${orderId}`
    };

    console.log('STK Push request:', JSON.stringify(requestBody, null, 2));

    const response = await axios.post(
      MPESA_URLS[MPESA_CONFIG.environment].stkpush,
      requestBody,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    console.log('STK Push response:', JSON.stringify(response.data, null, 2));

    if (response.data && response.data.ResponseCode === '0') {
      return {
        success: true,
        data: response.data
      };
    } else {
      return {
        success: false,
        message: response.data?.CustomerMessage || response.data?.errorMessage || 'STK Push failed'
      };
    }
  } catch (error) {
    console.error('STK Push error:', error.response?.data || error.message);
    return {
      success: false,
      message: error.response?.data?.errorMessage || 'Failed to initiate payment'
    };
  }
};

// Validate M-Pesa configuration
exports.validateConfig = () => {
  const requiredFields = [
    'MPESA_CONSUMER_KEY',
    'MPESA_CONSUMER_SECRET', 
    'MPESA_BUSINESS_SHORTCODE',
    'MPESA_PASSKEY',
    'MPESA_CALLBACK_URL'
  ];

  const missing = requiredFields.filter(field => !process.env[field]);
  
  if (missing.length > 0) {
    console.error('Missing M-Pesa environment variables:', missing);
    return false;
  }

  return true;
};