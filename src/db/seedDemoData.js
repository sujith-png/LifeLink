const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const { ensureAdminUser } = require('./seedAdmin');
const { seedBloodBanks } = require('./seedBloodBanks');

/**
 * LifeLink Complete Seed Data for College Demo
 * Seeds:
 * - 20 realistic donors across 8 blood groups and 5 major cities
 * - 5 realistic emergency requests showcasing different verification stages
 * - 10 verified regional blood banks with official landline switchboards
 * - Configures initial administrator securely via environment variables
 */

const SAMPLE_DONORS = [
  // Mumbai Donors
  { name: 'Rahul Sharma', email: 'rahul.sharma@lifelink.demo', phone: '9820111111', blood: 'O+', city: 'Mumbai', pincode: '400012', lat: 19.0028, lng: 72.8427, daysAgo: 110, available: 1 },
  { name: 'Pooja Kulkarni', email: 'pooja.kulkarni@lifelink.demo', phone: '9820222222', blood: 'A+', city: 'Mumbai', pincode: '400050', lat: 19.0514, lng: 72.8295, daysAgo: 95, available: 1 },
  { name: 'Amitabh Sen', email: 'amitabh.sen@lifelink.demo', phone: '9820333333', blood: 'B+', city: 'Mumbai', pincode: '400014', lat: 19.0178, lng: 72.8478, daysAgo: 130, available: 1 },
  { name: 'Neha Varma', email: 'neha.varma@lifelink.demo', phone: '9820444444', blood: 'AB+', city: 'Mumbai', pincode: '400016', lat: 19.0345, lng: 72.8402, daysAgo: 100, available: 1 },
  { name: 'Vikram Joshi', email: 'vikram.joshi@lifelink.demo', phone: '9820555555', blood: 'O-', city: 'Mumbai', pincode: '400004', lat: 18.9567, lng: 72.8189, daysAgo: 120, available: 1 },
  { name: 'Sneha Patil', email: 'sneha.patil@lifelink.demo', phone: '9820666666', blood: 'A-', city: 'Mumbai', pincode: '400052', lat: 19.0689, lng: 72.8344, daysAgo: 45, available: 1 }, // Ineligible (<90 days)
  { name: 'Kunal Deshmukh', email: 'kunal.d@lifelink.demo', phone: '9820777777', blood: 'B-', city: 'Mumbai', pincode: '400007', lat: 18.9634, lng: 72.8122, daysAgo: 140, available: 0 }, // Ineligible (available=0)

  // Delhi Donors
  { name: 'Arjun Mehra', email: 'arjun.mehra@lifelink.demo', phone: '9811111111', blood: 'AB-', city: 'Delhi', pincode: '110029', lat: 28.5672, lng: 77.2100, daysAgo: 105, available: 1 },
  { name: 'Simran Kaur', email: 'simran.kaur@lifelink.demo', phone: '9811222222', blood: 'O+', city: 'Delhi', pincode: '110016', lat: 28.5522, lng: 77.1950, daysAgo: 115, available: 1 },
  { name: 'Deepak Gupta', email: 'deepak.gupta@lifelink.demo', phone: '9811333333', blood: 'A+', city: 'Delhi', pincode: '110001', lat: 28.6328, lng: 77.2197, daysAgo: 125, available: 1 },
  { name: 'Ananya Roy', email: 'ananya.roy@lifelink.demo', phone: '9811444444', blood: 'B+', city: 'Delhi', pincode: '110025', lat: 28.5630, lng: 77.2840, daysAgo: 98, available: 1 },
  { name: 'Rohan Kapoor', email: 'rohan.kapoor@lifelink.demo', phone: '9811555555', blood: 'O-', city: 'Delhi', pincode: '110048', lat: 28.5355, lng: 77.2410, daysAgo: 150, available: 1 },

  // Bengaluru Donors
  { name: 'Kavita Nair', email: 'kavita.nair@lifelink.demo', phone: '9845111111', blood: 'O+', city: 'Bengaluru', pincode: '560002', lat: 12.9642, lng: 77.5756, daysAgo: 100, available: 1 },
  { name: 'Ganesh Rao', email: 'ganesh.rao@lifelink.demo', phone: '9845222222', blood: 'O-', city: 'Bengaluru', pincode: '560017', lat: 12.9592, lng: 77.6499, daysAgo: 110, available: 1 },
  { name: 'Priya Hegde', email: 'priya.hegde@lifelink.demo', phone: '9845333333', blood: 'B+', city: 'Bengaluru', pincode: '560034', lat: 12.9250, lng: 77.6245, daysAgo: 140, available: 1 },
  { name: 'Siddharth Iyer', email: 'siddharth.i@lifelink.demo', phone: '9845444444', blood: 'A+', city: 'Bengaluru', pincode: '560001', lat: 12.9716, lng: 77.5946, daysAgo: 102, available: 1 },

  // Pune Donors
  { name: 'Tanvi Chitnis', email: 'tanvi.c@lifelink.demo', phone: '9822111111', blood: 'A-', city: 'Pune', pincode: '411001', lat: 18.5284, lng: 73.8739, daysAgo: 115, available: 1 },
  { name: 'Sameer Shinde', email: 'sameer.s@lifelink.demo', phone: '9822222222', blood: 'B+', city: 'Pune', pincode: '411004', lat: 18.5167, lng: 73.8417, daysAgo: 130, available: 1 },

  // Chennai Donors
  { name: 'Manoj Sundaram', email: 'manoj.s@lifelink.demo', phone: '9841111111', blood: 'O+', city: 'Chennai', pincode: '600003', lat: 13.0810, lng: 80.2785, daysAgo: 108, available: 1 },
  { name: 'Lakshmi Narayanan', email: 'lakshmi.n@lifelink.demo', phone: '9841222222', blood: 'AB+', city: 'Chennai', pincode: '600004', lat: 13.0334, lng: 80.2678, daysAgo: 120, available: 1 }
];

