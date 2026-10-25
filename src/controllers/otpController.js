const OtpService = require('../services/otpService');
const { validateAndNormalizeIndianPhone } = require('../utils/phoneValidator');

exports.sendOtp = async (req, res) => {
  try {
    const { phone, purpose = 'post_request' } = req.body;

    const phoneVal = validateAndNormalizeIndianPhone(phone);
    if (!phoneVal.valid) {
      return res.status(400).json({
        success: false,
        message: phoneVal.message
      });
    }

    const result = await OtpService.generateOtp(phoneVal.phone10, purpose);

    // Explicitly return ONLY the required message. Do NOT expose OTP!
    return res.json({
      success: true,
      message: 'OTP sent to your registered mobile number.',
      expiresAt: result.expiresAt
    });
  } catch (error) {
    console.error('[OtpController.sendOtp] Error:', error.message);
    let statusCode = 400;
    if (error.message.includes('blocked')) {
      statusCode = 403;
    } else if (error.message.includes('not configured')) {
      statusCode = 503;
    } else if (error.message.includes('Too many') || error.message.includes('wait')) {
      statusCode = 429;
    }

    return res.status(statusCode).json({
      success: false,
      message: error.message || 'Failed to send OTP.'
    });
  }
};

exports.verifyOtp = (req, res) => {
  try {
    const { phone, code, purpose = 'post_request' } = req.body;

    if (!phone || !code) {
      return res.status(400).json({
        success: false,
        message: 'Mobile phone number and 6-digit verification code are required.'
      });
    }

    const phoneVal = validateAndNormalizeIndianPhone(phone);
    if (!phoneVal.valid) {
      return res.status(400).json({
        success: false,
        message: phoneVal.message
      });
    }

    const result = OtpService.verifyOtp(phoneVal.phone10, code, purpose);

    if (!result.verified) {
      return res.status(400).json({
        success: false,
        message: result.message
      });
    }

    return res.json({
      success: true,
      message: result.message
    });
  } catch (error) {
    console.error('[OtpController.verifyOtp] Error:', error.message);
    return res.status(400).json({
      success: false,
      message: error.message || 'OTP verification failed.'
    });
  }
};
