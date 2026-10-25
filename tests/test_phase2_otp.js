process.env.NODE_ENV = 'test';
const app = require('../src/app');
const db = require('../src/config/database');
const { ensureAdminUser } = require('../src/db/seedAdmin');
const { runMigrations } = require('../src/db/migrate');
const OtpService = require('../src/services/otpService');

runMigrations();
ensureAdminUser();

const server = app.listen(4002, async () => {
  console.log('[Test] Server listening on port 4002');
  const baseUrl = 'http://localhost:4002/api';

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

  try {
    console.log('\n--- Test 1: Send OTP to Valid Indian Mobile Number ---');
    const testPhone = `98765${Math.floor(10000 + Math.random() * 90000)}`;
    const otpRes = await post(`${baseUrl}/otp/send`, { phone: testPhone, purpose: 'post_request' });

    console.log('OTP Send Status:', otpRes.status);
    console.log('OTP Send Response Message:', otpRes.data.message);

    if (otpRes.status !== 200) {
      throw new Error(`Failed to send OTP: ${otpRes.data.message}`);
    }

    if (otpRes.data.mockOtp || otpRes.data.code) {
      throw new Error('SECURITY VIOLATION: OTP code must NEVER be exposed in API responses');
    }

    if (otpRes.data.message !== 'OTP sent to your registered mobile number.') {
      throw new Error(`Expected message 'OTP sent to your registered mobile number.', received: ${otpRes.data.message}`);
    }

    // Retrieve the securely stored OTP code directly from database
    const dbOtp = db.prepare('SELECT code FROM otps WHERE phone = ? ORDER BY id DESC LIMIT 1').get(testPhone);
    if (!dbOtp || !dbOtp.code || dbOtp.code.length !== 6) {
      throw new Error('Valid 6-digit OTP was not saved in database');
    }
    const generatedCode = dbOtp.code;
    console.log('✅ OTP saved securely in DB; not exposed in response.');

    console.log('\n--- Test 2: Resend OTP 30-Second Cooldown Protection ---');
    const cooldownRes = await post(`${baseUrl}/otp/send`, { phone: testPhone, purpose: 'post_request' });
    console.log('Immediate Resend Status:', cooldownRes.status, 'Message:', cooldownRes.data.message);
    if (cooldownRes.status !== 429 && cooldownRes.status !== 400) {
      throw new Error('Cooldown must reject immediate duplicate OTP requests');
    }
    if (!cooldownRes.data.message.includes('seconds')) {
      throw new Error('Cooldown error must inform user of remaining seconds');
    }
    console.log('✅ 30-second cooldown protection successfully enforced.');

    console.log('\n--- Test 3: Reject Invalid Phone Number Format ---');
    const invalidPhoneRes = await post(`${baseUrl}/otp/send`, { phone: '1234567890' }); // Starts with 1, not 6-9
    console.log('Invalid Phone Status:', invalidPhoneRes.status, 'Message:', invalidPhoneRes.data.message);
    if (invalidPhoneRes.status !== 400) {
      throw new Error('Invalid Indian mobile number must be rejected with 400');
    }
    console.log('✅ Phone validation on backend rejected non-Indian format.');

    console.log('\n--- Test 4: Verify Incorrect OTP Code & Attempt Counter ---');
    const wrongRes = await post(`${baseUrl}/otp/verify`, {
      phone: testPhone,
      code: '000000',
      purpose: 'post_request'
    });
    console.log('Wrong OTP Response Status:', wrongRes.status, 'Message:', wrongRes.data.message);
    if (wrongRes.status !== 400 || !wrongRes.data.message.includes('Incorrect')) {
      throw new Error('Wrong OTP should be rejected with 400 and state remaining attempts');
    }
    console.log('✅ Incorrect code correctly rejected with remaining attempts count.');

    console.log('\n--- Test 5: Verify Correct OTP Code ---');
    const correctRes = await post(`${baseUrl}/otp/verify`, {
      phone: testPhone,
      code: generatedCode,
      purpose: 'post_request'
    });
    console.log('Correct OTP Response Status:', correctRes.status, 'Message:', correctRes.data.message);
    if (correctRes.status !== 200 || !correctRes.data.message.includes('verified')) {
      throw new Error('Correct OTP should succeed with 200');
    }
    console.log('✅ Correct OTP verified successfully.');

    console.log('\n--- Test 6: Reusing Used OTP Should Fail ---');
    const reuseRes = await post(`${baseUrl}/otp/verify`, {
      phone: testPhone,
      code: generatedCode,
      purpose: 'post_request'
    });
    console.log('Reused OTP Status:', reuseRes.status);
    if (reuseRes.status !== 400) {
      throw new Error('Used OTP must not be reusable');
    }
    console.log('✅ Previously verified OTP correctly barred from reuse.');

    console.log('\n--- Test 7: Blocklist Prevention ---');
    const blockedPhone = '9800000000';
    db.prepare(`
      INSERT OR REPLACE INTO blocklist (phone, reason, is_active)
      VALUES (?, 'Suspicious spam requests', 1)
    `).run(blockedPhone);

    const blockOtpRes = await post(`${baseUrl}/otp/send`, { phone: blockedPhone });
    console.log('Blocked Phone OTP Status:', blockOtpRes.status, 'Message:', blockOtpRes.data.message);
    if ((blockOtpRes.status !== 400 && blockOtpRes.status !== 403) || !blockOtpRes.data.message.includes('blocked')) {
      throw new Error('Blocked phone must be rejected when requesting OTP');
    }
    console.log('✅ Blocklisted numbers correctly rejected.');

    console.log('\n--- Test 8: Donor Registration Requires Verified Phone OTP ---');
    const eligibleDate = new Date();
    eligibleDate.setDate(eligibleDate.getDate() - 95);
    const donorPhone = `9876${Math.floor(100000 + Math.random() * 900000)}`;
    const testEmail = `donor_${Date.now()}@test.com`;

    // 8a. Attempt to register without OTP code -> MUST FAIL
    const unverifiedReg = await post(`${baseUrl}/auth/register`, {
      email: testEmail,
      password: 'SecurePassword123',
      role: 'donor',
      name: 'Rohan Mehra',
      phone: donorPhone,
      blood_group: 'B+',
      city: 'Delhi',
      area_pincode: '110001'
    });
    console.log('Registration without OTP Status:', unverifiedReg.status, 'Message:', unverifiedReg.data.message);
    if (unverifiedReg.status !== 400) {
      throw new Error('Donor registration without OTP verification must be rejected');
    }

    // 8b. Generate OTP for donor registration, verify and complete registration
    const regOtpGen = await OtpService.generateOtp(donorPhone, 'registration');
    const verifiedReg = await post(`${baseUrl}/auth/register`, {
      email: testEmail,
      password: 'SecurePassword123',
      role: 'donor',
      name: 'Rohan Mehra',
      phone: donorPhone,
      otp_code: regOtpGen.code,
      blood_group: 'B+',
      city: 'Delhi',
      area_pincode: '110001',
      last_donation_date: eligibleDate.toISOString().split('T')[0],
      is_available: 1
    });

    console.log('Verified Registration Status:', verifiedReg.status);
    console.log('Donor eligibility:', verifiedReg.data.donor?.eligibility?.isEligible);
    if (verifiedReg.status !== 201 || !verifiedReg.data.donor?.eligibility?.isEligible) {
      throw new Error('Donor with verified OTP should register successfully');
    }
    console.log('✅ Donor registered successfully with verified phone OTP.');

    console.log('\n✅ ALL PHASE 2 TESTS (AUTH + DONOR + OTP + COOLDOWN + BLOCKLIST) PASSED!\n');
    server.close(() => {
      setTimeout(() => process.exit(0), 100);
    });
  } catch (err) {
    console.error('❌ Phase 2 test failed:', err);
    server.close(() => {
      setTimeout(() => process.exit(1), 100);
    });
  }
});
