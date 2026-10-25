const jwt = require('jsonwebtoken');
const db = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'lifelink_super_secret_jwt_key_2026_secure';

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Authentication required. No token provided.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const userStmt = db.prepare('SELECT id, email, role, created_at FROM users WHERE id = ?');
    const user = userStmt.get(decoded.id);

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid token: User not found.' });
    }

    req.user = user;

    // If user is a donor, attach donor record
    if (user.role === 'donor') {
      const donorStmt = db.prepare('SELECT * FROM donors WHERE user_id = ?');
      req.donor = donorStmt.get(user.id) || null;
    }

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Session expired. Please log in again.' });
    }
    return res.status(401).json({ success: false, message: 'Invalid authentication token.' });
  }
}

function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const userStmt = db.prepare('SELECT id, email, role FROM users WHERE id = ?');
    const user = userStmt.get(decoded.id);
    if (user) {
      req.user = user;
      if (user.role === 'donor') {
        const donorStmt = db.prepare('SELECT * FROM donors WHERE user_id = ?');
        req.donor = donorStmt.get(user.id) || null;
      }
    }
  } catch (_) {
    // Ignore invalid optional tokens
  }
  next();
}

function authorize(allowedRoles = []) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }
    if (allowedRoles.length > 0 && !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Access forbidden: Insufficient permissions.' });
    }
    next();
  };
}

module.exports = {
  authenticate,
  optionalAuth,
  authorize,
  JWT_SECRET
};
