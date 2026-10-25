const db = require('../config/database');
const SmsService = require('./smsService');
const { validateAndNormalizeIndianPhone } = require('../utils/phoneValidator');

/**
 * OTP Verification Service
 * - Enforces real SMS OTP provider delivery (Twilio, MSG91, Fast2SMS)
 * - 5-minute expiry
 * - Max 5 incorrect attempts
 * - 30-second cooldown between resends
 * - Rate limiting (max 5 OTPs per 15 mins)
 * - Blocklist checks
 * - Invalidation after verification and prevents reuse
 */
class OtpService {
  /**
   * Check if phone is on the active blocklist
   */
  static isPhoneBlocked(phone) {
    const cleanPhone = phone.replace(/[\s-]/g, '');
    const blocked = db.prepare('SELECT id, reason FROM blocklist WHERE phone = ? AND is_active = 1').get(cleanPhone);
    return blocked || null;
  }

  /**
   * Generate and dispatch a 6-digit OTP via real SMS provider
   * @param {string} phone
   * @param {string} purpose
   * @returns {Promise<{ phone: string, expiresAt: string }>}
   */
  static async generateOtp(phone, purpose = 'post_request') {
    // 1. Phone number format validation (Indian 10-digit mobile)
    const phoneVal = validateAndNormalizeIndianPhone(phone);
    if (!phoneVal.valid) {
      throw new Error(phoneVal.message);
    }
    const cleanPhone = phoneVal.phone10;

    // 2. Blocklist check
    const blockRecord = this.isPhoneBlocked(cleanPhone);
    if (blockRecord) {
      throw new Error(`This phone number has been blocked by LifeLink administrators. Reason: ${blockRecord.reason}`);
    }

    // 3. Resend OTP cooldown check (30 seconds)
    const latestOtp = db.prepare(`
      SELECT created_at FROM otps 
      WHERE phone = ? AND purpose = ? 
      ORDER BY id DESC LIMIT 1
    `).get(cleanPhone, purpose);

    if (latestOtp && latestOtp.created_at) {
      const rawCreatedAt = latestOtp.created_at.includes('T')
        ? latestOtp.created_at
        : latestOtp.created_at.replace(' ', 'T') + 'Z';
      const createdTime = new Date(rawCreatedAt).getTime();
      const diffSec = Math.floor((Date.now() - createdTime) / 1000);
      if (diffSec >= 0 && diffSec < 30) {
        throw new Error(`Please wait ${30 - diffSec} seconds before requesting another OTP.`);
      }
    }

    // 4. Rate limit check: max 5 OTPs in the last 15 minutes
    const recentOtps = db.prepare(`
      SELECT COUNT(*) as count FROM otps 
      WHERE phone = ? AND created_at > datetime('now', '-15 minutes')
    `).get(cleanPhone);

    if (recentOtps && recentOtps.count >= 5) {
      throw new Error('Too many OTP attempts for this number. Please wait 15 minutes before requesting another code.');
    }

    // 5. Generate secure 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const nowIso = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minutes

    // 6. Save OTP record to database
    db.prepare(`
      INSERT INTO otps (phone, code, purpose, expires_at, is_used, attempts, is_consumed, created_at)
      VALUES (?, ?, ?, ?, 0, 0, 0, ?)
    `).run(cleanPhone, code, purpose, expiresAt, nowIso);

    // 7. Dispatch via configured SMS provider
    await SmsService.sendOtpSms({
      phone10: cleanPhone,
      phoneE164: phoneVal.phoneE164,
      code,
      purpose
    });

    // Return confirmation to backend caller (controller does not expose code)
    return {
      phone: cleanPhone,
      expiresAt,
      code
    };
  }

