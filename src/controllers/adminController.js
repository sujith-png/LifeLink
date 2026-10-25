const db = require('../config/database');
const verificationController = require('./verificationController');
const ReportService = require('../services/reportService');

/**
 * Admin Controller
 * Handles verification queue, reports moderation, audit logs, and phone blocklist.
 */

// Verification actions (delegated to verificationController)
exports.getVerificationQueue = verificationController.getVerificationQueue;
exports.getRequisitionSlip = verificationController.getRequisitionSlip;
exports.verifyDocument = verificationController.verifyDocument;
exports.updateVerificationStatus = verificationController.updateVerificationStatus;
exports.getVerificationLogs = verificationController.getVerificationLogs;

// Admin platform statistics overview
exports.getStats = (req, res) => {
  try {
    const totalDonors = db.prepare('SELECT COUNT(*) as count FROM donors').get().count;
    const availableDonors = db.prepare('SELECT COUNT(*) as count FROM donors WHERE is_available = 1').get().count;
    const activeRequests = db.prepare("SELECT COUNT(*) as count FROM requests WHERE status = 'Open' AND is_hidden = 0").get().count;
    const fulfilledRequests = db.prepare("SELECT COUNT(*) as count FROM requests WHERE status = 'Fulfilled'").get().count;
    const totalRequests = db.prepare('SELECT COUNT(*) as count FROM requests').get().count;
    const pendingVerification = db.prepare("SELECT COUNT(*) as count FROM requests WHERE status = 'Open' AND verification_status IN ('Unverified', 'Phone Verified')").get().count;
    const hospitalConfirmed = db.prepare("SELECT COUNT(*) as count FROM requests WHERE verification_status = 'Hospital Confirmed'").get().count;
    const flaggedOrHidden = db.prepare("SELECT COUNT(*) as count FROM requests WHERE is_hidden = 1 OR is_suspicious = 1 OR report_count > 0").get().count;
    const totalReports = db.prepare("SELECT COUNT(*) as count FROM reports WHERE status != 'dismissed'").get().count;
    const blockedPhones = db.prepare("SELECT COUNT(*) as count FROM blocklist WHERE is_active = 1").get().count;
    const bloodBanksCount = db.prepare("SELECT COUNT(*) as count FROM blood_banks").get().count;

    return res.json({
      success: true,
      stats: {
        totalDonors,
        availableDonors,
        activeRequests,
        fulfilledRequests,
        totalRequests,
        pendingVerification,
        hospitalConfirmed,
        flaggedOrHidden,
        totalReports,
        blockedPhones,
        bloodBanksCount
      }
    });
  } catch (err) {
    console.error('[AdminController.getStats] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch admin stats.' });
  }
};

// Reports moderation
exports.getAllReports = (req, res) => {
  try {
    const statusFilter = req.query.status;
    let query = `
      SELECT 
        r.id as report_id,
        r.request_id,
        r.reporter_ip,
        r.reporter_phone,
        r.reason,
        r.details,
        r.status as report_status,
        r.created_at as reported_at,
        req.patient_name,
        req.hospital_name,
        req.blood_group,
        req.city,
        req.status as request_status,
        req.verification_status,
        req.is_hidden,
        req.report_count
      FROM reports r
      JOIN requests req ON r.request_id = req.id
    `;
    const params = [];

    if (statusFilter) {
      query += ` WHERE r.status = ? `;
      params.push(statusFilter);
    }

    query += ` ORDER BY r.created_at DESC LIMIT 100 `;

    const reports = db.prepare(query).all(...params);

    return res.json({
      success: true,
      count: reports.length,
      reports
    });
  } catch (err) {
    console.error('[AdminController.getAllReports] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve reports.' });
  }
};

exports.getReportsForRequest = (req, res) => {
  try {
    const requestId = parseInt(req.params.id, 10);
    const reports = ReportService.getReportsForRequest(requestId);
    return res.json({
      success: true,
      requestId,
      count: reports.length,
      reports
    });
  } catch (err) {
    console.error('[AdminController.getReportsForRequest] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve reports for request.' });
  }
};

exports.restoreHiddenRequest = (req, res) => {
  try {
    const requestId = parseInt(req.params.id, 10);
    const { notes } = req.body;
    const adminUserId = req.user.id;

    const result = ReportService.restoreHiddenRequest(requestId, adminUserId, notes);
    return res.json(result);
  } catch (err) {
    console.error('[AdminController.restoreHiddenRequest] Error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to restore request.' });
  }
};

exports.upholdReports = (req, res) => {
  try {
    const requestId = parseInt(req.params.id, 10);
    const { notes, shouldBlockPhone = false } = req.body;
    const adminUserId = req.user.id;

    const result = ReportService.upholdReportsAndReject(requestId, adminUserId, notes, Boolean(shouldBlockPhone));
    return res.json(result);
  } catch (err) {
    console.error('[AdminController.upholdReports] Error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to uphold reports.' });
  }
};

// Phone blocklist management
exports.getBlocklist = (req, res) => {
  try {
    const blocklist = db.prepare(`
      SELECT b.*, u.email as blocked_by_email
      FROM blocklist b
      LEFT JOIN users u ON b.blocked_by_user_id = u.id
      ORDER BY b.created_at DESC
    `).all();

    return res.json({
      success: true,
      count: blocklist.length,
      blocklist
    });
  } catch (err) {
    console.error('[AdminController.getBlocklist] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch blocklist.' });
  }
};

exports.addToBlocklist = (req, res) => {
  try {
    const { phone, reason } = req.body;
    if (!phone || !reason) {
      return res.status(400).json({ success: false, message: 'Phone number and reason are required.' });
    }

    const cleanPhone = phone.replace(/[\s-]/g, '');
    const adminUserId = req.user.id;

    db.prepare(`
      INSERT INTO blocklist (phone, reason, blocked_by_user_id, is_active)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(phone) DO UPDATE SET
        reason = excluded.reason,
        blocked_by_user_id = excluded.blocked_by_user_id,
        is_active = 1,
        updated_at = CURRENT_TIMESTAMP
    `).run(cleanPhone, reason.trim(), adminUserId);

    console.log(`[Blocklist] Phone ${cleanPhone} added to blocklist by Admin #${adminUserId}: ${reason}`);

    return res.json({
      success: true,
      message: `Phone number ${cleanPhone} has been added to the active blocklist.`
    });
  } catch (err) {
    console.error('[AdminController.addToBlocklist] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to block phone number.' });
  }
};

exports.unblockPhone = (req, res) => {
  try {
    const phone = req.params.phone;
    if (!phone) {
      return res.status(400).json({ success: false, message: 'Phone parameter is required.' });
    }

    const cleanPhone = phone.replace(/[\s-]/g, '');
    const result = db.prepare(`
      UPDATE blocklist 
      SET is_active = 0, updated_at = CURRENT_TIMESTAMP 
      WHERE phone = ?
    `).run(cleanPhone);

    if (result.changes === 0) {
      return res.status(404).json({ success: false, message: 'Phone number not found in blocklist.' });
    }

    console.log(`[Blocklist] Phone ${cleanPhone} unblocked by Admin #${req.user.id}`);

    return res.json({
      success: true,
      message: `Phone number ${cleanPhone} has been unblocked.`
    });
  } catch (err) {
    console.error('[AdminController.unblockPhone] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to unblock phone number.' });
  }
};
