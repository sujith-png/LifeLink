const { BLOOD_GROUPS, URGENCY_LEVELS } = require('../config/constants');

// Simple XSS sanitization helper that strips HTML tags and trims whitespace
function sanitizeString(val) {
  if (typeof val !== 'string') return val;
  return val.replace(/<[^>]*>?/gm, '').trim();
}

function sanitizeObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeString(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function sanitizeBody(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeObject(req.body);
  }
  next();
}

function validateRegistration(req, res, next) {
  const { email, password, role = 'donor', name, phone, blood_group, city, area_pincode } = req.body;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, message: 'Please provide a valid email address.' });
  }

  if (!password || password.length < 6) {
    return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long.' });
  }

  if (role && !['donor', 'requester'].includes(role)) {
    return res.status(400).json({ success: false, message: 'Role must be either "donor" or "requester".' });
  }

  if (role === 'donor') {
    if (!name || name.trim().length < 2) {
      return res.status(400).json({ success: false, message: 'Please provide your full name (minimum 2 characters).' });
    }

    if (!phone || !/^\+?[0-9]{10,15}$/.test(phone.replace(/[\s-]/g, ''))) {
      return res.status(400).json({ success: false, message: 'Please provide a valid 10-15 digit phone number.' });
    }

    if (!blood_group || !BLOOD_GROUPS.includes(blood_group.toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: `Invalid blood group. Allowed: ${BLOOD_GROUPS.join(', ')}`
      });
    }

    if (!city || city.trim().length < 2) {
      return res.status(400).json({ success: false, message: 'City is required.' });
    }

    if (!area_pincode || area_pincode.trim().length < 2) {
      return res.status(400).json({ success: false, message: 'Area or Pincode is required.' });
    }
  }

  next();
}

function validateLogin(req, res, next) {
  const identifier = req.body.identifier || req.body.email || req.body.phone;
  const password = req.body.password;
  if (!identifier || !password) {
    return res.status(400).json({ success: false, message: 'Email or phone number and password are required.' });
  }
  next();
}

module.exports = {
  sanitizeBody,
  validateRegistration,
  validateLogin,
  sanitizeString
};
