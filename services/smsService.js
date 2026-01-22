//backend src/services/smsService.js
const axios = require('axios');

class SMSService {
  constructor() {
    this.termiiApiKey = process.env.TERMII_API_KEY;
    this.termiiBaseUrl = 'https://api.ng.termii.com/api';
    this.senderId = process.env.TERMII_SENDER_ID || 'Termii'; // Default sender ID
    this.channel = 'generic'; // or 'whatsapp', 'generic'
  }

  // Generate 6-digit OTP
  generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  // Format phone number for international format
  formatPhoneNumber(phone) {
    // Remove any spaces, dashes, or parentheses
    let cleaned = phone.replace(/[\s\-\(\)]/g, '');
    
    // If it starts with 0, replace with country code (assuming Kenya +254)
    if (cleaned.startsWith('0')) {
      cleaned = '254' + cleaned.substring(1);
    }
    
    // If it starts with +, remove the +
    if (cleaned.startsWith('+')) {
      cleaned = cleaned.substring(1);
    }
    
    // If it doesn't start with country code, add Kenya code
    if (!cleaned.startsWith('254')) {
      cleaned = '254' + cleaned;
    }
    
    return cleaned;
  }

  // Send OTP via Termii SMS API
  async sendOTP(phone, otp, userName = 'User') {
    try {
      const formattedPhone = this.formatPhoneNumber(phone);
      console.log(`Attempting to send OTP to: ${formattedPhone}`);
      
      const message = `Hello ${userName}, your CessPlug verification code is: ${otp}. Valid for 10 minutes.`;

      const payload = {
        api_key: this.termiiApiKey,
        to: formattedPhone,
        from: this.senderId,
        sms: message,
        type: 'plain',
        channel: this.channel
      };

      console.log('Termii SMS payload:', { ...payload, api_key: '[HIDDEN]', sms: 'OTP message' });

      const response = await axios.post(`${this.termiiBaseUrl}/sms/send`, payload, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 30000 // 30 seconds timeout
      });

      console.log('Termii SMS API Response:', response.data);
      
      if (response.data && response.data.message_id) {
        return {
          success: true,
          messageId: response.data.message_id,
          balance: response.data.balance
        };
      } else {
        throw new Error('Invalid response from Termii API');
      }
    } catch (error) {
      console.error('Termii SMS sending error:', {
        error: error.message,
        response: error.response?.data,
        status: error.response?.status,
        phone: phone
      });
      
      // Handle specific Termii error cases
      if (error.response?.data) {
        const errorData = error.response.data;
        
        if (errorData.message) {
          throw new Error(`SMS delivery failed: ${errorData.message}`);
        }
        
        if (error.response.status === 400) {
          throw new Error('Invalid phone number or SMS parameters');
        } else if (error.response.status === 401) {
          throw new Error('Invalid API key or unauthorized access');
        } else if (error.response.status === 402) {
          throw new Error('Insufficient SMS credits. Please top up your account.');
        }
      }
      
      throw new Error(`Failed to send verification code: ${error.message}`);
    }
  }

  // Send OTP using Termii's dedicated OTP endpoint
  async sendOTPViaTermiiOTP(phone, userName = 'User') {
    try {
      const formattedPhone = this.formatPhoneNumber(phone);
      console.log(`Sending OTP via Termii OTP endpoint to: ${formattedPhone}`);

      const payload = {
        api_key: this.termiiApiKey,
        message_type: 'NUMERIC',
        to: formattedPhone,
        from: 'SecureOTP',
        channel: 'generic',
        pin_attempts: 3,
        pin_time_to_live: 10, // 10 minutes
        pin_length: 6,
        pin_placeholder: '< 1234 >',
        message_text: `Hello ${userName}, your CessPlug verification code is < 1234 >. Valid for 10 minutes.`,
        pin_type: 'NUMERIC'
      };

      console.log('Termii OTP payload:', { ...payload, api_key: '[HIDDEN]' });

      const response = await axios.post(`${this.termiiBaseUrl}/sms/otp/send`, payload, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });

      console.log('Termii OTP API Response:', response.data);

      if (response.data && response.data.pinId) {
        return {
          success: true,
          pinId: response.data.pinId,
          balance: response.data.balance,
          smsStatus: response.data.smsStatus
        };
      } else {
        throw new Error('Invalid response from Termii OTP API');
      }
    } catch (error) {
      console.error('Termii OTP sending error:', {
        error: error.message,
        response: error.response?.data,
        status: error.response?.status,
        phone: phone
      });

      if (error.response?.data?.message) {
        throw new Error(`OTP sending failed: ${error.response.data.message}`);
      }

      throw new Error(`Failed to send OTP: ${error.message}`);
    }
  }

  // Verify OTP using Termii's verification endpoint
  async verifyOTPViaTermii(pinId, pin) {
    try {
      console.log(`Verifying OTP with pinId: ${pinId}`);

      const payload = {
        api_key: this.termiiApiKey,
        pin_id: pinId,
        pin: pin
      };

      const response = await axios.post(`${this.termiiBaseUrl}/sms/otp/verify`, payload, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 15000
      });

      console.log('Termii OTP Verification Response:', response.data);

      return {
        success: response.data.verified === true || response.data.verified === 'True',
        verified: response.data.verified,
        msisdn: response.data.msisdn
      };
    } catch (error) {
      console.error('Termii OTP verification error:', {
        error: error.message,
        response: error.response?.data,
        status: error.response?.status
      });

      if (error.response?.data?.message) {
        throw new Error(`OTP verification failed: ${error.response.data.message}`);
      }

      throw new Error(`Failed to verify OTP: ${error.message}`);
    }
  }

  // Check account balance
  async checkBalance() {
    try {
      const response = await axios.get(`${this.termiiBaseUrl}/get-balance?api_key=${this.termiiApiKey}`, {
        timeout: 15000
      });

      return response.data;
    } catch (error) {
      console.error('Balance check error:', error.message);
      throw new Error(`Failed to check balance: ${error.message}`);
    }
  }

  // Validate phone number format
  validatePhoneNumber(phone) {
    // Enhanced validation for various international formats
    const cleaned = phone.replace(/[\s\-\(\)]/g, '');
    
    // Check for various international number formats
    const patterns = [
      /^(\+254|254)(7\d{8}|1\d{8})$/, // Kenya
      /^(\+234|234)(7\d{9}|8\d{9}|9\d{9})$/, // Nigeria
      /^(\+233|233)(2\d{8}|5\d{8})$/, // Ghana
      /^(0)(7\d{8}|1\d{8})$/, // Local format with 0
      /^\+\d{10,15}$/ // General international format
    ];
    
    return patterns.some(pattern => pattern.test(cleaned));
  }

  // Test connection to Termii API
  async testConnection() {
    try {
      const balance = await this.checkBalance();
      console.log('Termii connection test successful:', balance);
      return balance;
    } catch (error) {
      console.error('Termii connection test failed:', error);
      throw error;
    }
  }

  // For development: simulate SMS sending
  async sendOTPDevelopment(phone, otp, userName = 'User') {
    console.log(`[DEV MODE] Would send OTP ${otp} to ${phone} for ${userName}`);
    
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    return {
      success: true,
      messageId: 'dev-' + Date.now(),
      balance: '1000.00'
    };
  }
}

module.exports = new SMSService();