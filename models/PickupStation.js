// models/PickupStation.js
const mongoose = require('mongoose');

const pickupStationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please add a station name'],
    trim: true,
    maxlength: [100, 'Station name cannot be more than 100 characters']
  },
  address: {
    type: String,
    required: [true, 'Please add an address'],
    trim: true,
    maxlength: [200, 'Address cannot be more than 200 characters']
  },
  city: {
    type: String,
    required: [true, 'Please add a city'],
    trim: true,
    maxlength: [50, 'City name cannot be more than 50 characters']
  },
  state: {
    type: String,
    trim: true,
    maxlength: [50, 'State name cannot be more than 50 characters']
  },
  postalCode: {
    type: String,
    trim: true,
    maxlength: [20, 'Postal code cannot be more than 20 characters']
  },
  phone: {
    type: String,
    trim: true
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    match: [
      /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
      'Please add a valid email'
    ]
  },
  coordinates: {
    latitude: {
      type: Number,
      min: -90,
      max: 90
    },
    longitude: {
      type: Number,
      min: -180,
      max: 180
    }
  },
  operatingHours: {
    monday: { open: String, close: String },
    tuesday: { open: String, close: String },
    wednesday: { open: String, close: String },
    thursday: { open: String, close: String },
    friday: { open: String, close: String },
    saturday: { open: String, close: String },
    sunday: { open: String, close: String }
  },
  capacity: {
    type: Number,
    default: 100,
    min: [1, 'Capacity must be at least 1']
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Create index for location-based queries
pickupStationSchema.index({ 'coordinates.latitude': 1, 'coordinates.longitude': 1 });
pickupStationSchema.index({ city: 1, isActive: 1 });
pickupStationSchema.index({ name: 1, isActive: 1 });

module.exports = mongoose.model('PickupStation', pickupStationSchema);