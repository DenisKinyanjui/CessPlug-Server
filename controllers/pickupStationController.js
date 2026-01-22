// controllers/pickupStationController.js
const PickupStation = require('../models/PickupStation');

// @desc    Get all active pickup stations
// @route   GET /api/pickup-stations
// @access  Public
exports.getAllPickupStations = async (req, res) => {
  try {
    const { county, city, isActive = 'true', page = 1, limit = 50 } = req.query;
    
    // Build query
    const query = { isActive: isActive === 'true' };
    
    // Add location filters
    if (county) {
      query.state = { $regex: new RegExp(county, 'i') };
    }
    
    if (city) {
      query.city = { $regex: new RegExp(city, 'i') };
    }

    // Pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const stations = await PickupStation.find(query)
      .select('name address city state postalCode phone email operatingHours capacity coordinates')
      .sort({ city: 1, name: 1 })
      .skip(skip)
      .limit(limitNum);

    const total = await PickupStation.countDocuments(query);

    res.json({
      success: true,
      data: {
        stations,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum)
        }
      }
    });

  } catch (error) {
    console.error('Get pickup stations error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pickup stations'
    });
  }
};

// @desc    Get pickup stations by location (county and city)
// @route   GET /api/pickup-stations/location
// @access  Public
exports.getPickupStationsByLocation = async (req, res) => {
  try {
    const { county, city } = req.query;
    
    if (!county || !city) {
      return res.status(400).json({
        success: false,
        message: 'County and city are required'
      });
    }

    // Try exact match first
    let stations = await PickupStation.find({
      state: { $regex: new RegExp(`^${county}$`, 'i') },
      city: { $regex: new RegExp(`^${city}$`, 'i') },
      isActive: true
    })
    .select('name address city state postalCode phone email operatingHours capacity coordinates')
    .sort({ name: 1 });

    // If no exact matches, try partial matches
    if (stations.length === 0) {
      stations = await PickupStation.find({
        $and: [
          {
            $or: [
              { state: { $regex: new RegExp(county, 'i') } },
              { city: { $regex: new RegExp(county, 'i') } }
            ]
          },
          {
            $or: [
              { city: { $regex: new RegExp(city, 'i') } },
              { address: { $regex: new RegExp(city, 'i') } }
            ]
          },
          { isActive: true }
        ]
      })
      .select('name address city state postalCode phone email operatingHours capacity coordinates')
      .sort({ name: 1 });
    }

    res.json({
      success: true,
      data: {
        stations,
        location: { county, city }
      }
    });

  } catch (error) {
    console.error('Get pickup stations by location error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pickup stations for this location'
    });
  }
};

// @desc    Get single pickup station by ID
// @route   GET /api/pickup-stations/:id
// @access  Public
exports.getPickupStationById = async (req, res) => {
  try {
    const station = await PickupStation.findOne({
      _id: req.params.id,
      isActive: true
    }).select('name address city state postalCode phone email operatingHours capacity coordinates');

    if (!station) {
      return res.status(404).json({
        success: false,
        message: 'Pickup station not found'
      });
    }

    res.json({
      success: true,
      data: { station }
    });

  } catch (error) {
    console.error('Get pickup station by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pickup station'
    });
  }
};

// @desc    Search pickup stations
// @route   GET /api/pickup-stations/search
// @access  Public
exports.searchPickupStations = async (req, res) => {
  try {
    const { q, limit = 20 } = req.query;
    
    if (!q) {
      return res.status(400).json({
        success: false,
        message: 'Search query is required'
      });
    }

    const searchRegex = new RegExp(q, 'i');
    
    const stations = await PickupStation.find({
      $and: [
        {
          $or: [
            { name: { $regex: searchRegex } },
            { address: { $regex: searchRegex } },
            { city: { $regex: searchRegex } },
            { state: { $regex: searchRegex } }
          ]
        },
        { isActive: true }
      ]
    })
    .select('name address city state postalCode phone email operatingHours capacity')
    .sort({ name: 1 })
    .limit(parseInt(limit));

    res.json({
      success: true,
      data: {
        stations,
        query: q,
        count: stations.length
      }
    });

  } catch (error) {
    console.error('Search pickup stations error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search pickup stations'
    });
  }
};

// @desc    Get pickup stations for admin/agents (from existing agentController)
// @route   GET /api/pickup-stations/admin
// @access  Private/Admin
exports.getPickupStationsForAdmin = async (req, res) => {
  try {
    const stations = await PickupStation.find({ isActive: true })
      .select('name address city state postalCode capacity')
      .sort({ name: 1 });

    res.json({
      success: true,
      data: { stations }
    });
  } catch (error) {
    console.error('Get pickup stations error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};