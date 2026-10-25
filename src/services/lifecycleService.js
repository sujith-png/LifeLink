const db = require('../config/database');
const NotificationService = require('./notificationService');

class LifecycleService {
  /**
   * Log status transition in audit trail
   */
  static logTransition(requestId, actorUserId, previousStatus, newStatus, reason = '') {
    db.prepare(`
      INSERT INTO request_lifecycle_logs (request_id, actor_user_id, previous_status, new_status, reason)
      VALUES (?, ?, ?, ?, ?)
    `).run(requestId, actorUserId || null, previousStatus, newStatus, reason || '');
  }

  /**
   * Automatically expires all requests whose needed_by timestamp has passed
   */
  static autoExpirePastDeadlineRequests() {
    try {
      const expiredRequests = db.prepare(`
        SELECT id, patient_name, requester_user_id, status 
        FROM requests 
        WHERE status = 'Open' AND needed_by < datetime('now')
      `).all();

      for (const req of expiredRequests) {
        db.prepare(`
          UPDATE requests 
          SET status = 'Expired', closed_at = datetime('now'), updated_at = CURRENT_TIMESTAMP 
          WHERE id = ?
        `).run(req.id);

        // Stop escalations
        db.prepare(`
          UPDATE request_escalations SET is_escalating = 0 WHERE request_id = ?
        `).run(req.id);

        this.logTransition(req.id, null, 'Open', 'Expired', 'Auto-expired: needed_by deadline passed');

        // Notify requester
        if (req.requester_user_id) {
          NotificationService.notifyRequester({
            requesterUserId: req.requester_user_id,
            requestId: req.id,
            type: 'request_expired',
            title: `Request #${req.id} Has Expired`,
            message: `The needed-by deadline for patient ${req.patient_name} has passed. The emergency request has been automatically closed.`
          });
        }

        console.log(`[Lifecycle] Request #${req.id} for ${req.patient_name} automatically transitioned to Expired.`);
      }

      return expiredRequests.length;
    } catch (err) {
      console.error('[Lifecycle.autoExpirePastDeadlineRequests] Error:', err.message);
      return 0;
    }
  }

  /**
   * Fulfill a request (explicitly confirmed by requester or admin)
   */
  static fulfillRequest(requestId, actorUserId, notes = '') {
    const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId);
    if (!request) {
      throw new Error('Emergency request not found.');
    }

    if (request.status !== 'Open') {
      throw new Error(`Cannot fulfill request: Current status is already ${request.status}.`);
    }

    // Update status
    db.prepare(`
      UPDATE requests 
      SET status = 'Fulfilled',
          fulfillment_confirmed_at = datetime('now'),
          fulfillment_notes = ?,
          closed_at = datetime('now'),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(notes || 'Fulfilment confirmed by requester', requestId);

    // Stop all escalations
    db.prepare(`
      UPDATE request_escalations SET is_escalating = 0 WHERE request_id = ?
    `).run(requestId);

    this.logTransition(requestId, actorUserId, 'Open', 'Fulfilled', notes || 'Fulfillment confirmed');

    // Notify all accepted donors with a heartfelt thank you message!
    const acceptedDonors = db.prepare(`
      SELECT d.user_id, d.name
      FROM responses resp
      JOIN donors d ON resp.donor_id = d.id
      WHERE resp.request_id = ? AND resp.status IN (
        'Accepted', 'Availability Confirmed', 'On the Way', 'Arrived — Self-Reported'
      )
    `).all(requestId);

    for (const donor of acceptedDonors) {
      NotificationService.sendInApp({
        userId: donor.user_id,
        requestId,
        type: 'request_fulfilled',
        title: `🎉 Blood Requirement Fulfilled!`,
        message: `Thank you ${donor.name}! The blood requirement for ${request.patient_name} at ${request.hospital_name} has been confirmed fulfilled.`
      });
    }

    console.log(`[Lifecycle] Request #${requestId} confirmed Fulfilled by user #${actorUserId}. Alerting stopped.`);
    return { success: true, request: { ...request, status: 'Fulfilled' } };
  }

  /**
   * Cancel an open request
   */
  static cancelRequest(requestId, actorUserId, reason = '') {
    const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId);
    if (!request) {
      throw new Error('Emergency request not found.');
    }

    if (request.status !== 'Open') {
      throw new Error(`Cannot cancel request: Current status is already ${request.status}.`);
    }

    db.prepare(`
      UPDATE requests 
      SET status = 'Cancelled', closed_at = datetime('now'), updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(requestId);

    db.prepare(`
      UPDATE request_escalations SET is_escalating = 0 WHERE request_id = ?
    `).run(requestId);

    this.logTransition(requestId, actorUserId, 'Open', 'Cancelled', reason || 'Cancelled by user');

    // Notify accepted donors of cancellation so they don't travel unnecessarily
    const acceptedDonors = db.prepare(`
      SELECT d.user_id, d.name
      FROM responses resp
      JOIN donors d ON resp.donor_id = d.id
      WHERE resp.request_id = ? AND resp.status IN (
        'Accepted', 'Availability Confirmed', 'On the Way', 'Arrived — Self-Reported'
      )
    `).all(requestId);

    for (const donor of acceptedDonors) {
      NotificationService.sendInApp({
        userId: donor.user_id,
        requestId,
        type: 'request_cancelled',
        title: `Emergency Request Cancelled`,
        message: `The blood request for ${request.patient_name} at ${request.hospital_name} was cancelled by the requester: ${reason || 'Requirement resolved or cancelled.'}`
      });
    }

    console.log(`[Lifecycle] Request #${requestId} Cancelled by user #${actorUserId}.`);
    return { success: true, request: { ...request, status: 'Cancelled' } };
  }

  /**
   * Reopen a request (Admin or authorized workflow)
   */
  static reopenRequest(requestId, actorUserId, reason = '') {
    const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId);
    if (!request) {
      throw new Error('Emergency request not found.');
    }

    const prevStatus = request.status;
    db.prepare(`
      UPDATE requests 
      SET status = 'Open', closed_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(requestId);

    db.prepare(`
      UPDATE request_escalations 
      SET is_escalating = 1, next_escalation_at = datetime('now') 
      WHERE request_id = ?
    `).run(requestId);

    this.logTransition(requestId, actorUserId, prevStatus, 'Open', reason || 'Reopened by admin');

    console.log(`[Lifecycle] Request #${requestId} Reopened by user #${actorUserId}.`);
    return { success: true, request: { ...request, status: 'Open' } };
  }
}

module.exports = LifecycleService;
