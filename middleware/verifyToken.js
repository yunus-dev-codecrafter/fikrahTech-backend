const jwt = require('jsonwebtoken');
const { User } = require('../models');

/**
 * JWT Token Verification Middleware
 * Verifies JWT tokens and attaches a normalized user to the request.
 * Normalized shape exposes BOTH `schoolId` and `school_id` so every
 * controller keeps working regardless of which key it reads.
 */
const verifyToken = async (req, res, next) => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        message: 'Access token required',
      });
    }

    // Extract token from "Bearer <token>"
    const token = authHeader.split(' ')[1];

    if (!token || token === 'null' || token === 'undefined') {
      return res.status(401).json({
        message: 'Invalid token format',
      });
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      return res.status(500).json({
        message: 'Server configuration error.',
      });
    }

    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, jwtSecret);
    } catch (err) {
      return res.status(401).json({
        message: 'Invalid or expired token',
      });
    }

    if (!decoded || !decoded.id) {
      return res.status(401).json({
        message: 'Invalid or expired token',
      });
    }

    // Find user from decoded token (single DB lookup per request)
    const user = await User.findByPk(decoded.id, {
      attributes: ['id', 'email', 'role', 'school_id'],
    });

    if (!user) {
      return res.status(401).json({
        message: 'User not found',
      });
    }

    // Attach normalized user to request (both key styles supported)
    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      schoolId: user.school_id,
      school_id: user.school_id,
    };

    next();
  } catch (error) {
    return res.status(401).json({
      message: 'Token verification failed',
    });
  }
};

/**
 * Admin Role Verification Middleware
 * Assumes verifyToken already ran (see routes/index.js) — does NOT
 * re-verify the token, avoiding 2-3x DB hits per admin request.
 */
const isAdmin = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      message: 'Authentication required.',
    });
  }

  const role = String(req.user.role || '').toLowerCase();
  if (role !== 'super_admin' && role !== 'admin') {
    return res.status(403).json({
      message: 'Access denied. Admin privileges required.',
    });
  }

  next();
};

module.exports = { verifyToken, isAdmin };
