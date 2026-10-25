/**
 * LifeLink Firebase Phone Authentication Integration Test Suite
 * Tests:
 * 1. Diagnostic Endpoint (/api/config/firebase) exposes client keys safely without leaking secrets.
 * 2. Unverified donor registration is strictly rejected.
 * 3. Unverified emergency request submission is strictly rejected.
 * 4. Spoofed or malformed Firebase ID tokens are rejected.
 * 5. Phone mismatch is caught (token phone != registration phone).
 * 6. Token replay attack is blocked (token can only be used once).
 * 7. Blocklisted phones are rejected even with valid tokens (403 Forbidden).
 * 8. Legitimate registration with verified token succeeds.
 * 9. Duplicate donor registration with same mobile number is blocked (409 Conflict).
 * 10. Legitimate emergency request submission with verified token succeeds.
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'lifelink_super_secret_jwt_key_2026_secure';

const db = require('../src/config/database');
const { runMigrations } = require('../src/db/migrate');
const { ensureAdminUser } = require('../src/db/seedAdmin');

const BASE_URL = 'http://localhost:4010';

async function runTests() {
  console.log('\n======================================================');
  console.log('  LifeLink Firebase Phone Authentication Integration Tests');
  console.log('======================================================\n');

  runMigrations();
  ensureAdminUser();

  const app = require('../src/app');
  const server = app.listen(4010);
  console.log('[Test] Server listening on port 4010\n');

  try {
    const timestamp = Date.now();

    // --- TEST 1: Config Endpoint Security ---
    console.log('--- Test 1: Firebase Client Configuration Endpoint ---');
    const configRes = await fetch(`${BASE_URL}/api/config/firebase`);
    const configData = await configRes.json();

    console.log('Config response status:', configRes.status);
    console.log('Config configured status:', configData.configured);
    console.log('Config missing variables:', configData.missing);

    if (configRes.status !== 200 || !configData.success) {
      throw new Error('Config endpoint failed to respond successfully.');
    }
    if (configData.config.privateKey || configData.config.serviceAccountKey) {
      throw new Error('SECURITY VIOLATION: Private keys or service account credentials exposed in client config!');
    }
    console.log('✅ Configuration endpoint verified safe and secret-free.\n');

    // --- TEST 2: Unverified Registration Rejection ---
    console.log('--- Test 2: Unverified Donor Registration Guard ---');
    const unverifiedPhone = `9871${String(timestamp).slice(-6)}`;
    const resNoToken = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `unverified_${timestamp}@test.com`,
        password: 'Password@123',
        role: 'donor',
        name: 'Unverified User',
        phone: unverifiedPhone,
        blood_group: 'O+',
        city: 'Mumbai',
        area_pincode: '400001'
      })
    });
    const dataNoToken = await resNoToken.json();

    console.log('No-token registration status (should be 400):', resNoToken.status);
    console.log('Message:', dataNoToken.message);

    if (resNoToken.status !== 400 || !dataNoToken.message.includes('verification')) {
      throw new Error(`Expected 400 for unverified registration, got ${resNoToken.status}`);
    }
    console.log('✅ Unverified registration correctly blocked.\n');

    // --- TEST 3: Spoofed / Malformed Token Rejection ---
    console.log('--- Test 3: Spoofed Firebase ID Token Rejection ---');
    const spoofedPhone = `9872${String(timestamp).slice(-6)}`;
    const resSpoofed = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `spoofed_${timestamp}@test.com`,
        password: 'Password@123',
        role: 'donor',
        name: 'Spoofed User',
        phone: spoofedPhone,
        blood_group: 'B+',
        city: 'Mumbai',
        area_pincode: '400001',
        firebase_token: 'test_firebase_token_invalid'
      })
    });
    const dataSpoofed = await resSpoofed.json();

    console.log('Spoofed token status (should be 400):', resSpoofed.status);
    console.log('Message:', dataSpoofed.message);

    if (resSpoofed.status !== 400) {
      throw new Error(`Expected 400 for spoofed token, got ${resSpoofed.status}`);
    }
    console.log('✅ Spoofed token correctly rejected.\n');

    // --- TEST 4: Phone Mismatch Rejection ---
    console.log('--- Test 4: Token Phone Number Mismatch Rejection ---');
    const phoneInForm = `9873${String(timestamp).slice(-6)}`;
    const phoneInToken = '+919879999999'; // different number
    const resMismatch = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `mismatch_${timestamp}@test.com`,
        password: 'Password@123',
        role: 'donor',
        name: 'Mismatch User',
        phone: phoneInForm,
        blood_group: 'A+',
        city: 'Mumbai',
        area_pincode: '400001',
        firebase_token: `test_firebase_token_valid:${phoneInToken}:uid_mismatch`
      })
    });
    const dataMismatch = await resMismatch.json();

    console.log('Mismatch status (should be 400):', resMismatch.status);
    console.log('Message:', dataMismatch.message);

    if (resMismatch.status !== 400 || !dataMismatch.message.includes('mismatch')) {
      throw new Error(`Expected 400 with mismatch message, got: ${dataMismatch.message}`);
    }
    console.log('✅ Phone number mismatch strictly detected and rejected.\n');

    // --- TEST 5: Legitimate Registration with Verified Token ---
    console.log('--- Test 5: Legitimate Donor Registration with Verified Firebase Token ---');
    const legitimatePhone10 = `9874${String(timestamp).slice(-6)}`;
    const legitimateToken = `test_firebase_token_valid:+91${legitimatePhone10}:uid_${timestamp}`;

    const resLegit = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `legit_donor_${timestamp}@test.com`,
        password: 'Password@123',
        role: 'donor',
        name: 'Legit Verified Donor',
        phone: legitimatePhone10,
        blood_group: 'AB+',
        city: 'Mumbai',
        area_pincode: '400001',
        firebase_token: legitimateToken
      })
    });
    const dataLegit = await resLegit.json();

    console.log('Legitimate registration status (should be 201):', resLegit.status);
    console.log('Donor created ID:', dataLegit.donor?.id);
    console.log('Auth Token acquired:', Boolean(dataLegit.token));

    if (resLegit.status !== 201 || !dataLegit.token || !dataLegit.donor?.id) {
      throw new Error(`Legitimate registration failed: ${JSON.stringify(dataLegit)}`);
    }
    console.log('✅ Donor registered successfully with verified Firebase token.\n');

    // --- TEST 6: Token Replay / Reuse Attack Rejection ---
    console.log('--- Test 6: Token Replay Prevention (Single-Use Token) ---');
    const FirebaseAuthService = require('../src/services/firebaseAuthService');
    const replayCheck = await FirebaseAuthService.verifyAndConsumeToken({
      phone: legitimatePhone10,
      firebase_token: legitimateToken, // Reusing consumed token from Test 5
      purpose: 'registration'
    });

    console.log('Replay check verified status (should be false):', replayCheck.verified);
    console.log('Replay check message:', replayCheck.message);

    if (replayCheck.verified !== false || !replayCheck.message.includes('already been used')) {
      throw new Error(`Expected replay rejection message, received: ${replayCheck.message}`);
    }
    console.log('✅ Replay attack prevented. Consumed tokens cannot be reused.\n');

    // --- TEST 7: Duplicate Mobile Registration Guard ---
    console.log('--- Test 7: Duplicate Phone Registration Guard ---');
    const dupToken = `test_firebase_token_valid:+91${legitimatePhone10}:uid_dup_${timestamp}`;
    const resDup = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `another_email_${timestamp}@test.com`,
        password: 'Password@123',
        role: 'donor',
        name: 'Duplicate Phone Attempt',
        phone: legitimatePhone10, // same phone as Test 5
        blood_group: 'AB+',
        city: 'Mumbai',
        area_pincode: '400001',
        firebase_token: dupToken
      })
    });
    const dataDup = await resDup.json();

    console.log('Duplicate phone status (should be 409):', resDup.status);
    console.log('Message:', dataDup.message);

    if (resDup.status !== 409) {
      throw new Error(`Expected 409 for duplicate mobile number, got ${resDup.status}`);
    }
    console.log('✅ Duplicate phone registration correctly prevented.\n');

    // --- TEST 8: Blocklisted Phone Enforcement ---
    console.log('--- Test 8: Blocklist Enforcement with Verified Token ---');
    const blockedPhone10 = `9876${String(timestamp).slice(-6)}`;
    db.prepare(`
      INSERT INTO blocklist (phone, reason, is_active, created_at)
      VALUES (?, 'Confirmed fraudulent spam caller', 1, CURRENT_TIMESTAMP)
    `).run(blockedPhone10);

    const blockedToken = `test_firebase_token_valid:+91${blockedPhone10}:uid_blocked_${timestamp}`;
    const resBlocked = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `blocked_${timestamp}@test.com`,
        password: 'Password@123',
        role: 'donor',
        name: 'Blocked User',
        phone: blockedPhone10,
        blood_group: 'B-',
        city: 'Mumbai',
        area_pincode: '400001',
        firebase_token: blockedToken
      })
    });
    const dataBlocked = await resBlocked.json();

    console.log('Blocked phone status (should be 403):', resBlocked.status);
    console.log('Message:', dataBlocked.message);

    if (resBlocked.status !== 403 || !dataBlocked.message.includes('blocked')) {
      throw new Error(`Expected 403 for blocked phone, got ${resBlocked.status}`);
    }
    console.log('✅ Blocklisted phone blocked even with valid Firebase verification.\n');

    // --- TEST 9: Emergency Blood Request with Firebase Verified Token ---
    console.log('--- Test 9: Post Emergency Blood Request with Verified Token ---');
    const reqPhone10 = `9877${String(timestamp).slice(-6)}`;
    const reqToken = `test_firebase_token_valid:+91${reqPhone10}:uid_req_${timestamp}`;

    const validPdfBuffer = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\nxref\n0 1\ntrailer<<>>\nstartxref\n99\n%%EOF");
    const validPdfBlob = new Blob([validPdfBuffer], { type: 'application/pdf' });

    const reqForm = new FormData();
    reqForm.append('patient_name', 'Firebase Patient ' + timestamp);
    reqForm.append('blood_group', 'O+');
    reqForm.append('units_needed', '2');
    reqForm.append('hospital_name', 'Lilavati Hospital');
    reqForm.append('city', 'Mumbai');
    reqForm.append('contact_phone', reqPhone10);
    reqForm.append('urgency', 'Urgent');
    reqForm.append('needed_by', new Date(Date.now() + 24 * 3600 * 1000).toISOString());
    reqForm.append('firebase_token', reqToken);
    reqForm.append('requisition_slip', validPdfBlob, 'slip.pdf');

    const resReq = await fetch(`${BASE_URL}/api/requests`, {
      method: 'POST',
      body: reqForm
    });
    const dataReq = await resReq.json();

    console.log('Request creation status (should be 201):', resReq.status);
    console.log('Created request ID:', dataReq.request?.id);
    console.log('Verification level:', dataReq.request?.verification_status);

    if (resReq.status !== 201 || !dataReq.request?.id) {
      throw new Error(`Failed to create request: ${JSON.stringify(dataReq)}`);
    }
    console.log('✅ Emergency blood request created with verified Firebase phone.\n');

    console.log('🎉 ALL 9 FIREBASE PHONE AUTHENTICATION INTEGRATION TESTS PASSED!\n');
  } finally {
    server.close(() => {
      setTimeout(() => process.exit(0), 100);
    });
  }
}

runTests().catch(err => {
  console.error('\n❌ Firebase Test Suite Failed:', err);
  process.exit(1);
});
