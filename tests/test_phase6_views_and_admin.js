process.env.NODE_ENV = 'test';
const app = require('../src/app');
const db = require('../src/config/database');
const { ensureAdminUser } = require('../src/db/seedAdmin');
const { seedBloodBanks } = require('../src/db/seedBloodBanks');
const { runMigrations } = require('../src/db/migrate');
const OtpService = require('../src/services/otpService');

runMigrations();
ensureAdminUser();
seedBloodBanks();

const PORT = 4007;
const server = app.listen(PORT, async () => {
  console.log(`[Test] Server listening on port ${PORT}`);
  const baseUrl = `http://localhost:${PORT}/api`;

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
    const timestamp = Date.now();

    console.log('\n--- Setup: Admin Authentication ---');
    const adminLoginRes = await post(`${baseUrl}/auth/login`, {
      email: 'admin@lifelink.org',
      password: 'Admin@123'
    });
    if (adminLoginRes.status !== 200 || !adminLoginRes.data.token) {
      throw new Error('Admin login failed: ' + JSON.stringify(adminLoginRes.data));
    }
    const adminToken = adminLoginRes.data.token;
    console.log('✅ Admin token acquired.');

    console.log('\n--- Test 1: Blood Banks Directory (Seed Data & Filters) ---');
    const allBanksRes = await get(`${baseUrl}/blood-banks`);
    if (allBanksRes.status !== 200 || !allBanksRes.data.bloodBanks) {
      throw new Error('Failed to retrieve blood banks directory');
    }
    console.log(`Total Blood Banks Seeded: ${allBanksRes.data.count}`);
    if (allBanksRes.data.count < 10) {
      throw new Error('Expected at least 10 seeded verified blood banks');
    }

    const firstBank = allBanksRes.data.bloodBanks[0];
    console.log('Sample Hospital:', firstBank.name, 'City:', firstBank.city, 'Phone:', firstBank.official_hospital_phone);
    if (!firstBank.official_hospital_phone || !firstBank.operating_hours) {
      throw new Error('Blood bank must provide official telephone and operating hours');
    }

    // Filter by City: Bengaluru
    const blrBanksRes = await get(`${baseUrl}/blood-banks?city=Bengaluru`);
    console.log(`Bengaluru Facilities: ${blrBanksRes.data.count}`);
    if (blrBanksRes.data.count === 0 || !blrBanksRes.data.bloodBanks.every(b => b.city.toLowerCase() === 'bengaluru')) {
      throw new Error('City filtering failed for Bengaluru');
    }

    // Keyword Search: "AIIMS"
    const aiimsRes = await get(`${baseUrl}/blood-banks?q=AIIMS`);
    console.log(`Search 'AIIMS' results: ${aiimsRes.data.count}`);
    if (aiimsRes.data.count === 0 || !aiimsRes.data.bloodBanks[0].name.includes('AIIMS')) {
      throw new Error('Keyword search failed for AIIMS');
    }
    console.log('✅ Blood Banks Directory API, city filtering, and keyword search verified.');

    console.log('\n--- Test 2: Public Emergency Board (Creation, Masking & Multi-Filter) ---');
    // Seed 2 distinct requests with different blood groups, urgencies, and cities
    const phoneP6_1 = `9860${String(timestamp).slice(-6)}`;
    const otpGen1 = await OtpService.generateOtp(phoneP6_1, 'post_request');
    const otpP6_1 = otpGen1.code;
    const req1 = await postForm(`${baseUrl}/requests`, {
      patient_name: `PatientAlpha_${timestamp}`,
      blood_group: 'AB-',
      units_needed: 1,
      hospital_name: 'AIIMS Blood Bank & Transfusion Center',
      city: 'Delhi',
      contact_phone: phoneP6_1,
      urgency: 'Critical',
      needed_by: new Date(Date.now() + 86400000).toISOString(),
      otp_code: otpP6_1
    });
    if (req1.status !== 201) throw new Error('Failed to create Request 1: ' + JSON.stringify(req1.data));
    const req1Id = req1.data.request.id;

    const phoneP6_2 = `9861${String(timestamp).slice(-6)}`;
    const otpGen2 = await OtpService.generateOtp(phoneP6_2, 'post_request');
    const otpP6_2 = otpGen2.code;
    const req2 = await postForm(`${baseUrl}/requests`, {
      patient_name: `PatientBeta_${timestamp}`,
      blood_group: 'O-',
      units_needed: 3,
      hospital_name: 'Victoria Hospital Blood Bank (BMCRI)',
      city: 'Bengaluru',
      contact_phone: phoneP6_2,
      urgency: 'Normal',
      needed_by: new Date(Date.now() + 86400000).toISOString(),
      otp_code: otpP6_2
    });
    if (req2.status !== 201) throw new Error('Failed to create Request 2: ' + JSON.stringify(req2.data));
    const req2Id = req2.data.request.id;

    // Public fetch (anonymous visitor)
    const boardRes = await get(`${baseUrl}/requests`);
    if (boardRes.status !== 200 || !boardRes.data.requests) {
      throw new Error('Failed to fetch public emergency board');
    }
    console.log(`Public Emergency Board Total Active: ${boardRes.data.count}`);

    // Verify phone masking for anonymous users
    const publicReq1 = boardRes.data.requests.find(r => r.id === req1Id);
    if (!publicReq1) throw new Error('Created request not visible on board');
    console.log('Public masked contact phone:', publicReq1.contact_phone);
    if (!publicReq1.contact_phone.includes('*****') || publicReq1.can_view_contact !== false) {
      throw new Error('Public board must redact phone number for unauthenticated users');
    }

    // Filter by Blood Group: AB-
    const abNegRes = await get(`${baseUrl}/requests?blood_group=AB-`);
    console.log(`Filtered AB- requests count: ${abNegRes.data.count}`);
    if (abNegRes.data.count === 0 || !abNegRes.data.requests.every(r => r.blood_group === 'AB-')) {
      throw new Error('Blood group filter failed for AB-');
    }

    // Filter by City: Bengaluru
    const blrReqRes = await get(`${baseUrl}/requests?city=Bengaluru`);
    console.log(`Filtered Bengaluru requests count: ${blrReqRes.data.count}`);
    if (blrReqRes.data.count === 0 || !blrReqRes.data.requests.every(r => r.city.toLowerCase() === 'bengaluru')) {
      throw new Error('City filter failed for Bengaluru');
    }

    // Filter by Urgency: Critical
    const critReqRes = await get(`${baseUrl}/requests?urgency=Critical`);
    console.log(`Filtered Critical requests count: ${critReqRes.data.count}`);
    if (critReqRes.data.count === 0 || !critReqRes.data.requests.every(r => r.urgency === 'Critical')) {
      throw new Error('Urgency filter failed for Critical');
    }
    console.log('✅ Public Emergency Board listing, phone privacy masking, and multi-parameter filtering verified.');

    console.log('\n--- Test 3: Exclude Hidden / Auto-Reported Requests from Public Board ---');
    // Hide req2 manually or report it
    db.prepare('UPDATE requests SET is_hidden = 1 WHERE id = ?').run(req2Id);

    const boardAfterHideRes = await get(`${baseUrl}/requests`);
    const checkHidden = boardAfterHideRes.data.requests.find(r => r.id === req2Id);
    if (checkHidden) {
      throw new Error('Hidden/flagged requests must never appear on public emergency board');
    }
    console.log('✅ Hidden request successfully excluded from public view.');

    console.log('\n--- Test 4: Admin Dashboard Platform Statistics API ---');
    const statsRes = await get(`${baseUrl}/admin/stats`, adminToken);
    if (statsRes.status !== 200 || !statsRes.data.stats) {
      throw new Error('Failed to retrieve admin dashboard stats: ' + JSON.stringify(statsRes.data));
    }
    const stats = statsRes.data.stats;
    console.log('Admin Stats:', JSON.stringify(stats, null, 2));
    if (
      typeof stats.totalDonors !== 'number' ||
      typeof stats.activeRequests !== 'number' ||
      typeof stats.fulfilledRequests !== 'number' ||
      typeof stats.bloodBanksCount !== 'number' ||
      stats.bloodBanksCount < 10
    ) {
      throw new Error('Invalid or incomplete admin statistics metrics');
    }
    console.log('✅ Admin Dashboard stats endpoint validated.');

    console.log('\n--- Test 5: Admin Authorization Gatekeeping ---');
    // Attempting to access admin stats without token
    const anonStatsRes = await get(`${baseUrl}/admin/stats`);
    if (anonStatsRes.status !== 401) {
      throw new Error('Unauthenticated access to admin routes must return 401');
    }

    // Register a standard donor
    const normUserRes = await post(`${baseUrl}/auth/register`, {
      email: `normal_user_${timestamp}@test.com`,
      password: 'Password@123',
      role: 'requester'
    });
    const normalToken = normUserRes.data.token;

    // Normal user attempting to access admin routes
    const normAdminRes = await get(`${baseUrl}/admin/stats`, normalToken);
    if (normAdminRes.status !== 403) {
      throw new Error('Non-admin users must be denied with 403 Forbidden on admin routes');
    }
    console.log('✅ Admin routes strictly protected against unauthenticated and unauthorized users.');

    console.log('\n✅ ALL PHASE 6 TESTS (PUBLIC BOARD, BLOOD BANKS DIRECTORY, FILTERS, ADMIN STATS & RBAC) PASSED!\n');
    server.close(() => {
      setTimeout(() => process.exit(0), 100);
    });
  } catch (err) {
    console.error('❌ Phase 6 test failed:', err);
    server.close(() => {
      setTimeout(() => process.exit(1), 100);
    });
  }
});
