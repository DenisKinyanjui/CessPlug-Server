const User = require('../models/User');
const PickupStation = require('../models/PickupStation');
const Order = require('../models/Order'); // ADD THIS
const Commission = require('../models/Commission'); // ADD THIS
const mongoose = require('mongoose'); // ADD THIS
const crypto = require('crypto');
const { sendAgentSetupEmail } = require('../utils/emailService');
const bcrypt = require('bcryptjs');

// @desc    Get all agents
// @route   GET /api/admin/agents
// @access  Private/Admin
exports.getAllAgents = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Build query
    let query = { role: 'agent' };
    
    // Search by name or email
    if (req.query.search) {
      query.$or = [
        { name: { $regex: req.query.search, $options: 'i' } },
        { email: { $regex: req.query.search, $options: 'i' } }
      ];
    }

    // Filter by pickup station
    if (req.query.pickupStation) {
      query.pickupStation = req.query.pickupStation;
    }

    // Filter by active status
    if (req.query.isActive !== undefined) {
      query.isActive = req.query.isActive === 'true';
    }

    const agents = await User.find(query)
      .select('-password')
      .populate('pickupStation', 'name address city state postalCode')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await User.countDocuments(query);

    res.json({
      success: true,
      data: {
        agents,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get all agents error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get single agent
// @route   GET /api/admin/agents/:id
// @access  Private/Admin
exports.getAgentById = async (req, res) => {
  try {
    const agent = await User.findOne({ 
      _id: req.params.id, 
      role: 'agent' 
    })
    .select('-password')
    .populate('pickupStation', 'name address city state postalCode coordinates operatingHours capacity');
    
    if (!agent) {
      return res.status(404).json({
        success: false,
        message: 'Agent not found'
      });
    }

    res.json({
      success: true,
      data: { agent }
    });
  } catch (error) {
    console.error('Get agent by ID error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Create new agent (legacy - requires existing pickup station)
// @route   POST /api/admin/agents
// @access  Private/Admin
exports.createAgent = async (req, res) => {
  try {
    const { name, email, phone, pickupStation, isActive = true } = req.body;

    // Validate required fields
    if (!name || !email || !phone || !pickupStation) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields (name, email, phone, pickupStation)'
      });
    }

    // Validate input data
    if (typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid name'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address'
      });
    }

    // Check if email already exists
    const existingUser = await User.findOne({ 
      email: email.toLowerCase(), 
      isActive: true 
    });
    
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    // Check if phone already exists
    const existingPhone = await User.findOne({ 
      phone: phone.trim(), 
      isActive: true 
    });
    
    if (existingPhone) {
      return res.status(400).json({
        success: false,
        message: 'User with this phone number already exists'
      });
    }

    // Verify pickup station exists
    const station = await PickupStation.findById(pickupStation);
    if (!station) {
      return res.status(400).json({
        success: false,
        message: 'Invalid pickup station'
      });
    }

    if (!station.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Selected pickup station is not active'
      });
    }

    // Generate a secure temporary password
    const tempPassword = Math.random().toString(36).slice(-12) + Math.random().toString(36).slice(-12);

    // Create agent
    const agent = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: tempPassword,
      phone: phone.trim(),
      role: 'agent',
      pickupStation,
      isActive,
      verified: true,
      isPhoneVerified: true
    });

    // Remove password from response
    const agentResponse = await User.findById(agent._id)
      .select('-password')
      .populate('pickupStation', 'name address city state postalCode');

    res.status(201).json({
      success: true,
      message: 'Agent created successfully',
      data: { 
        agent: agentResponse,
        tempPassword // Send this securely to the agent
      }
    });
  } catch (error) {
    console.error('Create agent error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Create new agent with pickup station using county/town system
// @route   POST /api/admin/agents/with-station
// @access  Private/Admin
exports.createAgentWithStation = async (req, res) => {
  try {
    const { name, email, phone, isActive = true, pickupStationData } = req.body;

    // Validate required fields
    if (!name || !email || !phone || !pickupStationData) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields including pickup station data'
      });
    }

    // Validate input data types
    if (typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid agent name'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address'
      });
    }

    // Validate pickup station data - now requires name, address, city
    if (!pickupStationData.name || !pickupStationData.address || !pickupStationData.city) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required pickup station fields (name, address, city)'
      });
    }

    // Validate pickup station name specifically
    if (typeof pickupStationData.name !== 'string' || pickupStationData.name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid pickup station name'
      });
    }

    if (pickupStationData.name.trim().length < 3) {
      return res.status(400).json({
        success: false,
        message: 'Pickup station name must be at least 3 characters long'
      });
    }

    if (typeof pickupStationData.address !== 'string' || pickupStationData.address.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid pickup station address'
      });
    }

    if (typeof pickupStationData.city !== 'string' || pickupStationData.city.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid pickup station city'
      });
    }

    // Check if agent email already exists
    const existingUser = await User.findOne({ 
      email: email.toLowerCase().trim(), 
      isActive: true 
    });
    
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    // Check if agent phone already exists
    const existingPhone = await User.findOne({ 
      phone: phone.trim(), 
      isActive: true 
    });
    
    if (existingPhone) {
      return res.status(400).json({
        success: false,
        message: 'User with this phone number already exists'
      });
    }

    // Check if pickup station with the exact same name already exists
    const existingStation = await PickupStation.findOne({
      name: { $regex: new RegExp(`^${pickupStationData.name.trim()}$`, 'i') },
      isActive: true
    });

    if (existingStation) {
      // Check if this station is orphaned (no agent assigned to it)
      const assignedAgent = await User.findOne({
        pickupStation: existingStation._id,
        role: 'agent',
        isActive: true
      });

      if (!assignedAgent) {
        // This is an orphaned station from a previous failed creation - delete it
        console.log('Found orphaned pickup station, deleting:', existingStation._id);
        await PickupStation.findByIdAndDelete(existingStation._id);
      } else {
        return res.status(400).json({
          success: false,
          message: 'A pickup station with this name already exists. Please choose a different name.'
        });
      }
    }

    // Variable to track created pickup station for cleanup on error
    let pickupStation = null;

    try {
    // Create pickup station first with the custom name
    const pickupStationPayload = {
      name: pickupStationData.name.trim(),
      address: pickupStationData.address.trim(),
      city: pickupStationData.city.trim(),
      state: pickupStationData.state?.trim() || pickupStationData.city.trim(), // Use city as fallback
      postalCode: pickupStationData.postalCode?.trim() || '',
      phone: pickupStationData.phone?.trim() || phone.trim(), // Use agent's phone as fallback
      email: pickupStationData.email?.toLowerCase().trim() || email.toLowerCase().trim(), // Use agent's email as fallback
      isActive: true,
      capacity: 100, // Default capacity
      operatingHours: {
        monday: { open: '08:00', close: '18:00' },
        tuesday: { open: '08:00', close: '18:00' },
        wednesday: { open: '08:00', close: '18:00' },
        thursday: { open: '08:00', close: '18:00' },
        friday: { open: '08:00', close: '18:00' },
        saturday: { open: '09:00', close: '17:00' },
        sunday: { open: '10:00', close: '16:00' }
      },
      createdBy: req.user.id
    };

    console.log('Creating pickup station with payload:', pickupStationPayload);

    pickupStation = await PickupStation.create(pickupStationPayload);

    // Generate a secure temporary password (agent will set their own via email setup link)
    // Using same method as legacy createAgent function for consistency
    const tempPassword = Math.random().toString(36).slice(-12) + Math.random().toString(36).slice(-12);

    console.log('Generated temp password length:', tempPassword.length);

    // Create agent with temporary password (required by User model validation)
    const agentPayload = {
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: tempPassword, // Temporary - agent will set their own via email setup
      phone: phone.trim(),
      role: 'agent',
      pickupStation: pickupStation._id,
      isActive,
      verified: false, // Will be set to true when password is created
      isPhoneVerified: true
    };

    console.log('Creating agent with payload:', agentPayload);

    const agent = await User.create(agentPayload);

    // Generate password setup token (24 hours expiry)
    const setupToken = agent.getResetPasswordToken();
    // Override the default 10-minute expiry to 24 hours for initial setup
    agent.resetPasswordExpire = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
    await agent.save({ validateBeforeSave: false });

    // Send setup email to agent
    let emailResult = { success: false };
    try {
      emailResult = await sendAgentSetupEmail(
        agent.email,
        setupToken,
        agent.name,
        pickupStation.name
      );
    } catch (emailError) {
      console.error('Failed to send setup email:', emailError);
      emailResult = { success: false, error: emailError.message };
    }

    // Get complete agent data with populated pickup station
    const agentResponse = await User.findById(agent._id)
      .select('-password')
      .populate('pickupStation', 'name address city state postalCode coordinates operatingHours capacity');

    console.log('Agent created successfully:', {
      agentId: agent._id,
      stationId: pickupStation._id,
      stationName: pickupStation.name
    });

    res.status(201).json({
      success: true,
      message: emailResult.success
        ? 'Agent and pickup station created successfully. Setup email sent.'
        : 'Agent created successfully, but setup email failed to send. Please share the setup link manually.',
      data: {
        agent: agentResponse,
        setupToken: emailResult.success ? undefined : setupToken, // Only include if email failed
        setupUrl: emailResult.success ? undefined : `${process.env.AGENT_BASE_URL || 'http://127.0.0.1:3002'}/agent/setup-password?token=${setupToken}`,
        emailSent: emailResult.success,
        pickupStation: {
          _id: pickupStation._id,
          name: pickupStation.name,
          address: pickupStation.address,
          city: pickupStation.city
        }
      }
    });
    } catch (innerError) {
      // If agent creation fails after pickup station was created, clean it up
      if (pickupStation) {
        console.log('Agent creation failed, cleaning up pickup station:', pickupStation._id);
        try {
          await PickupStation.findByIdAndDelete(pickupStation._id);
        } catch (cleanupError) {
          console.error('Failed to cleanup pickup station:', cleanupError);
        }
      }
      throw innerError;
    }
  } catch (error) {
    console.error('Create agent with station error:', error);

    res.status(400).json({
      success: false,
      message: error.message || 'Failed to create agent and pickup station'
    });
  }
};

