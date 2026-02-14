const ChamaGroup = require('../models/ChamaGroup');
const ChamaContribution = require('../models/ChamaContribution');
const ChamaRedemption = require('../models/ChamaRedemption');
const User = require('../models/User');

/**
 * Check if a user is eligible to redeem from a chama group
 * @param {String} userId - User ID
 * @param {String} chamaGroupId - Chama Group ID
 * @returns {Object} { eligible: boolean, reason: string, group: object, userPosition: number }
 */
exports.checkChamaEligibility = async (userId, chamaGroupId) => {
  try {
    // Fetch chama group
    const chamaGroup = await ChamaGroup.findById(chamaGroupId).populate('members.userId');
    if (!chamaGroup) {
      return {
        eligible: false,
        reason: 'Chama group not found'
      };
    }

    // Check if group is active
    if (chamaGroup.status !== 'active') {
      return {
        eligible: false,
        reason: `Chama group is not active (status: ${chamaGroup.status})`
      };
    }

    // Check if user is a member
    const memberInfo = chamaGroup.members.find(m => m.userId._id.toString() === userId);
    if (!memberInfo) {
      return {
        eligible: false,
        reason: 'User is not a member of this chama group',
        group: chamaGroup
      };
    }

    // Check if it's user's turn (position matches currentTurnPosition)
    if (memberInfo.position !== chamaGroup.currentTurnPosition) {
      return {
        eligible: false,
        reason: `Not your turn. Current turn: Position ${chamaGroup.currentTurnPosition}, Your position: ${memberInfo.position}`,
        group: chamaGroup,
        userPosition: memberInfo.position
      };
    }

    // Check if user is a defaulter in this group
    const user = await User.findById(userId);
    if (user && user.chamaDefaulterGroups) {
      const isDefaulter = user.chamaDefaulterGroups.some(
        dg => dg.chamaGroupId.toString() === chamaGroupId && !dg.resolvedAt
      );
      if (isDefaulter) {
        return {
          eligible: false,
          reason: 'You are marked as a defaulter in this chama group and cannot redeem',
          group: chamaGroup,
          userPosition: memberInfo.position
        };
      }
    }

    // User is eligible
    return {
      eligible: true,
      reason: 'User is eligible to redeem',
      group: chamaGroup,
      userPosition: memberInfo.position,
      maxRedemptionAmount: chamaGroup.weeklyContribution
    };
  } catch (error) {
    return {
      eligible: false,
      reason: `Error checking eligibility: ${error.message}`
    };
  }
};

/**
 * Get user's current chama groups with details
 * @param {String} userId - User ID
 * @returns {Array} Array of chama groups with eligibility status
 */
exports.getUserChamaGroups = async (userId) => {
  try {
    const user = await User.findById(userId).populate('chamaGroups.chamaGroupId');
    if (!user || !user.chamaGroups || user.chamaGroups.length === 0) {
      return [];
    }

    const groupsWithStatus = await Promise.all(
      user.chamaGroups.map(async (cg) => {
        const group = await ChamaGroup.findById(cg.chamaGroupId._id)
          .populate('members.userId', 'name email phone')
          .populate('createdBy', 'name email');

        const eligibility = await this.checkChamaEligibility(userId, cg.chamaGroupId._id);

        // Get user's contribution status for current week
        const contribution = await ChamaContribution.findOne({
          userId,
          chamaGroupId: cg.chamaGroupId._id,
          weekNumber: group.currentWeek
        });

        return {
          ...group.toObject(),
          userPosition: cg.position,
          joinedAt: cg.joinedAt,
          eligibility: {
            isEligible: eligibility.eligible,
            reason: eligibility.reason
          },
          currentWeekContribution: contribution ? {
            amount: contribution.amount,
            paid: contribution.paid,
            paidAt: contribution.paidAt
          } : null
        };
      })
    );

    return groupsWithStatus;
  } catch (error) {
    throw new Error(`Error fetching user chama groups: ${error.message}`);
  }
};

/**
 * Mark a user as a defaulter
 * @param {String} userId - User ID
 * @param {String} chamaGroupId - Chama Group ID
 * @param {String} reason - Reason for defaulting
 */
exports.markAsDefaulter = async (userId, chamaGroupId, reason = 'missed_contribution') => {
  try {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    // Add to defaulter groups if not already there
    const existingDefaulter = user.chamaDefaulterGroups.find(
      dg => dg.chamaGroupId.toString() === chamaGroupId && !dg.resolvedAt
    );

    if (!existingDefaulter) {
      user.chamaDefaulterGroups.push({
        chamaGroupId,
        reason,
        markedAt: new Date()
      });
    }

    // Set general defaulter flag if they're a defaulter in any group
    user.isChamaDefaulter = user.chamaDefaulterGroups.some(dg => !dg.resolvedAt);

    await user.save();
    return user;
  } catch (error) {
    throw new Error(`Error marking defaulter: ${error.message}`);
  }
};

/**
 * Resolve defaulter status
 * @param {String} userId - User ID
 * @param {String} chamaGroupId - Chama Group ID
 */
