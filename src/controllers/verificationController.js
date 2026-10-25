const path = require('path');
const fs = require('fs');
const db = require('../config/database');
const NotificationService = require('../services/notificationService');

exports.getVerificationQueue = (req, res) => {
  try {
    // Fetch requests that need verification or attention
    const queue = db.prepare(`
      SELECT 
        r.*,
        u.email as requester_email
      FROM requests r
      LEFT JOIN users u ON r.requester_user_id = u.id
      WHERE r.status = 'Open' 
         OR r.is_hidden = 1 
         OR r.is_suspicious = 1 
         OR r.report_count > 0 
         OR r.verification_status IN ('Unverified', 'Phone Verified')
      ORDER BY 
        CASE 
          WHEN r.is_hidden = 1 THEN 1
          WHEN r.is_suspicious = 1 THEN 2
          WHEN r.urgency = 'Critical' THEN 3
          WHEN r.report_count > 0 THEN 4
          ELSE 5
        END, r.created_at DESC
    `).all();

    // Attach matching verified blood bank / hospital official phone numbers
    const enrichedQueue = queue.map(r => {
      const hospitalMatch = db.prepare(`
        SELECT name, phone, official_hospital_phone, city, address 
        FROM blood_banks 
        WHERE LOWER(city) = LOWER(?) AND (
          LOWER(name) LIKE '%' || LOWER(?) || '%' OR
          LOWER(?) LIKE '%' || LOWER(name) || '%'
        )
        LIMIT 1
      `).get(r.city, r.hospital_name, r.hospital_name);

      return {
        ...r,
        has_slip: Boolean(r.requisition_slip_filename),
        document_status: r.document_status || (r.requisition_slip_filename ? 'PENDING' : 'MISSING'),
        document_rejection_reason: r.document_rejection_reason || null,
        official_hospital_contact: hospitalMatch || null
      };
    });

    return res.json({
      success: true,
      count: enrichedQueue.length,
      queue: enrichedQueue
    });
  } catch (err) {
    console.error('[VerificationController.getVerificationQueue] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch verification queue.' });
  }
};

exports.getRequisitionSlip = (req, res) => {
  try {
    const requestId = parseInt(req.params.id, 10);
    const request = db.prepare('SELECT requisition_slip_filename, requisition_slip_mimetype FROM requests WHERE id = ?').get(requestId);

    if (!request || !request.requisition_slip_filename) {
      return res.status(404).json({ success: false, message: 'Requisition slip not found for this request.' });
    }

    const filePath = path.resolve(__dirname, '../../uploads/requisitions', request.requisition_slip_filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'Slip file missing from storage.' });
    }

    res.setHeader('Content-Type', request.requisition_slip_mimetype || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${request.requisition_slip_filename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error('[VerificationController.getRequisitionSlip] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve requisition slip.' });
  }
};

/**
 * Real Document Verification: Approve or Reject Document
 * Requires authorized admin to inspect the document first.
 */
exports.verifyDocument = (req, res) => {
  try {
    const requestId = parseInt(req.params.id, 10);
    const { action, reason } = req.body;
    const adminUserId = req.user.id;

    const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Emergency request not found.' });
    }

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid action. Must be "approve" or "reject".'
      });
    }

    const oldDocStatus = request.document_status || (request.requisition_slip_filename ? 'PENDING' : 'MISSING');

    if (action === 'approve') {
      if (!request.requisition_slip_filename) {
        return res.status(400).json({
          success: false,
          message: 'Cannot approve document: No medical requisition slip exists for this request.'
        });
      }

      const filePath = path.resolve(__dirname, '../../uploads/requisitions', request.requisition_slip_filename);
      if (!fs.existsSync(filePath)) {
        return res.status(400).json({
          success: false,
          message: 'Cannot approve document: Requisition slip file is missing from server storage.'
        });
      }

      // Update document and request verification statuses
      db.prepare(`
        UPDATE requests 
        SET document_status = 'VERIFIED',
            document_verified_by = ?,
            document_verified_at = datetime('now'),
            document_rejection_reason = NULL,
            verification_status = CASE 
              WHEN verification_status IN ('Unverified', 'Phone Verified') THEN 'Document Verified'
              ELSE verification_status 
            END,
            is_suspicious = 0,
            suspicious_reason = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(adminUserId, requestId);

      // Record audit log
      db.prepare(`
        INSERT INTO verification_logs (request_id, admin_user_id, old_status, new_status, verification_method, notes)
        VALUES (?, ?, ?, 'VERIFIED', 'document_check', ?)
      `).run(
        requestId,
        adminUserId,
        oldDocStatus,
        'Admin verified and approved hospital requisition slip / prescription document.'
      );

      // Notify requester
      if (request.requester_user_id) {
        NotificationService.notifyRequester({
          requesterUserId: request.requester_user_id,
          requestId,
          type: 'request_verified',
          title: 'Document Verified 🛡️',
          message: `Your hospital requisition slip for request #${requestId} has been inspected and approved by hospital administrators.`
        });
      }

      const updated = db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId);
      console.log(`[Verification] Request #${requestId} document APPROVED by Admin #${adminUserId}`);

      return res.json({
        success: true,
        message: 'Medical requisition slip successfully verified and approved.',
        document_status: 'VERIFIED',
        request: updated
      });
    } else if (action === 'reject') {
      const rejectionReason = (reason || '').trim();
      if (!rejectionReason) {
        return res.status(400).json({
          success: false,
          message: 'A rejection reason is required to reject a medical document.'
        });
      }

      // Update document status to REJECTED and cancel the request
      db.prepare(`
        UPDATE requests 
        SET document_status = 'REJECTED',
            document_rejection_reason = ?,
            document_verified_by = ?,
            document_verified_at = datetime('now'),
            verification_status = 'Rejected',
            status = 'Cancelled',
            closed_at = datetime('now'),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(rejectionReason, adminUserId, requestId);

      // Halt escalations
      db.prepare('UPDATE request_escalations SET is_escalating = 0 WHERE request_id = ?').run(requestId);

      // Record audit log
      db.prepare(`
        INSERT INTO verification_logs (request_id, admin_user_id, old_status, new_status, verification_method, notes)
        VALUES (?, ?, ?, 'REJECTED', 'document_check', ?)
      `).run(
        requestId,
        adminUserId,
        oldDocStatus,
        `Document rejected by admin. Reason: ${rejectionReason}`
      );

      // Notify requester
      if (request.requester_user_id) {
        NotificationService.notifyRequester({
          requesterUserId: request.requester_user_id,
          requestId,
          type: 'request_rejected',
          title: 'Document Rejected ❌',
          message: `Your hospital requisition slip for request #${requestId} was rejected by administrators: ${rejectionReason}. The request has been cancelled.`
        });
      }

      const updated = db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId);
      console.log(`[Verification] Request #${requestId} document REJECTED by Admin #${adminUserId}: ${rejectionReason}`);

      return res.json({
        success: true,
        message: 'Medical document rejected and request cancelled.',
        document_status: 'REJECTED',
        request: updated
      });
    }
  } catch (err) {
    console.error('[VerificationController.verifyDocument] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update document verification status.' });
  }
};

