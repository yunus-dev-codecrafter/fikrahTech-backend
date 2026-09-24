const jwt = require('jsonwebtoken');

// Simple JWT verification middleware (proprietor routes).
// Attaches a normalized user with both `school_id` and `schoolId`.
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({
      message: 'Missing Token Header'
    });
  }

  const token = authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token || token === 'null' || token === 'undefined') {
    return res.status(401).json({
      message: 'Invalid token format'
    });
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    return res.status(500).json({
      message: 'Server configuration error - JWT_SECRET missing'
    });
  }

  jwt.verify(token, jwtSecret, (err, decoded) => {
    if (err) {
      return res.status(401).json({
        message: 'Invalid or expired token'
      });
    }

    // Normalize: proprietorController reads req.user.school_id,
    // other code may read schoolId — expose both.
    req.user = {
      ...decoded,
      schoolId: decoded.school_id ?? decoded.schoolId ?? null,
      school_id: decoded.school_id ?? decoded.schoolId ?? null,
    };
    next();
  });
};

module.exports = {
  authenticateToken
};
