const Order = require('../models/Order');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const User = require('../models/User');
const PickupStation = require('../models/PickupStation');
const NodeCache = require('node-cache');
const chamaService = require('../services/chamaService');
const { 
  createDeliveryCommission, 
  createAgentOrderCommission, 
  cancelCommissionsForOrder 
} = require('./commissionController');

const frequentlyBoughtCache = new NodeCache({ stdTTL: 1800 });

// @desc    Create new order with pickup station assignment
// @route   POST /api/orders
// @access  Private
exports.createOrder = async (req, res) => {
  try {
    const {
      orderItems,
      shippingAddress,
      paymentMethod,
      itemsPrice,
      taxPrice,
      shippingPrice,
      totalPrice,
      deliveryMethod = 'home_delivery',
      pickupStation,
      pickupInstructions,
      // NEW: Agent order fields
      customerInfo,
      isAgentOrder = false,
      // NEW: Chama redemption fields
      chamaGroupId,
      useChamaCredit = false
    } = req.body;

    console.log('Create order request body:', {
      orderItems: orderItems ? orderItems.length : 'undefined',
      customerInfo,
      isAgentOrder,
      useChamaCredit,
      chamaGroupId,
      userRole: req.user.role
    });

    if (!orderItems || orderItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No order items provided'
      });
    }

    // EXISTING validation logic...
    if (deliveryMethod === 'pickup_station') {
      if (!pickupStation) {
        console.log('Pickup station missing for pickup delivery');
        return res.status(400).json({
          success: false,
          message: 'Pickup station is required for pickup delivery'
        });
      }

      // Verify pickup station exists and is active
      const station = await PickupStation.findOne({
        _id: pickupStation,
        isActive: true
      });
      
      if (!station) {
        console.log('Invalid or inactive pickup station:', pickupStation);
        return res.status(400).json({
          success: false,
          message: 'Selected pickup station is not available'
        });
      }
      
      console.log('Validated pickup station:', station.name);
    }

    // Transform cart items to order items format
    const transformedOrderItems = orderItems.map(item => ({
      product: item.productId || item.product,
      name: item.productName || item.name,
      quantity: item.quantity,
      price: item.price,
      image: item.image
    }));

    // Validate stock availability for all items
    for (const item of transformedOrderItems) {
      const product = await Product.findById(item.product);
      if (!product || product.stock < item.quantity) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for product: ${item.name}`
        });
      }
    }

    // Determine if this is an agent order
    const createdBy = (req.user.role === 'agent' && isAgentOrder) ? 'agent' : 'customer';
    
    // For agent orders, validate customer info
    if (createdBy === 'agent') {
      if (!customerInfo || !customerInfo.name || !customerInfo.phone) {
        return res.status(400).json({
          success: false,
          message: 'Customer name and phone are required for agent orders'
        });
      }
    }

    // NEW: Validate chama redemption if requested
    let chamaContext = null;
    if (useChamaCredit && chamaGroupId) {
      const eligibility = await chamaService.checkChamaEligibility(req.user._id, chamaGroupId);
      
      if (!eligibility.eligible) {
        return res.status(403).json({
          success: false,
          message: eligibility.reason,
          eligibilityDetails: eligibility
        });
      }

      chamaContext = {
        chamaGroupId,
        eligible: true,
        group: eligibility.group,
        userPosition: eligibility.userPosition,
        maxRedemptionAmount: eligibility.maxRedemptionAmount
      };

      console.log('Chama redemption validated for user:', req.user._id, 'Amount:', chamaContext.maxRedemptionAmount);
    }

    // Find and assign agent if pickup station is specified
    let assignedAgent = null;
    if (pickupStation) {
      const agent = await User.findOne({ 
        role: 'agent', 
        pickupStation: pickupStation,
        isActive: true 
      });
      if (agent) {
        assignedAgent = agent._id;
      }
    }

    // Prepare order data
    const orderData = {
      user: req.user.id,
      orderItems: transformedOrderItems,
      shippingAddress,
      paymentMethod,
      itemsPrice,
      taxPrice,
      shippingPrice,
      totalPrice,
      deliveryMethod,
      pickupInstructions: pickupInstructions || '',
      createdBy,
      agentId: createdBy === 'agent' ? req.user.id : undefined,
      customerInfo: createdBy === 'agent' ? customerInfo : undefined
    };

    // Add pickup-specific fields if applicable
    if (deliveryMethod === 'pickup_station' && pickupStation) {
      orderData.pickupStation = pickupStation;
      if (assignedAgent) {
        orderData.assignedAgent = assignedAgent;
      }
    }

    console.log('Creating order with data:', {
      ...orderData,
      orderItems: `${orderData.orderItems.length} items`,
      createdBy: orderData.createdBy
    });

    const order = await Order.create(orderData);

    // Update product stock
    for (const item of transformedOrderItems) {
      const product = await Product.findById(item.product);
      product.stock -= item.quantity;
      await product.save();
    }

    // NEW: Create agent order commission if this is an agent-created order
    if (createdBy === 'agent') {
      try {
        await createAgentOrderCommission(order._id);
        console.log('Agent order commission created for order:', order._id);
      } catch (commissionError) {
        console.error('Failed to create agent order commission:', commissionError);
        // Don't fail the order creation if commission creation fails
      }
    }

    // NEW: Record chama redemption if applicable
    if (chamaContext && useChamaCredit) {
      try {
        // Determine amount redeemed vs amount paid outside chama
        let amountRedeemed = Math.min(totalPrice, chamaContext.maxRedemptionAmount);
        let amountOutsideChama = totalPrice - amountRedeemed;

        await chamaService.createChamaRedemption({
          userId: req.user._id,
          chamaGroupId: chamaContext.chamaGroupId,
          orderId: order._id,
          weekNumber: chamaContext.group.currentWeek,
          amountRedeemed,
          amountOutsideChama,
          notes: `Order redemption via chama group ${chamaContext.group.name}`
        });

        console.log('Chama redemption recorded for order:', order._id, {
          amountRedeemed,
          amountOutsideChama
        });
      } catch (chamaError) {
        console.error('Failed to record chama redemption:', chamaError);
        // Don't fail the order creation if chama recording fails
      }
    }

    // Clear user cart only if it's a customer order
    if (createdBy === 'customer') {
      await Cart.findOneAndUpdate(
        { user: req.user.id },
        { items: [] }
      );
    }

    // Populate the order before sending response
    const populatedOrder = await Order.findById(order._id)
      .populate('user', 'name email phone')
      .populate('pickupStation', 'name address city state phone')
      .populate('assignedAgent', 'name email phone')
      .populate('agentId', 'name email phone');

    res.status(201).json({
      success: true,
      message: `Order created successfully ${createdBy === 'agent' ? 'on behalf of customer' : ''}`,
      data: { order: populatedOrder }
    });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get user orders
// @route   GET /api/orders/my
// @access  Private
exports.getMyOrders = async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user.id }).sort({ createdAt: -1 });

    res.json({
      success: true,
      data: { orders }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

exports.getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Allow access if user is admin OR if order belongs to user OR if user is agent assigned to this order's station
    const hasAccess = 
      req.user.role === 'admin' || 
      order.user._id.toString() === req.user.id ||
      (req.user.role === 'agent' && req.user.pickupStation && 
       order.pickupStation && order.pickupStation.toString() === req.user.pickupStation.toString());

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this order'
      });
    }

    res.json({
      success: true,
      data: { order }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Update order to paid
// @route   PUT /api/orders/:id/pay
// @access  Private
exports.updateOrderToPaid = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    if (order.user.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this order'
      });
    }

    order.isPaid = true;
    order.paidAt = Date.now();
    order.status = 'processing';
    order.paymentResult = {
      id: req.body.id,
      status: req.body.status,
      update_time: req.body.update_time,
      email_address: req.body.email_address
    };

    const updatedOrder = await order.save();

    res.json({
      success: true,
      message: 'Order updated to paid',
      data: { order: updatedOrder }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Update order status (with agent permissions for their station orders)
// @route   PUT /api/orders/:id/status
// @access  Private/Admin/Agent
exports.updateOrderStatus = async (req, res) => {
  try {
    const { status, deliveryProofUrl, deliveryProofPublicId } = req.body;
    const order = await Order.findById(req.params.id)
      .populate('pickupStation')
      .populate('assignedAgent');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // EXISTING permission checks...
    if (req.user.role === 'agent') {
      if (!req.user.pickupStation || 
          order.pickupStation._id.toString() !== req.user.pickupStation.toString()) {
        return res.status(403).json({
          success: false,
          message: 'You can only update orders for your assigned pickup station'
        });
      }
      
      const allowedAgentStatuses = ['arrived_at_station', 'delivered'];
      if (!allowedAgentStatuses.includes(status)) {
        return res.status(403).json({
          success: false,
          message: 'Agents can only mark orders as arrived at station or delivered'
        });
      }
    }

    // Validate status
    const validStatuses = ['pending', 'processing', 'shipped', 'arrived_at_station', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status'
      });
    }

    // Update order status
    order.status = status;

    // Update related fields based on status
    switch (status) {
      case 'processing':
        if (!order.isPaid) {
          order.isPaid = true;
          order.paidAt = new Date();
        }
        break;
        
      case 'arrived_at_station':
        order.arrivedAtStationAt = new Date();
        break;
        
      case 'delivered':
        order.isDelivered = true;
        order.deliveredAt = new Date();
        if (!order.isPaid) {
          order.isPaid = true;
          order.paidAt = new Date();
        }
        
        // Save delivery proof if provided
        if (deliveryProofUrl) {
          order.deliveryProofUrl = deliveryProofUrl;
        }
        if (deliveryProofPublicId) {
          order.deliveryProofPublicId = deliveryProofPublicId;
        }

        // NEW: Create delivery commission when order is delivered
        if (order.assignedAgent || (req.user.role === 'agent' && order.pickupStation)) {
          try {
            const agentId = order.assignedAgent?._id || req.user.id;
            await createDeliveryCommission(order._id);
            console.log('Delivery commission created for order:', order._id);
          } catch (commissionError) {
            console.error('Failed to create delivery commission:', commissionError);
            // Don't fail the status update if commission creation fails
          }
        }
        break;
        
      case 'cancelled':
        // Restore product stock if order is cancelled
        for (const item of order.orderItems) {
          const product = await Product.findById(item.product);
          if (product) {
            product.stock += item.quantity;
            await product.save();
          }
        }

        // NEW: Cancel any existing commissions for this order
        try {
          await cancelCommissionsForOrder(order._id);
          console.log('Cancelled commissions for order:', order._id);
        } catch (commissionError) {
          console.error('Failed to cancel commissions:', commissionError);
          // Don't fail the status update if commission cancellation fails
        }
        break;
    }

    const updatedOrder = await order.save();

    // Create appropriate success message
    let successMessage = `Order status updated to ${status}`;
    if (status === 'arrived_at_station') {
      successMessage = 'Order marked as arrived at pickup station';
    } else if (status === 'delivered' && deliveryProofUrl) {
      successMessage = 'Order marked as delivered with delivery proof';
    }

    res.json({
      success: true,
      message: successMessage,
      data: { order: updatedOrder }
    });
  } catch (error) {
    console.error('Error updating order status:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};


// @desc    Get all orders
// @route   GET /api/orders
// @access  Private/Admin
exports.getOrders = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const orders = await Order.find({})
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Order.countDocuments();

    res.json({
      success: true,
      data: {
        orders,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
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

// @desc    Update order to delivered
// @route   PUT /api/orders/:id/deliver
// @access  Private/Admin
exports.updateOrderToDelivered = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    order.isDelivered = true;
    order.deliveredAt = Date.now();
    order.status = 'delivered';

    const updatedOrder = await order.save();

    res.json({
      success: true,
      message: 'Order updated to delivered',
      data: { order: updatedOrder }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get frequently bought products
// @route   GET /api/orders/frequently-bought
// @access  Public
exports.getFrequentlyBought = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 8;
    const cacheKey = `frequently-bought-${limit}`;
    
    // Check cache first
    const cachedData = frequentlyBoughtCache.get(cacheKey);
    if (cachedData) {
      return res.json({
        success: true,
        data: { products: cachedData },
        cached: true
      });
    }

    // Aggregate pipeline to find most frequently bought products
    const frequentlyBought = await Order.aggregate([
      // Match only paid orders
      {
        $match: {
          isPaid: true
        }
      },
      // Unwind order items to process each product separately
      {
        $unwind: '$orderItems'
      },
      // Group by product and sum quantities
      {
        $group: {
          _id: '$orderItems.product',
          totalPurchases: { $sum: '$orderItems.quantity' },
          totalOrders: { $sum: 1 },
          productName: { $first: '$orderItems.name' },
          productImage: { $first: '$orderItems.image' },
          productPrice: { $first: '$orderItems.price' }
        }
      },
      // Sort by total purchases in descending order
      {
        $sort: { totalPurchases: -1 }
      },
      // Limit to requested number of products
      {
        $limit: limit
      },
      // Lookup product details from Product collection
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: '_id',
          as: 'productDetails'
        }
      },
      // Unwind product details
      {
        $unwind: {
          path: '$productDetails',
          preserveNullAndEmptyArrays: true
        }
      },
      // Project final structure
      {
        $project: {
          _id: 1,
          name: {
            $ifNull: ['$productDetails.name', '$productName']
          },
          slug: '$productDetails.slug',
          image: {
            $ifNull: [
              { $arrayElemAt: ['$productDetails.images', 0] },
              '$productImage'
            ]
          },
          price: {
            $ifNull: ['$productDetails.finalPrice', '$productPrice']
          },
          originalPrice: '$productDetails.price',
          discount: '$productDetails.discount',
          brand: '$productDetails.brand',
          category: '$productDetails.category',
          rating: '$productDetails.rating',
          reviews: '$productDetails.numReviews',
          inStock: {
            $gt: ['$productDetails.stock', 0]
          },
          isNew: '$productDetails.isNewArrival',
          totalPurchases: 1,
          totalOrders: 1,
          // Include stock info for ProductCard
          stock: '$productDetails.stock'
        }
      }
    ]);

    // Populate brand and category details
    await Order.populate(frequentlyBought, [
      {
        path: 'brand',
        select: 'name slug logo'
      },
      {
        path: 'category',
        select: 'name slug'
      }
    ]);

    // Transform data to match ProductCard interface
    const transformedProducts = frequentlyBought.map(item => ({
      _id: item._id,
      slug: item.slug,
      name: item.name,
      price: item.price || 0,
      finalPrice: item.price || 0,
      images: item.image ? [item.image] : [],
      brand: item.brand || { name: 'Unknown', slug: 'unknown' },
      category: item.category || { name: 'General', slug: 'general' },
      stock: item.stock || 0,
      isNewArrival: item.isNew || false,
      totalPurchases: item.totalPurchases,
      totalOrders: item.totalOrders
    }));

    // Cache the results
    frequentlyBoughtCache.set(cacheKey, transformedProducts);

    res.json({
      success: true,
      data: { products: transformedProducts },
      cached: false
    });
  } catch (error) {
    console.error('Error fetching frequently bought products:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching frequently bought products',
      error: error.message
    });
  }
};

// @desc    Get product sales data
// @route   GET /api/orders/product/:productId/sales
// @access  Private/Admin
exports.getProductSales = async (req, res) => {
  try {
    const { productId } = req.params;
    const months = parseInt(req.query.months) || 6; // Default to 6 months

    // Get the date range for the specified number of months
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);

    // Aggregate sales data for the specific product
    const salesAggregation = await Order.aggregate([
      // Match orders within date range and paid status
      {
        $match: {
          isPaid: true,
          createdAt: {
            $gte: startDate,
            $lte: endDate
          }
        }
      },
      // Unwind order items to process each product separately
      {
        $unwind: '$orderItems'
      },
      // Match the specific product
      {
        $match: {
          'orderItems.product': new mongoose.Types.ObjectId(productId)
        }
      },
      // Group by month and sum quantities
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          totalQuantity: { $sum: '$orderItems.quantity' },
          totalRevenue: { 
            $sum: { 
              $multiply: ['$orderItems.quantity', '$orderItems.price'] 
            } 
          },
          orderCount: { $sum: 1 }
        }
      },
      // Sort by year and month
      {
        $sort: {
          '_id.year': 1,
          '_id.month': 1
        }
      }
    ]);

    // Create a map of sales data by month
    const salesMap = {};
    let totalSold = 0;
    let totalRevenue = 0;

    salesAggregation.forEach(item => {
      const monthKey = `${item._id.year}-${item._id.month}`;
      const monthName = new Date(item._id.year, item._id.month - 1).toLocaleDateString('en-US', { month: 'short' });
      
      salesMap[monthKey] = {
        month: monthName,
        sales: item.totalQuantity,
        revenue: item.totalRevenue,
        orders: item.orderCount
      };
      
      totalSold += item.totalQuantity;
      totalRevenue += item.totalRevenue;
    });

    // Generate array for the last N months, filling in zeros for months with no sales
    const salesData = [];
    for (let i = months - 1; i >= 0; i--) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      const monthKey = `${date.getFullYear()}-${date.getMonth() + 1}`;
      const monthName = date.toLocaleDateString('en-US', { month: 'short' });
      
      salesData.push({
        month: monthName,
        sales: salesMap[monthKey]?.sales || 0,
        revenue: salesMap[monthKey]?.revenue || 0,
        orders: salesMap[monthKey]?.orders || 0
      });
    }

    // Get additional product stats
    const productStats = await Order.aggregate([
      // Match paid orders
      {
        $match: {
          isPaid: true
        }
      },
      // Unwind order items
      {
        $unwind: '$orderItems'
      },
      // Match the specific product
      {
        $match: {
          'orderItems.product': new mongoose.Types.ObjectId(productId)
        }
      },
      // Group to get overall stats
      {
        $group: {
          _id: null,
          totalSold: { $sum: '$orderItems.quantity' },
          totalRevenue: { 
            $sum: { 
              $multiply: ['$orderItems.quantity', '$orderItems.price'] 
            } 
          },
          totalOrders: { $sum: 1 },
          avgOrderQuantity: { $avg: '$orderItems.quantity' },
          firstOrderDate: { $min: '$createdAt' },
          lastOrderDate: { $max: '$createdAt' }
        }
      }
    ]);

    const stats = productStats[0] || {
      totalSold: 0,
      totalRevenue: 0,
      totalOrders: 0,
      avgOrderQuantity: 0,
      firstOrderDate: null,
      lastOrderDate: null
    };

    res.json({
      success: true,
      data: {
        salesData,
        stats: {
          totalSold: stats.totalSold,
          revenue: stats.totalRevenue,
          totalOrders: stats.totalOrders,
          avgOrderQuantity: Math.round(stats.avgOrderQuantity * 10) / 10,
          firstOrderDate: stats.firstOrderDate,
          lastOrderDate: stats.lastOrderDate
        },
        period: {
          months,
          startDate,
          endDate
        }
      }
    });
  } catch (error) {
    console.error('Error fetching product sales:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching product sales data',
      error: error.message
    });
  }
};

exports.getProductSalesStats = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 5;
    const months = parseInt(req.query.months) || 12; // Default to 12 months

    // Get the date range for the specified number of months
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);

    // Aggregate sales data for all products
    const productStats = await Order.aggregate([
      // Match paid orders within date range
      {
        $match: {
          isPaid: true,
          createdAt: {
            $gte: startDate,
            $lte: endDate
          }
        }
      },
      // Unwind order items to process each product separately
      {
        $unwind: '$orderItems'
      },
      // Group by product and sum quantities and revenue
      {
        $group: {
          _id: '$orderItems.product',
          name: { $first: '$orderItems.name' },
          totalSold: { $sum: '$orderItems.quantity' },
          totalRevenue: { 
            $sum: { 
              $multiply: ['$orderItems.quantity', '$orderItems.price'] 
            } 
          },
          orderCount: { $sum: 1 }
        }
      },
      // Sort by total sold in descending order
      {
        $sort: {
          totalSold: -1
        }
      },
      // Limit to requested number of products
      {
        $limit: limit
      },
      // Lookup product details from Product collection
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: '_id',
          as: 'productDetails'
        }
      },
      // Unwind product details
      {
        $unwind: {
          path: '$productDetails',
          preserveNullAndEmptyArrays: true
        }
      },
      // Project final structure
      {
        $project: {
          _id: 1,
          name: {
            $ifNull: ['$productDetails.name', '$name']
          },
          totalSold: 1,
          totalRevenue: 1,
          stock: '$productDetails.stock',
          images: '$productDetails.images'
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        products: productStats
      }
    });
  } catch (error) {
    console.error('Error fetching product sales stats:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching product sales statistics',
      error: error.message
    });
  }
};

// @desc    Get orders for a specific pickup station
// @route   GET /api/orders/station/:stationId
// @access  Private/Agent/Admin
exports.getOrdersByStation = async (req, res) => {
  try {
    const { stationId } = req.params;
    const { status, date, search, page = 1, limit = 50 } = req.query;
    

    // Build query
    const query = {
      pickupStation: stationId,
      deliveryMethod: 'pickup_station' // Ensure we only get pickup station orders
    };

    // Add filters
    if (status) {
      query.status = status;
    }

    if (date) {
      const startDate = new Date(date);
      const endDate = new Date(date);
      endDate.setDate(endDate.getDate() + 1);
      
      query.createdAt = {
        $gte: startDate,
        $lt: endDate
      };
    }

    // Pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    let orders = await Order.find(query)
      .populate('user', 'name email phone')
      .populate('pickupStation', 'name address city state phone')
      .populate('assignedAgent', 'name email phone')
      .populate('orderItems.product', 'name price image')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    // Apply search filter if provided
    if (search) {
      const searchLower = search.toLowerCase();
      orders = orders.filter(order => 
        order.orderNumber.toLowerCase().includes(searchLower) ||
        order.user?.name?.toLowerCase().includes(searchLower) ||
        order.user?.phone?.includes(search) ||
        order.orderItems.some(item => 
          item.name?.toLowerCase().includes(searchLower)
        )
      );
    }

    const total = await Order.countDocuments(query);

    res.json({
      success: true,
      data: {
        orders,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum)
        }
      }
    });

  } catch (error) {
    console.error('Get orders by station error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching station orders',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get orders for the current agent's pickup station
// @route   GET /api/orders/my-station
// @access  Private/Agent
exports.getMyStationOrders = async (req, res) => {
  try {
    console.log('Getting orders for current agent\'s station');
    console.log('User ID:', req.user.id);
    console.log('User role:', req.user.role);

    // Get the agent's pickup station
    const User = require('../models/User');
    const agent = await User.findById(req.user.id).populate('pickupStation');
    
    if (!agent || !agent.pickupStation) {
      return res.status(400).json({
        success: false,
        message: 'Agent does not have an assigned pickup station'
      });
    }

    console.log('Agent pickup station:', agent.pickupStation.name);

    const { status, date, search, page = 1, limit = 50 } = req.query;

    // Use the existing getOrdersByStation logic
    req.params.stationId = agent.pickupStation._id.toString();
    
    // Call the getOrdersByStation function
    return exports.getOrdersByStation(req, res);

  } catch (error) {
    console.error('Get my station orders error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching your station orders',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Assign order to agent automatically when created at pickup station
// @route   Called internally when order is created
// @access  Internal
exports.assignOrderToAgent = async (orderId, pickupStationId) => {
  try {
    console.log(`Assigning order ${orderId} to station ${pickupStationId}`);
    
    const User = require('../models/User');
    
    // Find an active agent for this pickup station
    const agent = await User.findOne({
      pickupStation: pickupStationId,
      role: 'agent',
      isActive: true
    });

    if (agent) {
      await Order.findByIdAndUpdate(orderId, {
        assignedAgent: agent._id,
        $set: { 'pickupStation': pickupStationId } // Ensure pickup station is set
      });
      
      console.log(`Order ${orderId} assigned to agent ${agent.name}`);
    } else {
      console.log(`No active agent found for pickup station ${pickupStationId}`);
    }

  } catch (error) {
    console.error('Error assigning order to agent:', error);
  }
};

exports.getOrderCommissions = async (req, res) => {
  try {
    const orderId = req.params.id;
    
    // Get the order
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Check permissions
    const hasAccess = 
      req.user.role === 'admin' || 
      order.user._id.toString() === req.user.id ||
      (req.user.role === 'agent' && (
        (order.assignedAgent && order.assignedAgent.toString() === req.user.id) ||
        (order.agentId && order.agentId.toString() === req.user.id)
      ));

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view commission details for this order'
      });
    }

    // Get commissions for this order
    const Commission = require('../models/Commission');
    const commissions = await Commission.find({ orderId });

    res.json({
      success: true,
      data: { 
        orderId,
        orderNumber: order.orderNumber,
        orderTotal: order.totalPrice,
        commissions 
      }
    });
  } catch (error) {
    console.error('Get order commissions error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// ADD: Helper function to check if order is eligible for commission
exports.checkCommissionEligibility = async (req, res) => {
  try {
    const orderId = req.params.id;
    
    const order = await Order.findById(orderId)
      .populate('assignedAgent')
      .populate('agentId');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const eligibility = {
      orderId,
      orderNumber: order.orderNumber,
      orderTotal: order.totalPrice,
      status: order.status,
      deliveryCommissionEligible: false,
      agentOrderCommissionEligible: false,
      reasons: []
    };

    // Check delivery commission eligibility
    if (order.assignedAgent && order.deliveryMethod === 'pickup_station') {
      if (order.status === 'delivered') {
        eligibility.deliveryCommissionEligible = true;
      } else {
        eligibility.reasons.push('Order must be delivered for delivery commission');
      }
    } else {
      if (!order.assignedAgent) {
        eligibility.reasons.push('No assigned agent for delivery commission');
      }
      if (order.deliveryMethod !== 'pickup_station') {
        eligibility.reasons.push('Must be pickup station delivery for delivery commission');
      }
    }

    // Check agent order commission eligibility
    if (order.createdBy === 'agent' && order.agentId) {
      eligibility.agentOrderCommissionEligible = true;
    } else {
      if (order.createdBy !== 'agent') {
        eligibility.reasons.push('Order not created by agent');
      }
      if (!order.agentId) {
        eligibility.reasons.push('No agent ID for agent order commission');
      }
    }

    res.json({
      success: true,
      data: eligibility
    });
  } catch (error) {
    console.error('Check commission eligibility error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get commission preview for order creation
// @route   GET /api/orders/commission-preview
// @access  Private/Agent/Admin
exports.getCommissionPreview = async (req, res) => {
  try {
    const { orderTotal, orderType, itemCount } = req.query;
    
    if (!orderTotal || !orderType) {
      return res.status(400).json({
        success: false,
        message: 'Order total and type are required'
      });
    }
    
    const PayoutSettings = require('../models/PayoutSettings');
    const settings = await PayoutSettings.getCurrentSettings();
    
    let commissionType, commission, calculationMethod, commissionRate;
    
    if (orderType === 'agent_order') {
      commissionType = 'agentOrder';
      commissionRate = settings.commissionRates.agentOrder;
      commission = Math.round(parseFloat(orderTotal) * commissionRate);
      calculationMethod = 'percentage';
    } else if (orderType === 'delivery') {
      commissionType = 'delivery';
      const deliveryCount = parseInt(itemCount) || 1; // Number of items being delivered
      commission = settings.commissionRates.deliveryAmount * deliveryCount;
      commissionRate = settings.commissionRates.deliveryAmount;
      calculationMethod = 'fixed_per_item';
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid order type. Use "agent_order" or "delivery"'
      });
    }
    
    res.json({
      success: true,
      data: {
        orderTotal: parseFloat(orderTotal),
        commissionType,
        calculationMethod,
        commissionRate,
        commissionRateDisplay: calculationMethod === 'percentage' 
          ? `${(commissionRate * 100).toFixed(1)}%` 
          : `KSh ${commissionRate.toLocaleString()}`,
        commissionAmount: commission,
        formattedCommission: `KSh ${commission.toLocaleString()}`,
        itemCount: calculationMethod === 'fixed_per_item' ? parseInt(itemCount) || 1 : undefined,
        calculation: calculationMethod === 'percentage'
          ? `KSh ${parseFloat(orderTotal).toLocaleString()} × ${(commissionRate * 100).toFixed(1)}%`
          : `KSh ${commissionRate.toLocaleString()} × ${parseInt(itemCount) || 1} items`
      }
    });
  } catch (error) {
    console.error('Get commission preview error:', error);
    res.status(500).json({
      success: false,
      message: 'Error calculating commission preview'
    });
  }
};

// @desc    Get current commission rates for agents
// @route   GET /api/orders/commission-rates
// @access  Private/Agent/Admin
exports.getCurrentCommissionRates = async (req, res) => {
  try {
    const PayoutSettings = require('../models/PayoutSettings');
    const settings = await PayoutSettings.getCurrentSettings();
    
    const rates = {
      delivery: {
        amount: settings.commissionRates.deliveryAmount,
        display: `KSh ${settings.commissionRates.deliveryAmount.toLocaleString()}`,
        description: 'Fixed amount earned per delivery (regardless of order value)',
        type: 'fixed'
      },
      agentOrder: {
        rate: settings.commissionRates.agentOrder,
        percentage: (settings.commissionRates.agentOrder * 100).toFixed(1) + '%',
        description: 'Percentage of order value earned when creating orders on behalf of customers',
        type: 'percentage'
      }
    };
    
    // Add examples for common order values and item counts
    const exampleScenarios = [
      { orderValue: 10000, itemCount: 1 },
      { orderValue: 30000, itemCount: 3 },
      { orderValue: 40000, itemCount: 5 },
      { orderValue: 50000, itemCount: 8 }
    ];
    
    rates.examples = exampleScenarios.map(scenario => {
      const agentOrderCommission = Math.round(scenario.orderValue * settings.commissionRates.agentOrder);
      const deliveryCommission = settings.commissionRates.deliveryAmount * scenario.itemCount;
      
      return {
        orderValue: scenario.orderValue,
        itemCount: scenario.itemCount,
        deliveryCommission,
        agentOrderCommission,
        deliveryCalculation: `KSh ${settings.commissionRates.deliveryAmount.toLocaleString()} × ${scenario.itemCount} items`,
        agentOrderCalculation: `KSh ${scenario.orderValue.toLocaleString()} × ${(settings.commissionRates.agentOrder * 100).toFixed(1)}%`
      };
    });
    
    res.json({
      success: true,
      data: rates
    });
  } catch (error) {
    console.error('Get commission rates error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching commission rates'
    });
  }
};