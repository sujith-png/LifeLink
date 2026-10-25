const db = require('../config/database');
const { findMatchingDonors } = require('./matchingEngine');
const NotificationService = require('./notificationService');

// Configurable Escalation Policy
const ESCALATION_CONFIG = {
  STAGE_1_STANDARD_BATCH: 3,
  STAGE_1_CRITICAL_BATCH: 6,
  STAGE_2_BATCH: 4,
  STAGE_3_BATCH: 8,
  STAGE_INTERVAL_MINUTES: 5 // Default wait time before stage escalation
};

class EscalationService {
  /**
   * Initializes or gets the escalation tracking record for an emergency request
   */
  static getOrCreateEscalationRecord(requestId) {
    let record = db.prepare('SELECT * FROM request_escalations WHERE request_id = ?').get(requestId);

    if (!record) {
      db.prepare(`
        INSERT INTO request_escalations (
          request_id, current_stage, is_escalating, donors_notified_count, next_escalation_at
        ) VALUES (?, 1, 1, 0, datetime('now', '+${ESCALATION_CONFIG.STAGE_INTERVAL_MINUTES} minutes'))
      `).run(requestId);

      record = db.prepare('SELECT * FROM request_escalations WHERE request_id = ?').get(requestId);
    }

    return record;
  }

  /**
   * Check if a request has met its active response requirement
   */
  static hasMetRequirement(request) {
    const commitments = db.prepare(`
      SELECT COUNT(*) as count FROM responses 
      WHERE request_id = ? AND status IN ('Accepted', 'Availability Confirmed', 'On the Way', 'Arrived — Self-Reported')
    `).get(request.id);

    return (commitments && commitments.count >= request.units_needed);
  }

  /**
   * Start Stage 1 escalation when a new emergency request is created
   */
  static async startEscalation(requestId) {
    const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId);
    if (!request || request.status !== 'Open') {
      return { success: false, reason: 'Request is not open' };
    }

    // 1. Find all eligible, compatible donors sorted by proximity
    const matchedDonors = findMatchingDonors(request);

    // 2. Fetch existing notified donor user IDs to avoid duplicates
    const alreadyNotifiedUserIds = new Set(
      db.prepare(`
        SELECT user_id FROM notifications 
        WHERE request_id = ? AND type = 'emergency_alert'
      `).all(requestId).map(n => n.user_id)
    );

    const eligibleUnnotified = matchedDonors.filter(d => !alreadyNotifiedUserIds.has(d.user_id));

    // Determine batch size based on urgency
    const isCritical = request.urgency === 'Critical';
    const batchSize = isCritical
      ? ESCALATION_CONFIG.STAGE_1_CRITICAL_BATCH
      : ESCALATION_CONFIG.STAGE_1_STANDARD_BATCH;

    const stage1Donors = eligibleUnnotified.slice(0, batchSize);

    // 3. Dispatch notifications to Stage 1 donors
    let notifiedCount = 0;
    for (const donor of stage1Donors) {
      // Fetch phone and email needed for dispatch
      const donorDetail = db.prepare(`
        SELECT d.id, d.user_id, d.name, d.phone, u.email as user_email
        FROM donors d
        JOIN users u ON d.user_id = u.id
        WHERE d.id = ?
      `).get(donor.id);

      if (donorDetail) {
        const res = await NotificationService.notifyDonorOfEmergency({
          donor: donorDetail,
          request,
          stage: 1
        });
        if (res.success) notifiedCount++;
      }
    }

    // 4. Update or insert escalation record
    const nextEscalationAt = new Date(Date.now() + ESCALATION_CONFIG.STAGE_INTERVAL_MINUTES * 60 * 1000).toISOString();

    db.prepare(`
      INSERT INTO request_escalations (
        request_id, current_stage, stage_1_dispatched_at, next_escalation_at,
        is_escalating, donors_notified_count, last_evaluated_at
      ) VALUES (?, 1, CURRENT_TIMESTAMP, ?, 1, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(request_id) DO UPDATE SET
        current_stage = 1,
        stage_1_dispatched_at = CURRENT_TIMESTAMP,
        next_escalation_at = excluded.next_escalation_at,
        is_escalating = 1,
        donors_notified_count = donors_notified_count + excluded.donors_notified_count,
        last_evaluated_at = CURRENT_TIMESTAMP
    `).run(requestId, nextEscalationAt, notifiedCount);

    console.log(`[Escalation] Request #${requestId}: Stage 1 dispatched to ${notifiedCount} nearest donor(s). Next evaluation at ${nextEscalationAt}`);

