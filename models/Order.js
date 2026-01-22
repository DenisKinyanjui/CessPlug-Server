const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  name: {
    type: String,
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: [1, 'Quantity must be at least 1']
  },
  price: {
    type: Number,
    required: true
  },
  image: {
    type: String,
    required: true
  }
});

const orderSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  orderItems: [orderItemSchema],
  shippingAddress: {
    address: { type: String, required: true },
    city: { type: String, required: true },
    postalCode: { type: String, required: true },
    country: { type: String, required: true }
  },
  // FIXED: Updated enum values to match frontend
  pickupStation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PickupStation',
    required: function() {
      // Required for pickup delivery method
      return this.deliveryMethod === 'pickup_station';
    }
  },
  deliveryMethod: {
    type: String,
    enum: ['home_delivery', 'pickup_station'], // FIXED: Updated to match frontend
    default: 'home_delivery'
  },
  paymentMethod: {
    type: String,
    required: true,
    enum: ['mpesa', 'card', 'cod', 'paypal', 'stripe', 'razorpay']
  },
  paymentResult: {
    id: String,
    status: String,
    update_time: String,
    email_address: String
  },
  itemsPrice: {
    type: Number,
    required: true,
    default: 0.0
  },
  taxPrice: {
    type: Number,
    required: true,
    default: 0.0
  },
  shippingPrice: {
    type: Number,
    required: true,
    default: 0.0
  },
  totalPrice: {
    type: Number,
    required: true,
    default: 0.0
  },
  isPaid: {
    type: Boolean,
    required: true,
    default: false
  },
  paidAt: {
    type: Date
  },
  isDelivered: {
    type: Boolean,
    required: true,
    default: false
  },
  deliveredAt: {
    type: Date
  },
  // NEW: When order arrived at pickup station
  arrivedAtStationAt: {
    type: Date
  },
  // Delivery proof fields
  deliveryProofUrl: {
    type: String,
    default: ''
  },
  deliveryProofPublicId: {
    type: String,
    default: ''
  },
  // UPDATED: Include new arrived_at_station status
  status: {
    type: String,
    required: true,
    enum: ['pending', 'processing', 'shipped', 'arrived_at_station', 'delivered', 'cancelled'],
    default: 'pending'
  },
  trackingNumber: {
    type: String,
    default: ''
  },
  // Agent handling the order (for pickup stations)
  assignedAgent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  // Order number for easy reference
  orderNumber: {
    type: String,
    unique: true
  },
  // Special instructions for pickup
  pickupInstructions: {
    type: String,
    default: ''
  },
  // NEW: Fields to distinguish customer vs agent orders
  createdBy: {
    type: String,
    enum: ['customer', 'agent'],
    required: true,
    default: 'customer'
  },
  agentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: function() {
      return this.createdBy === 'agent';
    }
  },
  // NEW: Customer info for agent-created orders
  customerInfo: {
    name: {
      type: String,
      required: function() {
        return this.createdBy === 'agent';
      }
    },
    phone: {
      type: String,
      required: function() {
        return this.createdBy === 'agent';
      }
    },
    email: {
      type: String,
      required: false
    }
  }
}, {
  timestamps: true
});

// Generate order number before saving
orderSchema.pre('save', function(next) {
  if (!this.orderNumber) {
    const prefix = this.createdBy === 'agent' ? 'AGT' : 'ORD';
    this.orderNumber = `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
  }
  next();
});

// Populate user and pickup station details
orderSchema.pre(/^find/, function(next) {
  this.populate({
    path: 'user',
    select: 'name email phone'
  }).populate({
    path: 'pickupStation',
    select: 'name address city state phone'
  }).populate({
    path: 'assignedAgent',
    select: 'name email phone'
  }).populate({
    path: 'agentId',
    select: 'name email phone'
  });
  next();
});

module.exports = mongoose.model('Order', orderSchema);