exports.resolveDefaulter = async (userId, chamaGroupId) => {
  try {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    // Find and resolve the defaulter entry
    const defaulterGroup = user.chamaDefaulterGroups.find(
      dg => dg.chamaGroupId.toString() === chamaGroupId && !dg.resolvedAt
    );

    if (defaulterGroup) {
      defaulterGroup.resolvedAt = new Date();
    }

    // Update general defaulter flag
    user.isChamaDefaulter = user.chamaDefaulterGroups.some(dg => !dg.resolvedAt);

    await user.save();
    return user;
  } catch (error) {
    throw new Error(`Error resolving defaulter: ${error.message}`);
  }
};

/**
 * Get chama group statistics
 * @param {String} chamaGroupId - Chama Group ID
 * @returns {Object} Statistics for the group
 */
exports.getChamaGroupStats = async (chamaGroupId) => {
  try {
    const group = await ChamaGroup.findById(chamaGroupId).populate('members.userId');

    if (!group) {
      throw new Error('Chama group not found');
    }

    // Get contribution stats for current week
    const currentWeekContributions = await ChamaContribution.find({
      chamaGroupId,
      weekNumber: group.currentWeek
    });

    const totalContributed = currentWeekContributions
      .filter(c => c.paid)
      .reduce((sum, c) => sum + c.amount, 0);

    const expectedTotal = group.members.length * group.weeklyContribution;

    // Get redemption stats
    const totalRedemptions = await ChamaRedemption.aggregate([
      { $match: { chamaGroupId, status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$amountRedeemed' } } }
    ]);

    // Members with contribution status
    const membersWithStatus = await Promise.all(
      group.members.map(async (member) => {
        const contribution = currentWeekContributions.find(
          c => c.userId.toString() === member.userId._id.toString()
        );
        return {
          userId: member.userId._id,
          userName: member.userId.name,
          position: member.position,
          contributionStatus: contribution ? (contribution.paid ? 'paid' : 'pending') : 'not_recorded',
          amount: contribution ? contribution.amount : 0
        };
      })
    );

    return {
      groupId: group._id,
      groupName: group.name,
      status: group.status,
      currentWeek: group.currentWeek,
      currentTurnPosition: group.currentTurnPosition,
      memberCount: group.members.length,
      maxMembers: group.maxMembers,
      weeklyContribution: group.weeklyContribution,
      currentWeekStats: {
        totalContributed,
        expectedTotal,
        remainingAmount: Math.max(0, expectedTotal - totalContributed),
        contributionPercentage: Math.round((totalContributed / expectedTotal) * 100)
      },
      totalRedemptions: totalRedemptions.length > 0 ? totalRedemptions[0].total : 0,
      members: membersWithStatus
    };
  } catch (error) {
    throw new Error(`Error getting chama group stats: ${error.message}`);
  }
};

/**
 * Rotate turn to next member
 * @param {String} chamaGroupId - Chama Group ID
 * @returns {Object} Updated group
 */
exports.rotateTurn = async (chamaGroupId) => {
  try {
    const group = await ChamaGroup.findById(chamaGroupId);

    if (!group) {
      throw new Error('Chama group not found');
    }

    if (group.status !== 'active') {
      throw new Error('Cannot rotate turn for inactive group');
    }

    // Move to next position
    let nextPosition = group.currentTurnPosition + 1;
    
    // If we've completed all turns, increment week and reset position
    if (nextPosition > group.maxMembers) {
      nextPosition = 1;
      group.currentWeek = (group.currentWeek % 10) + 1; // Rotate weeks 1-10
    }

    group.currentTurnPosition = nextPosition;

    // Update contribution window
    group.contributionWindow = {
      startDate: new Date(),
      endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
    };

    await group.save();
    return group;
  } catch (error) {
    throw new Error(`Error rotating turn: ${error.message}`);
  }
};

/**
 * Create a chama redemption record
 * @param {Object} data - Redemption data
 * @returns {Object} Created redemption record
 */
exports.createChamaRedemption = async (data) => {
  try {
    const redemption = new ChamaRedemption({
      userId: data.userId,
      chamaGroupId: data.chamaGroupId,
      orderId: data.orderId,
      weekNumber: data.weekNumber,
      amountRedeemed: data.amountRedeemed,
      amountOutsideChama: data.amountOutsideChama || 0,
      status: 'completed',
      notes: data.notes || ''
    });

    await redemption.save();
    return redemption;
  } catch (error) {
    throw new Error(`Error creating chama redemption: ${error.message}`);
  }
};

/**
 * Get member redemption history
 * @param {String} userId - User ID
 * @param {String} chamaGroupId - Chama Group ID
 * @returns {Array} Array of redemption records
 */
exports.getMemberRedemptionHistory = async (userId, chamaGroupId) => {
  try {
    const redemptions = await ChamaRedemption.find({
      userId,
      chamaGroupId
    }).populate('orderId', 'totalPrice createdAt').sort({ createdAt: -1 });

    return redemptions;
  } catch (error) {
    throw new Error(`Error fetching redemption history: ${error.message}`);
  }
};
