process.env.NODE_ENV = 'test';
const app = require('../src/app');
const db = require('../src/config/database');
const jwt = require('jsonwebtoken');
const { ensureAdminUser } = require('../src/db/seedAdmin');
const { seedBloodBanks } = require('../src/db/seedBloodBanks');
const { runMigrations } = require('../src/db/migrate');
const OtpService = require('../src/services/otpService');

runMigrations();
ensureAdminUser();
seedBloodBanks();

const PORT = 4005;
const server = app.listen(PORT, async () => {
  console.log(`[Test] Server listening on port ${PORT}`);
  const baseUrl = `http://localhost:${PORT}/api`;

  async function post(url, data, token, customHeaders = {}) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...customHeaders
      },
      body: JSON.stringify(data)
    });
    return { status: res.status, data: await res.json() };
  }

  async function postForm(url, data, token, customHeaders = {}) {
    const form = new FormData();
    for (const [key, val] of Object.entries(data)) {
      if (val !== undefined && val !== null) {
        form.append(key, val);
      }
    }
    if (!data.requisition_slip) {
      const samplePdfBuf = Buffer.from("%PDF-1.4\n%LifeLinkTest\n%%EOF\n");
      const slipBlob = new Blob([samplePdfBuf], { type: 'application/pdf' });
      form.append('requisition_slip', slipBlob, 'slip.pdf');
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...customHeaders
      },
      body: form
    });
    return { status: res.status, data: await res.json() };
  }

  async function patch(url, data, token) {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify(data)
    });
    return { status: res.status, data: await res.json() };
  }

  async function get(url, token) {
    const res = await fetch(url, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });
    return { status: res.status, data: await res.json() };
  }

  try {
    const timestamp = Date.now();

    console.log('\n--- Setup: Admin Login ---');
    const adminLoginRes = await post(`${baseUrl}/auth/login`, {
      email: 'admin@lifelink.org',
      password: 'Admin@123'
    });
    if (adminLoginRes.status !== 200 || !adminLoginRes.data.token) {
      throw new Error('Admin login failed: ' + JSON.stringify(adminLoginRes.data));
    }
    const adminToken = adminLoginRes.data.token;
    console.log('✅ Admin authenticated successfully.');

    console.log('\n--- Setup: Register Donor & Requester ---');
    const donorEmail = `donor_${timestamp}@test.com`;
    const donorPhone = `9820${String(timestamp).slice(-6)}`;
    const donorOtp = await OtpService.generateOtp(donorPhone, 'registration');
    const donorReg = await post(`${baseUrl}/auth/register`, {
      email: donorEmail,
      password: 'Password@123',
      role: 'donor',
      name: 'Dr. Test Donor',
      phone: donorPhone,
      otp_code: donorOtp.code,
      blood_group: 'B+',
      city: 'Mumbai',
      area_pincode: '400050',
      latitude: 19.0514,
      longitude: 72.8295,
      last_donation_date: '2025-01-01',
      is_available: true
    });
    if (donorReg.status !== 201) {
      throw new Error('Donor registration failed: ' + JSON.stringify(donorReg.data));
    }
    const donorToken = donorReg.data.token;
    const donorId = donorReg.data.donor.id;
    console.log(`✅ Donor registered with ID #${donorId}`);

    console.log('\n--- Test 1: Emergency Request Creation with Verified Hospital ---');
    const reqPhone1 = `9811${String(timestamp).slice(-6)}`;
    const patientName = `P5Patient_${timestamp}`;
    const otp1 = await OtpService.generateOtp(reqPhone1, 'post_request');

    const createReq1 = await postForm(`${baseUrl}/requests`, {
      patient_name: patientName,
      blood_group: 'B+',
      units_needed: 2,
      hospital_name: 'Lilavati Hospital & Research Centre',
      doctor_name: 'Dr. Suresh Joshi',
      ward_bed: 'ICU Bed 12',
      city: 'Mumbai',
      area_pincode: '400050',
      contact_phone: reqPhone1,
      urgency: 'Critical',
      needed_by: new Date(Date.now() + 86400000).toISOString(),
      note: 'Urgent cardiac surgery',
      otp_code: otp1.code
    });

    if (createReq1.status !== 201) {
      throw new Error('Request 1 creation failed: ' + JSON.stringify(createReq1.data));
    }
    const req1Id = createReq1.data.request.id;
    console.log(`✅ Emergency Request #${req1Id} created. Initial verification_status: ${createReq1.data.request.verification_status}`);
    if (createReq1.data.request.verification_status !== 'Phone Verified') {
      throw new Error('Default verification_status should be "Phone Verified"');
    }

    console.log('\n--- Test 2: Duplicate Emergency Detection Engine ---');
    // Attempt to create another request for same patient and same hospital with another phone number
    const reqPhone2 = `9822${String(timestamp).slice(-6)}`;
    const otp2 = await OtpService.generateOtp(reqPhone2, 'post_request');

    const dupReqAttempt = await postForm(`${baseUrl}/requests`, {
      patient_name: patientName,
      blood_group: 'B+',
      units_needed: 2,
      hospital_name: 'Lilavati Hospital & Research Centre',
      doctor_name: 'Dr. Suresh Joshi',
      ward_bed: 'ICU Bed 12',
      city: 'Mumbai',
      contact_phone: reqPhone2,
      needed_by: new Date(Date.now() + 86400000).toISOString(),
      otp_code: otp2.code
    });

    console.log('Duplicate check status code:', dupReqAttempt.status);
    console.log('Duplicate warning message:', dupReqAttempt.data.message);
    if (dupReqAttempt.status !== 409 || !dupReqAttempt.data.duplicateWarning) {
      throw new Error('Duplicate emergency detection should reject with 409 and duplicateWarning=true');
    }
    console.log('✅ Duplicate emergency correctly detected and prevented broadcast.');

    // Now confirm with confirm_separate_emergency = true
    const confirmDupReq = await postForm(`${baseUrl}/requests`, {
      patient_name: patientName,
      blood_group: 'B+',
      units_needed: 2,
      hospital_name: 'Lilavati Hospital & Research Centre',
      doctor_name: 'Dr. Suresh Joshi',
      ward_bed: 'ICU Bed 14',
      city: 'Mumbai',
      contact_phone: reqPhone2,
      needed_by: new Date(Date.now() + 86400000).toISOString(),
      otp_code: otp2.code,
      confirm_separate_emergency: true
    });
    if (confirmDupReq.status !== 201) {
      throw new Error('Separate emergency bypass failed: ' + JSON.stringify(confirmDupReq.data));
    }
    const req2Id = confirmDupReq.data.request.id;
    console.log(`✅ Separate emergency successfully confirmed by user and created as #${req2Id}.`);

    console.log('\n--- Test 3: Community Reporting & Auto-Hide Threshold (3 Reports) ---');
    // Report 1
    const rep1 = await post(`${baseUrl}/requests/${req2Id}/report`, {
      reason: 'Spam / False Information',
      details: 'Patient name looks duplicate',
      reporter_phone: '9000000001'
    }, null, { 'x-forwarded-for': '192.168.1.1' });
    console.log('Report 1 status:', rep1.status, 'Report count:', rep1.data.reportCount, 'Auto-hidden:', rep1.data.isAutoHidden);
    if (rep1.status !== 200 || rep1.data.reportCount !== 1 || rep1.data.isAutoHidden) {
      throw new Error('Report 1 should record without auto-hide');
    }

    // Deduplication check: same reporter phone
    const repDup = await post(`${baseUrl}/requests/${req2Id}/report`, {
      reason: 'Repeated report',
      reporter_phone: '9000000001'
    }, null, { 'x-forwarded-for': '192.168.1.100' });
    if (repDup.status !== 400) {
      throw new Error('Duplicate report from same phone should be rejected');
    }
    console.log('✅ Duplicate report prevented correctly.');

    // Report 2
    const rep2 = await post(`${baseUrl}/requests/${req2Id}/report`, {
      reason: 'Suspected Fraud',
      details: 'Contact requested payment',
      reporter_phone: '9000000002'
    }, null, { 'x-forwarded-for': '192.168.1.2' });
    if (rep2.data.reportCount !== 2 || rep2.data.isAutoHidden) {
      throw new Error('Report 2 should record without auto-hide');
    }

    // Report 3: Reaches threshold of 3 -> MUST AUTO-HIDE
    const rep3 = await post(`${baseUrl}/requests/${req2Id}/report`, {
      reason: 'Fake Emergency',
      details: 'Hospital has no record',
      reporter_phone: '9000000003'
    }, null, { 'x-forwarded-for': '192.168.1.3' });
    console.log('Report 3 status:', rep3.status, 'Report count:', rep3.data.reportCount, 'Auto-hidden:', rep3.data.isAutoHidden);
    if (rep3.data.reportCount !== 3 || !rep3.data.isAutoHidden) {
      throw new Error('Request must auto-hide upon reaching 3 community reports');
    }

    const checkReq2Hidden = db.prepare('SELECT is_hidden, is_suspicious FROM requests WHERE id = ?').get(req2Id);
    const checkEsc2Halted = db.prepare('SELECT is_escalating FROM request_escalations WHERE request_id = ?').get(req2Id);
    if (checkReq2Hidden.is_hidden !== 1 || checkEsc2Halted.is_escalating !== 0) {
      throw new Error('Auto-hidden request must have is_hidden=1 and paused escalation');
    }
    console.log('✅ Request #2 automatically hidden and alerts paused at threshold.');

    console.log('\n--- Test 4: Admin Verification Queue & Hospital Cross-Match ---');
    const queueRes = await get(`${baseUrl}/admin/verification-queue`, adminToken);
    if (queueRes.status !== 200 || !queueRes.data.queue) {
      throw new Error('Failed to retrieve admin verification queue');
    }
    console.log(`Queue contains ${queueRes.data.count} items requiring review.`);

    const queueReq1 = queueRes.data.queue.find(q => q.id === req1Id);
    if (!queueReq1) {
      throw new Error('Request 1 not found in verification queue');
    }
    console.log('Hospital Cross-Match in Queue:');
    console.log('  Hospital Name in Request:   ', queueReq1.hospital_name);
    console.log('  Matched Verified Directory: ', queueReq1.official_hospital_contact?.name);
    console.log('  Official Landline Phone:    ', queueReq1.official_hospital_contact?.official_hospital_phone);
    if (!queueReq1.official_hospital_contact || !queueReq1.official_hospital_contact.official_hospital_phone) {
      throw new Error('Verification queue must supply official hospital directory landline for phone audit');
    }
    console.log('✅ Official hospital landline successfully linked for phone verification.');

    console.log('\n--- Test 5: Admin Verifies Request via Official Hospital Phone ---');
    const verifyRes = await patch(`${baseUrl}/admin/requests/${req1Id}/verify`, {
      status: 'Hospital Confirmed',
      verification_method: 'phone_call_hospital',
      notes: 'Called official landline (022-26751000). ICU desk confirmed Aarav Mehta is admitted in Bed 12.'
    }, adminToken);

    if (verifyRes.status !== 200 || verifyRes.data.request.verification_status !== 'Hospital Confirmed') {
      throw new Error('Failed to update verification status to Hospital Confirmed');
    }
    console.log('✅ Request #1 upgraded to "Hospital Confirmed" with official verification log.');

    // Check verification logs audit trail
    const auditRes = await get(`${baseUrl}/admin/verification-logs/${req1Id}`, adminToken);
    if (auditRes.status !== 200 || auditRes.data.logs.length === 0) {
      throw new Error('Verification log not found for request');
    }
    console.log('Audit log entry verification method:', auditRes.data.logs[0].verification_method);
    console.log('Audit log entry notes:', auditRes.data.logs[0].notes);

    console.log('\n--- Test 6: Admin Restores Auto-Hidden Request (Dismiss False Reports) ---');
    const restoreRes = await patch(`${baseUrl}/admin/requests/${req2Id}/restore`, {
      notes: 'Reviewed duplicate submission; verified separate emergency by family member.'
    }, adminToken);
    if (restoreRes.status !== 200) {
      throw new Error('Failed to restore hidden request: ' + JSON.stringify(restoreRes.data));
    }
    const checkRestored = db.prepare('SELECT is_hidden, report_count FROM requests WHERE id = ?').get(req2Id);
    if (checkRestored.is_hidden !== 0 || checkRestored.report_count !== 0) {
      throw new Error('Restored request must have is_hidden=0 and report_count=0');
    }
    console.log('✅ Auto-hidden request successfully restored and false reports dismissed.');

    console.log('\n--- Test 7: Private Requisition Slip Access Control ---');
    // Public/Donor attempt to view admin slip
    const donorSlipRes = await get(`${baseUrl}/admin/requests/${req1Id}/slip`, donorToken);
    console.log('Donor slip access status (should be 403):', donorSlipRes.status);
    if (donorSlipRes.status !== 403) {
      throw new Error('Non-admin users must be forbidden from requisition slip endpoint');
    }
    console.log('✅ Unauthorized slip access correctly blocked with 403 Forbidden.');

    console.log('\n--- Test 8: Donor Response & Post-Donation Authenticity Feedback ---');
    // Donor responds to Request 1
    const respondRes = await post(`${baseUrl}/requests/${req1Id}/respond`, {
      status: 'Accepted',
      eta_minutes: 20
    }, donorToken);
    if (respondRes.status !== 200) {
      throw new Error('Donor failed to accept request: ' + JSON.stringify(respondRes.data));
    }

    // Submit post-donation authenticity feedback
    const feedbackRes = await post(`${baseUrl}/requests/${req1Id}/feedback`, {
      was_genuine: 'yes',
      comments: 'Personally visited Lilavati Hospital ICU Bed 12. Verified genuine emergency and donated.'
    }, donorToken);
    if (feedbackRes.status !== 200) {
      throw new Error('Feedback submission failed: ' + JSON.stringify(feedbackRes.data));
    }
    console.log('✅ Donor feedback recorded successfully.');

    console.log('\n--- Test 9: Requester Trust Score Calculation & Trust Badge ---');
    // Mark Request 1 fulfilled
    await patch(`${baseUrl}/requests/${req1Id}/fulfill`, {
      notes: 'Blood units received'
    }, adminToken);

    const trustScoreRes = await get(`${baseUrl}/requests/${req1Id}/trust-score`);
    if (trustScoreRes.status !== 200) {
      throw new Error('Failed to get trust score');
    }
    console.log('Trust Score Data:', JSON.stringify(trustScoreRes.data));
    // Score calculation:
    // Fulfilled (+25) + Hospital Confirmed (+20) + Genuine Feedback (+15) = 60
    if (trustScoreRes.data.score < 50 || trustScoreRes.data.badge !== 'Trusted Requester') {
      throw new Error('Requester score should be >= 50 and carry "Trusted Requester" badge');
    }
    console.log(`✅ Trust Score: ${trustScoreRes.data.score} (${trustScoreRes.data.badgeIcon} ${trustScoreRes.data.badge})`);

    console.log('\n--- Test 10: Phone Blocklist Management & OTP Gatekeeper ---');
    const maliciousPhone = `9799${String(timestamp).slice(-6)}`;

    // Admin blocks malicious phone
    const blockRes = await post(`${baseUrl}/admin/blocklist`, {
      phone: maliciousPhone,
      reason: 'Confirmed fraudulent emergency request coordinator'
    }, adminToken);
    if (blockRes.status !== 200) {
      throw new Error('Failed to block phone');
    }
    console.log('✅ Phone blocked by admin.');

    // Malicious phone tries to register -> must be blocked with 403
    const regBlockedRes = await post(`${baseUrl}/auth/register`, {
      email: `malicious_${maliciousPhone}@test.com`,
      password: 'Password@123',
      role: 'donor',
      name: 'Malicious User',
      phone: maliciousPhone,
      blood_group: 'O+',
      city: 'Mumbai',
      area_pincode: '400001'
    });
    console.log('Register request for blocked phone status:', regBlockedRes.status, 'Message:', regBlockedRes.data.message);
    if (regBlockedRes.status !== 403) {
      throw new Error('Blocked phone must receive 403 on registration');
    }
    console.log('✅ Blocked phone successfully prevented from registering.');

    // Admin unblocks phone
    const unblockRes = await patch(`${baseUrl}/admin/blocklist/${maliciousPhone}/unblock`, {}, adminToken);
    if (unblockRes.status !== 200) {
      throw new Error('Failed to unblock phone');
    }
    console.log('✅ Phone successfully unblocked by admin.');

    console.log('\n✅ ALL PHASE 5 TESTS (VERIFICATION, HOSPITAL DIRECTORY CROSS-MATCH, AUTO-HIDE, MODERATION, TRUST SCORE & BLOCKLIST) PASSED!\n');
    server.close(() => {
      setTimeout(() => process.exit(0), 100);
    });
  } catch (err) {
    console.error('❌ Phase 5 test failed:', err);
    server.close(() => {
      setTimeout(() => process.exit(1), 100);
    });
  }
});
