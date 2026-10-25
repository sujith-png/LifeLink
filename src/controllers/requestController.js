const fs = require('fs');
const db = require('../config/database');
const { BLOOD_GROUPS, URGENCY_LEVELS } = require('../config/constants');
const { findMatchingDonors } = require('../services/matchingEngine');
const EscalationService = require('../services/escalationService');
const LifecycleService = require('../services/lifecycleService');
const DuplicateDetectionService = require('../services/duplicateDetectionService');
const ReportService = require('../services/reportService');
const TrustScoreService = require('../services/trustScoreService');
const { validateDocumentContent } = require('../middleware/upload');
const { validateAndNormalizeIndianPhone } = require('../utils/phoneValidator');

exports.createRequest = async (req, res) => {
  // Helper to safely remove uploaded file on any validation failure
  const cleanupUploadedFile = () => {
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (_) {}
    }
  };

  try {
    // 0. Compulsory Document Upload & Magic Bytes Content Validation
    const slipFile = req.file;
    if (!slipFile) {
      return res.status(400).json({
        success: false,
        message: "A hospital requisition slip or doctor's prescription is required to submit a blood request."
      });
    }

    const contentValidation = validateDocumentContent(slipFile.path);
    if (!contentValidation.valid) {
      cleanupUploadedFile();
      return res.status(400).json({
        success: false,
        message: contentValidation.message
      });
    }

    const {
      patient_name,
      blood_group,
      units_needed = 1,
      hospital_name,
      doctor_name,
      ward_bed,
      city,
      area_pincode,
      latitude,
      longitude,
      contact_phone,
      urgency = 'Urgent',
      needed_by,
      note,
      otp_code,
      firebase_token,
      confirm_separate_emergency = false
    } = req.body;

    // 1. Basic validation
    if (!patient_name || patient_name.trim().length < 2) {
      cleanupUploadedFile();
      return res.status(400).json({ success: false, message: 'Please provide the patient name.' });
    }

    if (!blood_group || !BLOOD_GROUPS.includes(blood_group.toUpperCase())) {
      cleanupUploadedFile();
      return res.status(400).json({
        success: false,
        message: `Invalid blood group. Allowed: ${BLOOD_GROUPS.join(', ')}`
      });
    }

    const units = parseInt(units_needed, 10);
    if (isNaN(units) || units < 1) {
      cleanupUploadedFile();
      return res.status(400).json({ success: false, message: 'Units needed must be at least 1 unit.' });
    }

    if (!hospital_name || hospital_name.trim().length < 2) {
      cleanupUploadedFile();
      return res.status(400).json({ success: false, message: 'Hospital name is required.' });
    }

    if (!city || city.trim().length < 2) {
      cleanupUploadedFile();
      return res.status(400).json({ success: false, message: 'City is required.' });
    }

    const phoneVal = validateAndNormalizeIndianPhone(contact_phone);
    if (!phoneVal.valid) {
      cleanupUploadedFile();
      return res.status(400).json({ success: false, message: phoneVal.message });
    }
    const cleanPhone = phoneVal.phone10;

    if (!needed_by) {
      cleanupUploadedFile();
      return res.status(400).json({ success: false, message: 'Please provide when blood is needed by (date & time).' });
    }

    const urgencyLevel = URGENCY_LEVELS.includes(urgency) ? urgency : 'Urgent';

    // 2. Blocklist check
    const isBlocked = db.prepare('SELECT id, reason FROM blocklist WHERE phone = ? AND is_active = 1').get(cleanPhone);
    if (isBlocked) {
      cleanupUploadedFile();
      return res.status(403).json({
        success: false,
        message: `This phone number has been blocked by administrators. Reason: ${isBlocked.reason}`
      });
    }

    // 3. Single active open request constraint per phone number
    const activeRequest = db.prepare(`
      SELECT id, patient_name, hospital_name, created_at 
      FROM requests 
      WHERE contact_phone = ? AND status = 'Open'
    `).get(cleanPhone);

    if (activeRequest) {
      cleanupUploadedFile();
      return res.status(400).json({
        success: false,
        message: `You already have an active open request (#${activeRequest.id} for ${activeRequest.patient_name} at ${activeRequest.hospital_name}). LifeLink limits to 1 open request per phone number to prevent duplicate broadcasts.`
      });
    }

    // 3b. Duplicate Emergency Detection Check
    const isConfirmSeparate = confirm_separate_emergency === true || confirm_separate_emergency === 'true';
    const dupCheck = DuplicateDetectionService.detectPotentialDuplicate({
      contact_phone: cleanPhone,
      hospital_name,
      blood_group,
      patient_name,
      city
    });

    if (dupCheck.isDuplicate && !isConfirmSeparate) {
      cleanupUploadedFile();
      return res.status(409).json({
        success: false,
        duplicateWarning: true,
        reason: dupCheck.reason,
        confidence: dupCheck.confidence,
        message: dupCheck.message,
        existingRequest: dupCheck.existingRequest
      });
    }

    // 4. Requisition slip file info (from multer)
    const slipFilename = slipFile.filename;
    const slipMimetype = slipFile.mimetype;

    // 6. Consistency & Heuristic Checks
    let isSuspicious = 0;
    const suspiciousReasons = [];

    if (units > 10) {
      isSuspicious = 1;
      suspiciousReasons.push('Unusually high blood units requested (>10 units). Hospital confirmation required.');
    }

    if (!doctor_name || doctor_name.trim().length < 3) {
      isSuspicious = 1;
      suspiciousReasons.push('Missing or incomplete attending doctor name.');
    }

    if (!ward_bed || ward_bed.trim().length < 2) {
      suspiciousReasons.push('Ward or bed number omitted.');
    }

    const suspiciousReasonStr = suspiciousReasons.length > 0 ? suspiciousReasons.join(' ') : null;

    // Initial verification tier
    const verificationStatus = 'Phone Verified';
    const documentStatus = 'PENDING';

    // 7. Insert Request into Database
    const requesterUserId = req.user ? req.user.id : null;

    const insertStmt = db.prepare(`
      INSERT INTO requests (
        requester_user_id, patient_name, blood_group, units_needed,
        hospital_name, doctor_name, ward_bed, city, area_pincode,
        latitude, longitude, contact_phone, urgency, needed_by, note,
        requisition_slip_filename, requisition_slip_mimetype,
        document_status, verification_status, status, otp_verified,
        is_suspicious, suspicious_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Open', 1, ?, ?)
    `);

    const result = insertStmt.run(
      requesterUserId,
      patient_name.trim(),
      blood_group.toUpperCase(),
      units,
      hospital_name.trim(),
      doctor_name ? doctor_name.trim() : null,
      ward_bed ? ward_bed.trim() : null,
      city.trim(),
      area_pincode ? area_pincode.trim() : null,
      latitude ? parseFloat(latitude) : null,
      longitude ? parseFloat(longitude) : null,
      cleanPhone,
      urgencyLevel,
      needed_by,
      note ? note.trim() : null,
      slipFilename,
      slipMimetype,
      documentStatus,
      verificationStatus,
      isSuspicious,
      suspiciousReasonStr
    );

    const newRequestId = Number(result.lastInsertRowid);
    const createdRequest = db.prepare('SELECT * FROM requests WHERE id = ?').get(newRequestId);

    // 8. Execute Matching Engine and Start Staged Escalation
    const matchedDonors = findMatchingDonors(createdRequest);
    const escalationResult = await EscalationService.startEscalation(newRequestId);

    console.log(`[Request #${newRequestId}] Successfully posted for ${patient_name} (${blood_group}) in ${city}. Matched ${matchedDonors.length} eligible donors. Stage 1 notified: ${escalationResult.notifiedCount}.`);

    return res.status(201).json({
      success: true,
      message: 'Emergency blood request created and broadcasted successfully.',
      request: {
        ...createdRequest,
        // Hide full phone in generic response payload
        contact_phone_masked: cleanPhone.slice(0, 3) + '*****' + cleanPhone.slice(-2)
      },
      matchedDonorsCount: matchedDonors.length,
      matchedDonors: matchedDonors.slice(0, 10), // First 10 closest donors
      escalation: escalationResult
    });
  } catch (error) {
    console.error('[RequestController.createRequest] Error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to submit emergency request.' });
  }
};

