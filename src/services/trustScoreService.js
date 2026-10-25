const db = require('../config/database');

class TrustScoreService {
  /**
   * Submit post-donation authenticity feedback from an accepted donor
   */
  static submitFeedback({ requestId, donorId, wasGenuine, comments = '' }) {
    // 1. Verify caller was actually an accepted donor for this request
    const response = db.prepare(`
      SELECT id, status FROM responses 
      WHERE request_id = ? AND donor_id = ?
    `).get(requestId, donorId);

    if (!response) {
      throw new Error('Only donors connected to this emergency request can submit feedback.');
    }

    const validAnswers = ['yes', 'no', 'not_sure'];
    if (!validAnswers.includes(wasGenuine)) {
      throw new Error('Invalid answer. Must be yes, no, or not_sure.');
    }

    db.prepare(`
      INSERT INTO feedback (request_id, donor_id, was_genuine, comments)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(request_id, donor_id) DO UPDATE SET
        was_genuine = excluded.was_genuine,
        comments = excluded.comments,
        created_at = CURRENT_TIMESTAMP
    `).run(requestId, donorId, wasGenuine, comments || '');

    console.log(`[TrustScoreService] Feedback recorded for Request #${requestId} by Donor #${donorId}: wasGenuine=${wasGenuine}`);
    return { success: true, message: 'Thank you for verifying the authenticity of this request.' };
  }

  /**
   * Calculate Trust Score and badge for a requester
   */
  static calculateScore({ requesterUserId = null, contactPhone = null }) {
    let requests = [];

    if (requesterUserId) {
      requests = db.prepare('SELECT * FROM requests WHERE requester_user_id = ?').all(requesterUserId);
    } else if (contactPhone) {
      const cleanPhone = contactPhone.replace(/[\s-]/g, '');
      requests = db.prepare('SELECT * FROM requests WHERE contact_phone = ?').all(cleanPhone);
    }

    if (requests.length === 0) {
      return {
        score: 10, // Starting baseline
        badge: 'New Requester',
        badgeIcon: '⚪',
        isTrusted: false,
        breakdown: {
          totalRequests: 0,
          fulfilledCount: 0,
          hospitalConfirmedCount: 0,
          documentVerifiedCount: 0,
          rejectedCount: 0,
          genuineFeedbackCount: 0,
          fraudFeedbackCount: 0
        }
      };
    }

    const reqIds = requests.map(r => r.id);
    const placeholders = reqIds.map(() => '?').join(',');

    // Feedback counts
    const feedbackRows = db.prepare(`
      SELECT was_genuine, COUNT(*) as count 
      FROM feedback 
      WHERE request_id IN (${placeholders})
      GROUP BY was_genuine
    `).all(...reqIds);

    let genuineCount = 0;
    let notGenuineCount = 0;
    for (const f of feedbackRows) {
      if (f.was_genuine === 'yes') genuineCount += f.count;
      if (f.was_genuine === 'no') notGenuineCount += f.count;
    }

    let fulfilledCount = 0;
    let hospitalConfirmedCount = 0;
    let documentVerifiedCount = 0;
    let rejectedCount = 0;
    let phoneVerifiedCount = 0;

    for (const r of requests) {
      if (r.status === 'Fulfilled') fulfilledCount++;
      if (r.verification_status === 'Hospital Confirmed') hospitalConfirmedCount++;
      else if (r.verification_status === 'Document Verified') documentVerifiedCount++;
      else if (r.verification_status === 'Phone Verified') phoneVerifiedCount++;
      else if (r.verification_status === 'Rejected') rejectedCount++;
    }

    // Mathematical Trust Score Formula
    let score =
      (fulfilledCount * 25) +
      (hospitalConfirmedCount * 20) +
      (documentVerifiedCount * 10) +
      (phoneVerifiedCount * 5) +
      (genuineCount * 15) -
      (rejectedCount * 35) -
      (notGenuineCount * 30);

    // Floor at 0 for normal accounts
    let badge = 'Standard Requester';
    let badgeIcon = '⚪';
    let isTrusted = false;

    if (score >= 50) {
      badge = 'Trusted Requester';
      badgeIcon = '🌟';
      isTrusted = true;
    } else if (score >= 25) {
      badge = 'Verified Requester';
      badgeIcon = '🛡️';
    } else if (score < 0 || rejectedCount > 0) {
      badge = 'Under Review';
      badgeIcon = '⚠️';
    }

    return {
      score,
      badge,
      badgeIcon,
      isTrusted,
      breakdown: {
        totalRequests: requests.length,
        fulfilledCount,
        hospitalConfirmedCount,
        documentVerifiedCount,
        phoneVerifiedCount,
        rejectedCount,
        genuineCount,
        notGenuineCount
      }
    };
  }
}

module.exports = TrustScoreService;
