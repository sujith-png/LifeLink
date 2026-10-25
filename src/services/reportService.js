const db = require('../config/database');
const NotificationService = require('./notificationService');

const AUTO_HIDE_THRESHOLD = 3;

class ReportService {
  /**
   * Submit an abuse/fraud report against an emergency request
   */
  static submitReport({ requestId, reporterIp, reporterPhone = null, reason, details = '' }) {
    const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId);
    if (!request) {
      throw new Error('Emergency request not found.');
    }

    const cleanReporterPhone = reporterPhone ? reporterPhone.replace(/[\s-]/g, '') : null;

    // 1. Deduplication: Prevent multiple reports from same Phone (if provided) or same IP (if anonymous)
    let existingReport = null;
    if (cleanReporterPhone) {
      existingReport = db.prepare(`
        SELECT id FROM reports 
        WHERE request_id = ? AND reporter_phone = ?
      `).get(requestId, cleanReporterPhone);
    } else if (reporterIp) {
      existingReport = db.prepare(`
        SELECT id FROM reports 
        WHERE request_id = ? AND reporter_ip = ?
      `).get(requestId, reporterIp);
    }

    if (existingReport) {
      throw new Error('You have already submitted a report for this emergency request. Our administrators have received it.');
    }

    // 2. Insert report
    db.prepare(`
      INSERT INTO reports (request_id, reporter_ip, reporter_phone, reason, details, status)
      VALUES (?, ?, ?, ?, ?, 'pending')
    `).run(requestId, reporterIp, cleanReporterPhone, reason, details || '');

    // 3. Count distinct valid reports for this request
    const countRow = db.prepare(`
      SELECT COUNT(*) as count FROM reports WHERE request_id = ? AND status != 'dismissed'
    `).get(requestId);

    const reportCount = countRow ? countRow.count : 1;

    // 4. Update request report_count
    db.prepare(`
      UPDATE requests SET report_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(reportCount, requestId);

    let isAutoHidden = false;

    // 5. Auto-Hide Rule: When 3 or more qualifying reports are received
    if (reportCount >= AUTO_HIDE_THRESHOLD && request.is_hidden === 0) {
      db.prepare(`
        UPDATE requests 
        SET is_hidden = 1,
            is_suspicious = 1,
            suspicious_reason = 'Community auto-hidden: Reached 3+ abuse reports (' || ? || ' reports). Queued for priority admin audit.',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(reportCount, requestId);

      // Halt active escalations while hidden
      db.prepare(`
        UPDATE request_escalations SET is_escalating = 0 WHERE request_id = ?
      `).run(requestId);

      isAutoHidden = true;

      console.warn(`[ReportService] Request #${requestId} AUTO-HIDDEN due to reaching ${reportCount} community reports. Alerts paused.`);
    }

    return {
      success: true,
      reportCount,
      isAutoHidden,
      message: isAutoHidden
        ? 'Thank you for your report. This request has reached 3 community reports and has been automatically hidden pending urgent administrator review.'
        : 'Report submitted successfully. Our moderation team will review this post.'
    };
  }

  /**
   * Get all reports for a request (Admin only)
   */
  static getReportsForRequest(requestId) {
    return db.prepare(`
      SELECT * FROM reports WHERE request_id = ? ORDER BY created_at DESC
    `).all(requestId);
  }

  /**
   * Admin restores an incorrectly hidden request
   */
  static restoreHiddenRequest(requestId, adminUserId, notes = '') {
    const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId);
    if (!request) {
      throw new Error('Request not found.');
    }

    // Un-hide request and dismiss pending reports
    db.prepare(`
      UPDATE requests 
      SET is_hidden = 0,
          report_count = 0,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(requestId);

    db.prepare(`
      UPDATE reports SET status = 'dismissed' WHERE request_id = ?
    `).run(requestId);

    // Resume alerts if still Open
    if (request.status === 'Open') {
      db.prepare(`
        UPDATE request_escalations 
        SET is_escalating = 1, next_escalation_at = datetime('now') 
        WHERE request_id = ?
      `).run(requestId);
    }

    // Log admin moderation action
    db.prepare(`
      INSERT INTO verification_logs (request_id, admin_user_id, old_status, new_status, verification_method, notes)
      VALUES (?, ?, ?, ?, 'manual_review', ?)
    `).run(requestId, adminUserId, request.verification_status, request.verification_status, `Restored hidden request: ${notes || 'Dismissed community reports as false flags'}`);

    console.log(`[ReportService] Request #${requestId} RESTORED by Admin #${adminUserId}.`);
    return { success: true, message: 'Request restored and false reports dismissed.' };
  }

  /**
   * Admin upholds reports and permanently rejects/cancels the request
   */
  static upholdReportsAndReject(requestId, adminUserId, notes = '', shouldBlockPhone = false) {
    const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId);
    if (!request) {
      throw new Error('Request not found.');
    }

    // Mark reports action_taken
    db.prepare(`
      UPDATE reports SET status = 'action_taken' WHERE request_id = ?
    `).run(requestId);

    // Set request status to Rejected and Cancelled
    db.prepare(`
      UPDATE requests 
      SET verification_status = 'Rejected',
          status = 'Cancelled',
          is_hidden = 1,
          closed_at = datetime('now'),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(requestId);

    // Halt alerts
    db.prepare(`
      UPDATE request_escalations SET is_escalating = 0 WHERE request_id = ?
    `).run(requestId);

    // Block phone if requested
    if (shouldBlockPhone && request.contact_phone) {
      db.prepare(`
        INSERT INTO blocklist (phone, reason, blocked_by_user_id, is_active)
        VALUES (?, ?, ?, 1)
        ON CONFLICT(phone) DO UPDATE SET is_active = 1, reason = excluded.reason, updated_at = CURRENT_TIMESTAMP
      `).run(request.contact_phone, `Fraudulent emergency request #${requestId} confirmed by admin. ${notes}`, adminUserId);
    }

    // Log moderation action
    db.prepare(`
      INSERT INTO verification_logs (request_id, admin_user_id, old_status, new_status, verification_method, notes)
      VALUES (?, ?, ?, 'Rejected', 'manual_review', ?)
    `).run(requestId, adminUserId, request.verification_status, `Reports upheld by admin. Request cancelled. ${notes}`);

    console.log(`[ReportService] Request #${requestId} REJECTED and upheld by Admin #${adminUserId}.`);
    return { success: true, message: 'Reports upheld. Request marked Rejected and cancelled.' };
  }
}

module.exports = ReportService;
