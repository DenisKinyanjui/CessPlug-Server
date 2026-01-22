const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = async () => {
  try {
    // Configure mongoose settings before connecting
    mongoose.set('strictQuery', false);
    
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000, // Reduced timeout
      socketTimeoutMS: 45000,
      family: 4, // Use IPv4, skip trying IPv6
      bufferCommands: false,
      maxPoolSize: 10
    });

    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    
    return conn;
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    // Don't exit the process, let it retry
    throw error;
  }
};

// Simplified event handlers
mongoose.connection.on('error', (err) => {
  console.error('❌ Mongoose connection error:', err.message);
});

mongoose.connection.on('connected', () => {
  console.log('🟢 Mongoose connected successfully');
});

mongoose.connection.on('disconnected', () => {
  console.log('🔴 Mongoose disconnected');
});

mongoose.connection.on('reconnected', () => {
  console.log('🟡 Mongoose reconnected');
});

// Handle application termination gracefully
const gracefulShutdown = async () => {
  try {
    await mongoose.connection.close();
    console.log('📤 MongoDB connection closed through app termination');
    process.exit(0);
  } catch (error) {
    console.error('Error during graceful shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

module.exports = connectDB;