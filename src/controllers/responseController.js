const db = require('../config/database');
const NotificationService = require('../services/notificationService');
const EscalationService = require('../services/escalationService');
const LifecycleService = require('../services/lifecycleService');
const { findMatchingDonors } = require('../services/matchingEngine');

exports.respondToRequest = async (req, res) => {
  try {
    const requestId = parseInt(req.params.id, 10);
    const { status, note, eta_minutes } = req.body;

    // Check that caller is a donor
    if (!req.donor) {
      return res.status(403).json({ success: false, message: 'Only registered donors can respond to emergency alerts.' });
    }

    const donorId = req.donor.id;

    // Check request state
    const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Emergency request not found.' });
    }

    if (request.status !== 'Open') {
      return res.status(400).json({
        success: false,
        message: `Cannot respond to an emergency request that is already ${request.status}.`
      });
    }

    // Normalize status
    const normalizedStatus = (status || '').toLowerCase() === 'accepted' ? 'Accepted' : 'Declined';
    const etaNum = eta_minutes ? parseInt(eta_minutes, 10) : null;

    // Upsert response
    db.prepare(`
      INSERT INTO responses (request_id, donor_id, status, eta_minutes, note, status_updated_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(request_id, donor_id) DO UPDATE SET
        status = excluded.status,
        eta_minutes = excluded.eta_minutes,
        note = excluded.note,
        withdrawal_reason = NULL,
        status_updated_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    `).run(requestId, donorId, normalizedStatus, etaNum, note || null);

    if (normalizedStatus === 'Accepted') {
      // Notify requester
      if (request.requester_user_id) {
        NotificationService.notifyRequester({
          requesterUserId: request.requester_user_id,
          requestId,
          type: 'donor_accepted',
          title: `🩸 Donor Accepted!`,
          message: `${req.donor.name} (${req.donor.blood_group}) accepted your emergency request at ${request.hospital_name}. ${etaNum ? 'ETA: ' + etaNum + ' mins.' : ''}`,
          metadata: {
            donor_id: donorId,
            donor_name: req.donor.name,
            blood_group: req.donor.blood_group,
            eta_minutes: etaNum
          }
        });
      }

      // Check if requirement is now met to pause escalation
      if (EscalationService.hasMetRequirement(request)) {
        db.prepare('UPDATE request_escalations SET is_escalating = 0 WHERE request_id = ?').run(requestId);
      }

      return res.json({
        success: true,
        status: 'Accepted',
        message: 'Thank you for accepting! The patient contact number is now unlocked below for coordination.',
        contact_phone: request.contact_phone, // Contact revealed only after acceptance
        request
      });
    } else {
      return res.json({
        success: true,
        status: 'Declined',
        message: 'Thank you for letting us know.'
      });
    }
  } catch (err) {
    console.error('[ResponseController.respondToRequest] Error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to submit response.' });
  }
};

