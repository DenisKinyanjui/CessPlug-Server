// middleware/payoutValidation.js - Fixed version

const PayoutSettings = require('../models/PayoutSettings');
const PayoutRequest = require('../models/PayoutRequest');
const Commission = require('../models/Commission');

// Middleware to validate payout requests against admin settings
exports.validatePayoutRequest = async (req, res, next) => {
  try {
    const { amount, method, accountDetails } = req.body;
    const agentId = req.user.id;

    console.log('Validating payout request:', { agentId, amount, method });

    // Get current payout settings
    const settings = await PayoutSettings.findOne();
    
    if (!settings) {
      console.log('No payout settings found, using defaults');
      // Allow if no settings exist (backward compatibility)
      return next();
    }

    const errors = [];
    const warnings = [];

    // 1. Check global payout hold
    if (settings.globalPayoutHold) {
      errors.push('Payouts are currently on hold globally. Please contact support.');
    }

    // 2. Check minimum amount
    if (amount < settings.minWithdrawalAmount) {
      errors.push(`Minimum withdrawal amount is KSh ${settings.minWithdrawalAmount.toLocaleString()}`);
    }

    // 3. Check maximum amount
    if (amount > settings.maxWithdrawalAmount) {
      errors.push(`Maximum withdrawal amount is KSh ${settings.maxWithdrawalAmount.toLocaleString()}`);
    }

    // 4. Check payout window if scheduled
    if (settings.payoutSchedule.enabled) {
      const now = new Date();
      const currentDay = now.getDay(); // 0 = Sunday, 6 = Saturday
      const currentTime = now.toTimeString().substr(0, 5); // HH:MM format

      const isCorrectDay = currentDay === settings.payoutSchedule.dayOfWeek;
      const isWithinTimeRange = currentTime >= settings.payoutSchedule.startTime && 
                               currentTime <= settings.payoutSchedule.endTime;

      if (!isCorrectDay || !isWithinTimeRange) {
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

        errors.push('Payout requests are only allowed during scheduled windows');
        warnings.push(`Next payout window: ${nextDate.toLocaleString()}`);
      }
    }

    // 5. Check agent's available balance
    const pendingCommissions = await Commission.find({
      agentId,
      status: 'pending'
    });

    const availableBalance = pendingCommissions.reduce((sum, comm) => sum + comm.amount, 0);

    if (amount > availableBalance) {
      errors.push(`Insufficient balance. Available: KSh ${availableBalance.toLocaleString()}`);
    }

    // 6. FIXED: Check for existing ACTIVE payout requests only (exclude rejected/cancelled)
    const existingPayout = await PayoutRequest.findOne({
      agentId,
      status: { $in: ['pending', 'approved', 'on_hold'] } // REMOVED 'rejected' from this list
    });

    if (existingPayout) {
      errors.push('You already have a pending payout request');
    }

    // 7. Enhanced auto-approval logic with detailed warnings
    const willAutoApprove = !settings.requireManagerApproval && amount <= settings.autoApprovalThreshold;
    const willRequireApproval = settings.requireManagerApproval && amount > settings.autoApprovalThreshold;
    
    if (willAutoApprove) {
      warnings.push(`This amount will be auto-approved and processed immediately (below KSh ${settings.autoApprovalThreshold.toLocaleString()} threshold)`);
      
      // Check if there's sufficient balance for immediate payment
      if (availableBalance >= amount) {
        warnings.push('Payment will be processed automatically upon approval');
      } else {
        warnings.push('Will be auto-approved but payment pending sufficient commission balance');
      }
    } else if (willRequireApproval) {
      warnings.push(`This amount requires manager approval (above KSh ${settings.autoApprovalThreshold.toLocaleString()} threshold)`);
    } else if (settings.requireManagerApproval) {
      warnings.push('All payouts require manager approval based on current settings');
    }

    // 8. Add processing fee warning
    if (settings.processingFee > 0) {
      warnings.push(`Processing fee of KSh ${settings.processingFee.toLocaleString()} will be deducted`);
    }

    // 9. Additional validation for auto-approval eligibility
    if (willAutoApprove) {
      // Check if agent has any restrictions that would prevent auto-approval
      const User = require('../models/User');
      const agent = await User.findById(agentId);
      
      if (agent && agent.payoutHold && agent.payoutHold.isHeld) {
        errors.push('Your account has a payout hold. Auto-approval is not available.');
      }

      // Check agent's recent payout history for rate limiting
      const recentPayouts = await PayoutRequest.find({
        agentId,
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Last 24 hours
      });

      const dailyPayoutCount = recentPayouts.length;
      const dailyPayoutAmount = recentPayouts.reduce((sum, payout) => sum + payout.amount, 0);

      // Check against admin settings for daily limits
      if (settings.maxPayoutsPerDay && dailyPayoutCount >= settings.maxPayoutsPerDay) {
        errors.push(`Daily payout limit reached (${settings.maxPayoutsPerDay} requests per day)`);
      }

      if (settings.maxPayoutAmountPerDay && dailyPayoutAmount + amount > settings.maxPayoutAmountPerDay) {
        errors.push(`Daily payout amount limit exceeded (KSh ${settings.maxPayoutAmountPerDay.toLocaleString()} per day)`);
      }
    }

    // If there are validation errors, return them
    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Payout request validation failed',
        errors,
        warnings
      });
    }

    // Attach validation results to request object for use in controller
    req.payoutValidation = {
      settings,
      warnings,
      availableBalance,
      willAutoApprove,
      willRequireApproval
    };

    console.log('Payout request validation passed:', { 
      warnings: warnings.length,
      willAutoApprove,
      amount,
      threshold: settings.autoApprovalThreshold 
    });
    
    next();
  } catch (error) {
    console.error('Payout validation middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Validation service temporarily unavailable'
    });
  }
};

// Middleware to validate payout settings access
exports.validatePayoutSettingsAccess = (req, res, next) => {
  // Allow both agents and admins to read payout settings
  if (req.user.role === 'admin' || req.user.role === 'agent') {
    return next();
  }

  return res.status(403).json({
    success: false,
    message: 'Access denied. Admin or agent role required.'
  });
};

// Middleware to validate window status access
exports.validateWindowStatusAccess = (req, res, next) => {
  // Allow both agents and admins to check window status
  if (req.user.role === 'admin' || req.user.role === 'agent') {
    return next();
  }

  return res.status(403).json({
    success: false,
    message: 'Access denied. Admin or agent role required.'
  });
};