exports.getRequestById = (req, res) => {
  try {
    const requestId = parseInt(req.params.id, 10);
    const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId);

    if (!request) {
      return res.status(404).json({ success: false, message: 'Emergency request not found.' });
    }

    // Check if deadline has passed for open requests
    if (request.status === 'Open' && new Date(request.needed_by).getTime() < Date.now()) {
      LifecycleService.autoExpirePastDeadlineRequests();
      request.status = 'Expired';
    }

    const user = req.user;
    const isOwner = user && request.requester_user_id === user.id;
    const isAdmin = user && user.role === 'admin';

    // Check if current user is an accepted donor (and not withdrawn)
    let isAcceptedDonor = false;
    if (user && user.role === 'donor') {
      const donor = db.prepare('SELECT id FROM donors WHERE user_id = ?').get(user.id);
      if (donor) {
        const resp = db.prepare(`
          SELECT id FROM responses 
          WHERE request_id = ? AND donor_id = ? AND status IN (
            'Accepted', 'Availability Confirmed', 'On the Way', 'Arrived — Self-Reported', 'accepted'
          )
        `).get(requestId, donor.id);
        isAcceptedDonor = Boolean(resp);
      }
    }

    // Redact phone number unless authorized
    const canSeeContact = isOwner || isAdmin || isAcceptedDonor;
    const safeRequest = { ...request };
    if (!canSeeContact) {
      const p = request.contact_phone;
      safeRequest.contact_phone = p.slice(0, 3) + '*****' + p.slice(-2);
      safeRequest.can_view_contact = false;
    } else {
      safeRequest.can_view_contact = true;
    }

    // Hide internal slip file paths from public
    delete safeRequest.requisition_slip_filename;
    safeRequest.has_requisition_slip = Boolean(request.requisition_slip_filename);

    // Fetch accepted donors count
    const acceptedCount = db.prepare(`
      SELECT COUNT(*) as count FROM responses 
      WHERE request_id = ? AND status IN (
        'Accepted', 'Availability Confirmed', 'On the Way', 'Arrived — Self-Reported', 'accepted'
      )
    `).get(requestId);
    safeRequest.accepted_donors_count = acceptedCount ? acceptedCount.count : 0;

    // Attach requester trust score and badge
    safeRequest.trust_score = TrustScoreService.calculateScore({
      requesterUserId: request.requester_user_id,
      contactPhone: request.contact_phone
    });

    return res.json({
      success: true,
      request: safeRequest
    });
  } catch (error) {
    console.error('[RequestController.getRequestById] Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch request.' });
  }
};

