const express = require('express');
const {
  initiateSTKPush,
  handleMpesaCallback,
  checkPaymentStatus
} = require('../controllers/mpesaController');
const { protect } = require('../middleware/auth');

const router = express.Router();

// Public M-Pesa callback route (Safaricom must access without auth)
router.post('/callback', handleMpesaCallback);

// Protected routes
router.use(protect);

// Initiate STK Push
router.post('/stkpush', initiateSTKPush);

// Check payment status
router.get('/payment-status/:checkoutRequestId', checkPaymentStatus);

module.exports = router;