const Brand = require('../models/Brand');

// @desc    Get all brands
// @route   GET /api/brands
// @access  Public
exports.getBrands = async (req, res) => {
  try {
    const { search, status } = req.query;
    let query = {};

    // Filter by search term
    if (search) {
      query.name = { $regex: search, $options: 'i' };
    }

    // Filter by status
    if (status) {
      query.isActive = status === 'active';
    } else {
      // Default to active brands for public access
      query.isActive = true;
    }

    const brands = await Brand.find(query).sort({ name: 1 });

    res.json({
      success: true,
      data: { brands }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get single brand
// @route   GET /api/brands/:id
// @access  Public
exports.getBrand = async (req, res) => {
  try {
    const brand = await Brand.findById(req.params.id);

    if (!brand) {
      return res.status(404).json({
        success: false,
        message: 'Brand not found'
      });
    }

    res.json({
      success: true,
      data: { brand }
    });
  } catch (error) {
    // Handle invalid ObjectId
    if (error.name === 'CastError') {
      return res.status(404).json({
        success: false,
        message: 'Brand not found'
      });
    }
    
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Create brand
// @route   POST /api/brands
// @access  Private/Admin
exports.createBrand = async (req, res) => {
  try {
    const brand = await Brand.create(req.body);

    res.status(201).json({
      success: true,
      message: 'Brand created successfully',
      data: { brand }
    });
  } catch (error) {
    // Handle duplicate key error
    if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({
        success: false,
        message: `Brand with this ${field} already exists`
      });
    }

    // Handle validation errors
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: messages.join(', ')
      });
    }

    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Update brand
// @route   PUT /api/brands/:id
// @access  Private/Admin
exports.updateBrand = async (req, res) => {
  try {
    const brand = await Brand.findByIdAndUpdate(
      req.params.id,
      req.body,
      {
        new: true,
        runValidators: true
      }
    );

    if (!brand) {
      return res.status(404).json({
        success: false,
        message: 'Brand not found'
      });
    }

    res.json({
      success: true,
      message: 'Brand updated successfully',
      data: { brand }
    });
  } catch (error) {
    // Handle duplicate key error
    if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({
        success: false,
        message: `Brand with this ${field} already exists`
      });
    }

    // Handle validation errors
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: messages.join(', ')
      });
    }

    // Handle invalid ObjectId
    if (error.name === 'CastError') {
      return res.status(404).json({
        success: false,
        message: 'Brand not found'
      });
    }

    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Delete brand (HARD DELETE)
// @route   DELETE /api/brands/:id
// @access  Private/Admin
exports.deleteBrand = async (req, res) => {
  try {
    const brand = await Brand.findByIdAndDelete(req.params.id);

    if (!brand) {
      return res.status(404).json({
        success: false,
        message: 'Brand not found'
      });
    }

    res.json({
      success: true,
      message: 'Brand permanently deleted'
    });
  } catch (error) {
    // Handle invalid ObjectId
    if (error.name === 'CastError') {
      return res.status(404).json({
        success: false,
        message: 'Brand not found'
      });
    }

    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get all brands for admin (including inactive)
// @route   GET /api/admin/brands
// @access  Private/Admin
exports.getAdminBrands = async (req, res) => {
  try {
    const { search, status } = req.query;
    let query = {};

    // Filter by search term
    if (search) {
      query.name = { $regex: search, $options: 'i' };
    }

    // Filter by status
    if (status) {
      query.isActive = status === 'active';
    }

    const brands = await Brand.find(query).sort({ name: 1 });

    res.json({
      success: true,
      data: { brands }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};