exports.getMatchedDonors = (req, res) => {
  try {
    const requestId = parseInt(req.params.id, 10);
    const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId);

    if (!request) {
      return res.status(404).json({ success: false, message: 'Emergency request not found.' });
    }

    const matched = findMatchingDonors(request);

    return res.json({
      success: true,
      requestId,
      count: matched.length,
      donors: matched
    });
  } catch (error) {
    console.error('[RequestController.getMatchedDonors] Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to find matching donors.' });
  }
};

/**
 * Community moderation report submission
 */
exports.reportRequest = (req, res) => {
  try {
    const requestId = parseInt(req.params.id, 10);
    const { reason, details, reporter_phone } = req.body;
    const reporterIp = req.headers['x-forwarded-for'] || req.ip || req.connection.remoteAddress || '127.0.0.1';

    if (!reason) {
      return res.status(400).json({ success: false, message: 'Please specify a reason for reporting.' });
    }

    const result = ReportService.submitReport({
      requestId,
      reporterIp,
      reporterPhone: reporter_phone,
      reason,
      details
    });

    return res.status(200).json(result);
  } catch (err) {
    console.error('[RequestController.reportRequest] Error:', err);
    return res.status(400).json({ success: false, message: err.message || 'Failed to submit report.' });
  }
};

/**
 * Donor authenticity feedback submission
 */
exports.submitFeedback = (req, res) => {
  try {
    const requestId = parseInt(req.params.id, 10);
    const { was_genuine, comments } = req.body;
    const userId = req.user.id;

    const donor = db.prepare('SELECT id FROM donors WHERE user_id = ?').get(userId);
    if (!donor) {
      return res.status(403).json({ success: false, message: 'Only registered donors can submit authenticity feedback.' });
    }

    const result = TrustScoreService.submitFeedback({
      requestId,
      donorId: donor.id,
      wasGenuine: was_genuine,
      comments
    });

    return res.status(200).json(result);
  } catch (err) {
    console.error('[RequestController.submitFeedback] Error:', err);
    return res.status(400).json({ success: false, message: err.message || 'Failed to submit feedback.' });
  }
};

/**
 * Get Trust Score for request's owner
 */