// @desc    Update agent
// @route   PUT /api/admin/agents/:id
// @access  Private/Admin
exports.updateAgent = async (req, res) => {
  try {
    const { name, email, phone, pickupStation, isActive } = req.body;

    const agent = await User.findOne({ 
      _id: req.params.id, 
      role: 'agent' 
    });

    if (!agent) {
      return res.status(404).json({
        success: false,
        message: 'Agent not found'
      });
    }

    // Validate input data if provided
    if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid name'
      });
    }

    // Validate email format if provided
    if (email !== undefined) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid email address'
        });
      }
    }

    // Check if email is being changed and if it already exists
    if (email && email.toLowerCase() !== agent.email) {
      const existingUser = await User.findOne({ 
        email: email.toLowerCase().trim(), 
        isActive: true,
        _id: { $ne: req.params.id }
      });
      
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'User with this email already exists'
        });
      }
    }

    // Check if phone is being changed and if it already exists
    if (phone && phone !== agent.phone) {
      const existingPhone = await User.findOne({ 
        phone: phone.trim(), 
        isActive: true,
        _id: { $ne: req.params.id }
      });
      
      if (existingPhone) {
        return res.status(400).json({
          success: false,
          message: 'User with this phone number already exists'
        });
      }
    }

    // Verify pickup station exists if being changed
    if (pickupStation && pickupStation !== agent.pickupStation?.toString()) {
      const station = await PickupStation.findById(pickupStation);
      if (!station) {
        return res.status(400).json({
          success: false,
          message: 'Invalid pickup station'
        });
      }
      
      if (!station.isActive) {
        return res.status(400).json({
          success: false,
          message: 'Selected pickup station is not active'
        });
      }
    }

    // Update fields
    const updateFields = {};
    if (name !== undefined) updateFields.name = name.trim();
    if (email !== undefined) updateFields.email = email.toLowerCase().trim();
    if (phone !== undefined) updateFields.phone = phone.trim();
    if (pickupStation !== undefined) updateFields.pickupStation = pickupStation;
    if (isActive !== undefined) updateFields.isActive = isActive;

    // Add updated timestamp
    updateFields.updatedAt = new Date();

    const updatedAgent = await User.findByIdAndUpdate(
      req.params.id,
      updateFields,
      {
        new: true,
        runValidators: true
      }
    )
    .select('-password')
    .populate('pickupStation', 'name address city state postalCode');

    res.json({
      success: true,
      message: 'Agent updated successfully',
      data: { agent: updatedAgent }
    });
  } catch (error) {
    console.error('Update agent error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Update agent with pickup station
// @route   PUT /api/admin/agents/:id/with-station
// @access  Private/Admin
exports.updateAgentWithStation = async (req, res) => {
  try {
    const { name, email, phone, isActive, pickupStationData } = req.body;

    const agent = await User.findOne({ 
      _id: req.params.id, 
      role: 'agent' 
    }).populate('pickupStation');

    if (!agent) {
      return res.status(404).json({
        success: false,
        message: 'Agent not found'
      });
    }

    // Validate agent input data if provided
    if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid name'
      });
    }

    // Validate email format if provided
    if (email !== undefined) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid email address'
        });
      }
    }

    // Validate pickup station data
    if (!pickupStationData || !pickupStationData.name || !pickupStationData.address || !pickupStationData.city) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required pickup station fields (name, address, city)'
      });
    }

    // Check if email is being changed and if it already exists
    if (email && email.toLowerCase() !== agent.email) {
      const existingUser = await User.findOne({ 
        email: email.toLowerCase().trim(), 
        isActive: true,
        _id: { $ne: req.params.id }
      });
      
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'User with this email already exists'
        });
      }
    }

    // Check if phone is being changed and if it already exists
    if (phone && phone !== agent.phone) {
      const existingPhone = await User.findOne({ 
        phone: phone.trim(), 
        isActive: true,
        _id: { $ne: req.params.id }
      });
      
      if (existingPhone) {
        return res.status(400).json({
          success: false,
          message: 'User with this phone number already exists'
        });
      }
    }

    // Update pickup station first
    const pickupStationUpdateFields = {
      name: pickupStationData.name.trim(),
      address: pickupStationData.address.trim(),
      city: pickupStationData.city.trim(),
      state: pickupStationData.state?.trim() || '',
      postalCode: pickupStationData.postalCode?.trim() || '',
      phone: pickupStationData.phone?.trim() || phone.trim(),
      email: pickupStationData.email?.toLowerCase().trim() || email.toLowerCase().trim(),
      updatedAt: new Date()
    };

    await PickupStation.findByIdAndUpdate(
      agent.pickupStation._id,
      pickupStationUpdateFields,
      { new: true, runValidators: true }
    );

    // Update agent fields
    const agentUpdateFields = {};
    if (name !== undefined) agentUpdateFields.name = name.trim();
    if (email !== undefined) agentUpdateFields.email = email.toLowerCase().trim();
    if (phone !== undefined) agentUpdateFields.phone = phone.trim();
    if (isActive !== undefined) agentUpdateFields.isActive = isActive;
    agentUpdateFields.updatedAt = new Date();

    const updatedAgent = await User.findByIdAndUpdate(
      req.params.id,
      agentUpdateFields,
      {
        new: true,
        runValidators: true
      }
    )
    .select('-password')
    .populate('pickupStation', 'name address city state postalCode');

    res.json({
      success: true,
      message: 'Agent and pickup station updated successfully',
      data: { agent: updatedAgent }
    });
  } catch (error) {
    console.error('Update agent with station error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Delete agent (soft delete)
// @route   DELETE /api/admin/agents/:id
// @access  Private/Admin
exports.deleteAgent = async (req, res) => {
  try {
    const agent = await User.findOne({ 
      _id: req.params.id, 
      role: 'agent' 
    });

    if (!agent) {
      return res.status(404).json({
        success: false,
        message: 'Agent not found'
      });
    }

    // Soft delete - set as inactive and modify unique fields
    const timestamp = Date.now();
    agent.isActive = false;
    agent.email = `deleted_${timestamp}_${agent.email}`;
    agent.phone = `deleted_${timestamp}_${agent.phone}`;
    agent.updatedAt = new Date();
    
    await agent.save();

    res.json({
      success: true,
      message: 'Agent deactivated successfully'
    });
  } catch (error) {
    console.error('Delete agent error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get pickup stations (for legacy support)
// @route   GET /api/pickup-stations
// @access  Private/Admin
exports.getPickupStations = async (req, res) => {
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

// @desc    Get agent statistics
// @route   GET /api/admin/agents/stats
// @access  Private/Admin
exports.getAgentStats = async (req, res) => {
  try {
    const totalAgents = await User.countDocuments({ role: 'agent' });
    const activeAgents = await User.countDocuments({ role: 'agent', isActive: true });
    const inactiveAgents = await User.countDocuments({ role: 'agent', isActive: false });

    // Get agents created in the last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentAgents = await User.countDocuments({ 
      role: 'agent', 
      createdAt: { $gte: thirtyDaysAgo } 
    });

    // Get pickup stations count
    const totalStations = await PickupStation.countDocuments({ isActive: true });

    res.json({
      success: true,
      data: {
        totalAgents,
        activeAgents,
        inactiveAgents,
        recentAgents,
        totalStations
      }
    });
  } catch (error) {
    console.error('Get agent stats error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Bulk update agent status
// @route   PUT /api/admin/agents/bulk-status
// @access  Private/Admin
exports.bulkUpdateAgentStatus = async (req, res) => {
  try {
    const { agentIds, isActive } = req.body;

    if (!agentIds || !Array.isArray(agentIds) || agentIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide valid agent IDs'
      });
    }

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid status (active/inactive)'
      });
    }

    const result = await User.updateMany(
      { 
        _id: { $in: agentIds }, 
        role: 'agent' 
      },
      { 
        isActive,
        updatedAt: new Date()
      }
    );

    res.json({
      success: true,
      message: `${result.modifiedCount} agents updated successfully`,
      data: {
        modifiedCount: result.modifiedCount,
        matchedCount: result.matchedCount
      }
    });
  } catch (error) {
    console.error('Bulk update agent status error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get agent statistics by agent ID
// @route   GET /api/admin/agents/:id/stats
// @access  Private/Admin
exports.getAgentStatistics = async (req, res) => {
  try {
    const agentId = req.params.id;

    console.log('Getting agent statistics for agent:', agentId);

    // Validate agent exists and is an agent
    const agent = await User.findOne({ 
      _id: agentId, 
      role: 'agent' 
    }).populate('pickupStation', 'name address city state');

    if (!agent) {
      return res.status(404).json({
        success: false,
        message: 'Agent not found'
      });
    }

    // Get commission statistics
    const commissionStats = await Commission.aggregate([
      { $match: { agentId: new mongoose.Types.ObjectId(agentId) } },
      {
        $group: {
          _id: '$status',
          total: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      }
    ]);

    // Process commission stats
    let pendingCommissions = 0;
    let totalEarnings = 0;
    
    commissionStats.forEach(stat => {
      if (stat._id === 'pending') {
        pendingCommissions = stat.total;
      } else if (stat._id === 'paid') {
        totalEarnings = stat.total;
      }
    });

    // Get order statistics for agent's pickup station
    const orderStats = await Order.aggregate([
      {
        $match: {
          $or: [
            { assignedAgent: new mongoose.Types.ObjectId(agentId) },
            { agentId: new mongoose.Types.ObjectId(agentId) }
          ]
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    // Process order stats
    let totalOrders = 0;
    let pendingOrders = 0;

    orderStats.forEach(stat => {
      totalOrders += stat.count;
      if (['pending', 'processing', 'shipped', 'arrived_at_station'].includes(stat._id)) {
        pendingOrders += stat.count;
      }
    });

    const stats = {
      totalOrders,
      pendingOrders,
      pendingCommissions, // Available for payout
      totalEarnings, // All time paid commissions
      currentBalance: pendingCommissions // Same as pending commissions
    };

    console.log('Agent stats calculated:', stats);

    res.json({
      success: true,
      data: {
        agent: {
          _id: agent._id,
          name: agent.name,
          email: agent.email,
          phone: agent.phone,
          pickupStation: agent.pickupStation
        },
        stats
      }
    });
  } catch (error) {
    console.error('Get agent stats error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get recent orders for an agent
// @route   GET /api/admin/agents/:id/orders
// @access  Private/Admin
exports.getAgentOrdersList = async (req, res) => {
  try {
    const agentId = req.params.id;
    const { page = 1, limit = 10, status } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    console.log('Getting agent orders for agent:', agentId);

    // Validate agent exists
    const agent = await User.findOne({ 
      _id: agentId, 
      role: 'agent' 
    });

    if (!agent) {
      return res.status(404).json({
        success: false,
        message: 'Agent not found'
      });
    }

    // Build query for orders handled by this agent
    const query = {
      $or: [
        { assignedAgent: agentId }, // Orders assigned to agent (pickup station orders)
        { agentId: agentId } // Orders created by agent (agent orders)
      ]
    };

    // Add status filter if provided
    if (status) {
      query.status = status;
    }

    // Get orders with pagination
    const orders = await Order.find(query)
      .populate('user', 'name email phone')
      .populate('pickupStation', 'name address city state')
      .populate('assignedAgent', 'name email phone')
      .populate('agentId', 'name email phone')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const total = await Order.countDocuments(query);

    // Transform orders for frontend
    const transformedOrders = orders.map(order => ({
      _id: order._id,
      orderNumber: order.orderNumber,
      user: {
        name: order.user?.name || order.customerInfo?.name || 'Unknown',
        email: order.user?.email || order.customerInfo?.email || '',
        phone: order.user?.phone || order.customerInfo?.phone || ''
      },
      status: order.status,
      createdAt: order.createdAt,
      totalPrice: order.totalPrice,
      deliveryMethod: order.deliveryMethod,
      createdBy: order.createdBy || 'customer'
    }));

    console.log(`Found ${orders.length} orders for agent ${agentId}`);

    res.json({
      success: true,
      data: {
        orders: transformedOrders,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum)
        }
      }
    });
  } catch (error) {
    console.error('Get agent orders error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};