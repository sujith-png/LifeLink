process.env.NODE_ENV = 'test';
const app = require('../src/app');
const db = require('../src/config/database');
const { ensureAdminUser } = require('../src/db/seedAdmin');
const { runMigrations } = require('../src/db/migrate');
const NotificationService = require('../src/services/notificationService');
const EscalationService = require('../src/services/escalationService');
const LifecycleService = require('../src/services/lifecycleService');
const OtpService = require('../src/services/otpService');

runMigrations();
ensureAdminUser();

const server = app.listen(4004, async () => {
  console.log('[Test] Server listening on port 4004');
  const baseUrl = 'http://localhost:4004/api';

  async function post(url, data, token) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify(data)
    });
    return { status: res.status, data: await res.json() };
  }

  async function postForm(url, data, token) {
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
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
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
    console.log('\n--- Test 1: Seed Dedicated Donors for Escalation & Commitment ---');
    // Seed 4 O- donors in Mumbai at different distances
    const createDonor = (email, name, phone, lat, lng) => {
      const uRes = db.prepare(`
        INSERT OR REPLACE INTO users (email, password_hash, role)
        VALUES (?, 'hash123', 'donor')
      `).run(email);
      const uId = Number(uRes.lastInsertRowid);

      db.prepare(`
        INSERT OR REPLACE INTO donors (
          user_id, name, phone, blood_group, city, area_pincode,
          latitude, longitude, last_donation_date, is_available
        ) VALUES (?, ?, ?, 'O-', 'Mumbai', '400001', ?, ?, datetime('now', '-100 days'), 1)
      `).run(uId, name, phone, lat, lng);

      return { userId: uId, name, phone };
    };

    const donor1 = createDonor('d1_phase4@test.com', 'Donor One', '9811111111', 18.9300, 72.8300);
    const donor2 = createDonor('d2_phase4@test.com', 'Donor Two', '9822222222', 18.9400, 72.8310);
    const donor3 = createDonor('d3_phase4@test.com', 'Donor Three', '9833333333', 18.9500, 72.8320);
    const donor4 = createDonor('d4_phase4@test.com', 'Donor Four', '9844444444', 18.9600, 72.8330);

    // Create a requester user
    const reqUserRes = db.prepare(`
      INSERT OR REPLACE INTO users (email, password_hash, role)
      VALUES ('requester_phase4@test.com', 'hash123', 'requester')
    `).run();
    const requesterUserId = Number(reqUserRes.lastInsertRowid);

    // Log in requester
    const reqLogin = await post(`${baseUrl}/auth/login`, {
      email: 'requester_phase4@test.com',
      password: 'Password123'
    });
    // In test environment, if password fails, generate token directly
    const jwt = require('jsonwebtoken');
    const { JWT_SECRET } = require('../src/middleware/auth');
    const requesterToken = jwt.sign({ id: requesterUserId, email: 'requester_phase4@test.com', role: 'requester' }, JWT_SECRET);
    const donor1Token = jwt.sign({ id: donor1.userId, email: 'd1_phase4@test.com', role: 'donor' }, JWT_SECRET);
    const donor2Token = jwt.sign({ id: donor2.userId, email: 'd2_phase4@test.com', role: 'donor' }, JWT_SECRET);

    console.log('\n--- Test 2: Create Emergency Request & Stage 1 Escalation ---');
    const testPhone = `980004${Math.floor(1000 + Math.random() * 9000)}`;
    const otp = await OtpService.generateOtp(testPhone, 'post_request');

    const reqPost = await postForm(`${baseUrl}/requests`, {
      patient_name: 'Anjali Sharma',
      blood_group: 'O-',
      units_needed: 2,
      hospital_name: 'Saifee Hospital',
      doctor_name: 'Dr. M. Merchant',
      ward_bed: 'Ward 4B',
      city: 'Mumbai',
      latitude: 18.9350,
      longitude: 72.8305,
      contact_phone: testPhone,
      urgency: 'Critical',
      needed_by: new Date(Date.now() + 10 * 3600 * 1000).toISOString(),
      otp_code: otp.code
    }, requesterToken);

    console.log('Post Status:', reqPost.status);
    console.log('Created Request ID:', reqPost.data.request?.id);
    console.log('Stage 1 Escalation Notified Count:', reqPost.data.escalation?.notifiedCount);
    const requestId = reqPost.data.request.id;

    if (reqPost.status !== 201 || !reqPost.data.escalation) {
      throw new Error('Request posting and Stage 1 escalation failed');
    }

    console.log('\n--- Test 3: Check In-App Notification Delivery to Donor 1 ---');
    const d1Notifs = await get(`${baseUrl}/notifications`, donor1Token);
    console.log('Donor 1 Notifications count:', d1Notifs.data.notifications?.length);
    console.log('Unread count:', d1Notifs.data.unreadCount);
    if (!d1Notifs.data.notifications || d1Notifs.data.notifications.length === 0) {
      throw new Error('Donor 1 should have received in-app notification');
    }

    const notifId = d1Notifs.data.notifications[0].id;
    const markReadRes = await patch(`${baseUrl}/notifications/${notifId}/read`, {}, donor1Token);
    console.log('Mark read status:', markReadRes.status);
    if (markReadRes.status !== 200) throw new Error('Mark read failed');

    console.log('\n--- Test 4: Duplicate Alert Prevention ---');
    const d1Record = db.prepare('SELECT d.*, u.email as user_email FROM donors d JOIN users u ON d.user_id = u.id WHERE d.user_id = ?').get(donor1.userId);
    const dupAlert = await NotificationService.notifyDonorOfEmergency({
      donor: d1Record,
      request: reqPost.data.request,
      stage: 1
    });
    console.log('Duplicate alert skipped:', dupAlert.success === false, 'Reason:', dupAlert.reason);
    if (dupAlert.success !== false || dupAlert.reason !== 'Already notified') {
      throw new Error('Duplicate notification to same donor was not prevented');
    }

    console.log('\n--- Test 5: Donor 1 Accepts -> Privacy Barrier Unlocks Requester Phone ---');
    // Prior to acceptance, public/unaccepted cannot see full phone
    const preCheck = await get(`${baseUrl}/requests/${requestId}`, donor1Token);
    console.log('Pre-acceptance phone masked:', preCheck.data.request.contact_phone);
    if (!preCheck.data.request.contact_phone.includes('*****')) {
      throw new Error('Contact phone must be masked prior to acceptance');
    }

    const acceptRes = await post(`${baseUrl}/requests/${requestId}/respond`, {
      status: 'Accepted',
      eta_minutes: 30,
      note: 'On my way from Marine Lines'
    }, donor1Token);

    console.log('Accept Response Status:', acceptRes.status);
    console.log('Unlocked contact phone in response:', acceptRes.data.contact_phone);
    if (acceptRes.status !== 200 || acceptRes.data.contact_phone !== testPhone) {
      throw new Error('Accepted donor was not granted access to requester contact');
    }

    console.log('\n--- Test 6: Donor 1 Updates Commitment: Avail Confirmed -> On the Way -> Arrived ---');
    const confRes = await patch(`${baseUrl}/requests/${requestId}/response-status`, {
      status: 'Availability Confirmed'
    }, donor1Token);
    console.log('Availability Confirmed status:', confRes.status);
    if (confRes.status !== 200) throw new Error('Failed to confirm availability');

    const otwRes = await patch(`${baseUrl}/requests/${requestId}/response-status`, {
      status: 'On the Way',
      eta_minutes: 15
    }, donor1Token);
    console.log('On the Way status:', otwRes.status);
    if (otwRes.status !== 200) throw new Error('Failed to set On the Way');

    const arrivedRes = await patch(`${baseUrl}/requests/${requestId}/response-status`, {
      status: 'Arrived — Self-Reported'
    }, donor1Token);
    console.log('Arrived status:', arrivedRes.status);
    if (arrivedRes.status !== 200 || arrivedRes.data.response.status !== 'Arrived — Self-Reported') {
      throw new Error('Failed to set Arrived — Self-Reported');
    }

    console.log('\n--- Test 7: Donor 2 Accepts then Withdraws -> Re-escalates Deficit ---');
    await post(`${baseUrl}/requests/${requestId}/respond`, {
      status: 'Accepted'
    }, donor2Token);

    const withdrawRes = await patch(`${baseUrl}/requests/${requestId}/response-status`, {
      status: 'Withdrawn',
      withdrawal_reason: 'Emergency call at workplace'
    }, donor2Token);

    console.log('Withdrawn status:', withdrawRes.status);
    console.log('Contact phone masked after withdrawal:', withdrawRes.data.contact_phone);
    if (withdrawRes.status !== 200 || withdrawRes.data.contact_phone !== null) {
      throw new Error('Withdrawn donor must have contact phone revoked');
    }

    console.log('\n--- Test 8: Requester Views Accepted Donors Live Roster ---');
    const rosterRes = await get(`${baseUrl}/requests/${requestId}/accepted-donors`, requesterToken);
    console.log('Roster count:', rosterRes.data.count);
    console.log('Roster donors:', rosterRes.data.donors?.map(d => ({ name: d.donor_name, status: d.commitment_status })));
    if (rosterRes.status !== 200 || rosterRes.data.count < 1) {
      throw new Error('Requester should be able to view accepted donors');
    }

    console.log('\n--- Test 9: Emergency Progress Tracker Breakdown ---');
    const progRes = await get(`${baseUrl}/requests/${requestId}/progress`);
    console.log('Progress metrics:', {
      potentialMatches: progRes.data.progress.potentialMatches,
      donorsNotified: progRes.data.progress.donorsNotified,
      accepted: progRes.data.progress.accepted,
      availabilityConfirmed: progRes.data.progress.availabilityConfirmed,
      onTheWay: progRes.data.progress.onTheWay,
      reportedArrival: progRes.data.progress.reportedArrival,
      withdrawn: progRes.data.progress.withdrawn,
      fulfilmentStatus: progRes.data.progress.fulfilmentStatus
    });

    if (progRes.data.progress.reportedArrival !== 1 || progRes.data.progress.withdrawn !== 1) {
      throw new Error('Progress breakdown did not match actual response states');
    }

    console.log('\n--- Test 10: Auto-Expiry of Overdue Requests ---');
    // Create an already-expired request in DB
    const expRes = db.prepare(`
      INSERT INTO requests (
        patient_name, blood_group, units_needed, hospital_name, city,
        contact_phone, needed_by, status
      ) VALUES ('Past Patient', 'A+', 1, 'City Clinic', 'Mumbai', '9899999999', datetime('now', '-2 hours'), 'Open')
    `).run();
    const expReqId = Number(expRes.lastInsertRowid);

    const expiredCount = LifecycleService.autoExpirePastDeadlineRequests();
    console.log(`Auto-expired count: ${expiredCount}`);
    const checkExp = db.prepare('SELECT status FROM requests WHERE id = ?').get(expReqId);
    console.log('Request status after auto-expire:', checkExp.status);
    if (checkExp.status !== 'Expired') {
      throw new Error('Overdue request should transition to Expired');
    }

    // Donor responding to expired request must be rejected
    const tryRespondExpired = await post(`${baseUrl}/requests/${expReqId}/respond`, {
      status: 'Accepted'
    }, donor1Token);
    console.log('Responding to expired request status:', tryRespondExpired.status);
    if (tryRespondExpired.status !== 400) {
      throw new Error('Should reject responses to expired requests');
    }

    console.log('\n--- Test 11: Requester Confirms Requirement Fulfilled ---');
    const fulfillRes = await patch(`${baseUrl}/requests/${requestId}/fulfill`, {
      notes: 'Blood transfusion completed successfully'
    }, requesterToken);
    console.log('Fulfillment status:', fulfillRes.status, 'Message:', fulfillRes.data.message);
    if (fulfillRes.status !== 200) {
      throw new Error('Failed to confirm fulfillment');
    }

    const checkFulfilled = db.prepare('SELECT status, closed_at FROM requests WHERE id = ?').get(requestId);
    console.log('Updated Request Status:', checkFulfilled.status);
    if (checkFulfilled.status !== 'Fulfilled' || !checkFulfilled.closed_at) {
      throw new Error('Request was not marked Fulfilled with closed_at timestamp');
    }

    console.log('\n✅ ALL PHASE 4 TESTS (ESCALATION, COMMITMENT TRACKING, PROGRESS TRACKER, LIFECYCLE & PRIVACY) PASSED!\n');
    server.close(() => {
      process.exit(0);
    });
  } catch (err) {
    console.error('❌ Phase 4 test failed:', err);
    server.close(() => {
      process.exit(1);
    });
  }
});
