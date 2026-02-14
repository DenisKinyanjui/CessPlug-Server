const ChamaGroup = require('../models/ChamaGroup');
const ChamaContribution = require('../models/ChamaContribution');
const User = require('../models/User');
const chamaService = require('../services/chamaService');

// ============ ADMIN ENDPOINTS ============

/**
 * @desc    Create a new chama group
 * @route   POST /api/admin/chamas
 * @access  Private/Admin
 */
exports.createChamaGroup = async (req, res) => {
  try {
    const { name, description, weeklyContribution = 500, maxMembers = 10, notes } = req.body;

    // Validation
    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Chama group name is required'
      });
    }

    if (maxMembers < 2 || maxMembers > 10) {
      return res.status(400).json({
        success: false,
        message: 'Maximum members must be between 2 and 10'
      });
    }

    if (weeklyContribution < 100) {
      return res.status(400).json({
        success: false,
        message: 'Weekly contribution must be at least 100'
      });
    }

    // Check if name already exists
    const existingGroup = await ChamaGroup.findOne({ name });
    if (existingGroup) {
      return res.status(400).json({
        success: false,
        message: 'A chama group with this name already exists'
      });
    }

    const chamaGroup = new ChamaGroup({
      name,
      description,
      weeklyContribution,
      maxMembers,
      notes,
      createdBy: req.user._id,
      status: 'draft'
    });

    await chamaGroup.save();

    res.status(201).json({
      success: true,
      message: 'Chama group created successfully',
      data: chamaGroup
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * @desc    Get all chama groups (admin)
 * @route   GET /api/admin/chamas
 * @access  Private/Admin
 */
exports.getAllChamaGroups = async (req, res) => {
  try {
    const { status, search } = req.query;

    let filter = {};
    if (status) {
      filter.status = status;
    }
    if (search) {
      filter.name = { $regex: search, $options: 'i' };
    }

    const chamaGroups = await ChamaGroup.find(filter)
      .populate('createdBy', 'name email')
      .populate('members.userId', 'name email phone')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: chamaGroups
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * @desc    Get a single chama group
 * @route   GET /api/admin/chamas/:id
 * @access  Private/Admin
 */
exports.getChamaGroup = async (req, res) => {
  try {
    const chamaGroup = await ChamaGroup.findById(req.params.id)
      .populate('createdBy', 'name email')
      .populate('members.userId', 'name email phone');

    if (!chamaGroup) {
      return res.status(404).json({
        success: false,
        message: 'Chama group not found'
      });
    }

    // Get stats
    const stats = await chamaService.getChamaGroupStats(req.params.id);

    res.json({
      success: true,
      data: { ...chamaGroup.toObject(), stats }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * @desc    Add member to chama group (before activation)
 * @route   POST /api/admin/chamas/:id/add-member
 * @access  Private/Admin
 */
exports.addMemberToChamaGroup = async (req, res) => {
  try {
    const { userId, position } = req.body;

    if (!userId || !position) {
      return res.status(400).json({
        success: false,
        message: 'User ID and position are required'
      });
    }

    const chamaGroup = await ChamaGroup.findById(req.params.id);
    if (!chamaGroup) {
      return res.status(404).json({
        success: false,
        message: 'Chama group not found'
      });
    }

    // Cannot add members to active group
    if (chamaGroup.status === 'active') {
      return res.status(400).json({
        success: false,
        message: 'Cannot add members to an active chama group'
      });
    }

    // Check if group is full
    if (chamaGroup.members.length >= chamaGroup.maxMembers) {
      return res.status(400).json({
        success: false,
        message: `Chama group is full (max ${chamaGroup.maxMembers} members)`
      });
    }

    // Check if user already exists in group
    const memberExists = chamaGroup.members.some(m => m.userId.toString() === userId);
    if (memberExists) {
      return res.status(400).json({
        success: false,
        message: 'User is already a member of this group'
      });
    }

    // Check if position is already taken
    const positionTaken = chamaGroup.members.some(m => m.position === position);
    if (positionTaken) {
      return res.status(400).json({
        success: false,
        message: `Position ${position} is already taken`
      });
    }

    // Verify user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Add member to group
    chamaGroup.members.push({
      userId,
      position,
      joinedAt: new Date()
    });

    await chamaGroup.save();

    // Add group to user's chama groups
    if (!user.chamaGroups) {
      user.chamaGroups = [];
    }
    
    const groupExists = user.chamaGroups.some(g => g.chamaGroupId.toString() === chamaGroup._id.toString());
    if (!groupExists) {
      user.chamaGroups.push({
        chamaGroupId: chamaGroup._id,
        position,
        joinedAt: new Date()
      });
    }

    await user.save();

    res.json({
      success: true,
      message: 'Member added successfully',
      data: chamaGroup
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * @desc    Remove member from chama group (before activation)
 * @route   DELETE /api/admin/chamas/:id/members/:userId
 * @access  Private/Admin
 */
exports.removeMemberFromChamaGroup = async (req, res) => {
  try {
    const { id, userId } = req.params;

    const chamaGroup = await ChamaGroup.findById(id);
    if (!chamaGroup) {
      return res.status(404).json({
        success: false,
        message: 'Chama group not found'
      });
    }

    // Cannot remove members from active group
    if (chamaGroup.status === 'active') {
      return res.status(400).json({
        success: false,
        message: 'Cannot remove members from an active chama group'
      });
    }

    // Remove member
    chamaGroup.members = chamaGroup.members.filter(m => m.userId.toString() !== userId);
    await chamaGroup.save();

    // Remove group from user's chama groups
    const user = await User.findById(userId);
    if (user && user.chamaGroups) {
      user.chamaGroups = user.chamaGroups.filter(
        g => g.chamaGroupId.toString() !== id
      );
      await user.save();
    }

    res.json({
      success: true,
      message: 'Member removed successfully',
      data: chamaGroup
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * @desc    Activate a chama group (lock members and turn order)
 * @route   POST /api/admin/chamas/:id/activate
 * @access  Private/Admin
 */
exports.activateChamaGroup = async (req, res) => {
  try {
    const chamaGroup = await ChamaGroup.findById(req.params.id);
    if (!chamaGroup) {
      return res.status(404).json({
        success: false,
        message: 'Chama group not found'
      });
    }

    if (chamaGroup.status === 'active') {
      return res.status(400).json({
        success: false,
        message: 'Chama group is already active'
      });
    }

    // Must have at least 2 members
    if (chamaGroup.members.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Group must have at least 2 members before activation'
      });
    }

    // Set to active
    chamaGroup.status = 'active';
    chamaGroup.activatedAt = new Date();
    chamaGroup.currentTurnPosition = 1;
    chamaGroup.currentWeek = 1;
    chamaGroup.contributionWindow = {
      startDate: new Date(),
      endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    };

    await chamaGroup.save();

    res.json({
      success: true,
      message: 'Chama group activated successfully',
      data: chamaGroup
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * @desc    Pause a chama group
 * @route   POST /api/admin/chamas/:id/pause
 * @access  Private/Admin
 */
exports.pauseChamaGroup = async (req, res) => {
  try {
    const chamaGroup = await ChamaGroup.findById(req.params.id);
    if (!chamaGroup) {
      return res.status(404).json({
        success: false,
        message: 'Chama group not found'
      });
    }

    if (chamaGroup.status === 'paused') {
      return res.status(400).json({
        success: false,
        message: 'Chama group is already paused'
      });
    }

    // Set to paused
    chamaGroup.status = 'paused';
    chamaGroup.pausedAt = new Date();

    await chamaGroup.save();

    res.json({
      success: true,
      message: 'Chama group paused successfully',
      data: chamaGroup
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * @desc    Mark a contribution as paid
 * @route   POST /api/admin/chamas/:id/mark-contribution
 * @access  Private/Admin
 */
exports.markContributionPaid = async (req, res) => {
  try {
    const { userId, weekNumber, amount, paymentMethod, transactionId } = req.body;

    if (!userId || !weekNumber || !amount || !paymentMethod) {
      return res.status(400).json({
        success: false,
        message: 'User ID, week number, amount, and payment method are required'
      });
    }

    const chamaGroup = await ChamaGroup.findById(req.params.id);
    if (!chamaGroup) {
      return res.status(404).json({
        success: false,
        message: 'Chama group not found'
      });
    }

    // Try to find existing contribution
    let contribution = await ChamaContribution.findOne({
      userId,
      chamaGroupId: req.params.id,
      weekNumber
    });

    if (!contribution) {
      contribution = new ChamaContribution({
        userId,
        chamaGroupId: req.params.id,
        weekNumber,
        amount,
        paymentMethod,
        transactionId,
        paid: true,
        paidAt: new Date(),
        recordedBy: req.user._id
      });
    } else {
      contribution.amount = amount;
      contribution.paymentMethod = paymentMethod;
      contribution.transactionId = transactionId;
      contribution.paid = true;
      contribution.paidAt = new Date();
      contribution.recordedBy = req.user._id;
    }

    await contribution.save();

    // If this was the defaulter's missing contribution, resolve defaulter status
    const user = await User.findById(userId);
    if (user && user.chamaDefaulterGroups) {
      const defaulterGroup = user.chamaDefaulterGroups.find(
        dg => dg.chamaGroupId.toString() === req.params.id && !dg.resolvedAt
      );
      if (defaulterGroup) {
        await chamaService.resolveDefaulter(userId, req.params.id);
      }
    }

    res.json({
      success: true,
      message: 'Contribution marked as paid',
      data: contribution
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * @desc    Rotate to next turn
 * @route   POST /api/admin/chamas/:id/next-turn
 * @access  Private/Admin
 */
exports.rotateToNextTurn = async (req, res) => {
  try {
    const group = await chamaService.rotateTurn(req.params.id);

    res.json({
      success: true,
      message: 'Rotated to next turn',
      data: group
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ============ USER ENDPOINTS ============

/**
 * @desc    Get user's chama groups
 * @route   GET /api/chamas/my
 * @access  Private
 */
exports.getUserChamaGroups = async (req, res) => {
  try {
    const groups = await chamaService.getUserChamaGroups(req.user._id);

    res.json({
      success: true,
      data: groups
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * @desc    Get chama group details
 * @route   GET /api/chamas/:id
 * @access  Private
 */
exports.getChamaGroupDetails = async (req, res) => {
  try {
    const chamaGroup = await ChamaGroup.findById(req.params.id)
      .populate('members.userId', 'name email phone')
      .populate('createdBy', 'name email');

    if (!chamaGroup) {
      return res.status(404).json({
        success: false,
        message: 'Chama group not found'
      });
    }

    // Verify user is a member
    const isMember = chamaGroup.members.some(m => m.userId._id.toString() === req.user._id.toString());
    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: 'You are not a member of this chama group'
      });
    }

    // Get user's eligibility
    const eligibility = await chamaService.checkChamaEligibility(req.user._id, req.params.id);

    res.json({
      success: true,
      data: {
        ...chamaGroup.toObject(),
        userEligibility: eligibility
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * @desc    Check eligibility to redeem from chama
 * @route   GET /api/chamas/:id/eligibility
 * @access  Private
 */
exports.checkEligibility = async (req, res) => {
  try {
    const eligibility = await chamaService.checkChamaEligibility(req.user._id, req.params.id);

    res.json({
      success: true,
      data: eligibility
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * @desc    Get user's redemption history
 * @route   GET /api/chamas/:id/redemptions
 * @access  Private
 */
exports.getRedemptionHistory = async (req, res) => {
  try {
    const redemptions = await chamaService.getMemberRedemptionHistory(
      req.user._id,
      req.params.id
    );

    res.json({
      success: true,
      data: redemptions
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * @desc    Get overall chama statistics (admin)
 * @route   GET /api/admin/chamas/stats
 * @access  Private/Admin
 */
exports.getChamaStats = async (req, res) => {
  try {
    // Total chama groups
    const totalGroups = await ChamaGroup.countDocuments();

    // Active chama groups
    const activeGroups = await ChamaGroup.countDocuments({ status: 'active' });

    // Total members across all chamas
    const groupsWithMembers = await ChamaGroup.aggregate([
      {
        $group: {
          _id: null,
          totalMembers: { $sum: { $size: '$members' } }
        }
      }
    ]);
    const totalMembers = groupsWithMembers[0]?.totalMembers || 0;

    // Total contributions
    const contributionStats = await ChamaContribution.aggregate([
      {
        $group: {
          _id: '$status',
          total: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      }
    ]);

    let totalContributions = 0;
    let paidContributions = 0;
    let pendingContributions = 0;

    contributionStats.forEach(stat => {
      if (stat._id === 'paid') {
        paidContributions = stat.total;
      } else if (stat._id === 'pending') {
        pendingContributions = stat.total;
      }
      totalContributions += stat.total;
    });

    res.json({
      success: true,
      data: {
        totalGroups,
        activeGroups,
        totalMembers,
        totalContributions,
        paidContributions,
        pendingContributions,
        inactiveGroups: totalGroups - activeGroups
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
