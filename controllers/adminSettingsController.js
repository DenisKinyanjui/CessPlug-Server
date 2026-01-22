// controllers/adminSettingsController.js
const PayoutSettings = require('../models/PayoutSettings'); // You'll need to create this model
const PayoutRequest = require('../models/PayoutRequest');

// @desc    Get payout settings
// @route   GET /api/admin/payout-settings
// @access  Private/Admin
exports.getPayoutSettings = async (req, res) => {
  try {
    const settings = await PayoutSettings.getCurrentSettings();
    
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
    const updateData = req.body;
    const adminUserId = req.user.id;
    
    let settings = await PayoutSettings.findOne({});
    
    if (!settings) {
      // Create new settings if none exist
      updateData.lastModifiedBy = adminUserId;
      settings = await PayoutSettings.create(updateData);
    } else {
      // Store the changes for audit trail
      const oldValues = settings.toObject();
      const changes = {};
      
      // Track what changed
      Object.keys(updateData).forEach(key => {
        if (JSON.stringify(oldValues[key]) !== JSON.stringify(updateData[key])) {
          changes[key] = {
            from: oldValues[key],
            to: updateData[key]
          };
        }
      });
      
      // Update settings
      Object.assign(settings, updateData);
      settings.lastModifiedBy = adminUserId;
      
      // Add to modification history
      settings.modificationHistory.push({
        modifiedBy: adminUserId,
        modifiedAt: new Date(),
        changes: changes,
        reason: updateData.modificationReason || 'Settings update'
      });
      
      await settings.save();
    }

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
    const adminUserId = req.user.id;
    
    let settings = await PayoutSettings.findOne({});
    
    if (!settings) {
      settings = await PayoutSettings.create({
        globalPayoutHold: isHeld,
        holdReason: reason || '',
        lastModifiedBy: adminUserId,
        modificationHistory: [{
          modifiedBy: adminUserId,
          modifiedAt: new Date(),
          changes: { globalPayoutHold: { from: false, to: isHeld } },
          reason: reason || `Global payout hold ${isHeld ? 'enabled' : 'disabled'}`
        }]
      });
    } else {
      const oldHoldStatus = settings.globalPayoutHold;
      
      settings.globalPayoutHold = isHeld;
      settings.holdReason = reason || '';
      settings.lastModifiedBy = adminUserId;
      
      // Add to modification history
      settings.modificationHistory.push({
        modifiedBy: adminUserId,
        modifiedAt: new Date(),
        changes: { 
          globalPayoutHold: { from: oldHoldStatus, to: isHeld },
          holdReason: { from: settings.holdReason, to: reason || '' }
        },
        reason: reason || `Global payout hold ${isHeld ? 'enabled' : 'disabled'}`
      });
      
      await settings.save();
    }

    const action = isHeld ? 'enabled' : 'disabled';
    
    res.json({
      success: true,
      message: `Global payout hold ${action} successfully`,
      data: settings
    });
  } catch (error) {
    console.error('Set global payout hold error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Check payout window status
// @route   GET /api/admin/payout-settings/window-status
// @access  Private/Admin
exports.checkPayoutWindow = async (req, res) => {
  try {
    const settings = await PayoutSettings.getCurrentSettings();
    const payoutStatus = settings.arePayoutsAllowed();
    const currentTime = new Date();
    
    let nextPayoutWindow = null;
    
    // Calculate next payout window if payouts are currently not allowed due to scheduling
    if (!payoutStatus.allowed && settings.payoutSchedule.enabled && !settings.globalPayoutHold) {
      const nextWindow = new Date();
      const currentDay = nextWindow.getDay();
      const daysUntilNext = (settings.payoutSchedule.dayOfWeek - currentDay + 7) % 7;
      
      const [startHour, startMinute] = settings.payoutSchedule.startTime.split(':').map(Number);
      const currentHour = currentTime.getHours();
      const currentMinute = currentTime.getMinutes();
      const currentTimeMinutes = currentHour * 60 + currentMinute;
      const startTimeMinutes = startHour * 60 + startMinute;
      
      if (daysUntilNext === 0 && currentTimeMinutes < startTimeMinutes) {
        // Same day but before start time
        nextWindow.setHours(startHour, startMinute, 0, 0);
      } else {
        // Next scheduled day
        nextWindow.setDate(nextWindow.getDate() + (daysUntilNext || 7));
        nextWindow.setHours(startHour, startMinute, 0, 0);
      }
      
      nextPayoutWindow = nextWindow.toISOString();
    }

    res.json({
      success: true,
      data: {
        isPayoutWindowOpen: payoutStatus.allowed,
        reason: payoutStatus.reason,
        nextPayoutWindow,
        currentTime: currentTime.toISOString(),
        payoutSchedule: settings.payoutSchedule,
        globalPayoutHold: settings.globalPayoutHold,
        holdReason: settings.holdReason,
        formattedSchedule: settings.formattedSchedule
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

// @desc    Set agent-specific payout hold
// @route   PUT /api/admin/payout-settings/agents/:agentId/payout-hold
// @access  Private/Admin
exports.setAgentPayoutHold = async (req, res) => {
  try {
    const { agentId } = req.params;
    const { isHeld, reason } = req.body;
    
    const User = require('../models/User');
    const agent = await User.findById(agentId);
    
    if (!agent || agent.role !== 'agent') {
      return res.status(404).json({
        success: false,
        message: 'Agent not found'
      });
    }
    
    agent.payoutHold = isHeld;
    if (reason) {
      agent.payoutHoldReason = reason;
    }
    await agent.save();
    
    const action = isHeld ? 'enabled' : 'disabled';
    
    res.json({
      success: true,
      message: `Payout hold ${action} for agent ${agent.name}`,
      data: {
        agentId: agent._id,
        agentName: agent.name,
        payoutHold: agent.payoutHold,
        payoutHoldReason: agent.payoutHoldReason
      }
    });
  } catch (error) {
    console.error('Set agent payout hold error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get agent payout history
// @route   GET /api/admin/payout-settings/agents/:agentId/payout-history
// @access  Private/Admin
exports.getAgentPayoutHistory = async (req, res) => {
  try {
    const { agentId } = req.params;
    const { page = 1, limit = 10 } = req.query;
    
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    
    const payoutRequests = await PayoutRequest.find({ agentId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .populate('agentId', 'name email phone')
      .populate('processedBy', 'name email');
    
    const total = await PayoutRequest.countDocuments({ agentId });
    
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
    console.error('Get agent payout history error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Validate withdrawal request
// @route   POST /api/admin/payout-settings/validate-withdrawal
// @access  Private/Agent/Admin
exports.validateWithdrawalRequest = async (req, res) => {
  try {
    const { amount, agentId } = req.body;
    const settings = await PayoutSettings.getCurrentSettings();
    
    const errors = [];
    const warnings = [];

    // Check minimum amount
    if (amount < settings.minWithdrawalAmount) {
      errors.push(`Minimum withdrawal amount is KSh ${settings.minWithdrawalAmount.toLocaleString()}`);
    }

    // Check maximum amount
    if (amount > settings.maxWithdrawalAmount) {
      errors.push(`Maximum withdrawal amount is KSh ${settings.maxWithdrawalAmount.toLocaleString()}`);
    }

    // Check global hold
    if (settings.globalPayoutHold) {
      errors.push('Payouts are currently on hold');
    }

    // Check if amount requires manager approval
    if (settings.requireManagerApproval && amount > settings.autoApprovalThreshold) {
      warnings.push(`This amount requires manager approval (above KSh ${settings.autoApprovalThreshold.toLocaleString()})`);
    }

    res.json({
      success: true,
      data: {
        isValid: errors.length === 0,
        errors,
        warnings
      }
    });
  } catch (error) {
    console.error('Validate withdrawal request error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};