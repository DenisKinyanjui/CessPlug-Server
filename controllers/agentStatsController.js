// controllers/agentStatsController.js
const Order = require('../models/Order');
const Commission = require('../models/Commission');
const User = require('../models/User');
const mongoose = require('mongoose');

// @desc    Get agent statistics by agent ID
// @route   GET /api/admin/agents/:id/stats
// @access  Private/Admin
exports.getAgentStats = async (req, res) => {
  try {
    const agentId = req.params.id;

    console.log('Getting agent statistics for agent:', agentId);

    // Validate agent exists and is an agent
    const agent = await User.findOne({ 
      _id: agentId, 
      role: 'agent' 
    }).populate('pickupStation', 'name address city state');

    if (!agent) {
      return res.status(404).json({
        success: false,
        message: 'Agent not found'
      });
    }

    // Get commission statistics
    const commissionStats = await Commission.aggregate([
      { $match: { agentId: new mongoose.Types.ObjectId(agentId) } },
      {
        $group: {
          _id: '$status',
          total: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      }
    ]);

    // Process commission stats
    let pendingCommissions = 0;
    let totalEarnings = 0;
    
    commissionStats.forEach(stat => {
      if (stat._id === 'pending') {
        pendingCommissions = stat.total;
      } else if (stat._id === 'paid') {
        totalEarnings = stat.total;
      }
    });

    // Get order statistics for agent's pickup station
    const orderStats = await Order.aggregate([
      {
        $match: {
          $or: [
            { assignedAgent: new mongoose.Types.ObjectId(agentId) },
            { agentId: new mongoose.Types.ObjectId(agentId) }
          ]
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    // Process order stats
    let totalOrders = 0;
    let pendingOrders = 0;

    orderStats.forEach(stat => {
      totalOrders += stat.count;
      if (['pending', 'processing', 'shipped', 'arrived_at_station'].includes(stat._id)) {
        pendingOrders += stat.count;
      }
    });

    const stats = {
      totalOrders,
      pendingOrders,
      pendingCommissions, // Available for payout
      totalEarnings, // All time paid commissions
      currentBalance: pendingCommissions // Same as pending commissions
    };

    console.log('Agent stats calculated:', stats);

    res.json({
      success: true,
      data: {
        agent: {
          _id: agent._id,
          name: agent.name,
          email: agent.email,
          phone: agent.phone,
          pickupStation: agent.pickupStation
        },
        stats
      }
    });
  } catch (error) {
    console.error('Get agent stats error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get recent orders for an agent
// @route   GET /api/admin/agents/:id/orders
// @access  Private/Admin
exports.getAgentOrders = async (req, res) => {
  try {
    const agentId = req.params.id;
    const { page = 1, limit = 10, status } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    console.log('Getting agent orders for agent:', agentId);

    // Validate agent exists
    const agent = await User.findOne({ 
      _id: agentId, 
      role: 'agent' 
    });

    if (!agent) {
      return res.status(404).json({
        success: false,
        message: 'Agent not found'
      });
    }

    // Build query for orders handled by this agent
    const query = {
      $or: [
        { assignedAgent: agentId }, // Orders assigned to agent (pickup station orders)
        { agentId: agentId } // Orders created by agent (agent orders)
      ]
    };

    // Add status filter if provided
    if (status) {
      query.status = status;
    }

    // Get orders with pagination
    const orders = await Order.find(query)
      .populate('user', 'name email phone')
      .populate('pickupStation', 'name address city state')
      .populate('assignedAgent', 'name email phone')
      .populate('agentId', 'name email phone')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const total = await Order.countDocuments(query);

    // Transform orders for frontend
    const transformedOrders = orders.map(order => ({
      _id: order._id,
      orderNumber: order.orderNumber,
      user: {
        name: order.user?.name || order.customerInfo?.name || 'Unknown',
        email: order.user?.email || order.customerInfo?.email || '',
        phone: order.user?.phone || order.customerInfo?.phone || ''
      },
      status: order.status,
      createdAt: order.createdAt,
      totalPrice: order.totalPrice,
      deliveryMethod: order.deliveryMethod,
      createdBy: order.createdBy || 'customer'
    }));

    console.log(`Found ${orders.length} orders for agent ${agentId}`);

    res.json({
      success: true,
      data: {
        orders: transformedOrders,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum)
        }
      }
    });
  } catch (error) {
    console.error('Get agent orders error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get detailed agent analytics
// @route   GET /api/admin/agents/:id/analytics
// @access  Private/Admin
exports.getAgentAnalytics = async (req, res) => {
  try {
    const agentId = req.params.id;
    const { startDate, endDate } = req.query;

    console.log('Getting agent analytics for agent:', agentId);

    // Build date filter if provided
    const dateFilter = {};
    if (startDate) dateFilter.$gte = new Date(startDate);
    if (endDate) dateFilter.$lte = new Date(endDate);

    const matchStage = Object.keys(dateFilter).length > 0 
      ? { createdAt: dateFilter }
      : {};

    // Get commission analytics
    const commissionAnalytics = await Commission.aggregate([
      { 
        $match: { 
          agentId: new mongoose.Types.ObjectId(agentId),
          ...matchStage
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          totalAmount: { $sum: '$amount' },
          count: { $sum: 1 },
          deliveryCommissions: {
            $sum: {
              $cond: [{ $eq: ['$type', 'delivery'] }, '$amount', 0]
            }
          },
          agentOrderCommissions: {
            $sum: {
              $cond: [{ $eq: ['$type', 'agent_order'] }, '$amount', 0]
            }
          }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    // Get order analytics
    const orderAnalytics = await Order.aggregate([
      {
        $match: {
          $or: [
            { assignedAgent: new mongoose.Types.ObjectId(agentId) },
            { agentId: new mongoose.Types.ObjectId(agentId) }
          ],
          ...matchStage
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          totalOrders: { $sum: 1 },
          totalValue: { $sum: '$totalPrice' },
          deliveredOrders: {
            $sum: {
              $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0]
            }
          }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    res.json({
      success: true,
      data: {
        commissionAnalytics,
        orderAnalytics,
        period: {
          startDate: startDate || 'All time',
          endDate: endDate || 'Present'
        }
      }
    });
  } catch (error) {
    console.error('Get agent analytics error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};