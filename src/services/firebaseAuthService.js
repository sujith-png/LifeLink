const crypto = require('crypto');
const db = require('../config/database');
const FirebaseConfig = require('../config/firebase');
const OtpService = require('./otpService');
const { validateAndNormalizeIndianPhone } = require('../utils/phoneValidator');

/**
 * FirebaseAuthService
 * Verifies Firebase Phone ID tokens server-side, validates phone ownership,
 * enforces blocklist policies, and prevents token replay attacks.
 */
class FirebaseAuthService {
  /**
   * Compute a secure SHA-256 fingerprint for token replay detection
   */
  static hashToken(token) {
    return crypto.createHash('sha256').update(token.trim()).digest('hex');
  }

  /**
   * Verify and consume a phone verification token
   * @param {Object} params
   * @param {string} params.phone - The user-provided phone number
   * @param {string} [params.firebase_token] - Firebase ID token from client signInWithPhoneNumber
   * @param {string} [params.otp_code] - Fallback/test OTP code
   * @param {string} params.purpose - Purpose of verification ('registration' | 'post_request')
   * @returns {Promise<{ verified: boolean, message?: string, phone?: string, uid?: string }>}
   */
  static async verifyAndConsumeToken({ phone, firebase_token, otp_code, purpose = 'registration' }) {
    // 1. Phone number validation
    const phoneVal = validateAndNormalizeIndianPhone(phone);
    if (!phoneVal.valid) {
      return { verified: false, message: phoneVal.message };
    }
    const cleanPhone = phoneVal.phone10;
    const phoneE164 = phoneVal.phoneE164;

    // 2. Active blocklist check
    const isBlocked = OtpService.isPhoneBlocked(cleanPhone);
    if (isBlocked) {
      return {
        verified: false,
        isBlocked: true,
        message: `This phone number has been blocked by administrators. Reason: ${isBlocked.reason}`
      };
    }

    // 3. Primary Path: Firebase Phone ID Token Verification
    if (firebase_token && typeof firebase_token === 'string' && firebase_token.trim().length > 0) {
      try {
        const decoded = await FirebaseConfig.verifyIdToken(firebase_token);

        if (!decoded || !decoded.phone_number) {
          return {
            verified: false,
            message: 'Firebase token did not contain a verified phone number.'
          };
        }

        // Validate that token phone number matches the form phone number
        const tokenPhoneNormalized = decoded.phone_number.replace(/[\s\-.()]/g, '');
        if (tokenPhoneNormalized !== phoneE164 && tokenPhoneNormalized !== `+91${cleanPhone}`) {
          return {
            verified: false,
            message: `Verification mismatch: The verified mobile number (${tokenPhoneNormalized}) does not match the entered mobile number (${phoneE164}).`
          };
        }

        // Prevent Token Replay Attack (Ensure single-use)
        const tokenHash = this.hashToken(firebase_token);
        const existingToken = db.prepare('SELECT id FROM verified_tokens WHERE token_hash = ?').get(tokenHash);
        if (existingToken) {
          return {
            verified: false,
            message: 'This verification token has already been used. Please request a new OTP.'
          };
        }

        // Mark token as consumed atomically
        const nowIso = new Date().toISOString();
        db.prepare(`
          INSERT INTO verified_tokens (firebase_uid, phone, token_hash, purpose, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(decoded.uid || null, cleanPhone, tokenHash, purpose, nowIso);

        return {
          verified: true,
          phone: cleanPhone,
          phoneE164,
          uid: decoded.uid
        };
      } catch (err) {
        console.error('[FirebaseAuthService] Token verification failed:', err.message);
        return {
          verified: false,
          message: err.message || 'Firebase phone verification failed. Please try again.'
        };
      }
    }

    // 4. Secondary / Test Mode Fallback: Direct OTP code verification
    if (otp_code && typeof otp_code === 'string' && otp_code.trim().length > 0) {
      const otpRes = OtpService.consumeVerification(cleanPhone, otp_code, purpose);
      if (!otpRes.verified) {
        return {
          verified: false,
          message: otpRes.message || 'Invalid or expired OTP code.'
        };
      }
      return {
        verified: true,
        phone: cleanPhone,
        phoneE164,
        uid: `legacy_${cleanPhone}`
      };
    }

    // Neither Firebase token nor OTP code was provided
    return {
      verified: false,
      message: 'Mobile phone verification is required. Please verify your phone number using the OTP sent to your mobile.'
    };
  }
}

module.exports = FirebaseAuthService;