    return {
      success: true,
      stage: 1,
      notifiedCount,
      totalMatched: matchedDonors.length
    };
  }

  /**
   * Evaluates escalation and triggers next stage if needed
   */
  static async evaluateEscalation(requestId) {
    const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId);
    if (!request || request.status !== 'Open') {
      // Request closed, expired, or cancelled -> stop escalation
      db.prepare('UPDATE request_escalations SET is_escalating = 0 WHERE request_id = ?').run(requestId);
      return { success: false, reason: 'Request is not open' };
    }

    // Check if responses already fulfill units needed
    if (this.hasMetRequirement(request)) {
      db.prepare('UPDATE request_escalations SET is_escalating = 0 WHERE request_id = ?').run(requestId);
      console.log(`[Escalation] Request #${requestId}: Requirement met. Pausing escalation.`);
      return { success: true, escalated: false, reason: 'Requirement met by current commitments' };
    }

    const escalation = this.getOrCreateEscalationRecord(requestId);
    const nextStage = escalation.current_stage + 1;

    if (nextStage > 3 && escalation.donors_notified_count > 0) {
      // Reached max stages, but we can keep checking in case new donors register
      const nextCheck = new Date(Date.now() + ESCALATION_CONFIG.STAGE_INTERVAL_MINUTES * 60 * 1000).toISOString();
      db.prepare(`
        UPDATE request_escalations 
        SET next_escalation_at = ?, last_evaluated_at = CURRENT_TIMESTAMP 
        WHERE request_id = ?
      `).run(nextCheck, requestId);
      return { success: true, escalated: false, reason: 'Max escalation stages reached for current candidate pool' };
    }

    // Find eligible donors not yet notified
    const matchedDonors = findMatchingDonors(request);
    const alreadyNotifiedUserIds = new Set(
      db.prepare(`
        SELECT user_id FROM notifications 
        WHERE request_id = ? AND type = 'emergency_alert'
      `).all(requestId).map(n => n.user_id)
    );

    const eligibleUnnotified = matchedDonors.filter(d => !alreadyNotifiedUserIds.has(d.user_id));

    if (eligibleUnnotified.length === 0) {
      console.log(`[Escalation] Request #${requestId}: No additional eligible donors available in radius.`);
      const nextCheck = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      db.prepare(`
        UPDATE request_escalations 
        SET next_escalation_at = ?, last_evaluated_at = CURRENT_TIMESTAMP 
        WHERE request_id = ?
      `).run(nextCheck, requestId);
      return { success: true, escalated: false, reason: 'No new eligible donors in radius' };
    }

    const batchSize = nextStage === 2 ? ESCALATION_CONFIG.STAGE_2_BATCH : ESCALATION_CONFIG.STAGE_3_BATCH;
    const nextBatch = eligibleUnnotified.slice(0, batchSize);

    let newlyNotifiedCount = 0;
    for (const donor of nextBatch) {
      const donorDetail = db.prepare(`
        SELECT d.id, d.user_id, d.name, d.phone, u.email as user_email
        FROM donors d
        JOIN users u ON d.user_id = u.id
        WHERE d.id = ?
      `).get(donor.id);

      if (donorDetail) {
        const res = await NotificationService.notifyDonorOfEmergency({
          donor: donorDetail,
          request,
          stage: nextStage
        });
        if (res.success) newlyNotifiedCount++;
      }
    }

    const stageColumn = nextStage === 2 ? 'stage_2_dispatched_at' : 'stage_3_dispatched_at';
    const nextEscalationAt = new Date(Date.now() + ESCALATION_CONFIG.STAGE_INTERVAL_MINUTES * 60 * 1000).toISOString();

    db.prepare(`
      UPDATE request_escalations
      SET current_stage = ?,
          ${stageColumn} = CURRENT_TIMESTAMP,
          next_escalation_at = ?,
          donors_notified_count = donors_notified_count + ?,
          last_evaluated_at = CURRENT_TIMESTAMP,
          is_escalating = 1
      WHERE request_id = ?
    `).run(nextStage, nextEscalationAt, newlyNotifiedCount, requestId);

    console.log(`[Escalation] Request #${requestId}: Escalated to Stage ${nextStage}, notified ${newlyNotifiedCount} additional donor(s).`);

    return {
      success: true,
      escalated: true,
      stage: nextStage,
      notifiedCount: newlyNotifiedCount
    };
  }

  /**
   * Resumes escalation when an accepted donor withdraws and a deficit exists
   */
  static async resumeEscalationIfDeficit(requestId) {
    const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId);
    if (!request || request.status !== 'Open') return;

    if (!this.hasMetRequirement(request)) {
      console.log(`[Escalation] Deficit detected for Request #${requestId} after donor withdrawal. Resuming escalation...`);
      db.prepare(`
        UPDATE request_escalations 
        SET is_escalating = 1, next_escalation_at = datetime('now') 
        WHERE request_id = ?
      `).run(requestId);

      // Immediately evaluate and dispatch to the next eligible donor
      await this.evaluateEscalation(requestId);
    }
  }

  /**
   * Resilient cron/tick processor for all due escalations across the database
   */
  static async processDueEscalations() {
    try {
      const dueRecords = db.prepare(`
        SELECT request_id FROM request_escalations
        WHERE is_escalating = 1 
          AND next_escalation_at <= datetime('now')
      `).all();

      for (const row of dueRecords) {
        await this.evaluateEscalation(row.request_id);
      }
    } catch (err) {
      console.error('[Escalation] Periodic runner error:', err.message);
    }
  }
}

module.exports = EscalationService;
