process.env.NODE_ENV = 'test';
const app = require('../src/app');
const db = require('../src/config/database');
const { ensureAdminUser } = require('../src/db/seedAdmin');
const { runMigrations } = require('../src/db/migrate');
const { findMatchingDonors, calculateHaversineDistance } = require('../src/services/matchingEngine');
const OtpService = require('../src/services/otpService');

runMigrations();
ensureAdminUser();

const server = app.listen(4003, async () => {
  console.log('[Test] Server listening on port 4003');
  const baseUrl = 'http://localhost:4003/api';

  try {
    console.log('\n--- Test 1: Haversine Distance Calculation ---');
    // Mumbai CST (18.9400, 72.8350) to Dadar (19.0178, 72.8478) is approx 8.7 km
    const dist = calculateHaversineDistance(18.9400, 72.8350, 19.0178, 72.8478);
    console.log(`Calculated distance between CST & Dadar: ${dist} km`);
    if (dist < 8 || dist > 10) {
      throw new Error(`Unexpected Haversine distance: ${dist}`);
    }

    console.log('\n--- Test 2: Seeding Test Donors for Compatibility Check ---');
    // Create users & donors for tests
    const seedDonor = (email, name, blood, city, lat, lng, daysAgo, isAvail) => {
      const userRes = db.prepare(`
        INSERT OR REPLACE INTO users (email, password_hash, role)
        VALUES (?, 'hash123', 'donor')
      `).run(email);
      const userId = Number(userRes.lastInsertRowid);

      let lastDate = null;
      if (daysAgo != null) {
        const d = new Date();
        d.setDate(d.getDate() - daysAgo);
        lastDate = d.toISOString().split('T')[0];
      }

      db.prepare(`
        INSERT OR REPLACE INTO donors (
          user_id, name, phone, blood_group, city, area_pincode,
          latitude, longitude, last_donation_date, is_available
        ) VALUES (?, ?, '9999990001', ?, ?, '400001', ?, ?, ?, ?)
      `).run(userId, name, blood, city, lat, lng, lastDate, isAvail ? 1 : 0);
    };

    seedDonor('o_neg_mumbai@test.com', 'Aarav (O-)', 'O-', 'Mumbai', 18.9387, 72.8353, 110, 1);
    seedDonor('o_pos_mumbai@test.com', 'Bhavna (O+)', 'O+', 'Mumbai', 18.9450, 72.8300, 100, 1);
    seedDonor('a_pos_mumbai@test.com', 'Chirag (A+)', 'A+', 'Mumbai', 18.9500, 72.8320, 95, 1);
    seedDonor('ab_pos_mumbai@test.com', 'Dev (AB+)', 'AB+', 'Mumbai', 18.9600, 72.8400, 92, 1);
    seedDonor('b_pos_pune@test.com', 'Esha (B+ in Pune)', 'B+', 'Pune', 18.5204, 73.8567, 100, 1);
    seedDonor('o_neg_recent@test.com', 'Farhan (O- recent)', 'O-', 'Mumbai', 18.9390, 72.8355, 20, 1); // Ineligible (<90d)
    seedDonor('o_neg_unavail@test.com', 'Geeta (O- unavail)', 'O-', 'Mumbai', 18.9390, 72.8355, 120, 0); // Ineligible (avail OFF)

    console.log('\n--- Test 3: Matching Engine Compatibility for O+ Patient ---');
    const mockRequestOpos = {
      blood_group: 'O+',
      city: 'Mumbai',
      latitude: 18.9380,
      longitude: 72.8350,
      urgency: 'Critical'
    };

    const matchesForOpos = findMatchingDonors(mockRequestOpos);
    console.log(`Matched donors for O+ patient: ${matchesForOpos.length}`);
    const matchedNames = matchesForOpos.map(m => m.name);
    console.log('Matched donor names:', matchedNames);

    // O+ recipient can only receive from O+ and O-
    if (!matchedNames.includes('Aarav (O-)') || !matchedNames.includes('Bhavna (O+)')) {
      throw new Error('Eligible O- and O+ donors should match O+ recipient');
    }
    if (matchedNames.includes('Chirag (A+)') || matchedNames.includes('Dev (AB+)')) {
      throw new Error('A+ and AB+ donors must NOT match O+ recipient');
    }
    if (matchedNames.includes('Farhan (O- recent)') || matchedNames.includes('Geeta (O- unavail)')) {
      throw new Error('Ineligible donors must NOT be included in matches');
    }

    console.log('\n--- Test 4: Distance Sorting Verification ---');
    // Verify distance sorting: first match should have smaller distance than subsequent
    if (matchesForOpos.length >= 2) {
      console.log(`First donor distance: ${matchesForOpos[0].distanceKm} km, Second: ${matchesForOpos[1].distanceKm} km`);
      if (matchesForOpos[0].distanceKm > matchesForOpos[1].distanceKm) {
        throw new Error('Matched donors must be sorted closest first');
      }
    }

    console.log('\n--- Test 5: Universal Recipient (AB+) Matching ---');
    const mockRequestABpos = {
      blood_group: 'AB+',
      city: 'Mumbai',
      latitude: 18.9380,
      longitude: 72.8350
    };
    const matchesForABpos = findMatchingDonors(mockRequestABpos);
    console.log(`Matched donors for AB+ recipient: ${matchesForABpos.length}`);
    if (matchesForABpos.length < 4) {
      throw new Error('AB+ recipient should match O-, O+, A+, and AB+ eligible donors in city');
    }

    console.log('\n--- Test 6: Request Posting API with OTP Verification & Mandatory Slip ---');
    const testRequesterPhone = '98' + Math.floor(10000000 + Math.random() * 90000000);
    // Generate OTP
    const otpData = await OtpService.generateOtp(testRequesterPhone, 'post_request');

    const samplePdfBuf = Buffer.from("%PDF-1.4\n%LifeLinkTest\n%%EOF\n");
    const testSlipBlob = new Blob([samplePdfBuf], { type: 'application/pdf' });

    const form6 = new FormData();
    form6.append('patient_name', 'Suresh Patil ' + Date.now());
    form6.append('blood_group', 'O+');
    form6.append('units_needed', '2');
    form6.append('hospital_name', 'KEM Hospital');
    form6.append('doctor_name', 'Dr. V. Joshi');
    form6.append('ward_bed', 'ICU-3');
    form6.append('city', 'Mumbai');
    form6.append('area_pincode', '400012');
    form6.append('latitude', '18.9380');
    form6.append('longitude', '72.8350');
    form6.append('contact_phone', testRequesterPhone);
    form6.append('urgency', 'Critical');
    form6.append('needed_by', new Date(Date.now() + 12 * 3600 * 1000).toISOString());
    form6.append('note', 'Urgent surgery required');
    form6.append('otp_code', otpData.code);
    form6.append('requisition_slip', testSlipBlob, 'slip.pdf');

    const postRes = await fetch(`${baseUrl}/requests`, {
      method: 'POST',
      body: form6
    });

    const postData = await postRes.json();
    console.log('Post Request Status:', postRes.status);
    console.log('Created Request ID:', postData.request?.id);
    console.log('Verification status:', postData.request?.verification_status);
    console.log('Matched donors count in response:', postData.matchedDonorsCount);

    if (postRes.status !== 201 || !postData.request?.id) {
      throw new Error(`Failed to create request: ${postData.message}`);
    }
    if (postData.request.verification_status !== 'Phone Verified') {
      throw new Error('Initial verification status should be "Phone Verified"');
    }

    const createdReqId = postData.request.id;

    console.log('\n--- Test 7: Single Open Request per Phone Constraint ---');
    // Attempting to post a second request with the same phone should fail on phone constraint
    const formDup = new FormData();
    formDup.append('patient_name', 'Another Patient');
    formDup.append('blood_group', 'A+');
    formDup.append('units_needed', '1');
    formDup.append('hospital_name', 'Lilavati Hospital');
    formDup.append('city', 'Mumbai');
    formDup.append('contact_phone', testRequesterPhone);
    formDup.append('urgency', 'Urgent');
    formDup.append('needed_by', new Date().toISOString());
    formDup.append('otp_code', '123456');
    formDup.append('requisition_slip', testSlipBlob, 'slip_dup.pdf');

    const duplicateRes = await fetch(`${baseUrl}/requests`, {
      method: 'POST',
      body: formDup
    });
    const dupData = await duplicateRes.json();
    console.log('Duplicate request status:', duplicateRes.status, 'Message:', dupData.message);
    if (duplicateRes.status !== 400 || !dupData.message.includes('already have an active open request')) {
      throw new Error('Should prevent multiple open requests for the same phone number');
    }

    console.log('\n--- Test 8: Public Contact Phone Redaction Check ---');
    const getReqRes = await fetch(`${baseUrl}/requests/${createdReqId}`);
    const getReqData = await getReqRes.json();
    console.log('Public view contact phone:', getReqData.request?.contact_phone);
    console.log('Can view contact flag:', getReqData.request?.can_view_contact);
    if (getReqData.request.can_view_contact !== false || !getReqData.request.contact_phone.includes('*****')) {
      throw new Error('Public view must mask sensitive phone numbers');
    }

    console.log('\n--- Test 9: Heuristic Check for Suspicious High Units ---');
    const phoneHighUnits = '98' + Math.floor(10000000 + Math.random() * 90000000);
    const otpHighUnits = await OtpService.generateOtp(phoneHighUnits, 'post_request');
    const formHigh = new FormData();
    formHigh.append('patient_name', 'Kavita Singh ' + Date.now());
    formHigh.append('blood_group', 'B+');
    formHigh.append('units_needed', '15'); // > 10 units
    formHigh.append('hospital_name', 'City Hospital');
    formHigh.append('city', 'Mumbai');
    formHigh.append('contact_phone', phoneHighUnits);
    formHigh.append('urgency', 'Urgent');
    formHigh.append('needed_by', new Date().toISOString());
    formHigh.append('otp_code', otpHighUnits.code);
    formHigh.append('requisition_slip', testSlipBlob, 'slip2.pdf');

    const highUnitsRes = await fetch(`${baseUrl}/requests`, {
      method: 'POST',
      body: formHigh
    });
    const highUnitsData = await highUnitsRes.json();
    console.log('Suspicious flag on >10 units:', highUnitsData.request?.is_suspicious);
    console.log('Suspicious reason:', highUnitsData.request?.suspicious_reason);
    if (highUnitsData.request?.is_suspicious !== 1) {
      throw new Error('Requests with >10 units must be flagged as suspicious');
    }

    console.log('\n✅ ALL PHASE 3 TESTS (MATCHING ENGINE, PROXIMITY, REQUEST POSTING, HEURISTICS, PRIVACY) PASSED!\n');
    server.close(() => {
      setTimeout(() => process.exit(0), 100);
    });
  } catch (err) {
    console.error('❌ Phase 3 test failed:', err);
    server.close(() => {
      setTimeout(() => process.exit(1), 100);
    });
  }
});