exports.updateResponseStatus = async (req, res) => {
  try {
    const requestId = parseInt(req.params.id, 10);
    const { status, eta_minutes, eta_text, withdrawal_reason } = req.body;

    if (!req.donor) {
      return res.status(403).json({ success: false, message: 'Only donors can update commitment status.' });
    }

    const donorId = req.donor.id;
    const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found.' });
    }

    const existingResponse = db.prepare('SELECT * FROM responses WHERE request_id = ? AND donor_id = ?').get(requestId, donorId);
    if (!existingResponse) {
      return res.status(400).json({ success: false, message: 'No prior response found for this request.' });
    }

    const allowedTransitions = ['Availability Confirmed', 'On the Way', 'Arrived — Self-Reported', 'Withdrawn'];
    if (!allowedTransitions.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Allowed transitions: ${allowedTransitions.join(', ')}`
      });
    }

    const etaNum = eta_minutes !== undefined ? parseInt(eta_minutes, 10) : existingResponse.eta_minutes;

    db.prepare(`
      UPDATE responses 
      SET status = ?,
          eta_minutes = ?,
          eta_text = COALESCE(?, eta_text),
          withdrawal_reason = ?,
          status_updated_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE request_id = ? AND donor_id = ?
    `).run(status, etaNum, eta_text || null, withdrawal_reason || null, requestId, donorId);

    // Notifications and escalation adjustments
    if (status === 'Withdrawn') {
      if (request.requester_user_id) {
        NotificationService.notifyRequester({
          requesterUserId: request.requester_user_id,
          requestId,
          type: 'donor_withdrawn',
          title: `⚠️ Donor Withdrew`,
          message: `${req.donor.name} had to withdraw from request #${requestId}: ${withdrawal_reason || 'Unable to attend'}. LifeLink is checking for substitute donors.`,
          metadata: { donor_id: donorId, donor_name: req.donor.name }
        });
      }

      // Resume escalation if remaining donors < units needed
      await EscalationService.resumeEscalationIfDeficit(requestId);
    } else {
      if (request.requester_user_id) {
        NotificationService.notifyRequester({
          requesterUserId: request.requester_user_id,
          requestId,
          type: 'donor_status_updated',
          title: `Donor Status Update: ${status}`,
          message: `${req.donor.name} updated their status to "${status}". ${status === 'Arrived — Self-Reported' ? '(Note: Self-reported arrival)' : ''} ${etaNum ? 'ETA: ' + etaNum + ' mins.' : ''}`,
          metadata: { donor_id: donorId, status, eta_minutes: etaNum }
        });
      }
    }

    const updated = db.prepare('SELECT * FROM responses WHERE request_id = ? AND donor_id = ?').get(requestId, donorId);

    return res.json({
      success: true,
      message: `Status updated to ${status}.`,
      response: updated,
      // If donor withdrew, redact contact phone; otherwise retain it
      contact_phone: status === 'Withdrawn' ? null : request.contact_phone
    });
  } catch (err) {
    console.error('[ResponseController.updateResponseStatus] Error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to update response status.' });
  }
};

exports.getMyResponse = (req, res) => {
  try {
    const requestId = parseInt(req.params.id, 10);
    if (!req.donor) {
      return res.json({ success: true, response: null, can_view_contact: false });
    }

    const donorId = req.donor.id;
    const response = db.prepare('SELECT * FROM responses WHERE request_id = ? AND donor_id = ?').get(requestId, donorId);
    const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId);

    const isAcceptedActive = response && [
      'Accepted', 'Availability Confirmed', 'On the Way', 'Arrived — Self-Reported'
    ].includes(response.status);

    return res.json({
      success: true,
      response: response || null,
      can_view_contact: Boolean(isAcceptedActive),
      contact_phone: isAcceptedActive && request ? request.contact_phone : null
    });
  } catch (err) {
    console.error('[ResponseController.getMyResponse] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch donor response.' });
  }
};

exports.getAcceptedDonors = (req, res) => {
  try {
    const requestId = parseInt(req.params.id, 10);
    const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId);

    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found.' });
    }

    const user = req.user;
    const isOwner = user && request.requester_user_id === user.id;
    const isAdmin = user && user.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Access denied: Only the requester can view the accepted donor roster.' });
    }

    const donors = db.prepare(`
      SELECT 
        d.id as donor_id,
        d.name as donor_name,
        d.blood_group,
        d.city,
        d.area_pincode,
        d.phone,
        resp.status as commitment_status,
        resp.eta_minutes,
        resp.eta_text,
        resp.note,
        resp.withdrawal_reason,
        resp.status_updated_at,
        resp.created_at as accepted_at
      FROM responses resp
      JOIN donors d ON resp.donor_id = d.id
      WHERE resp.request_id = ?
      ORDER BY 
        CASE resp.status
          WHEN 'Arrived — Self-Reported' THEN 1
          WHEN 'On the Way' THEN 2
          WHEN 'Availability Confirmed' THEN 3
          WHEN 'Accepted' THEN 4
          WHEN 'Withdrawn' THEN 5
          ELSE 6
        END, resp.status_updated_at DESC
    `).all(requestId);

    return res.json({
      success: true,
      requestId,
      count: donors.length,
      donors
    });
  } catch (err) {
    console.error('[ResponseController.getAcceptedDonors] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch accepted donors.' });
  }
};