function seedDonors() {
  const salt = bcrypt.genSaltSync(8);
  const commonHash = bcrypt.hashSync('Donor@123', salt);

  const insertUser = db.prepare(`
    INSERT INTO users (email, password_hash, role)
    VALUES (?, ?, 'donor')
    ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash
  `);

  const insertDonor = db.prepare(`
    INSERT INTO donors (
      user_id, name, phone, blood_group, city, area_pincode,
      latitude, longitude, last_donation_date, is_available
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      name = excluded.name,
      phone = excluded.phone,
      blood_group = excluded.blood_group,
      city = excluded.city,
      area_pincode = excluded.area_pincode,
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      last_donation_date = excluded.last_donation_date,
      is_available = excluded.is_available
  `);

  const tx = db.transaction(() => {
    for (const d of SAMPLE_DONORS) {
      insertUser.run(d.email, commonHash);
      const user = db.prepare('SELECT id FROM users WHERE email = ?').get(d.email);

      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - d.daysAgo);
      const pastDateStr = pastDate.toISOString().split('T')[0];

      insertDonor.run(
        user.id,
        d.name,
        d.phone,
        d.blood,
        d.city,
        d.pincode,
        d.lat,
        d.lng,
        pastDateStr,
        d.available
      );
    }
  });

  tx();
  console.log(`[Seed] Seeded ${SAMPLE_DONORS.length} sample donors with password "Donor@123".`);
}

function ensureSampleSlipFiles() {
  const uploadDir = path.resolve(__dirname, '../../uploads/requisitions');
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  // Sample PDF binary (valid PDF header %PDF-1.4)
  const pdfBuffer = Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj\nxref\n0 4\n0000000000 65535 f \n" +
    "0000000010 00000 n \n0000000060 00000 n \n0000000111 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF\n"
  );

  // Sample JPEG binary (valid JPEG header 0xFF 0xD8 0xFF)
  const jpegBuffer = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
    0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
    0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
    0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20,
    0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
    0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32,
    0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
    0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00,
    0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
    0x09, 0x0a, 0x0b, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f,
    0x00, 0xbf, 0x80, 0xff, 0xd9
  ]);

  // Sample PNG binary (valid PNG header 0x89 0x50 0x4E 0x47)
  const pngBuffer = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
    0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x60, 0x60, 0x60, 0x00,
    0x00, 0x00, 0x04, 0x00, 0x01, 0x5d, 0x16, 0x85, 0x48, 0x00, 0x00, 0x00,
    0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
  ]);

  fs.writeFileSync(path.join(uploadDir, 'demo_requisition_slip_aiims.pdf'), pdfBuffer);
  fs.writeFileSync(path.join(uploadDir, 'demo_requisition_slip_kem.jpg'), jpegBuffer);
  fs.writeFileSync(path.join(uploadDir, 'demo_requisition_slip_lilavati.png'), pngBuffer);
  fs.writeFileSync(path.join(uploadDir, 'demo_requisition_slip_victoria.pdf'), pdfBuffer);
}

