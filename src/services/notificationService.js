const db = require('../config/database');

/**
 * Notification Service with Pluggable SMS/Email channels,
 * Mock Mode console formatting, and in-app notification center.
 */
class NotificationService {
  /**
   * Log mock SMS to console (extensible for Twilio / Fast2SMS)
   */
  static async sendSms({ phone, message, badge = '' }) {
    const isMock = process.env.MOCK_NOTIFICATIONS !== 'false';
    const cleanPhone = (phone || '').replace(/[\s-]/g, '');

    if (isMock) {
      console.log(`\n======================================================`);
      console.log(`  [MOCK SMS ALERT DISPATCH]`);
      console.log(`  To:      ${cleanPhone}`);
      if (badge) console.log(`  Badge:   [ ${badge} ]`);
      console.log(`  Message: ${message}`);
      console.log(`  Time:    ${new Date().toLocaleTimeString()}`);
      console.log(`======================================================\n`);
      return { success: true, channel: 'mock_sms' };
    }

    // Future Twilio / Fast2SMS implementation hook:
    // return await twilioClient.messages.create({ to: cleanPhone, body: message });
    return { success: true, channel: 'sms' };
  }

  /**
   * Log mock Email to console (extensible for Nodemailer / SendGrid)
   */
  static async sendEmail({ email, subject, message, badge = '' }) {
    const isMock = process.env.MOCK_NOTIFICATIONS !== 'false';

    if (isMock) {
      console.log(`\n------------------------------------------------------`);
      console.log(`  [MOCK EMAIL ALERT DISPATCH]`);
      console.log(`  To:      ${email}`);
      console.log(`  Subject: ${subject}`);
      if (badge) console.log(`  Badge:   [ ${badge} ]`);
      console.log(`  Body:    ${message}`);
      console.log(`------------------------------------------------------\n`);
      return { success: true, channel: 'mock_email' };
    }

    // Future Nodemailer implementation hook:
    // return await mailTransporter.sendMail({ to: email, subject, text: message });
    return { success: true, channel: 'email' };
  }

  /**
   * Insert in-app notification into database
   */
  static sendInApp({ userId, requestId = null, type, title, message, verificationBadge = null, metadata = null }) {
    try {
      const stmt = db.prepare(`
        INSERT INTO notifications (
          user_id, request_id, type, title, message, channel, verification_badge, metadata
        ) VALUES (?, ?, ?, ?, ?, 'in_app', ?, ?)
      `);

      const metaStr = metadata ? JSON.stringify(metadata) : null;
      const res = stmt.run(userId, requestId, type, title, message, verificationBadge, metaStr);

      return { success: true, id: Number(res.lastInsertRowid) };
    } catch (err) {
      console.error('[NotificationService.sendInApp] Error:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Send staged emergency alert to a matched donor
   * Guards against duplicate notifications for the same request to the same donor!
   */
  static async notifyDonorOfEmergency({ donor, request, stage = 1 }) {
    // 1. Re-check request status immediately
    const currentReq = db.prepare('SELECT status, verification_status FROM requests WHERE id = ?').get(request.id);
    if (!currentReq || currentReq.status !== 'Open') {
      console.log(`[NotificationService] Skipped alert to Donor #${donor.id}: Request #${request.id} is ${currentReq ? currentReq.status : 'missing'}.`);
      return { success: false, reason: 'Request closed' };
    }

    // 2. Prevent duplicate emergency alert to the same user for this request
    const existing = db.prepare(`
      SELECT id FROM notifications 
      WHERE user_id = ? AND request_id = ? AND type = 'emergency_alert'
    `).get(donor.user_id, request.id);

    if (existing) {
      console.log(`[NotificationService] Skipped duplicate alert to User #${donor.user_id} for Request #${request.id}`);
      return { success: false, reason: 'Already notified' };
    }

    const badge = currentReq.verification_status;
    const alertTitle = `🚨 Emergency Blood Alert: ${request.blood_group} Needed`;
    const alertMessage = `URGENT: Patient at ${request.hospital_name}, ${request.city} urgently needs ${request.units_needed} unit(s) of ${request.blood_group} blood. (Urgency: ${request.urgency}). Verification Level: ${badge}.`;

    // 3. Dispatch In-App Notification
    this.sendInApp({
      userId: donor.user_id,
      requestId: request.id,
      type: 'emergency_alert',
      title: alertTitle,
      message: alertMessage,
      verificationBadge: badge,
      metadata: {
        stage,
        urgency: request.urgency,
        blood_group: request.blood_group,
        hospital: request.hospital_name,
        city: request.city
      }
    });

    // 4. Dispatch Mock SMS
    await this.sendSms({
      phone: donor.phone,
      message: `${alertTitle}. ${alertMessage} Please check LifeLink donor panel to respond.`,
      badge
    });

    // 5. Dispatch Mock Email if email exists
    if (donor.user_email) {
      await this.sendEmail({
        email: donor.user_email,
        subject: alertTitle,
        message: alertMessage,
        badge
      });
    }

    return { success: true };
  }

  /**
   * Notify requester of donor response (accepted, status update, or withdrawal)
   */
  static notifyRequester({ requesterUserId, requestId, type, title, message, metadata = null }) {
    if (!requesterUserId) return;

    this.sendInApp({
      userId: requesterUserId,
      requestId,
      type,
      title,
      message,
      metadata
    });
  }

  /**
   * Fetch in-app notifications for user
   */
  static getUserNotifications(userId, limit = 30) {
    return db.prepare(`
      SELECT n.*, r.patient_name, r.blood_group, r.hospital_name, r.city, r.status as request_status
      FROM notifications n
      LEFT JOIN requests r ON n.request_id = r.id
      WHERE n.user_id = ?
      ORDER BY n.created_at DESC
      LIMIT ?
    `).all(userId, limit);
  }

  /**
   * Get unread count
   */
  static getUnreadCount(userId) {
    const row = db.prepare(`
      SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0
    `).get(userId);
    return row ? row.count : 0;
  }

  /**
   * Mark notification as read
   */
  static markAsRead(notificationId, userId) {
    db.prepare(`
      UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?
    `).run(notificationId, userId);
  }

  /**
   * Mark all notifications as read for a user
   */
  static markAllAsRead(userId) {
    db.prepare(`
      UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0
    `).run(userId);
  }
}

module.exports = NotificationService;
