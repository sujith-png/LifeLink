const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const { validateRegistration, validateLogin, sanitizeBody } = require('../middleware/validate');
const { createRateLimiter } = require('../middleware/rateLimiter');

const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many authentication attempts. Please try again after 15 minutes.'
});

// POST /api/auth/register
router.post('/register', authLimiter, sanitizeBody, validateRegistration, authController.register);

// POST /api/auth/login
router.post('/login', authLimiter, sanitizeBody, validateLogin, authController.login);

// GET /api/auth/me
router.get('/me', authenticate, authController.getMe);

module.exports = router;
