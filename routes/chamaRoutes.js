const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/auth');
const { 
  verifyChamaEligibility, 
  requireAdmin 
} = require('../middleware/chama');
const {
  // Admin routes
  createChamaGroup,
  getAllChamaGroups,
  getChamaGroup,
  getChamaStats,
  addMemberToChamaGroup,
  removeMemberFromChamaGroup,
  activateChamaGroup,
  pauseChamaGroup,
  markContributionPaid,
  rotateToNextTurn,
  // User routes
  getUserChamaGroups,
  getChamaGroupDetails,
  checkEligibility,
  getRedemptionHistory
} = require('../controllers/chamaController');

// ============ ADMIN ROUTES ============
router.post('/admin/chamas', protect, admin, createChamaGroup);
router.get('/admin/chamas', protect, admin, getAllChamaGroups);
router.get('/admin/chamas/stats', protect, admin, getChamaStats);
router.get('/admin/chamas/:id', protect, admin, getChamaGroup);
router.post('/admin/chamas/:id/add-member', protect, admin, addMemberToChamaGroup);
router.delete('/admin/chamas/:id/members/:userId', protect, admin, removeMemberFromChamaGroup);
router.post('/admin/chamas/:id/activate', protect, admin, activateChamaGroup);
router.post('/admin/chamas/:id/pause', protect, admin, pauseChamaGroup);
router.post('/admin/chamas/:id/mark-contribution', protect, admin, markContributionPaid);
router.post('/admin/chamas/:id/next-turn', protect, admin, rotateToNextTurn);

// ============ USER ROUTES ============
router.get('/chamas/my', protect, getUserChamaGroups);
router.get('/chamas/:id', protect, getChamaGroupDetails);
router.get('/chamas/:id/eligibility', protect, checkEligibility);
router.get('/chamas/:id/redemptions', protect, getRedemptionHistory);

module.exports = router;
