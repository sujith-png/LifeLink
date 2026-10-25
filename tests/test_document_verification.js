/**
 * LifeLink End-to-End Integration Test: Document Verification System
 * Tests:
 * 1. Rejection of requests submitted without a document (Compulsory check).
 * 2. Rejection of invalid file extensions and spoofed magic bytes.
 * 3. Successful submission with valid PDF document (initial status PENDING).
 * 4. Verification that non-admins cannot access private requisition slips (401/403).
 * 5. Admin secure document streaming (200 OK with proper headers).
 * 6. Admin approval workflow (PENDING -> VERIFIED with audit trail).
 * 7. Admin rejection workflow (Rejection reason mandatory, status REJECTED, request cancelled).
 * 8. Missing document approval guard (Disabled approval for requests without a document).
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'lifelink_super_secret_jwt_key_2026_secure';

const jwt = require('jsonwebtoken');
const db = require('../src/config/database');
const { runMigrations } = require('../src/db/migrate');
const { ensureAdminUser } = require('../src/db/seedAdmin');

const BASE_URL = 'http://localhost:4009';
const JWT_SECRET = process.env.JWT_SECRET;

async function runTests() {
  console.log('\n======================================================');
  console.log('  LifeLink Document Verification System Integration Test');
  console.log('======================================================\n');

  runMigrations();
  ensureAdminUser();

  const app = require('../src/app');
  const server = app.listen(4009);
  console.log('[Test] Server listening on port 4009\n');

  try {
    const adminUser = db.prepare("SELECT id, email, role FROM users WHERE role = 'admin'").get();
    const adminToken = jwt.sign({ id: adminUser.id, role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });

    const donorUser = db.prepare("SELECT id, email, role FROM users WHERE role = 'donor'").get();
    const donorToken = donorUser
      ? jwt.sign({ id: donorUser.id, role: 'donor' }, JWT_SECRET, { expiresIn: '1h' })
      : null;

    // --- TEST 1: Request Without Document (Must be Rejected) ---
    console.log('--- Test 1: Submit Request Without Document (Compulsory Guard) ---');
    const testPhone1 = `9888${Math.floor(100000 + Math.random() * 900000)}`;

    const formWithoutFile = new FormData();
    formWithoutFile.append('patient_name', 'Patient NoSlip');
    formWithoutFile.append('blood_group', 'B+');
    formWithoutFile.append('units_needed', '1');
    formWithoutFile.append('hospital_name', 'Lilavati Hospital');
    formWithoutFile.append('city', 'Mumbai');
    formWithoutFile.append('contact_phone', testPhone1);
    formWithoutFile.append('urgency', 'Urgent');
    formWithoutFile.append('needed_by', new Date(Date.now() + 24 * 3600 * 1000).toISOString());

    const resNoSlip = await fetch(`${BASE_URL}/api/requests`, {
      method: 'POST',
      body: formWithoutFile
    });
    const dataNoSlip = await resNoSlip.json();

    console.log('Response Status without file:', resNoSlip.status);
    console.log('Response Message:', dataNoSlip.message);

    if (resNoSlip.status !== 400) {
      throw new Error(`Expected status 400 for missing document, received ${resNoSlip.status}`);
    }
    if (!dataNoSlip.message.includes('required')) {
      throw new Error(`Expected message to indicate required document: ${dataNoSlip.message}`);
    }
    console.log('✅ Missing document correctly rejected with 400 Bad Request.\n');

    // --- TEST 2: Submit with Invalid/Spoofed File Format ---
    console.log('--- Test 2: Submit with Spoofed File (Invalid Binary Header) ---');
    const testPhone2 = `9888${Math.floor(100000 + Math.random() * 900000)}`;

    const fakeFileContent = Buffer.from('THIS IS PLAIN TEXT PRETENDING TO BE A JPEG');
    const fakeBlob = new Blob([fakeFileContent], { type: 'image/jpeg' });

    const formFakeFile = new FormData();
    formFakeFile.append('patient_name', 'Patient FakeDoc');
    formFakeFile.append('blood_group', 'O+');
    formFakeFile.append('units_needed', '1');
    formFakeFile.append('hospital_name', 'Lilavati Hospital');
    formFakeFile.append('city', 'Mumbai');
    formFakeFile.append('contact_phone', testPhone2);
    formFakeFile.append('urgency', 'Urgent');
    formFakeFile.append('needed_by', new Date(Date.now() + 24 * 3600 * 1000).toISOString());
    formFakeFile.append('requisition_slip', fakeBlob, 'fake_slip.jpg');

    const resFake = await fetch(`${BASE_URL}/api/requests`, {
      method: 'POST',
      body: formFakeFile
    });
    const dataFake = await resFake.json();

    console.log('Response Status for spoofed binary:', resFake.status);
    console.log('Response Message:', dataFake.message);

    if (resFake.status !== 400) {
      throw new Error(`Expected status 400 for spoofed binary, received ${resFake.status}`);
    }
    console.log('✅ Spoofed document header correctly blocked by magic bytes validator.\n');

    // --- TEST 3: Submit with Genuine PDF Document ---
    console.log('--- Test 3: Submit Request with Genuine Valid PDF Document ---');
    const testPhone3 = `9888${Math.floor(100000 + Math.random() * 900000)}`;

    const validPdfBuffer = Buffer.from(
      "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
      "3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj\nxref\n0 4\n0000000000 65535 f \n" +
      "0000000010 00000 n \n0000000060 00000 n \n0000000111 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF\n"
    );
    const validPdfBlob = new Blob([validPdfBuffer], { type: 'application/pdf' });

    const formValid = new FormData();
    formValid.append('patient_name', 'Patient DocVerif ' + Date.now());
    formValid.append('blood_group', 'A+');
    formValid.append('units_needed', '2');
    formValid.append('hospital_name', 'KEM Hospital');
    formValid.append('doctor_name', 'Dr. S. K. Roy');
    formValid.append('ward_bed', 'ICU-1');
    formValid.append('city', 'Mumbai');
    formValid.append('contact_phone', testPhone3);
    formValid.append('urgency', 'Critical');
    formValid.append('needed_by', new Date(Date.now() + 18 * 3600 * 1000).toISOString());
    formValid.append('requisition_slip', validPdfBlob, 'hospital_prescription.pdf');

    const resValid = await fetch(`${BASE_URL}/api/requests`, {
      method: 'POST',
      body: formValid
    });
    const dataValid = await resValid.json();

    console.log('Valid Post Status:', resValid.status);
    console.log('Created Request ID:', dataValid.request?.id);
    console.log('Initial document_status:', dataValid.request?.document_status);
    console.log('Verification status:', dataValid.request?.verification_status);

    if (resValid.status !== 201 || !dataValid.request?.id) {
      throw new Error(`Failed to create request: ${dataValid.message}`);
    }
    if (dataValid.request.document_status !== 'PENDING') {
      throw new Error(`Expected initial document_status PENDING, got ${dataValid.request.document_status}`);
    }

    const createdReqId = dataValid.request.id;
    console.log('✅ Request successfully created with document_status = PENDING.\n');

    // --- TEST 4: Unauthorized Slip Access Control ---
    console.log('--- Test 4: Access Control for Medical Slip (Confidentiality) ---');
    // Public unauthenticated request
    const resUnauth = await fetch(`${BASE_URL}/api/admin/requests/${createdReqId}/slip`);
    console.log('Public access status (should be 401):', resUnauth.status);
    if (resUnauth.status !== 401) {
      throw new Error(`Expected 401 for unauthenticated slip access, received ${resUnauth.status}`);
    }

    // Donor role (should be 403 Forbidden)
    if (donorToken) {
      const resDonor = await fetch(`${BASE_URL}/api/admin/requests/${createdReqId}/slip`, {
        headers: { 'Authorization': `Bearer ${donorToken}` }
      });
      console.log('Donor access status (should be 403):', resDonor.status);
      if (resDonor.status !== 403) {
        throw new Error(`Expected 403 for donor slip access, received ${resDonor.status}`);
      }
    }
    console.log('✅ Medical document strictly protected against non-admin access.\n');

    // --- TEST 5: Authorized Admin Slip Streaming ---
    console.log('--- Test 5: Authorized Admin Document Streaming ---');
    const resAdminSlip = await fetch(`${BASE_URL}/api/admin/requests/${createdReqId}/slip`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    console.log('Admin stream status:', resAdminSlip.status);
    console.log('Content-Type:', resAdminSlip.headers.get('content-type'));

    if (resAdminSlip.status !== 200) {
      throw new Error(`Failed to stream document as admin: status ${resAdminSlip.status}`);
    }
    const slipBytes = await resAdminSlip.arrayBuffer();
    console.log('Streamed byte length:', slipBytes.byteLength);
    if (slipBytes.byteLength === 0) {
      throw new Error('Received 0 bytes for document slip');
    }
    console.log('✅ Admin successfully streams medical document securely.\n');

    // --- TEST 6: Admin Approves Document ---
    console.log('--- Test 6: Admin Approves Document (PENDING -> VERIFIED) ---');
    const resApprove = await fetch(`${BASE_URL}/api/admin/requests/${createdReqId}/verify-document`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({ action: 'approve' })
    });
    const dataApprove = await resApprove.json();

    console.log('Approve response status:', resApprove.status);
    console.log('Updated document_status:', dataApprove.document_status);
    console.log('Updated verification_status:', dataApprove.request?.verification_status);

    if (resApprove.status !== 200 || dataApprove.document_status !== 'VERIFIED') {
      throw new Error(`Failed to approve document: ${JSON.stringify(dataApprove)}`);
    }
    if (dataApprove.request.verification_status !== 'Document Verified') {
      throw new Error(`Expected verification_status 'Document Verified', received ${dataApprove.request.verification_status}`);
    }

    // Verify Audit Trail Log
    const auditLog = db.prepare(`
      SELECT * FROM verification_logs 
      WHERE request_id = ? AND new_status = 'VERIFIED' AND verification_method = 'document_check'
    `).get(createdReqId);

    if (!auditLog) {
      throw new Error('Audit log was not recorded for document approval');
    }
    console.log('Audit log entry recorded by Admin ID:', auditLog.admin_user_id);
    console.log('✅ Document successfully approved with audit trail.\n');

    // --- TEST 7: Admin Rejection Workflow ---
    console.log('--- Test 7: Admin Rejects Document (Requires Reason) ---');
    // Create another request to test rejection
    const testPhone4 = `9888${Math.floor(100000 + Math.random() * 900000)}`;

    const formRejectTest = new FormData();
    formRejectTest.append('patient_name', 'Dubious Request ' + Date.now());
    formRejectTest.append('blood_group', 'O-');
    formRejectTest.append('units_needed', '1');
    formRejectTest.append('hospital_name', 'City Hospital');
    formRejectTest.append('city', 'Mumbai');
    formRejectTest.append('contact_phone', testPhone4);
    formRejectTest.append('urgency', 'Normal');
    formRejectTest.append('needed_by', new Date(Date.now() + 24 * 3600 * 1000).toISOString());
    formRejectTest.append('requisition_slip', validPdfBlob, 'prescription_2.pdf');

    const resReqReject = await fetch(`${BASE_URL}/api/requests`, { method: 'POST', body: formRejectTest });
    const dataReqReject = await resReqReject.json();
    const reqRejectId = dataReqReject.request.id;

    // 7a: Rejecting without reason should fail with 400
    const resNoReason = await fetch(`${BASE_URL}/api/admin/requests/${reqRejectId}/verify-document`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({ action: 'reject', reason: '' })
    });
    console.log('Reject without reason status (should be 400):', resNoReason.status);
    if (resNoReason.status !== 400) {
      throw new Error(`Expected 400 when rejecting without reason, got ${resNoReason.status}`);
    }

    // 7b: Reject with valid reason
    const rejectionReason = 'Requisition slip hospital seal is unreadable and date does not match';
    const resReject = await fetch(`${BASE_URL}/api/admin/requests/${reqRejectId}/verify-document`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({ action: 'reject', reason: rejectionReason })
    });
    const dataReject = await resReject.json();

    console.log('Reject response status:', resReject.status);
    console.log('Updated document_status:', dataReject.document_status);
    console.log('Updated request status:', dataReject.request?.status);

    if (resReject.status !== 200 || dataReject.document_status !== 'REJECTED') {
      throw new Error(`Failed to reject document: ${JSON.stringify(dataReject)}`);
    }
    if (dataReject.request.status !== 'Cancelled') {
      throw new Error(`Expected request status 'Cancelled', got ${dataReject.request.status}`);
    }

    const rejectLog = db.prepare(`
      SELECT * FROM verification_logs 
      WHERE request_id = ? AND new_status = 'REJECTED'
    `).get(reqRejectId);

    if (!rejectLog || !rejectLog.notes.includes('unreadable')) {
      throw new Error('Audit log was not properly recorded for document rejection');
    }
    console.log('✅ Rejection properly enforced with mandatory reason, cancelled lifecycle, and audit log.\n');

    // --- TEST 8: Missing Document Approval Guard ---
    console.log('--- Test 8: Missing Document Approval Guard ---');
    // Seed request #5 has document_status = MISSING (no file)
    const missingDocReq = db.prepare("SELECT id FROM requests WHERE document_status = 'MISSING' LIMIT 1").get();
    if (missingDocReq) {
      const resApproveMissing = await fetch(`${BASE_URL}/api/admin/requests/${missingDocReq.id}/verify-document`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({ action: 'approve' })
      });
      console.log('Approval status for request without document (should be 400):', resApproveMissing.status);
      if (resApproveMissing.status !== 400) {
        throw new Error(`Expected 400 when approving missing document, got ${resApproveMissing.status}`);
      }
      console.log('✅ Approving a request without a document is strictly blocked with 400.\n');
    }

    console.log('🎉 ALL DOCUMENT VERIFICATION SYSTEM TESTS PASSED SUCCESSFULLY!\n');
  } finally {
    server.close(() => {
      setTimeout(() => process.exit(0), 100);
    });
  }
}

runTests().catch(err => {
  console.error('\n❌ Test Suite Failed:', err);
  process.exit(1);
});
