/**
 * Middleware to check if user is an admin
 * Blocks access if user is not an admin
 */
exports.requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized. User not authenticated.'
    });
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin privileges required.'
    });
  }

  next();
};
// Export as default for backward compatibility
module.exports = exports.requireAdmin;