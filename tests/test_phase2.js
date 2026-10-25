const http = require('http');
const app = require('../src/app');
const db = require('../src/config/database');
const { ensureAdminUser } = require('../src/db/seedAdmin');
const { runMigrations } = require('../src/db/migrate');

runMigrations();
ensureAdminUser();

const server = app.listen(4001, async () => {
  console.log('[Test] Server listening on port 4001');
  const baseUrl = 'http://localhost:4001/api';

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

  async function get(url, token) {
    const res = await fetch(url, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
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

  async function put(url, data, token) {
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify(data)
    });
    return { status: res.status, data: await res.json() };
  }

  try {
    console.log('\n--- 1. Testing Donor Registration (Eligible: >90 days) ---');
    const eligibleDate = new Date();
    eligibleDate.setDate(eligibleDate.getDate() - 100);

    const reg1 = await post(`${baseUrl}/auth/register`, {
      email: 'eligible_donor2@test.com',
      password: 'Password123',
      role: 'donor',
      name: 'Amit Patel',
      phone: '9876543210',
      blood_group: 'O+',
      city: 'Mumbai',
      area_pincode: '400001',
      latitude: 18.9387,
      longitude: 72.8353,
      last_donation_date: eligibleDate.toISOString().split('T')[0],
      is_available: 1
    });

    console.log('Registration Status:', reg1.status);
    console.log('Donor eligibility:', reg1.data.donor?.eligibility?.isEligible);
    console.log('Donor reason:', reg1.data.donor?.eligibility?.reason);
    if (!reg1.data.donor?.eligibility?.isEligible) {
      throw new Error('Expected donor to be eligible');
    }

    const token = reg1.data.token;

    console.log('\n--- 2. Testing Donor Registration (Ineligible: <90 days) ---');
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 30);

    const reg2 = await post(`${baseUrl}/auth/register`, {
      email: 'recent_donor2@test.com',
      password: 'Password123',
      role: 'donor',
      name: 'Pooja Rao',
      phone: '9876543211',
      blood_group: 'A-',
      city: 'Mumbai',
      area_pincode: '400050',
      last_donation_date: recentDate.toISOString().split('T')[0],
      is_available: 1
    });

    console.log('Registration Status:', reg2.status);
    console.log('Donor eligibility:', reg2.data.donor?.eligibility?.isEligible);
    console.log('Days remaining:', reg2.data.donor?.eligibility?.daysRemaining);
    if (reg2.data.donor?.eligibility?.isEligible) {
      throw new Error('Expected recent donor to be ineligible');
    }

    console.log('\n--- 3. Testing Login ---');
    const loginRes = await post(`${baseUrl}/auth/login`, {
      email: 'eligible_donor2@test.com',
      password: 'Password123'
    });
    console.log('Login Status:', loginRes.status, 'User Role:', loginRes.data.user?.role);

    console.log('\n--- 4. Testing Admin Login ---');
    const adminLogin = await post(`${baseUrl}/auth/login`, {
      email: 'admin@lifelink.org',
      password: 'Admin@123'
    });
    console.log('Admin Login Status:', adminLogin.status, 'Admin Role:', adminLogin.data.user?.role);

    console.log('\n--- 5. Testing GET /api/auth/me ---');
    const meRes = await get(`${baseUrl}/auth/me`, token);
    console.log('Me endpoint email:', meRes.data.user?.email);

    console.log('\n--- 6. Testing Availability Toggle (Turn OFF) ---');
    const toggleOff = await patch(`${baseUrl}/donors/availability`, { is_available: 0 }, token);
    console.log('Toggle OFF message:', toggleOff.data.message);
    console.log('Eligibility after toggle OFF:', toggleOff.data.donor?.eligibility?.isEligible);
    if (toggleOff.data.donor?.eligibility?.isEligible) {
      throw new Error('Expected donor to be ineligible when availability is OFF');
    }

    console.log('\n--- 7. Testing Availability Toggle (Turn ON) ---');
    const toggleOn = await patch(`${baseUrl}/donors/availability`, { is_available: 1 }, token);
    console.log('Toggle ON message:', toggleOn.data.message);
    console.log('Eligibility after toggle ON:', toggleOn.data.donor?.eligibility?.isEligible);

    console.log('\n--- 8. Testing Profile Update ---');
    const updateRes = await put(`${baseUrl}/donors/profile`, { city: 'Navi Mumbai' }, token);
    console.log('Updated city:', updateRes.data.donor?.city);

    console.log('\n--- 9. Testing Public Donor Summary ---');
    const summaryRes = await get(`${baseUrl}/donors/summary`);
    console.log('Total donors in summary:', summaryRes.data.stats?.totalDonors);
    console.log('Available donors in summary:', summaryRes.data.stats?.availableDonors);

    console.log('\n✅ ALL PHASE 2 TESTS PASSED SUCCESSFULLY!\n');
    server.close();
    process.exit(0);
  } catch (err) {
    console.error('❌ Test failed:', err);
    server.close();
    process.exit(1);
  }
});
