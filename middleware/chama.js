const chamaService = require('../services/chamaService');

/**
 * Middleware to verify chama eligibility
 * Attaches chamaContext to request if user is eligible
 * Returns 403 if user is not eligible
 */
exports.verifyChamaEligibility = async (req, res, next) => {
  try {
    const { chamaGroupId } = req.body;

    if (!chamaGroupId) {
      return res.status(400).json({
        success: false,
        message: 'Chama group ID is required'
      });
    }

    const eligibility = await chamaService.checkChamaEligibility(
      req.user._id,
      chamaGroupId
    );

    if (!eligibility.eligible) {
      return res.status(403).json({
        success: false,
        message: eligibility.reason,
        eligibilityDetails: eligibility
      });
    }

    // Attach eligibility context to request
    req.chamaContext = {
      chamaGroupId,
      eligible: true,
      group: eligibility.group,
      userPosition: eligibility.userPosition,
      maxRedemptionAmount: eligibility.maxRedemptionAmount
    };

    next();
  } catch (error) {
    res.status(500).json({
      success: false,
      message: `Error verifying chama eligibility: ${error.message}`
    });
  }
};

/**
 * Middleware to check if user is admin
 * Used before admin chama endpoints
 */
exports.requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Only administrators can perform this action'
    });
  }
  next();
};