  /**
   * Verify an OTP for a given phone and purpose
   * Enforces 5-minute expiry, max 5 attempts, and invalidates on success
   */
  static verifyOtp(phone, code, purpose = 'post_request') {
    const phoneVal = validateAndNormalizeIndianPhone(phone);
    if (!phoneVal.valid) {
      return { verified: false, message: phoneVal.message };
    }
    const cleanPhone = phoneVal.phone10;

    // Blocklist check
    const blockRecord = this.isPhoneBlocked(cleanPhone);
    if (blockRecord) {
      return { verified: false, message: `This phone number is blocked. Reason: ${blockRecord.reason}` };
    }

    const trimmedCode = (code || '').trim();
    if (!trimmedCode) {
      return { verified: false, message: 'Verification code is required.' };
    }

    // Find the latest active/unused OTP for this phone and purpose
    const otpRecord = db.prepare(`
      SELECT * FROM otps 
      WHERE phone = ? AND purpose = ? AND is_used = 0
      ORDER BY id DESC LIMIT 1
    `).get(cleanPhone, purpose);

    if (!otpRecord) {
      // Check if code was already used
      const usedRecord = db.prepare(`
        SELECT * FROM otps 
        WHERE phone = ? AND purpose = ? AND is_used = 1 AND code = ?
        ORDER BY id DESC LIMIT 1
      `).get(cleanPhone, purpose, trimmedCode);

      if (usedRecord) {
        return {
          verified: false,
          message: 'This verification code has already been used. Please request a new code.'
        };
      }

      return {
        verified: false,
        message: 'No active OTP found or code has expired. Please request a new code.'
      };
    }

    // Check expiry (5 minutes)
    const now = new Date();
    const expiresAt = new Date(otpRecord.expires_at);
    if (now > expiresAt) {
      return {
        verified: false,
        message: 'Verification code has expired (valid for 5 minutes). Please request a new code.'
      };
    }

    // Check maximum attempts (5 attempts limit)
    if (otpRecord.attempts >= 5) {
      return {
        verified: false,
        message: 'Maximum verification attempts (5) exceeded. This OTP is locked. Please request a new code.'
      };
    }

    // Validate code match
    if (otpRecord.code !== trimmedCode) {
      const newAttempts = (otpRecord.attempts || 0) + 1;
      db.prepare('UPDATE otps SET attempts = ? WHERE id = ?').run(newAttempts, otpRecord.id);

      const remaining = 5 - newAttempts;
      if (remaining <= 0) {
        return {
          verified: false,
          message: 'Maximum verification attempts (5) exceeded. This OTP has been locked. Please request a new code.'
        };
      }
      return {
        verified: false,
        message: `Incorrect verification code. ${remaining} attempt(s) remaining.`
      };
    }

    // Mark as used and record verification timestamp
    db.prepare("UPDATE otps SET is_used = 1, verified_at = datetime('now') WHERE id = ?").run(otpRecord.id);

    return {
      verified: true,
      message: 'Phone number verified successfully.'
    };
  }

  /**
   * Final consumption check when creating an emergency request or completing user registration
   * Ensures an OTP cannot be reused after request/account creation.
   */
  static consumeVerification(phone, code, purpose = 'post_request') {
    const phoneVal = validateAndNormalizeIndianPhone(phone);
    if (!phoneVal.valid) {
      return { verified: false, message: phoneVal.message };
    }
    const cleanPhone = phoneVal.phone10;
    const trimmedCode = (code || '').trim();

    // 1. First check if there is an unconsumed verified record
    const verifiedRecord = db.prepare(`
      SELECT * FROM otps 
      WHERE phone = ? AND purpose = ? AND is_used = 1 AND is_consumed = 0
        AND verified_at > datetime('now', '-10 minutes')
        AND code = ?
      ORDER BY id DESC LIMIT 1
    `).get(cleanPhone, purpose, trimmedCode);

    if (verifiedRecord) {
      // Consume it
      db.prepare('UPDATE otps SET is_consumed = 1 WHERE id = ?').run(verifiedRecord.id);
      return { verified: true, message: 'Verification confirmed.' };
    }

    // 2. Otherwise verify and consume in one step
    const verifyRes = this.verifyOtp(cleanPhone, trimmedCode, purpose);
    if (!verifyRes.verified) {
      return verifyRes;
    }

    // Mark consumed
    db.prepare(`
      UPDATE otps SET is_consumed = 1 
      WHERE phone = ? AND purpose = ? AND is_used = 1 AND is_consumed = 0
    `).run(cleanPhone, purpose);

    return { verified: true, message: 'Verification confirmed.' };
  }
}

module.exports = OtpService;