exports.getProgress = (req, res) => {
  try {
    const requestId = parseInt(req.params.id, 10);
    const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId);

    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found.' });
    }

    // Auto-check expiry if needed
    if (request.status === 'Open' && new Date(request.needed_by).getTime() < Date.now()) {
      LifecycleService.autoExpirePastDeadlineRequests();
      request.status = 'Expired';
    }

    // 1. Potential eligible matches
    const potentialMatches = findMatchingDonors(request).length;

    // 2. Donors notified count
    const notifiedRow = db.prepare(`
      SELECT COUNT(DISTINCT user_id) as count 
      FROM notifications 
      WHERE request_id = ? AND type = 'emergency_alert'
    `).get(requestId);
    const donorsNotified = notifiedRow ? notifiedRow.count : 0;

    // 3. Status breakdowns from responses table
    const counts = db.prepare(`
      SELECT 
        SUM(CASE WHEN status IN ('Accepted', 'Availability Confirmed', 'On the Way', 'Arrived — Self-Reported') THEN 1 ELSE 0 END) as accepted,
        SUM(CASE WHEN status = 'Availability Confirmed' THEN 1 ELSE 0 END) as availability_confirmed,
        SUM(CASE WHEN status = 'On the Way' THEN 1 ELSE 0 END) as on_the_way,
        SUM(CASE WHEN status = 'Arrived — Self-Reported' THEN 1 ELSE 0 END) as arrived,
        SUM(CASE WHEN status = 'Withdrawn' THEN 1 ELSE 0 END) as withdrawn,
        SUM(CASE WHEN status = 'Declined' THEN 1 ELSE 0 END) as declined
      FROM responses
      WHERE request_id = ?
    `).get(requestId);

    // 4. Escalation status
    const escalation = db.prepare('SELECT current_stage, is_escalating, next_escalation_at FROM request_escalations WHERE request_id = ?').get(requestId);

    return res.json({
      success: true,
      progress: {
        requestId,
        patientName: request.patient_name,
        bloodGroup: request.blood_group,
        unitsNeeded: request.units_needed,
        hospitalName: request.hospital_name,
        city: request.city,
        urgency: request.urgency,
        neededBy: request.needed_by,
        verificationStatus: request.verification_status,
        requestStatus: request.status,
        fulfillmentConfirmed: request.status === 'Fulfilled',
        fulfilmentStatus: request.status === 'Fulfilled' ? 'Confirmed' : 'Pending',
        potentialMatches,
        donorsNotified,
        accepted: counts.accepted || 0,
        availabilityConfirmed: counts.availability_confirmed || 0,
        onTheWay: counts.on_the_way || 0,
        reportedArrival: counts.arrived || 0,
        withdrawn: counts.withdrawn || 0,
        declined: counts.declined || 0,
        escalationStage: escalation ? escalation.current_stage : 1,
        isEscalating: escalation ? Boolean(escalation.is_escalating) : false
      }
    });
  } catch (err) {
    console.error('[ResponseController.getProgress] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch emergency progress.' });
  }
};

exports.fulfillRequest = (req, res) => {
  try {
    const requestId = parseInt(req.params.id, 10);
    const { notes } = req.body;
    const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId);

    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found.' });
    }

    const user = req.user;
    const isOwner = user && request.requester_user_id === user.id;
    const isAdmin = user && user.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Only the requester or an administrator can confirm fulfillment.' });
    }

    const result = LifecycleService.fulfillRequest(requestId, user.id, notes);
    return res.json({
      success: true,
      message: 'Emergency request confirmed fulfilled. Donor alerts halted.',
      request: result.request
    });
  } catch (err) {
    console.error('[ResponseController.fulfillRequest] Error:', err);
    return res.status(400).json({ success: false, message: err.message });
  }
};

exports.cancelRequest = (req, res) => {
  try {
    const requestId = parseInt(req.params.id, 10);
    const { reason } = req.body;
    const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId);

    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found.' });
    }

    const user = req.user;
    const isOwner = user && request.requester_user_id === user.id;
    const isAdmin = user && user.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Only the requester or an administrator can cancel this request.' });
    }

    const result = LifecycleService.cancelRequest(requestId, user.id, reason);
    return res.json({
      success: true,
      message: 'Emergency request cancelled. Active alerts halted.',
      request: result.request
    });
  } catch (err) {
    console.error('[ResponseController.cancelRequest] Error:', err);
    return res.status(400).json({ success: false, message: err.message });
  }
};
