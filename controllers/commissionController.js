const Commission = require('../models/Commission');
const PayoutRequest = require('../models/PayoutRequest');
const Order = require('../models/Order');
const User = require('../models/User');
const mongoose = require('mongoose');

// @desc    Get agent's commissions
// @route   GET /api/commissions
// @access  Private/Agent
exports.getAgentCommissions = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, type } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Build query
    const query = { agentId: req.user.id };
    if (status) query.status = status;
    if (type) query.type = type;

    console.log('Getting agent commissions with query:', query);

    const commissions = await Commission.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const total = await Commission.countDocuments(query);

    console.log(`Found ${commissions.length} commissions for agent ${req.user.id}`);

    res.json({
      success: true,
      data: {
        commissions,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum)
        }
      }
    });
  } catch (error) {
    console.error('Get agent commissions error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get agent's commission statistics - FIXED VERSION
// @route   GET /api/commissions/stats
// @access  Private/Agent
exports.getCommissionStats = async (req, res) => {
  try {
    const agentId = req.user.id;

    console.log('Getting commission stats for agent:', agentId);

    // Get commission statistics using aggregation
    const stats = await Commission.aggregate([
      { $match: { agentId: new mongoose.Types.ObjectId(agentId) } },
      {
        $group: {
          _id: '$status',
          total: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      }
    ]);

    console.log('Commission stats aggregation result:', stats);

    // Initialize stats object
    const commissionStats = {
      totalEarnings: 0,
      pendingCommissions: 0,
      paidCommissions: 0,
      cancelledCommissions: 0,
      totalCommissionsCount: 0,
      pendingCount: 0,
      paidCount: 0,
      cancelledCount: 0
    };

    // Process aggregation results
    stats.forEach(stat => {
      switch (stat._id) {
        case 'pending':
          commissionStats.pendingCommissions = stat.total;
          commissionStats.pendingCount = stat.count;
          break;
        case 'paid':
          commissionStats.paidCommissions = stat.total;
          commissionStats.paidCount = stat.count;
          break;
        case 'cancelled':
          commissionStats.cancelledCommissions = stat.total;
          commissionStats.cancelledCount = stat.count;
          break;
      }
      commissionStats.totalEarnings += stat.total;
      commissionStats.totalCommissionsCount += stat.count;
    });

    // Get recent commission activity (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentCommissions = await Commission.find({
      agentId,
      createdAt: { $gte: thirtyDaysAgo }
    });

    const recentEarnings = recentCommissions.reduce((sum, comm) => sum + comm.amount, 0);

    // CRITICAL FIX: Current balance should ONLY include PENDING commissions
    const currentBalance = commissionStats.pendingCommissions;

    // DEBUGGING: Log the calculations for troubleshooting
    console.log('Commission stats calculations:', {
      totalEarnings: commissionStats.totalEarnings,
      pendingCommissions: commissionStats.pendingCommissions,
      paidCommissions: commissionStats.paidCommissions,
      currentBalance: currentBalance,
      pendingCount: commissionStats.pendingCount,
      paidCount: commissionStats.paidCount
    });

    const finalStats = {
      ...commissionStats,
      currentBalance, // This should reflect only pending commissions
      recentEarnings,
      recentCommissionsCount: recentCommissions.length
    };

    console.log('Final commission stats being returned:', finalStats);

    res.json({
      success: true,
      data: finalStats
    });
  } catch (error) {
    console.error('Get commission stats error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Create commission (internal function) - UPDATED to use dynamic rates
// @route   Called internally when orders are completed
// @access  Internal
exports.createCommission = async (orderId, agentId, type) => {
  try {
    console.log(`Creating commission for order ${orderId}, agent ${agentId}, type ${type}`);

    // Get order details
    const order = await Order.findById(orderId);
    if (!order) {
      throw new Error('Order not found');
    }

    // Validate agent exists
    const agent = await User.findById(agentId);
    if (!agent || agent.role !== 'agent') {
      throw new Error('Invalid agent');
    }

    // Check if commission already exists for this order and agent
    const existingCommission = await Commission.findOne({
      orderId,
      agentId,
      type
    });

    if (existingCommission) {
      console.log('Commission already exists for this order:', existingCommission._id);
      return existingCommission;
    }

    // UPDATED: Calculate commission amount using updated method
    let deliveryCount = 1;
    
    if (type === 'delivery') {
      // For delivery commissions, count the number of items being delivered
      deliveryCount = order.orderItems ? order.orderItems.reduce((sum, item) => sum + item.quantity, 0) : 1;
      console.log(`Delivery commission for ${deliveryCount} items`);
    }

    const commissionData = await Commission.calculateCommission(order.totalPrice, type, deliveryCount);

    // Create commission record with updated fields
    const commission = await Commission.create({
      orderId,
      agentId,
      type,
      amount: commissionData.amount,
      orderTotal: order.totalPrice,
      commissionRate: commissionData.rate,
      isFixedAmount: commissionData.isFixedAmount,
      deliveryCount: commissionData.deliveryCount,
      settingsVersion: commissionData.settingsId,
      description: type === 'delivery' 
        ? `Delivery commission: KSh ${commissionData.rate.toLocaleString()} × ${deliveryCount} items = KSh ${commissionData.amount.toLocaleString()}`
        : `Agent order commission: ${(commissionData.rate * 100).toFixed(1)}% of KSh ${order.totalPrice.toLocaleString()} = KSh ${commissionData.amount.toLocaleString()}`
    });

    console.log(`Commission created: ${commission._id}, amount: KSh ${commissionData.amount.toLocaleString()} (${type === 'delivery' ? 'fixed amount' : 'percentage rate'})`);
    return commission;
  } catch (error) {
    console.error('Create commission error:', error);
    throw error;
  }
};

// @desc    Get current commission rates for display
// @route   GET /api/commissions/rates
// @access  Private/Agent/Admin
exports.getCommissionRates = async (req, res) => {
  try {
    console.log('Getting current commission rates');
    
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

    // Add example calculations
    const exampleOrderValues = [1000, 5000, 10000, 20000];
    rates.examples = exampleOrderValues.map(orderValue => {
      const agentOrderCommission = Math.round(orderValue * settings.commissionRates.agentOrder);
      
      return {
        orderValue,
        deliveryCommission: settings.commissionRates.deliveryAmount, // Fixed amount
        agentOrderCommission,
        deliveryNote: `KSh ${settings.commissionRates.deliveryAmount.toLocaleString()} per delivery (fixed)`,
        agentOrderNote: `${(settings.commissionRates.agentOrder * 100).toFixed(1)}% of order value`
      };
    });

    res.json({
      success: true,
      data: rates
    });
  } catch (error) {
    console.error('Get commission rates error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get agent's payout requests
// @route   GET /api/commissions/payout-requests
// @access  Private/Agent
exports.getPayoutRequests = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    console.log('Getting payout requests for agent:', req.user.id);

    const payoutRequests = await PayoutRequest.find({ agentId: req.user.id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const total = await PayoutRequest.countDocuments({ agentId: req.user.id });

    console.log(`Found ${payoutRequests.length} payout requests for agent ${req.user.id}`);

    res.json({
      success: true,
      data: {
        payoutRequests,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum)
        }
      }
    });
  } catch (error) {
    console.error('Get payout requests error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};


// @desc    Create payout request with enhanced validation and auto-approval
// @route   POST /api/commissions/payout-requests
// @access  Private/Agent
exports.createPayoutRequest = async (req, res) => {
  try {
    const { amount, method, accountDetails } = req.body;
    const agentId = req.user.id;

    console.log('Creating enhanced payout request with auto-approval:', { agentId, amount, method });

    // Get validation results from middleware
    const { settings, warnings, availableBalance } = req.payoutValidation || {};

    // Basic validation (redundant but ensures safety)
    if (!amount || !method || !accountDetails) {
      return res.status(400).json({
        success: false,
        message: 'Please provide amount, method, and account details'
      });
    }

    if (!['mpesa', 'bank'].includes(method)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment method. Use mpesa or bank'
      });
    }

    // Validate M-Pesa number format if method is mpesa
    if (method === 'mpesa') {
      const mpesaRegex = /^(\+254|254|0)[17]\d{8}$/;
      if (!mpesaRegex.test(accountDetails.trim())) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid M-Pesa number (e.g., +254712345678)'
        });
      }
    }

    // Calculate actual amount after processing fee
    let finalAmount = amount;
    if (settings && settings.processingFee > 0) {
      if (amount <= settings.processingFee) {
        return res.status(400).json({
          success: false,
          message: `Amount must be greater than processing fee of KSh ${settings.processingFee}`
        });
      }
      // Note: We store the requested amount, fee will be handled during processing
    }

    // Determine if this request should be auto-approved and auto-paid
    const shouldAutoApprove = settings && 
                             !settings.requireManagerApproval && 
                             amount <= settings.autoApprovalThreshold;

    console.log('Auto-approval check:', {
      amount,
      autoApprovalThreshold: settings?.autoApprovalThreshold,
      requireManagerApproval: settings?.requireManagerApproval,
      shouldAutoApprove
    });

    // Create payout request with enhanced data
    const payoutRequestData = {
      agentId,
      amount: finalAmount,
      method,
      accountDetails: accountDetails.trim(),
      // Set initial status based on auto-approval
      status: shouldAutoApprove ? 'approved' : 'pending',
      // Add metadata about admin settings compliance
      metadata: {
        settingsVersion: settings?._id || null,
        processingFee: settings?.processingFee || 0,
        validatedAt: new Date(),
        validationWarnings: warnings || [],
        autoApproved: shouldAutoApprove,
        autoApprovalThreshold: settings?.autoApprovalThreshold || 0
      }
    };

    // If auto-approved, set approval details
    if (shouldAutoApprove) {
      payoutRequestData.processedAt = new Date();
      payoutRequestData.processedBy = agentId; // System auto-approval
      payoutRequestData.notes = 'Auto-approved based on admin settings';
    }

    const payoutRequest = await PayoutRequest.create(payoutRequestData);

    console.log('Payout request created:', {
      id: payoutRequest._id,
      status: payoutRequest.status,
      autoApproved: shouldAutoApprove
    });

    // If auto-approved, immediately process payment
    if (shouldAutoApprove) {
      try {
        console.log('Processing auto-approved payout payment...');
        
        // Get agent's pending commissions
        const pendingCommissions = await Commission.find({
          agentId: payoutRequest.agentId,
          status: 'pending'
        }).sort({ createdAt: 1 }); // Process oldest first

        console.log(`Found ${pendingCommissions.length} pending commissions for auto-payment`);

        // Check if agent has sufficient pending commissions
        const totalPendingAmount = pendingCommissions.reduce((sum, commission) => sum + commission.amount, 0);
        
        if (totalPendingAmount >= payoutRequest.amount) {
          // Process payment with commission splitting
          let remainingAmount = payoutRequest.amount;
          const paidCommissionIds = [];
          const commissionsToUpdate = [];

          for (const commission of pendingCommissions) {
            if (remainingAmount <= 0) break;

            if (commission.amount <= remainingAmount) {
              // Pay the entire commission
              commissionsToUpdate.push({
                commission,
                newStatus: 'paid',
                amountPaid: commission.amount
              });
              paidCommissionIds.push(commission._id);
              remainingAmount -= commission.amount;
              
              console.log(`Auto-paying commission ${commission._id}: ${commission.amount}`);
            } else {
              // Split the commission (create new commission for remaining amount)
              const paidAmount = remainingAmount;
              const remainingCommissionAmount = commission.amount - paidAmount;
              
              console.log(`Auto-splitting commission ${commission._id}: Paying ${paidAmount}, Remaining ${remainingCommissionAmount}`);
              
              // Create a new commission for the remaining amount
              const newCommission = await Commission.create({
                orderId: commission.orderId,
                agentId: commission.agentId,
                type: commission.type,
                amount: remainingCommissionAmount,
                status: 'pending',
                orderTotal: commission.orderTotal,
                commissionRate: commission.commissionRate,
                settingsVersion: commission.settingsVersion,
                description: commission.description ? `${commission.description} (Auto-Split - Remaining)` : `${commission.type} commission (Auto-Split - Remaining)`
              });

              // Update original commission to paid with new amount
              commission.amount = paidAmount;
              commission.description = commission.description ? `${commission.description} (Auto-Split - Paid)` : `${commission.type} commission (Auto-Split - Paid)`;
              
              commissionsToUpdate.push({
                commission,
                newStatus: 'paid',
                amountPaid: paidAmount
              });
              paidCommissionIds.push(commission._id);
              remainingAmount = 0;
              
              console.log(`Auto-split commission created: Original ${commission._id} (paid ${paidAmount}), New ${newCommission._id} (pending ${remainingCommissionAmount})`);
              
              break;
            }
          }

          // Update commissions to paid status
          for (const { commission, newStatus } of commissionsToUpdate) {
            commission.status = newStatus;
            commission.paidAt = new Date();
            commission.payoutRequestId = payoutRequest._id;
            await commission.save();
          }

          // Update payout request to paid status
          payoutRequest.status = 'paid';
          payoutRequest.commissionIds = paidCommissionIds;
          payoutRequest.notes = `Auto-approved and auto-paid. Processed ${paidCommissionIds.length} commission(s).`;
          await payoutRequest.save();

          console.log(`Auto-payment completed: KSh ${payoutRequest.amount.toLocaleString()} paid from ${paidCommissionIds.length} commission(s)`);
        } else {
          console.log('Insufficient commission balance for auto-payment, keeping as approved');
          payoutRequest.notes = 'Auto-approved but insufficient commission balance for auto-payment';
          await payoutRequest.save();
        }
      } catch (autoPayError) {
        console.error('Auto-payment failed:', autoPayError);
        // Keep the payout as approved but add error note
        payoutRequest.notes = `Auto-approved but auto-payment failed: ${autoPayError.message}`;
        await payoutRequest.save();
      }
    }

    // Fetch the updated payout request with populated data
    const finalPayoutRequest = await PayoutRequest.findById(payoutRequest._id)
      .populate('agentId', 'name email phone')
      .populate('processedBy', 'name email');

    // Prepare response with warnings and auto-approval info
    const response = {
      success: true,
      message: shouldAutoApprove 
        ? (finalPayoutRequest.status === 'paid' 
           ? 'Payout request auto-approved and paid successfully' 
           : 'Payout request auto-approved successfully')
        : 'Payout request created successfully',
      data: { payoutRequest: finalPayoutRequest }
    };

    // Add warnings to response if any
    if (warnings && warnings.length > 0) {
      response.warnings = warnings;
    }

    // Add auto-approval info
    if (shouldAutoApprove) {
      response.autoApproved = true;
      response.autoApprovalThreshold = settings.autoApprovalThreshold;
      if (finalPayoutRequest.status === 'paid') {
        response.autoPaid = true;
      }
    }

    res.status(201).json(response);
  } catch (error) {
    console.error('Create enhanced payout request error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get commission by ID
// @route   GET /api/commissions/:id
// @access  Private/Agent
exports.getCommissionById = async (req, res) => {
  try {
    const commission = await Commission.findById(req.params.id);

    if (!commission) {
      return res.status(404).json({
        success: false,
        message: 'Commission not found'
      });
    }

    // Ensure agent can only access their own commissions
    if (commission.agentId.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to access this commission'
      });
    }

    res.json({
      success: true,
      data: { commission }
    });
  } catch (error) {
    console.error('Get commission by ID error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get all commissions (admin only)
// @route   GET /api/commissions/admin/all
// @access  Private/Admin
exports.getAllCommissions = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, type, agentId } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    console.log('Getting all commissions (admin):', { page, limit, status, type, agentId });

    // Build query
    const query = {};
    if (status) query.status = status;
    if (type) query.type = type;
    if (agentId) query.agentId = agentId;

    const commissions = await Commission.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const total = await Commission.countDocuments(query);

    console.log(`Found ${commissions.length} total commissions`);

    res.json({
      success: true,
      data: {
        commissions,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum)
        }
      }
    });
  } catch (error) {
    console.error('Get all commissions error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get all payout requests (admin only)
// @route   GET /api/commissions/admin/payout-requests
// @access  Private/Admin
exports.getAllPayoutRequests = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, agentId } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    console.log('Getting all payout requests (admin):', { page, limit, status, agentId });

    // Build query
    const query = {};
    if (status) query.status = status;
    if (agentId) query.agentId = agentId;

    const payoutRequests = await PayoutRequest.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const total = await PayoutRequest.countDocuments(query);

    console.log(`Found ${payoutRequests.length} total payout requests`);

    res.json({
      success: true,
      data: {
        payoutRequests,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum)
        }
      }
    });
  } catch (error) {
    console.error('Get all payout requests error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Process payout request (admin only) - Updated with better rejection handling
// @route   PUT /api/commissions/payout-requests/:id/process
// @access  Private/Admin
exports.processPayoutRequest = async (req, res) => {
  try {
    const { action, notes, rejectionReason } = req.body; // action: 'approve', 'pay', 'reject', 'hold', 'release'
    
    console.log('Processing payout request:', req.params.id, 'action:', action);

    const payoutRequest = await PayoutRequest.findById(req.params.id)
      .populate('agentId', 'name email phone');

    if (!payoutRequest) {
      return res.status(404).json({
        success: false,
        message: 'Payout request not found'
      });
    }

    // Validate action
    if (!['approve', 'pay', 'reject', 'hold', 'release'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid action. Use approve, pay, reject, hold, or release'
      });
    }

    // Check current status
    if (payoutRequest.status === 'paid') {
      return res.status(400).json({
        success: false,
        message: 'Payout request has already been paid'
      });
    }

    if (payoutRequest.status === 'rejected') {
      return res.status(400).json({
        success: false,
        message: 'Payout request has already been rejected'
      });
    }

    let updatedRequest;
    let message = '';

    switch (action) {
      case 'approve':
        if (payoutRequest.status !== 'pending') {
          return res.status(400).json({
            success: false,
            message: 'Only pending payout requests can be approved'
          });
        }
        updatedRequest = await payoutRequest.approve(req.user.id);
        message = 'Payout request approved successfully';
        break;
      
      case 'pay':
        if (!['pending', 'approved'].includes(payoutRequest.status)) {
          return res.status(400).json({
            success: false,
            message: 'Only pending or approved payout requests can be paid'
          });
        }

        // Get agent's pending commissions
        const pendingCommissions = await Commission.find({
          agentId: payoutRequest.agentId._id,
          status: 'pending'
        }).sort({ createdAt: 1 }); // Process oldest first

        console.log(`Found ${pendingCommissions.length} pending commissions for agent`);
        console.log(`Total pending amount: ${pendingCommissions.reduce((sum, c) => sum + c.amount, 0)}`);
        console.log(`Payout request amount: ${payoutRequest.amount}`);

        // Check if agent has sufficient pending commissions
        const totalPendingAmount = pendingCommissions.reduce((sum, commission) => sum + commission.amount, 0);
        
        if (totalPendingAmount < payoutRequest.amount) {
          return res.status(400).json({
            success: false,
            message: `Insufficient pending commissions. Available: KSh ${totalPendingAmount.toLocaleString()}, Requested: KSh ${payoutRequest.amount.toLocaleString()}`
          });
        }

        // Process payment with commission splitting
        let remainingAmount = payoutRequest.amount;
        const paidCommissionIds = [];
        const commissionsToUpdate = [];

        for (const commission of pendingCommissions) {
          if (remainingAmount <= 0) break;

          if (commission.amount <= remainingAmount) {
            // Pay the entire commission
            commissionsToUpdate.push({
              commission,
              newStatus: 'paid',
              amountPaid: commission.amount
            });
            paidCommissionIds.push(commission._id);
            remainingAmount -= commission.amount;
            
            console.log(`Marking commission ${commission._id} as fully paid: ${commission.amount}`);
          } else {
            // Split the commission (create new commission for remaining amount)
            const paidAmount = remainingAmount;
            const remainingCommissionAmount = commission.amount - paidAmount;
            
            console.log(`Splitting commission ${commission._id}: Original ${commission.amount}, Paying ${paidAmount}, Remaining ${remainingCommissionAmount}`);
            
            // Create a new commission for the remaining amount
            const newCommission = await Commission.create({
              orderId: commission.orderId,
              agentId: commission.agentId,
              type: commission.type,
              amount: remainingCommissionAmount,
              status: 'pending',
              orderTotal: commission.orderTotal,
              commissionRate: commission.commissionRate,
              description: commission.description ? `${commission.description} (Split - Remaining)` : `${commission.type} commission (Split - Remaining)`
            });

            // Update original commission to paid with new amount
            commission.amount = paidAmount;
            commission.description = commission.description ? `${commission.description} (Split - Paid)` : `${commission.type} commission (Split - Paid)`;
            
            commissionsToUpdate.push({
              commission,
              newStatus: 'paid',
              amountPaid: paidAmount
            });
            paidCommissionIds.push(commission._id);
            remainingAmount = 0;
            
            console.log(`Split commission created: Original ${commission._id} (paid ${paidAmount}), New ${newCommission._id} (pending ${remainingCommissionAmount})`);
            
            break;
          }
        }

        // Update commissions to paid status
        for (const { commission, newStatus } of commissionsToUpdate) {
          commission.status = newStatus;
          commission.paidAt = new Date();
          commission.payoutRequestId = payoutRequest._id;
          await commission.save();
        }

        const totalPaid = payoutRequest.amount - remainingAmount;
        console.log(`Processed payment: Requested ${payoutRequest.amount}, Paid ${totalPaid}, Remaining unpaid ${remainingAmount}`);

        if (totalPaid !== payoutRequest.amount) {
          return res.status(400).json({
            success: false,
            message: `Payment processing error: Could not process full amount. Paid: ${totalPaid}, Requested: ${payoutRequest.amount}`
          });
        }

        message = `Payout processed successfully. KSh ${totalPaid.toLocaleString()} paid from ${paidCommissionIds.length} commission(s).`;

        // Update payout request with commission IDs and mark as paid
        payoutRequest.commissionIds = paidCommissionIds;
        updatedRequest = await payoutRequest.markAsPaid(req.user.id);
        break;
      
      case 'reject':
        // Enhanced rejection handling with better validation
        let finalRejectionReason = rejectionReason;
        
        if (!finalRejectionReason || finalRejectionReason.trim().length === 0) {
          return res.status(400).json({
            success: false,
            message: 'Rejection reason is required'
          });
        }

        // Validate rejection reason length
        if (finalRejectionReason.trim().length < 3) {
          return res.status(400).json({
            success: false,
            message: 'Rejection reason must be at least 3 characters long'
          });
        }

        if (finalRejectionReason.trim().length > 500) {
          return res.status(400).json({
            success: false,
            message: 'Rejection reason cannot exceed 500 characters'
          });
        }

        // Clean and format the rejection reason
        finalRejectionReason = finalRejectionReason.trim();
        
        updatedRequest = await payoutRequest.reject(finalRejectionReason, req.user.id);
        message = 'Payout request rejected successfully';
        
        console.log(`Payout ${payoutRequest._id} rejected with reason: ${finalRejectionReason}`);
        break;
        
      case 'hold':
        payoutRequest.status = 'on_hold';
        payoutRequest.processedAt = new Date();
        payoutRequest.processedBy = req.user.id;
        if (notes) payoutRequest.notes = notes.trim();
        updatedRequest = await payoutRequest.save();
        message = 'Payout request put on hold successfully';
        break;
        
      case 'release':
        if (payoutRequest.status !== 'on_hold') {
          return res.status(400).json({
            success: false,
            message: 'Only held payout requests can be released'
          });
        }
        payoutRequest.status = 'pending';
        payoutRequest.processedAt = new Date();
        payoutRequest.processedBy = req.user.id;
        if (notes) payoutRequest.notes = notes.trim();
        updatedRequest = await payoutRequest.save();
        message = 'Payout request released from hold successfully';
        break;
    }

    // Add additional notes if provided and not already added
    if (notes && !updatedRequest.notes && action !== 'reject') {
      updatedRequest.notes = notes.trim();
      await updatedRequest.save();
    }

    console.log('Payout request processed successfully:', updatedRequest._id);

    // Return populated payout request with fresh data
    const populatedRequest = await PayoutRequest.findById(updatedRequest._id)
      .populate('agentId', 'name email phone')
      .populate('processedBy', 'name email');

    res.json({
      success: true,
      message,
      data: { payoutRequest: populatedRequest }
    });
  } catch (error) {
    console.error('Process payout request error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get commission analytics (admin only)
// @route   GET /api/commissions/admin/analytics
// @access  Private/Admin
exports.getCommissionAnalytics = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    console.log('Getting commission analytics:', { startDate, endDate });

    // Build date filter
    const dateFilter = {};
    if (startDate) dateFilter.$gte = new Date(startDate);
    if (endDate) dateFilter.$lte = new Date(endDate);

    const matchStage = Object.keys(dateFilter).length > 0 
      ? { createdAt: dateFilter }
      : {};

    // Overall statistics
    const overallStats = await Commission.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          totalCommissions: { $sum: '$amount' },
          totalCount: { $sum: 1 },
          avgCommission: { $avg: '$amount' },
          maxCommission: { $max: '$amount' },
          minCommission: { $min: '$amount' }
        }
      }
    ]);

    // Commission by type
    const typeStats = await Commission.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$type',
          totalAmount: { $sum: '$amount' },
          count: { $sum: 1 },
          avgAmount: { $avg: '$amount' }
        }
      }
    ]);

    // Commission by status
    const statusStats = await Commission.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$status',
          totalAmount: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      }
    ]);

    // Top earning agents
    const topAgents = await Commission.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$agentId',
          totalEarnings: { $sum: '$amount' },
          commissionCount: { $sum: 1 }
        }
      },
      { $sort: { totalEarnings: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'agent'
        }
      },
      { $unwind: '$agent' },
      {
        $project: {
          agentName: '$agent.name',
          agentEmail: '$agent.email',
          totalEarnings: 1,
          commissionCount: 1
        }
      }
    ]);

    // Monthly trends (last 12 months)
    const monthlyTrends = await Commission.aggregate([
      {
        $match: {
          createdAt: {
            $gte: new Date(Date.now() - 12 * 30 * 24 * 60 * 60 * 1000)
          }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          totalAmount: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    res.json({
      success: true,
      data: {
        overall: overallStats[0] || {
          totalCommissions: 0,
          totalCount: 0,
          avgCommission: 0,
          maxCommission: 0,
          minCommission: 0
        },
        byType: typeStats,
        byStatus: statusStats,
        topAgents,
        monthlyTrends
      }
    });
  } catch (error) {
    console.error('Get commission analytics error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// Auto-commission creation hooks (called from order controller)
exports.createDeliveryCommission = async (orderId) => {
  try {
    const order = await Order.findById(orderId).populate('assignedAgent');
    
    if (!order || !order.assignedAgent) {
      console.log('No assigned agent found for delivery commission');
      return null;
    }

    return await exports.createCommission(orderId, order.assignedAgent._id, 'delivery');
  } catch (error) {
    console.error('Create delivery commission error:', error);
    throw error;
  }
};

exports.createAgentOrderCommission = async (orderId) => {
  try {
    const order = await Order.findById(orderId);
    
    if (!order || order.createdBy !== 'agent' || !order.agentId) {
      console.log('Order not eligible for agent commission');
      return null;
    }

    return await exports.createCommission(orderId, order.agentId, 'agent_order');
  } catch (error) {
    console.error('Create agent order commission error:', error);
    throw error;
  }
};

// Utility function to cancel commissions for cancelled orders
exports.cancelCommissionsForOrder = async (orderId) => {
  try {
    console.log('Cancelling commissions for order:', orderId);
    
    const result = await Commission.updateMany(
      { orderId, status: 'pending' },
      { 
        status: 'cancelled', 
        cancelledAt: new Date() 
      }
    );

    console.log(`Cancelled ${result.modifiedCount} commissions for order ${orderId}`);
    return result;
  } catch (error) {
    console.error('Cancel commissions error:', error);
    throw error;
  }
};

// @desc    Get payout statistics (enhanced version)
// @route   GET /api/commissions/admin/payout-stats
// @access  Private/Admin
exports.getPayoutStatsEnhanced = async (req, res) => {
  try {
    console.log('Getting enhanced payout statistics');

    // Get payout statistics using aggregation
    const stats = await PayoutRequest.aggregate([
      {
        $group: {
          _id: '$status',
          total: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      }
    ]);

    console.log('Payout stats aggregation result:', stats);

    // Initialize stats object
    const payoutStats = {
      totalPending: 0,
      totalPaid: 0,
      totalOnHold: 0,
      totalRejected: 0,
      pendingAmount: 0,
      paidAmount: 0,
      onHoldAmount: 0,
      rejectedAmount: 0,
      totalPayouts: 0,
      recentPayouts: 0
    };

    // Process aggregation results
    stats.forEach(stat => {
      switch (stat._id) {
        case 'pending':
          payoutStats.totalPending = stat.count;
          payoutStats.pendingAmount = stat.total;
          break;
        case 'paid':
          payoutStats.totalPaid = stat.count;
          payoutStats.paidAmount = stat.total;
          break;
        case 'on_hold':
          payoutStats.totalOnHold = stat.count;
          payoutStats.onHoldAmount = stat.total;
          break;
        case 'rejected':
          payoutStats.totalRejected = stat.count;
          payoutStats.rejectedAmount = stat.total;
          break;
      }
      payoutStats.totalPayouts += stat.count;
    });

    // Get recent payouts (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentPayouts = await PayoutRequest.countDocuments({
      createdAt: { $gte: thirtyDaysAgo }
    });

    payoutStats.recentPayouts = recentPayouts;

    console.log('Final payout stats:', payoutStats);

    res.json({
      success: true,
      data: payoutStats
    });
  } catch (error) {
    console.error('Get enhanced payout stats error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get payout analytics with date range
// @route   GET /api/commissions/admin/payout-analytics
// @access  Private/Admin
exports.getPayoutAnalyticsEnhanced = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    console.log('Getting payout analytics:', { startDate, endDate });

    // Build date filter
    const dateFilter = {};
    if (startDate) dateFilter.$gte = new Date(startDate);
    if (endDate) dateFilter.$lte = new Date(endDate);

    const matchStage = Object.keys(dateFilter).length > 0 
      ? { createdAt: dateFilter }
      : {};

    // Overall statistics
    const overallStats = await PayoutRequest.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          totalPayouts: { $sum: '$amount' },
          totalCount: { $sum: 1 },
          avgPayout: { $avg: '$amount' },
          maxPayout: { $max: '$amount' },
          minPayout: { $min: '$amount' }
        }
      }
    ]);

    // Payout by status
    const statusStats = await PayoutRequest.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$status',
          totalAmount: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      }
    ]);

    // Top agents by payout amount
    const topAgents = await PayoutRequest.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$agentId',
          totalPayouts: { $sum: '$amount' },
          payoutCount: { $sum: 1 }
        }
      },
      { $sort: { totalPayouts: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'agent'
        }
      },
      { $unwind: '$agent' },
      {
        $project: {
          agentId: '$_id',
          agentName: '$agent.name',
          agentEmail: '$agent.email',
          totalPayouts: 1,
          payoutCount: 1
        }
      }
    ]);

    // Monthly trends (last 12 months)
    const monthlyTrends = await PayoutRequest.aggregate([
      {
        $match: {
          createdAt: {
            $gte: new Date(Date.now() - 12 * 30 * 24 * 60 * 60 * 1000)
          }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          totalAmount: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
      {
        $project: {
          month: {
            $dateToString: {
              format: "%b",
              date: { $dateFromParts: { year: "$_id.year", month: "$_id.month" } }
            }
          },
          totalPayouts: '$count',
          totalAmount: 1
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        totalPayouts: overallStats[0]?.totalCount || 0,
        totalAmount: overallStats[0]?.totalPayouts || 0,
        avgPayoutAmount: overallStats[0]?.avgPayout || 0,
        topAgents,
        monthlyTrends,
        statusDistribution: statusStats.map(stat => ({
          status: stat._id,
          count: stat.count,
          amount: stat.totalAmount
        }))
      }
    });
  } catch (error) {
    console.error('Get payout analytics error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Bulk process payout requests - Updated with rejection reason handling
// @route   PUT /api/commissions/admin/payout-requests/bulk-process
// @access  Private/Admin
exports.bulkProcessPayouts = async (req, res) => {
  try {
    const { payoutIds, action, notes, rejectionReason } = req.body;
    
    console.log('Bulk processing payouts:', { payoutIds, action });

    if (!payoutIds || !Array.isArray(payoutIds) || payoutIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide valid payout IDs'
      });
    }

    if (!['approve', 'pay', 'reject', 'hold', 'release'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid action'
      });
    }

    // Special handling for bulk rejection
    if (action === 'reject') {
      const genericRejectionReason = rejectionReason || 'Bulk rejection - Contact support for specific details';
      
      // Validate the rejection reason
      if (genericRejectionReason.trim().length < 3) {
        return res.status(400).json({
          success: false,
          message: 'Rejection reason must be at least 3 characters long'
        });
      }

      // Process each payout individually for rejection to ensure proper reason assignment
      let processedCount = 0;
      const errors = [];

      for (const payoutId of payoutIds) {
        try {
          const payoutRequest = await PayoutRequest.findById(payoutId);
          
          if (payoutRequest && payoutRequest.status === 'pending') {
            await payoutRequest.reject(genericRejectionReason.trim(), req.user.id);
            processedCount++;
          } else if (payoutRequest) {
            errors.push(`Payout ${payoutId.slice(-8)} is not in pending status`);
          } else {
            errors.push(`Payout ${payoutId.slice(-8)} not found`);
          }
        } catch (error) {
          console.error(`Error rejecting payout ${payoutId}:`, error);
          errors.push(`Failed to reject payout ${payoutId.slice(-8)}: ${error.message}`);
        }
      }

      let message = `${processedCount} payout requests rejected successfully`;
      if (errors.length > 0) {
        message += `. ${errors.length} requests could not be processed.`;
      }

      return res.json({
        success: true,
        message,
        data: {
          processedCount,
          totalRequested: payoutIds.length,
          errors: errors.length > 0 ? errors : undefined
        }
      });
    }

    // For other actions, use the existing bulk update approach
    let updateData = {
      processedBy: req.user.id,
      processedAt: new Date()
    };

    switch (action) {
      case 'approve':
        updateData.status = 'approved';
        break;
      case 'pay':
        updateData.status = 'paid';
        break;
      case 'hold':
        updateData.status = 'on_hold';
        break;
      case 'release':
        updateData.status = 'pending';
        break;
    }

    if (notes) {
      updateData.notes = notes.trim();
    }

    // Define which statuses can be updated for each action
    const allowedStatuses = {
      'approve': ['pending'],
      'pay': ['pending', 'approved'],
      'hold': ['pending', 'approved'],
      'release': ['on_hold']
    };

    const result = await PayoutRequest.updateMany(
      { 
        _id: { $in: payoutIds },
        status: { $in: allowedStatuses[action] || [] }
      },
      updateData
    );

    // Special handling for pay action - need to process commissions
    if (action === 'pay' && result.modifiedCount > 0) {
      const paidPayouts = await PayoutRequest.find({ 
        _id: { $in: payoutIds },
        status: 'paid'
      });
      
      for (const payoutRequest of paidPayouts) {
        try {
          // Find and mark commissions as paid
          const commissions = await Commission.find({
            agentId: payoutRequest.agentId,
            status: 'pending'
          }).sort({ createdAt: 1 }).limit(100); // Process oldest first
          
          let totalPaid = 0;
          const paidCommissionIds = [];

          for (const commission of commissions) {
            if (totalPaid + commission.amount <= payoutRequest.amount) {
              await commission.markAsPaid(payoutRequest._id);
              totalPaid += commission.amount;
              paidCommissionIds.push(commission._id);
              
              if (totalPaid >= payoutRequest.amount) break;
            }
          }

          // Update payout request with commission IDs
          await PayoutRequest.findByIdAndUpdate(payoutRequest._id, {
            commissionIds: paidCommissionIds
          });
        } catch (commissionError) {
          console.error(`Error processing commissions for payout ${payoutRequest._id}:`, commissionError);
        }
      }
    }

    console.log(`Bulk processed ${result.modifiedCount} payouts with action: ${action}`);

    let message = `${result.modifiedCount} payout requests ${action}${action.endsWith('e') ? 'd' : action === 'pay' ? 'id' : 'ed'} successfully`;
    
    if (result.matchedCount > result.modifiedCount) {
      const skipped = result.matchedCount - result.modifiedCount;
      message += `. ${skipped} requests were skipped (already processed or invalid status).`;
    }

    res.json({
      success: true,
      message,
      data: {
        modifiedCount: result.modifiedCount,
        matchedCount: result.matchedCount,
        skippedCount: result.matchedCount - result.modifiedCount
      }
    });
  } catch (error) {
    console.error('Bulk process payouts error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Send payout notification
// @route   POST /api/commissions/payout-requests/:id/notify
// @access  Private/Admin
exports.sendPayoutNotification = async (req, res) => {
  try {
    const { type } = req.body; // 'approval', 'payment', 'rejection', 'reminder'
    const payoutId = req.params.id;

    const payoutRequest = await PayoutRequest.findById(payoutId)
      .populate('agentId', 'name email phone');

    if (!payoutRequest) {
      return res.status(404).json({
        success: false,
        message: 'Payout request not found'
      });
    }

    // Here you would implement your email/SMS notification service
    // For now, we'll just log the notification
    console.log(`Sending ${type} notification for payout ${payoutId} to agent ${payoutRequest.agentId.email}`);

    // You can integrate with your email service here
    // await sendPayoutNotificationEmail(payoutRequest.agentId.email, type, payoutRequest);

    res.json({
      success: true,
      message: `${type} notification sent successfully`
    });
  } catch (error) {
    console.error('Send payout notification error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Export payout data to CSV
// @route   GET /api/commissions/admin/payout-requests/export
// @access  Private/Admin
exports.exportPayoutData = async (req, res) => {
  try {
    const { status, agentId, method, startDate, endDate } = req.query;
    
    // Build query
    const query = {};
    if (status) query.status = status;
    if (agentId) query.agentId = agentId;
    if (method) query.method = method;
    
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const payouts = await PayoutRequest.find(query)
      .populate('agentId', 'name email phone')
      .populate('processedBy', 'name email')
      .sort({ createdAt: -1 });

    // Convert to CSV format
    const csvHeader = 'ID,Agent Name,Agent Email,Amount,Method,Account Details,Status,Requested Date,Processed Date,Processed By,Notes\n';
    
    const csvRows = payouts.map(payout => {
      return [
        payout._id,
        payout.agentId.name,
        payout.agentId.email,
        payout.amount,
        payout.method,
        payout.accountDetails,
        payout.status,
        new Date(payout.requestedAt).toISOString().split('T')[0],
        payout.processedAt ? new Date(payout.processedAt).toISOString().split('T')[0] : '',
        payout.processedBy ? payout.processedBy.name : '',
        payout.notes || ''
      ].map(field => `"${field}"`).join(',');
    }).join('\n');

    const csvContent = csvHeader + csvRows;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=payouts-export.csv');
    res.send(csvContent);
  } catch (error) {
    console.error('Export payout data error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};