const express = require('express');
const router = express.Router();
const otpController = require('../controllers/otpController');
const { createRateLimiter } = require('../middleware/rateLimiter');
const { sanitizeBody } = require('../middleware/validate');

const otpLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000,
  max: 10,
  message: 'Too many OTP requests. Please wait a few minutes before trying again.'
});

// POST /api/otp/send
router.post('/send', otpLimiter, sanitizeBody, otpController.sendOtp);

// POST /api/otp/verify
router.post('/verify', otpLimiter, sanitizeBody, otpController.verifyOtp);

module.exports = router;
