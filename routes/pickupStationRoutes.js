// routes/pickupStationRoutes.js
const express = require('express');
const { protect, authorize } = require('../middleware/auth');

// Import controllers
const { getPickupStations } = require('../controllers/agentController'); // Existing function
const {
  getAllPickupStations,
  getPickupStationsByLocation,
  getPickupStationById,
  searchPickupStations,
  getPickupStationsForAdmin
} = require('../controllers/pickupStationController'); // New functions

const router = express.Router();

// Public routes (for customer checkout)
router.get('/location', getPickupStationsByLocation);
router.get('/search', searchPickupStations);
router.get('/all', getAllPickupStations); // Changed from root to avoid conflicts

// Protected routes
router.get('/admin', protect, authorize('admin'), getPickupStationsForAdmin);
router.get('/', protect, authorize('admin'), getPickupStations); // Keep existing route for compatibility

// Individual station route (should be last to avoid conflicts)
router.get('/:id', getPickupStationById);

module.exports = router;