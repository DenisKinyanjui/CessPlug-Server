const { generateToken, initiateSTKPushRequest } = require('../services/mpesa');
const Order = require('../models/Order');

// Store pending payments in memory (in production, use Redis or database)
const pendingPayments = new Map();

// @desc    Initiate STK Push
// @route   POST /api/mpesa/stkpush
// @access  Private
exports.initiateSTKPush = async (req, res) => {
  try {
    const { phoneNumber, amount, orderId, accountReference } = req.body;

    // Validate required fields
    if (!phoneNumber || !amount || !orderId) {
      return res.status(400).json({
        success: false,
        message: 'Phone number, amount, and order ID are required'
      });
    }

    // Validate phone number format (should start with 254)
    const cleanPhoneNumber = phoneNumber.replace(/[^0-9]/g, '');
    let formattedPhone = cleanPhoneNumber;
    
    if (cleanPhoneNumber.startsWith('0')) {
      formattedPhone = '254' + cleanPhoneNumber.substring(1);
    } else if (cleanPhoneNumber.startsWith('+254')) {
      formattedPhone = cleanPhoneNumber.substring(1);
    } else if (!cleanPhoneNumber.startsWith('254')) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid Kenyan phone number'
      });
    }

    // Verify order exists and belongs to user
    const order = await Order.findById(orderId);
    if (!order || order.user._id.toString() !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Order not found or access denied'
      });
    }

    // Check if order is already paid
    if (order.isPaid) {
      return res.status(400).json({
        success: false,
        message: 'Order is already paid'
      });
    }

    // Generate access token
    const token = await generateToken();
    if (!token) {
      return res.status(500).json({
        success: false,
        message: 'Failed to authenticate with M-Pesa'
      });
    }

    // Initiate STK Push
    const stkResponse = await initiateSTKPushRequest({
      token,
      phoneNumber: formattedPhone,
      amount: Math.ceil(amount), // M-Pesa requires whole numbers
      orderId,
      accountReference: accountReference || `Order-${orderId}`
    });

    if (stkResponse.success) {
      // Store pending payment details
      pendingPayments.set(stkResponse.data.CheckoutRequestID, {
        orderId,
        userId: req.user.id,
        amount,
        phoneNumber: formattedPhone,
        timestamp: new Date(),
        status: 'pending'
      });

      // Set timeout to clean up pending payment after 5 minutes
      setTimeout(() => {
        if (pendingPayments.has(stkResponse.data.CheckoutRequestID)) {
          const payment = pendingPayments.get(stkResponse.data.CheckoutRequestID);
          if (payment.status === 'pending') {
            // Update status to failed if still pending after timeout
            pendingPayments.set(stkResponse.data.CheckoutRequestID, {
              ...payment,
              status: 'failed',
              failureReason: 'Payment timeout - no response received'
            });
          }
        }
      }, 5 * 60 * 1000); // 5 minutes

      res.json({
        success: true,
        message: 'STK Push initiated successfully',
        data: {
          checkoutRequestId: stkResponse.data.CheckoutRequestID,
          merchantRequestId: stkResponse.data.MerchantRequestID,
          customerMessage: stkResponse.data.CustomerMessage
        }
      });
    } else {
      res.status(400).json({
        success: false,
        message: stkResponse.message || 'Failed to initiate payment'
      });
    }
  } catch (error) {
    console.error('STK Push error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// @desc    Handle M-Pesa callback
// @route   POST /api/mpesa/callback
// @access  Public (M-Pesa service)
exports.handleMpesaCallback = async (req, res) => {
  try {
    console.log('M-Pesa Callback received:', JSON.stringify(req.body, null, 2));

    const { Body } = req.body;
    const { stkCallback } = Body;

    const {
      MerchantRequestID,
      CheckoutRequestID,
      ResultCode,
      ResultDesc,
      CallbackMetadata
    } = stkCallback;

    // Find pending payment
    const pendingPayment = pendingPayments.get(CheckoutRequestID);
    
    if (!pendingPayment) {
      console.log('No pending payment found for CheckoutRequestID:', CheckoutRequestID);
      return res.status(200).json({ ResultCode: 0, ResultDesc: 'Success' });
    }

    if (ResultCode === 0) {
      // Payment successful
      console.log('Payment successful for CheckoutRequestID:', CheckoutRequestID);

      // Extract payment details
      let mpesaReceiptNumber = '';
      let transactionDate = '';
      let phoneNumber = '';
      let amount = 0;

      if (CallbackMetadata && CallbackMetadata.Item) {
        CallbackMetadata.Item.forEach(item => {
          switch (item.Name) {
            case 'MpesaReceiptNumber':
              mpesaReceiptNumber = item.Value;
              break;
            case 'TransactionDate':
              transactionDate = item.Value;
              break;
            case 'PhoneNumber':
              phoneNumber = item.Value;
              break;
            case 'Amount':
              amount = item.Value;
              break;
          }
        });
      }

      // Update pending payment status
      pendingPayments.set(CheckoutRequestID, {
        ...pendingPayment,
        status: 'completed',
        mpesaReceiptNumber,
        transactionDate,
        completedAt: new Date()
      });

      // Update order status in database
      const order = await Order.findById(pendingPayment.orderId);
      if (order) {
        order.isPaid = true;
        order.paidAt = new Date();
        order.status = 'processing';
        order.paymentResult = {
          id: mpesaReceiptNumber,
          status: 'completed',
          update_time: transactionDate || new Date().toISOString(),
          email_address: ''
        };
        await order.save();
        console.log(`Order ${pendingPayment.orderId} updated to paid`);
      }

    } else {
      // Payment failed
      console.log('Payment failed for CheckoutRequestID:', CheckoutRequestID, 'Reason:', ResultDesc);
      
      // Update pending payment status
      pendingPayments.set(CheckoutRequestID, {
        ...pendingPayment,
        status: 'failed',
        failureReason: ResultDesc,
        failedAt: new Date()
      });
    }

    res.status(200).json({ ResultCode: 0, ResultDesc: 'Success' });

  } catch (error) {
    console.error('M-Pesa callback error:', error);
    res.status(200).json({
      ResultCode: 1,
      ResultDesc: 'Failed to process callback'
    });
  }
};

// @desc    Check payment status
// @route   GET /api/mpesa/payment-status/:checkoutRequestId
// @access  Private
exports.checkPaymentStatus = async (req, res) => {
  try {
    const { checkoutRequestId } = req.params;
    
    const pendingPayment = pendingPayments.get(checkoutRequestId);
    
    if (!pendingPayment) {
      return res.status(404).json({
        success: false,
        message: 'Payment request not found or expired'
      });
    }

    // Verify the payment belongs to the requesting user
    if (pendingPayment.userId !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.json({
      success: true,
      data: {
        status: pendingPayment.status,
        orderId: pendingPayment.orderId,
        amount: pendingPayment.amount,
        phoneNumber: pendingPayment.phoneNumber,
        mpesaReceiptNumber: pendingPayment.mpesaReceiptNumber || null,
        transactionDate: pendingPayment.transactionDate || null,
        failureReason: pendingPayment.failureReason || null,
        timestamp: pendingPayment.timestamp,
        completedAt: pendingPayment.completedAt || null,
        failedAt: pendingPayment.failedAt || null
      }
    });

  } catch (error) {
    console.error('Check payment status error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// @desc    Get all pending payments (for debugging - admin only)
// @route   GET /api/mpesa/pending-payments
// @access  Private/Admin
exports.getPendingPayments = async (req, res) => {
  try {
    const payments = Array.from(pendingPayments.entries()).map(([checkoutRequestId, payment]) => ({
      checkoutRequestId,
      ...payment
    }));

    res.json({
      success: true,
      data: { payments },
      count: payments.length
    });
  } catch (error) {
    console.error('Get pending payments error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};