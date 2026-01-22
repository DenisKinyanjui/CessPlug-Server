// controllers/payoutSettingsController.js
const PayoutSettings = require('../models/PayoutSettings');
const User = require('../models/User');

// @desc    Get payout settings
// @route   GET /api/admin/payout-settings
// @access  Private/Admin
exports.getPayoutSettings = async (req, res) => {
  try {
    let settings = await PayoutSettings.findOne();
    
    // Create default settings if none exist
    if (!settings) {
      settings = await PayoutSettings.create({
        minWithdrawalAmount: 100,
        maxWithdrawalAmount: 50000,
        payoutSchedule: {
          enabled: false,
          dayOfWeek: 5, // Friday
          startTime: '07:00',
          endTime: '23:59'
        },
        globalPayoutHold: false,
        processingFee: 0,
        autoApprovalThreshold: 1000,
        requireManagerApproval: false
      });
    }

    res.json({
      success: true,
      data: settings
    });
  } catch (error) {
    console.error('Get payout settings error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Update payout settings
// @route   PUT /api/admin/payout-settings
// @access  Private/Admin
exports.updatePayoutSettings = async (req, res) => {
  try {
    const {
      minWithdrawalAmount,
      maxWithdrawalAmount,
      payoutSchedule,
      globalPayoutHold,
      processingFee,
      autoApprovalThreshold,
      requireManagerApproval
    } = req.body;

    // Validation
    if (minWithdrawalAmount && minWithdrawalAmount < 1) {
      return res.status(400).json({
        success: false,
        message: 'Minimum withdrawal amount must be at least 1'
      });
    }

    if (maxWithdrawalAmount && maxWithdrawalAmount < minWithdrawalAmount) {
      return res.status(400).json({
        success: false,
        message: 'Maximum withdrawal amount must be greater than minimum'
      });
    }

    if (processingFee && processingFee < 0) {
      return res.status(400).json({
        success: false,
        message: 'Processing fee cannot be negative'
      });
    }

    if (autoApprovalThreshold && autoApprovalThreshold < 0) {
      return res.status(400).json({
        success: false,
        message: 'Auto approval threshold cannot be negative'
      });
    }

    // Find existing settings or create new
    let settings = await PayoutSettings.findOne();
    
    if (!settings) {
      settings = new PayoutSettings();
    }

    // Update fields
    if (minWithdrawalAmount !== undefined) settings.minWithdrawalAmount = minWithdrawalAmount;
    if (maxWithdrawalAmount !== undefined) settings.maxWithdrawalAmount = maxWithdrawalAmount;
    if (payoutSchedule !== undefined) settings.payoutSchedule = payoutSchedule;
    if (globalPayoutHold !== undefined) settings.globalPayoutHold = globalPayoutHold;
    if (processingFee !== undefined) settings.processingFee = processingFee;
    if (autoApprovalThreshold !== undefined) settings.autoApprovalThreshold = autoApprovalThreshold;
    if (requireManagerApproval !== undefined) settings.requireManagerApproval = requireManagerApproval;

    await settings.save();

    res.json({
      success: true,
      message: 'Payout settings updated successfully',
      data: settings
    });
  } catch (error) {
    console.error('Update payout settings error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Set global payout hold
// @route   PUT /api/admin/payout-settings/global-hold
// @access  Private/Admin
exports.setGlobalPayoutHold = async (req, res) => {
  try {
    const { isHeld, reason } = req.body;

    let settings = await PayoutSettings.findOne();
    
    if (!settings) {
      settings = new PayoutSettings();
    }

    settings.globalPayoutHold = isHeld;
    if (reason) {
      settings.holdReason = reason;
    }

    await settings.save();

    res.json({
      success: true,
      message: `Global payout hold ${isHeld ? 'enabled' : 'disabled'} successfully`
    });
  } catch (error) {
    console.error('Set global payout hold error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Set agent-specific payout hold
// @route   PUT /api/admin/agents/:agentId/payout-hold
// @access  Private/Admin
exports.setAgentPayoutHold = async (req, res) => {
  try {
    const { agentId } = req.params;
    const { isHeld, reason } = req.body;

    const agent = await User.findOne({ _id: agentId, role: 'agent' });
    
    if (!agent) {
      return res.status(404).json({
        success: false,
        message: 'Agent not found'
      });
    }

    agent.payoutHold = {
      isHeld,
      reason: reason || '',
      setBy: req.user.id,
      setAt: new Date()
    };

    await agent.save();

    res.json({
      success: true,
      message: `Agent payout hold ${isHeld ? 'enabled' : 'disabled'} successfully`
    });
  } catch (error) {
    console.error('Set agent payout hold error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Check payout window status
// @route   GET /api/admin/payout-settings/window-status
// @access  Private/Admin or Agent
exports.checkPayoutWindow = async (req, res) => {
  try {
    const settings = await PayoutSettings.findOne();
    
    if (!settings || !settings.payoutSchedule.enabled) {
      return res.json({
        success: true,
        data: {
          isPayoutWindowOpen: true,
          message: 'Payout scheduling is disabled - payouts allowed anytime',
          currentTime: new Date().toISOString(),
          payoutSchedule: settings?.payoutSchedule || null
        }
      });
    }

    const now = new Date();
    const currentDay = now.getDay(); // 0 = Sunday, 6 = Saturday
    const currentTime = now.toTimeString().substr(0, 5); // HH:MM format

    const isCorrectDay = currentDay === settings.payoutSchedule.dayOfWeek;
    const isWithinTimeRange = currentTime >= settings.payoutSchedule.startTime && 
                             currentTime <= settings.payoutSchedule.endTime;

    const isPayoutWindowOpen = isCorrectDay && isWithinTimeRange && !settings.globalPayoutHold;

    // Calculate next payout window
    let nextPayoutWindow = null;
    if (!isPayoutWindowOpen) {
      const nextDate = new Date();
      const daysUntilNext = (settings.payoutSchedule.dayOfWeek - currentDay + 7) % 7;
      
      if (daysUntilNext === 0 && currentTime > settings.payoutSchedule.endTime) {
        // If today is the payout day but time has passed, next window is next week
        nextDate.setDate(nextDate.getDate() + 7);
      } else {
        nextDate.setDate(nextDate.getDate() + daysUntilNext);
      }
      
      const [hours, minutes] = settings.payoutSchedule.startTime.split(':');
      nextDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);
      
      nextPayoutWindow = nextDate.toISOString();
    }

    res.json({
      success: true,
      data: {
        isPayoutWindowOpen,
        nextPayoutWindow,
        currentTime: now.toISOString(),
        payoutSchedule: settings.payoutSchedule,
        globalHold: settings.globalPayoutHold
      }
    });
  } catch (error) {
    console.error('Check payout window error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get agent payout history
// @route   GET /api/admin/agents/:agentId/payout-history
// @access  Private/Admin
exports.getAgentPayoutHistory = async (req, res) => {
  try {
    const { agentId } = req.params;
    const { page = 1, limit = 10 } = req.query;
    
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const agent = await User.findOne({ _id: agentId, role: 'agent' });
    
    if (!agent) {
      return res.status(404).json({
        success: false,
        message: 'Agent not found'
      });
    }

    const PayoutRequest = require('../models/PayoutRequest');
    
    const payouts = await PayoutRequest.find({ agentId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .populate('processedBy', 'name email');

    const total = await PayoutRequest.countDocuments({ agentId });

    res.json({
      success: true,
      data: {
        agent: {
          name: agent.name,
          email: agent.email,
          phone: agent.phone
        },
        payoutRequests: payouts,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum)
        }
      }
    });
  } catch (error) {
    console.error('Get agent payout history error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Validate withdrawal request against settings
// @route   POST /api/admin/payout-settings/validate-withdrawal
// @access  Private
exports.validateWithdrawalRequest = async (req, res) => {
  try {
    const { amount, agentId } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid withdrawal amount'
      });
    }

    if (!agentId) {
      return res.status(400).json({
        success: false,
        message: 'Agent ID is required'
      });
    }

    const settings = await PayoutSettings.findOne();
    const agent = await User.findById(agentId);

    if (!agent) {
      return res.status(404).json({
        success: false,
        message: 'Agent not found'
      });
    }

    const validationResult = {
      isValid: true,
      errors: [],
      warnings: []
    };

    // Check minimum amount
    if (settings && amount < settings.minWithdrawalAmount) {
      validationResult.isValid = false;
      validationResult.errors.push(`Minimum withdrawal amount is KSh ${settings.minWithdrawalAmount.toLocaleString()}`);
    }

    // Check maximum amount
    if (settings && amount > settings.maxWithdrawalAmount) {
      validationResult.isValid = false;
      validationResult.errors.push(`Maximum withdrawal amount is KSh ${settings.maxWithdrawalAmount.toLocaleString()}`);
    }

    // Check global hold
    if (settings && settings.globalPayoutHold) {
      validationResult.isValid = false;
      validationResult.errors.push('Payouts are currently on hold globally');
    }

    // Check agent-specific hold
    if (agent.payoutHold && agent.payoutHold.isHeld) {
      validationResult.isValid = false;
      validationResult.errors.push(`Your payouts are on hold: ${agent.payoutHold.reason || 'Contact support'}`);
    }

    // Check payout window - FIXED: Direct calculation instead of calling external function
    if (settings && settings.payoutSchedule && settings.payoutSchedule.enabled) {
      try {
        const now = new Date();
        const currentDay = now.getDay(); // 0 = Sunday, 6 = Saturday
        const currentTime = now.toTimeString().substr(0, 5); // HH:MM format

        const isCorrectDay = currentDay === settings.payoutSchedule.dayOfWeek;
        const isWithinTimeRange = currentTime >= settings.payoutSchedule.startTime && 
                                 currentTime <= settings.payoutSchedule.endTime;

        const isPayoutWindowOpen = isCorrectDay && isWithinTimeRange && !settings.globalPayoutHold;

        if (!isPayoutWindowOpen) {
          // Calculate next payout window
          const nextDate = new Date();
          const daysUntilNext = (settings.payoutSchedule.dayOfWeek - currentDay + 7) % 7;
          
          if (daysUntilNext === 0 && currentTime > settings.payoutSchedule.endTime) {
            nextDate.setDate(nextDate.getDate() + 7);
          } else {
            nextDate.setDate(nextDate.getDate() + daysUntilNext);
          }
          
          const [hours, minutes] = settings.payoutSchedule.startTime.split(':');
          nextDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);

          validationResult.isValid = false;
          validationResult.errors.push('Payout requests are only allowed during scheduled windows');
          validationResult.warnings.push(`Next payout window: ${nextDate.toLocaleString()}`);
        }
      } catch (windowError) {
        console.error('Error checking payout window:', windowError);
        // Continue without failing the entire validation
      }
    }

    // Check available balance
    try {
      const Commission = require('../models/Commission');
      const pendingCommissions = await Commission.find({
        agentId,
        status: 'pending'
      });

      const availableBalance = pendingCommissions.reduce((sum, comm) => sum + comm.amount, 0);

      if (amount > availableBalance) {
        validationResult.isValid = false;
        validationResult.errors.push(`Insufficient balance. Available: KSh ${availableBalance.toLocaleString()}`);
      }
    } catch (balanceError) {
      console.error('Error checking balance:', balanceError);
      validationResult.warnings.push('Unable to verify balance');
    }

    // Check for existing pending payout requests
    try {
      const PayoutRequest = require('../models/PayoutRequest');
      const existingPayout = await PayoutRequest.findOne({
        agentId,
        status: { $in: ['pending', 'approved'] }
      });

      if (existingPayout) {
        validationResult.isValid = false;
        validationResult.errors.push('You already have a pending payout request');
      }
    } catch (payoutError) {
      console.error('Error checking existing payouts:', payoutError);
      validationResult.warnings.push('Unable to verify existing payout requests');
    }

    // Check if requires manager approval
    if (settings && settings.requireManagerApproval && amount > settings.autoApprovalThreshold) {
      validationResult.warnings.push(`This amount requires manager approval (above KSh ${settings.autoApprovalThreshold.toLocaleString()})`);
    }

    // Add processing fee warning
    if (settings && settings.processingFee > 0) {
      validationResult.warnings.push(`Processing fee of KSh ${settings.processingFee.toLocaleString()} will be deducted`);
    }

    // Return validation result
    res.json({
      success: true,
      data: validationResult
    });

  } catch (error) {
    console.error('Validate withdrawal request error:', error);
    
    // Only send error response if headers haven't been sent
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Validation service temporarily unavailable'
      });
    }
  }
};

// @desc    Get auto-approval analytics
// @route   GET /api/admin/payout-settings/auto-approval-stats
// @access  Private/Admin
exports.getAutoApprovalAnalytics = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    console.log('Getting auto-approval analytics:', { startDate, endDate });

    const PayoutRequest = require('../models/PayoutRequest');
    
    // Get basic statistics
    const matchCriteria = {};
    if (startDate || endDate) {
      matchCriteria.createdAt = {};
      if (startDate) matchCriteria.createdAt.$gte = new Date(startDate);
      if (endDate) matchCriteria.createdAt.$lte = new Date(endDate);
    }

    const totalRequests = await PayoutRequest.countDocuments(matchCriteria);
    const autoApprovedRequests = await PayoutRequest.countDocuments({
      ...matchCriteria,
      'metadata.autoApproved': true
    });
    const autoPaidRequests = await PayoutRequest.countDocuments({
      ...matchCriteria,
      'metadata.autoPaid': true
    });

    // Get current settings for context
    const settings = await PayoutSettings.findOne();
    
    // Calculate percentages
    const autoApprovalRate = totalRequests > 0 
      ? (autoApprovedRequests / totalRequests * 100).toFixed(2)
      : 0;
    
    const autoPaymentRate = totalRequests > 0 
      ? (autoPaidRequests / totalRequests * 100).toFixed(2)
      : 0;

    res.json({
      success: true,
      data: {
        summary: {
          totalRequests,
          autoApprovedCount: autoApprovedRequests,
          autoPaidCount: autoPaidRequests,
          autoApprovalRate: parseFloat(autoApprovalRate),
          autoPaymentRate: parseFloat(autoPaymentRate)
        },
        settings: {
          autoApprovalThreshold: settings?.autoApprovalThreshold || 0,
          requireManagerApproval: settings?.requireManagerApproval || false,
          maxWithdrawalAmount: settings?.maxWithdrawalAmount || 0,
          minWithdrawalAmount: settings?.minWithdrawalAmount || 0
        }
      }
    });
  } catch (error) {
    console.error('Get auto-approval analytics error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Update auto-approval settings
// @route   PUT /api/admin/payout-settings/auto-approval
// @access  Private/Admin
exports.updateAutoApprovalSettings = async (req, res) => {
  try {
    const { 
      autoApprovalThreshold, 
      requireManagerApproval 
    } = req.body;
    
    const adminUserId = req.user.id;
    
    let settings = await PayoutSettings.findOne();
    
    if (!settings) {
      return res.status(404).json({
        success: false,
        message: 'Payout settings not found. Please create settings first.'
      });
    }

    // Store original values for audit
    const originalValues = {
      autoApprovalThreshold: settings.autoApprovalThreshold,
      requireManagerApproval: settings.requireManagerApproval
    };

    // Update auto-approval specific settings
    if (autoApprovalThreshold !== undefined) {
      if (autoApprovalThreshold < 0) {
        return res.status(400).json({
          success: false,
          message: 'Auto-approval threshold cannot be negative'
        });
      }
      settings.autoApprovalThreshold = autoApprovalThreshold;
    }

    if (requireManagerApproval !== undefined) {
      settings.requireManagerApproval = requireManagerApproval;
    }

    settings.lastModifiedBy = adminUserId;
    
    // Add to modification history if it exists
    if (settings.modificationHistory) {
      settings.modificationHistory.push({
        modifiedBy: adminUserId,
        modifiedAt: new Date(),
        changes: {
          autoApprovalThreshold: {
            from: originalValues.autoApprovalThreshold,
            to: settings.autoApprovalThreshold
          },
          requireManagerApproval: {
            from: originalValues.requireManagerApproval,
            to: settings.requireManagerApproval
          }
        },
        reason: 'Auto-approval settings update'
      });
    }

    await settings.save();

    res.json({
      success: true,
      message: 'Auto-approval settings updated successfully',
      data: {
        autoApprovalThreshold: settings.autoApprovalThreshold,
        requireManagerApproval: settings.requireManagerApproval,
        effectivelyEnabled: !settings.requireManagerApproval && settings.autoApprovalThreshold > 0
      }
    });
  } catch (error) {
    console.error('Update auto-approval settings error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};