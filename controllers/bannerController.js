const Banner = require('../models/Banner');

// @desc    Get all banners
// @route   GET /api/banners
// @access  Public
exports.getBanners = async (req, res) => {
  try {
    let query = { isActive: true };
    
    // Filter by position if specified
    if (req.query.position) {
      query.position = req.query.position;
    }

    // Check if current date is within banner date range
    const now = new Date();
    query.$or = [
      { endDate: { $exists: false } },
      { endDate: null },
      { endDate: { $gte: now } }
    ];
    query.startDate = { $lte: now };

    const banners = await Banner.find(query)
      .sort({ priority: -1, createdAt: -1 });

    res.json({
      success: true,
      data: { banners }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get all banners for admin
// @route   GET /api/admin/banners
// @access  Private/Admin
exports.getAllBannersAdmin = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    let query = {};
    
    // Filter by position
    if (req.query.position) {
      query.position = req.query.position;
    }

    // Filter by active status
    if (req.query.isActive !== undefined) {
      query.isActive = req.query.isActive === 'true';
    }

    const banners = await Banner.find(query)
      .sort({ priority: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Banner.countDocuments(query);

    res.json({
      success: true,
      data: {
        banners,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Create banner
// @route   POST /api/admin/banners
// @access  Private/Admin
exports.createBanner = async (req, res) => {
  try {
    req.body.createdBy = req.user.id;
    const banner = await Banner.create(req.body);

    res.status(201).json({
      success: true,
      message: 'Banner created successfully',
      data: { banner }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Update banner
// @route   PUT /api/admin/banners/:id
// @access  Private/Admin
exports.updateBanner = async (req, res) => {
  try {
    const banner = await Banner.findByIdAndUpdate(
      req.params.id,
      req.body,
      {
        new: true,
        runValidators: true
      }
    );

    if (!banner) {
      return res.status(404).json({
        success: false,
        message: 'Banner not found'
      });
    }

    res.json({
      success: true,
      message: 'Banner updated successfully',
      data: { banner }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get single banner by ID
// @route   GET /api/admin/banners/:id
// @access  Private/Admin
exports.getBannerById = async (req, res) => {
  try {
    const banner = await Banner.findById(req.params.id);

    if (!banner) {
      return res.status(404).json({
        success: false,
        message: 'Banner not found'
      });
    }

    res.json({
      success: true,
      data: { banner }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Delete banner (Hard Delete)
// @route   DELETE /api/admin/banners/:id
// @access  Private/Admin
exports.deleteBanner = async (req, res) => {
  try {
    // Use findByIdAndDelete for hard delete - this completely removes the document
    const banner = await Banner.findByIdAndDelete(req.params.id);

    if (!banner) {
      return res.status(404).json({
        success: false,
        message: 'Banner not found'
      });
    }

    res.json({
      success: true,
      message: 'Banner deleted successfully'
    });
  } catch (error) {
    console.error('Delete banner error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};