exports.updateVerificationStatus = (req, res) => {
  try {
    const requestId = parseInt(req.params.id, 10);
    const { status, verification_method, notes } = req.body;
    const adminUserId = req.user.id;

    const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Emergency request not found.' });
    }

    const allowedStatuses = ['Document Verified', 'Hospital Confirmed', 'Rejected', 'Phone Verified'];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid verification status. Allowed: ${allowedStatuses.join(', ')}`
      });
    }

    const allowedMethods = ['phone_call_hospital', 'document_check', 'otp_automated', 'manual_review'];
    const method = allowedMethods.includes(verification_method) ? verification_method : 'manual_review';

    const oldStatus = request.verification_status;

    // Update request
    if (status === 'Rejected') {
      db.prepare(`
        UPDATE requests 
        SET verification_status = 'Rejected',
            document_status = 'REJECTED',
            document_rejection_reason = ?,
            document_verified_by = ?,
            document_verified_at = datetime('now'),
            status = 'Cancelled',
            closed_at = datetime('now'),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(notes || 'Information could not be verified', adminUserId, requestId);

      // Halt escalations
      db.prepare('UPDATE request_escalations SET is_escalating = 0 WHERE request_id = ?').run(requestId);

      // Notify requester
      if (request.requester_user_id) {
        NotificationService.notifyRequester({
          requesterUserId: request.requester_user_id,
          requestId,
          type: 'request_rejected',
          title: `Emergency Request Flagged as Rejected`,
          message: `Your emergency request #${requestId} was audited and rejected by hospital administrators: ${notes || 'Information could not be verified'}.`
        });
      }
    } else {
      const docStatusClause = status === 'Document Verified' 
        ? `, document_status = 'VERIFIED', document_verified_by = ${adminUserId}, document_verified_at = datetime('now'), document_rejection_reason = NULL` 
        : '';

      db.prepare(`
        UPDATE requests 
        SET verification_status = ?,
            is_suspicious = 0,
            suspicious_reason = NULL,
            updated_at = CURRENT_TIMESTAMP
            ${docStatusClause}
        WHERE id = ?
      `).run(status, requestId);

      // Notify requester of successful verification
      if (request.requester_user_id) {
        NotificationService.notifyRequester({
          requesterUserId: request.requester_user_id,
          requestId,
          type: 'request_verified',
          title: `Request Verified: ${status} 🛡️`,
          message: `Great news! Your request #${requestId} has been officially upgraded to "${status}". Donors will see this verified trust badge immediately.`
        });
      }
    }

    // Record audit log
    db.prepare(`
      INSERT INTO verification_logs (request_id, admin_user_id, old_status, new_status, verification_method, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(requestId, adminUserId, oldStatus, status, method, notes || '');

    const updated = db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId);

    console.log(`[Verification] Request #${requestId} status updated from ${oldStatus} to ${status} by Admin #${adminUserId}`);

    return res.json({
      success: true,
      message: `Request verification updated to ${status}.`,
      request: updated
    });
  } catch (err) {
    console.error('[VerificationController.updateVerificationStatus] Error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to update verification status.' });
  }
};

exports.getVerificationLogs = (req, res) => {
  try {
    const requestId = req.params.id ? parseInt(req.params.id, 10) : null;
    let logs;

    if (requestId) {
      logs = db.prepare(`
        SELECT v.*, u.email as admin_email
        FROM verification_logs v
        JOIN users u ON v.admin_user_id = u.id
        WHERE v.request_id = ?
        ORDER BY v.created_at DESC
      `).all(requestId);
    } else {
      logs = db.prepare(`
        SELECT v.*, u.email as admin_email, r.patient_name, r.hospital_name
        FROM verification_logs v
        JOIN users u ON v.admin_user_id = u.id
        JOIN requests r ON v.request_id = r.id
        ORDER BY v.created_at DESC
        LIMIT 50
      `).all();
    }

    return res.json({
      success: true,
      count: logs.length,
      logs
    });
  } catch (err) {
    console.error('[VerificationController.getVerificationLogs] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch verification logs.' });
  }
};