exports.getTrustScore = (req, res) => {
  try {
    const requestId = parseInt(req.params.id, 10);
    const request = db.prepare('SELECT requester_user_id, contact_phone FROM requests WHERE id = ?').get(requestId);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Emergency request not found.' });
    }

    const scoreData = TrustScoreService.calculateScore({
      requesterUserId: request.requester_user_id,
      contactPhone: request.contact_phone
    });

    return res.json({
      success: true,
      requestId,
      ...scoreData
    });
  } catch (err) {
    console.error('[RequestController.getTrustScore] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to calculate trust score.' });
  }
};

/**
 * GET /api/requests - Public Emergency Board listing with multi-parameter filtering
 */
exports.getPublicRequests = (req, res) => {
  try {
    // 1. Auto-expire any overdue open requests first
    LifecycleService.autoExpirePastDeadlineRequests();

    const { blood_group, city, urgency, verification_status } = req.query;

    let query = `
      SELECT 
        r.id, r.patient_name, r.blood_group, r.units_needed, r.hospital_name,
        r.doctor_name, r.ward_bed, r.city, r.area_pincode, r.contact_phone,
        r.urgency, r.needed_by, r.note, r.verification_status, r.status,
        r.report_count, r.is_hidden, r.is_suspicious, r.created_at, r.requester_user_id,
        u.email as requester_email
      FROM requests r
      LEFT JOIN users u ON r.requester_user_id = u.id
      WHERE r.status = 'Open' AND r.is_hidden = 0
    `;
    const params = [];

    if (blood_group && blood_group.trim()) {
      query += ` AND r.blood_group = ? `;
      params.push(blood_group.trim().toUpperCase());
    }

    if (city && city.trim()) {
      query += ` AND LOWER(r.city) LIKE '%' || LOWER(?) || '%' `;
      params.push(city.trim());
    }

    if (urgency && urgency.trim()) {
      query += ` AND r.urgency = ? `;
      params.push(urgency.trim());
    }

    if (verification_status && verification_status.trim()) {
      query += ` AND r.verification_status = ? `;
      params.push(verification_status.trim());
    }

    query += `
      ORDER BY 
        CASE 
          WHEN r.urgency = 'Critical' THEN 1 
          WHEN r.urgency = 'Urgent' THEN 2 
          ELSE 3 
        END, 
        r.created_at DESC
    `;

    const rawRequests = db.prepare(query).all(...params);

    const user = req.user;
    const isAdmin = user && user.role === 'admin';

    // Enrich requests with trust badges, accepted donor counts, and privacy masking
    const enriched = rawRequests.map(r => {
      const isOwner = user && r.requester_user_id === user.id;

      // Check if logged-in donor has accepted
      let isAcceptedDonor = false;
      if (user && user.role === 'donor') {
        const donor = db.prepare('SELECT id FROM donors WHERE user_id = ?').get(user.id);
        if (donor) {
          const resp = db.prepare(`
            SELECT id FROM responses 
            WHERE request_id = ? AND donor_id = ? AND status IN (
              'Accepted', 'Availability Confirmed', 'On the Way', 'Arrived — Self-Reported', 'accepted'
            )
          `).get(r.id, donor.id);
          isAcceptedDonor = Boolean(resp);
        }
      }

      const canSeeContact = isOwner || isAdmin || isAcceptedDonor;
      const cleanPhone = r.contact_phone;
      const maskedPhone = cleanPhone.slice(0, 3) + '*****' + cleanPhone.slice(-2);

      // Trust score
      const trustScoreData = TrustScoreService.calculateScore({
        requesterUserId: r.requester_user_id,
        contactPhone: cleanPhone
      });

      // Accepted donor count
      const acceptedRow = db.prepare(`
        SELECT COUNT(*) as count FROM responses 
        WHERE request_id = ? AND status IN (
          'Accepted', 'Availability Confirmed', 'On the Way', 'Arrived — Self-Reported', 'accepted'
        )
      `).get(r.id);

      return {
        ...r,
        contact_phone: canSeeContact ? cleanPhone : maskedPhone,
        can_view_contact: canSeeContact,
        accepted_donors_count: acceptedRow ? acceptedRow.count : 0,
        trust_score: trustScoreData
      };
    });

    // Also get list of available cities with active requests for filter pills
    const activeCities = db.prepare(`
      SELECT DISTINCT city FROM requests WHERE status = 'Open' AND is_hidden = 0 ORDER BY city ASC
    `).all().map(c => c.city);

    return res.json({
      success: true,
      count: enriched.length,
      activeCities,
      requests: enriched
    });
  } catch (error) {
    console.error('[RequestController.getPublicRequests] Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve emergency requests.' });
  }
};
