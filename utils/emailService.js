const axios = require('axios');
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL || 'http://127.0.0.1:3001';
const AGENT_BASE_URL = process.env.AGENT_BASE_URL || 'http://127.0.0.1:3002'; 

/**
 * Send password reset email using Resend
 * @param {string} email - Recipient email address
 * @param {string} token - Password reset token
 * @param {string} name - User's name (optional)
 * @param {string} userRole - User's role (optional) - determines which frontend to use
 * @returns {Promise<Object>} - Response from Resend API
 */
const sendPasswordResetEmail = async (email, token, name = 'User', userRole = 'customer') => {
  try {
    // Determine which frontend URL to use based on user role
    const baseUrl = userRole === 'agent' ? AGENT_BASE_URL : FRONTEND_BASE_URL;
    const resetUrl = `${baseUrl}/auth/reset-password?token=${token}`;
    
    // Customize email content based on user role
    const isAgent = userRole === 'agent';
    const emailTitle = isAgent ? 'Agent Password Reset Request' : 'Password Reset Request';
    const platformName = isAgent ? 'CessPlug' : 'CessPlug';
    const greeting = isAgent ? `Hello Agent ${name}` : `Hello ${name}`;
    const description = isAgent 
      ? 'We received a request to reset your password for your agent dashboard account.'
      : 'We received a request to reset your password for your CessPlug account.';
    
    const response = await axios.post('https://api.resend.com/emails', {
      from: 'CessPlug <support@cessplug.com>',
      to: email,
      subject: emailTitle,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2196f3;">${emailTitle}</h2>
          <p>${greeting},</p>
          <p>${description}</p>
          <p>Please click the button below to reset your password:</p>
          <div style="margin: 30px 0;">
            <a href="${resetUrl}" style="background-color: #ea580c; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">
              Reset Password
            </a>
          </div>
          <p>This link will expire in 10 minutes. If you didn't request this, please ignore this email.</p>
          ${isAgent ? '<p><strong>Note:</strong> This link will take you to the agent dashboard.</p>' : ''}
          <p>Thanks,<br>The ${platformName} Team</p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
          <p style="font-size: 12px; color: #6b7280;">
            If you're having trouble with the button above, copy and paste this URL into your browser:
            <br>${resetUrl}
          </p>
        </div>
      `,
    }, {
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    console.log(`Password reset email sent to ${email} (${userRole}) using ${baseUrl}`);
    return { success: true, data: response.data };
  } catch (error) {
    console.error('Resend email error:', error.response?.data || error.message);
    return { 
      success: false, 
      message: error.response?.data?.message || 'Failed to send email',
      error: error.response?.data || error.message
    };
  }
};

/**
 * Send agent account setup email using Resend
 * @param {string} email - Agent email address
 * @param {string} token - Password setup token
 * @param {string} name - Agent's name
 * @param {string} pickupStation - Pickup station name
 * @returns {Promise<Object>} - Response from Resend API
 */
const sendAgentSetupEmail = async (email, token, name, pickupStation) => {
  try {
    // Ensure the setup URL is properly formatted and points to the agent dashboard
    const setupUrl = `${AGENT_BASE_URL}/agent/setup-password?token=${token}`;
    
    console.log('Sending setup email to:', email);
    console.log('Setup URL:', setupUrl);
    console.log('Token:', token);
    
    const response = await axios.post('https://api.resend.com/emails', {
      from: 'CessPlug <support@cessplug.com>',
      to: email,
      subject: 'Welcome to CessPlug - Complete Your Agent Account Setup',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #1f2937; font-size: 28px; margin-bottom: 10px;">Welcome to CessPlug!</h1>
            <p style="color: #6b7280; font-size: 16px;">Delivery Agent Platform</p>
          </div>
          
          <div style="background-color: #f9fafb; border-radius: 8px; padding: 25px; margin-bottom: 25px;">
            <h2 style="color: #059669; margin-top: 0;">Agent Account Created</h2>
            <p>Hello <strong>${name}</strong>,</p>
            <p>Your delivery agent account has been successfully created! You have been assigned to:</p>
            <div style="background-color: #ecfdf5; border: 1px solid #d1fae5; border-radius: 6px; padding: 15px; margin: 15px 0;">
              <p style="margin: 0; color: #065f46;"><strong>Pickup Station:</strong> ${pickupStation}</p>
            </div>
            <p>To complete your account setup and start working, please create your password by clicking the button below:</p>
          </div>
          
          <div style="text-align: center; margin: 40px 0;">
            <a href="${setupUrl}" style="background-color: #059669; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; display: inline-block;">
              Create Your Password
            </a>
          </div>
          
          <div style="background-color: #fef3c7; border: 1px solid #fbbf24; border-radius: 6px; padding: 15px; margin: 25px 0;">
            <p style="margin: 0; color: #92400e;"><strong>Important:</strong> This link will expire in 24 hours. Please complete your setup as soon as possible.</p>
          </div>
          
          <div style="margin-top: 30px;">
            <h3 style="color: #374151;">Next Steps:</h3>
            <ol style="color: #6b7280; line-height: 1.6;">
              <li>Click the "Create Your Password" button above</li>
              <li>Set up a secure password for your account</li>
              <li>Contact your supervisor for additional training materials</li>
            </ol>
          </div>
          
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
            <p style="color: #6b7280; margin: 0;">Thanks,<br><strong>The CessPlug</strong></p>
          </div>
          
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
          <div style="font-size: 12px; color: #9ca3af;">
            <p>If you're having trouble with the button above, copy and paste this URL into your browser:</p>
            <p style="word-break: break-all; background-color: #f3f4f6; padding: 10px; border-radius: 4px; font-family: monospace;">${setupUrl}</p>
            <p>If you didn't expect this email or believe it was sent in error, please contact our support team.</p>
            
          </div>
        </div>
      `,
    }, {
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('Setup email sent successfully:', response.data);
    return { success: true, data: response.data };
  } catch (error) {
    console.error('Resend agent setup email error:', error.response?.data || error.message);
    return { 
      success: false, 
      message: error.response?.data?.message || 'Failed to send setup email',
      error: error.response?.data || error.message
    };
  }
};

module.exports = {
  sendPasswordResetEmail,
  sendAgentSetupEmail
};