function seedRequests() {
  ensureSampleSlipFiles();

  const demoRequesterEmail = 'requester.demo@lifelink.org';
  const salt = bcrypt.genSaltSync(8);
  const reqHash = bcrypt.hashSync('Req@123', salt);

  db.prepare(`
    INSERT INTO users (email, password_hash, role)
    VALUES (?, ?, 'requester')
    ON CONFLICT(email) DO NOTHING
  `).run(demoRequesterEmail, reqHash);

  const reqUser = db.prepare('SELECT id FROM users WHERE email = ?').get(demoRequesterEmail);
  const reqUserId = reqUser ? reqUser.id : null;

  const SAMPLE_REQUESTS = [
    {
      patient_name: 'Devika Singhania',
      blood_group: 'AB-',
      units: 2,
      hospital: 'AIIMS Blood Bank & Transfusion Center',
      doctor: 'Dr. R. K. Sharma',
      ward: 'ICU Bed 04',
      city: 'Delhi',
      pincode: '110029',
      lat: 28.5672,
      lng: 77.2100,
      phone: '9811001100',
      urgency: 'Critical',
      hoursRemaining: 18,
      note: 'Urgent open-heart coronary bypass surgery at AIIMS.',
      verification: 'Hospital Confirmed',
      status: 'Open',
      slip_filename: 'demo_requisition_slip_aiims.pdf',
      slip_mimetype: 'application/pdf',
      document_status: 'VERIFIED'
    },
    {
      patient_name: 'Rajesh Gokhale',
      blood_group: 'O+',
      units: 3,
      hospital: 'KEM Hospital Blood Bank',
      doctor: 'Dr. V. Joshi',
      ward: 'Trauma ICU-2',
      city: 'Mumbai',
      pincode: '400012',
      lat: 19.0028,
      lng: 72.8427,
      phone: '9820002200',
      urgency: 'Urgent',
      hoursRemaining: 24,
      note: 'Road traffic trauma emergency needing immediate packed red blood cells.',
      verification: 'Document Verified',
      status: 'Open',
      slip_filename: 'demo_requisition_slip_kem.jpg',
      slip_mimetype: 'image/jpeg',
      document_status: 'VERIFIED'
    },
    {
      patient_name: 'Aarav Mehta',
      blood_group: 'B+',
      units: 2,
      hospital: 'Lilavati Hospital & Research Centre',
      doctor: 'Dr. Suresh Joshi',
      ward: 'Cardiac ICU Bed 12',
      city: 'Mumbai',
      pincode: '400050',
      lat: 19.0514,
      lng: 72.8295,
      phone: '9820003300',
      urgency: 'Critical',
      hoursRemaining: 12,
      note: 'Paediatric cardiac emergency. Hospital transfusion unit matching donors.',
      verification: 'Phone Verified',
      status: 'Open',
      slip_filename: 'demo_requisition_slip_lilavati.png',
      slip_mimetype: 'image/png',
      document_status: 'PENDING'
    },
    {
      patient_name: 'Suresh Patil',
      blood_group: 'O-',
      units: 1,
      hospital: 'Victoria Hospital Blood Bank (BMCRI)',
      doctor: 'Dr. Manjunath',
      ward: 'Ward 4B',
      city: 'Bengaluru',
      pincode: '560002',
      lat: 12.9642,
      lng: 77.5756,
      phone: '9845004400',
      urgency: 'Normal',
      hoursRemaining: 48,
      note: 'Elective scheduled orthopaedic surgery.',
      verification: 'Hospital Confirmed',
      status: 'Fulfilled',
      slip_filename: 'demo_requisition_slip_victoria.pdf',
      slip_mimetype: 'application/pdf',
      document_status: 'VERIFIED'
    },
    {
      patient_name: 'Alok Nath Trivedi',
      blood_group: 'A+',
      units: 12, // Suspicious high units
      hospital: 'Sassoon General Hospital Blood Center',
      doctor: 'Dr. Deshmukh',
      ward: 'Bed 20',
      city: 'Pune',
      pincode: '411001',
      lat: 18.5284,
      lng: 73.8739,
      phone: '9822005500',
      urgency: 'Urgent',
      hoursRemaining: 36,
      note: 'Major surgical procedure requiring blood backup.',
      verification: 'Phone Verified',
      status: 'Open',
      is_suspicious: 1,
      suspicious_reason: 'Unusually high blood units requested (>10 units). Hospital confirmation required.',
      slip_filename: null,
      slip_mimetype: null,
      document_status: 'MISSING'
    }
  ];

  const insertReq = db.prepare(`
    INSERT INTO requests (
      requester_user_id, patient_name, blood_group, units_needed,
      hospital_name, doctor_name, ward_bed, city, area_pincode,
      latitude, longitude, contact_phone, urgency, needed_by, note,
      requisition_slip_filename, requisition_slip_mimetype, document_status,
      verification_status, status, otp_verified, is_suspicious, suspicious_reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `);

  const tx = db.transaction(() => {
    for (const r of SAMPLE_REQUESTS) {
      const existing = db.prepare('SELECT id FROM requests WHERE contact_phone = ?').get(r.phone);
      if (!existing) {
        const neededBy = new Date(Date.now() + r.hoursRemaining * 3600 * 1000).toISOString();
        insertReq.run(
          reqUserId,
          r.patient_name,
          r.blood_group,
          r.units,
          r.hospital,
          r.doctor,
          r.ward,
          r.city,
          r.pincode,
          r.lat,
          r.lng,
          r.phone,
          r.urgency,
          neededBy,
          r.note,
          r.slip_filename || null,
          r.slip_mimetype || null,
          r.document_status || 'PENDING',
          r.verification,
          r.status,
          r.is_suspicious || 0,
          r.suspicious_reason || null
        );
      }
    }
  });

  tx();
  console.log(`[Seed] Seeded ${SAMPLE_REQUESTS.length} representative emergency requests with document verification statuses.`);
}

function runSeedAll() {
  console.log('\n======================================================');
  console.log('  LifeLink College Project: Master Seed Data Script');
  console.log('======================================================');
  ensureAdminUser();
  seedBloodBanks();
  seedDonors();
  seedRequests();
  console.log('✅ Master seed data successfully initialized.\n');
}

if (require.main === module) {
  runSeedAll();
}

module.exports = { runSeedAll };
