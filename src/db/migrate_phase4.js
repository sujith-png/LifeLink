const db = require('../config/database');

function runPhase4Migration() {
  console.log('[Migration Phase 4] Checking and applying Phase 4 schema updates...');

  // Check if request_escalations already exists
  const tableCheck = db.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name='request_escalations'
  `).get();

  if (tableCheck) {
    console.log('[Migration Phase 4] Schema already updated.');
    return;
  }

  db.pragma('foreign_keys = OFF');

  const migration = db.transaction(() => {
    // 1. Create table responses_new with extended statuses and columns
    db.exec(`
      CREATE TABLE IF NOT EXISTS responses_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          request_id INTEGER NOT NULL,
          donor_id INTEGER NOT NULL,
          status TEXT CHECK(status IN (
            'Invited', 'Accepted', 'Declined', 'Availability Confirmed',
            'On the Way', 'Arrived — Self-Reported', 'Withdrawn', 'Timed Out',
            'accepted', 'declined'
          )) NOT NULL,
          eta_minutes INTEGER,
          eta_text TEXT,
          note TEXT,
          withdrawal_reason TEXT,
          status_updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(request_id, donor_id),
          FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE,
          FOREIGN KEY (donor_id) REFERENCES donors(id) ON DELETE CASCADE
      );
    `);

    // Copy existing responses
    db.exec(`
      INSERT INTO responses_new (id, request_id, donor_id, status, note, created_at, updated_at)
      SELECT id, request_id, donor_id, 
             CASE 
               WHEN status = 'accepted' THEN 'Accepted' 
               WHEN status = 'declined' THEN 'Declined' 
               ELSE status 
             END, 
             note, created_at, updated_at 
      FROM responses;
    `);

    db.exec(`DROP TABLE responses;`);
    db.exec(`ALTER TABLE responses_new RENAME TO responses;`);

    // 2. Create request_escalations table
    db.exec(`
      CREATE TABLE IF NOT EXISTS request_escalations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          request_id INTEGER UNIQUE NOT NULL,
          current_stage INTEGER NOT NULL DEFAULT 1,
          stage_1_dispatched_at DATETIME,
          stage_2_dispatched_at DATETIME,
          stage_3_dispatched_at DATETIME,
          next_escalation_at DATETIME,
          is_escalating INTEGER NOT NULL DEFAULT 1 CHECK(is_escalating IN (0, 1)),
          donors_notified_count INTEGER NOT NULL DEFAULT 0,
          last_evaluated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE
      );
    `);

    // 3. Create request_lifecycle_logs table
    db.exec(`
      CREATE TABLE IF NOT EXISTS request_lifecycle_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          request_id INTEGER NOT NULL,
          actor_user_id INTEGER,
          previous_status TEXT NOT NULL,
          new_status TEXT NOT NULL,
          reason TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE
      );
    `);

    // 4. Create requests_new to allow 'Cancelled' and new tracking columns
    db.exec(`
      CREATE TABLE IF NOT EXISTS requests_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          requester_user_id INTEGER,
          patient_name TEXT NOT NULL,
          blood_group TEXT CHECK(blood_group IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')) NOT NULL,
          units_needed INTEGER NOT NULL DEFAULT 1 CHECK(units_needed > 0),
          hospital_name TEXT NOT NULL,
          doctor_name TEXT,
          ward_bed TEXT,
          city TEXT NOT NULL COLLATE NOCASE,
          area_pincode TEXT,
          latitude REAL,
          longitude REAL,
          contact_phone TEXT NOT NULL,
          urgency TEXT CHECK(urgency IN ('Critical', 'Urgent', 'Normal')) NOT NULL DEFAULT 'Urgent',
          needed_by DATETIME NOT NULL,
          note TEXT,
          requisition_slip_filename TEXT,
          requisition_slip_mimetype TEXT,
          verification_status TEXT CHECK(verification_status IN (
              'Unverified', 'Phone Verified', 'Document Verified', 'Hospital Confirmed', 'Rejected'
          )) NOT NULL DEFAULT 'Unverified',
          status TEXT CHECK(status IN ('Open', 'Fulfilled', 'Expired', 'Cancelled')) NOT NULL DEFAULT 'Open',
          otp_verified INTEGER NOT NULL DEFAULT 0 CHECK(otp_verified IN (0, 1)),
          report_count INTEGER NOT NULL DEFAULT 0,
          is_hidden INTEGER NOT NULL DEFAULT 0 CHECK(is_hidden IN (0, 1)),
          is_suspicious INTEGER NOT NULL DEFAULT 0 CHECK(is_suspicious IN (0, 1)),
          suspicious_reason TEXT,
          fulfillment_confirmed_at DATETIME,
          fulfillment_notes TEXT,
          closed_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (requester_user_id) REFERENCES users(id) ON DELETE SET NULL
      );
    `);

    db.exec(`
      INSERT INTO requests_new (
          id, requester_user_id, patient_name, blood_group, units_needed,
          hospital_name, doctor_name, ward_bed, city, area_pincode,
          latitude, longitude, contact_phone, urgency, needed_by, note,
          requisition_slip_filename, requisition_slip_mimetype,
          verification_status, status, otp_verified, report_count,
          is_hidden, is_suspicious, suspicious_reason, created_at, updated_at
      )
      SELECT 
          id, requester_user_id, patient_name, blood_group, units_needed,
          hospital_name, doctor_name, ward_bed, city, area_pincode,
          latitude, longitude, contact_phone, urgency, needed_by, note,
          requisition_slip_filename, requisition_slip_mimetype,
          verification_status, status, otp_verified, report_count,
          is_hidden, is_suspicious, suspicious_reason, created_at, updated_at
      FROM requests;
    `);

    db.exec(`DROP TABLE requests;`);
    db.exec(`ALTER TABLE requests_new RENAME TO requests;`);

    // Indexes
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_donors_blood_city ON donors(blood_group, city, is_available);
      CREATE INDEX IF NOT EXISTS idx_requests_status_urgency ON requests(status, urgency, city, is_hidden);
      CREATE INDEX IF NOT EXISTS idx_requests_phone ON requests(contact_phone, status);
      CREATE INDEX IF NOT EXISTS idx_requests_verification ON requests(verification_status);
      CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
      CREATE INDEX IF NOT EXISTS idx_responses_request ON responses(request_id);
      CREATE INDEX IF NOT EXISTS idx_escalations_request ON request_escalations(request_id, is_escalating);
      CREATE INDEX IF NOT EXISTS idx_escalations_due ON request_escalations(next_escalation_at, is_escalating);
    `);
  });

  migration();
  db.pragma('foreign_keys = ON');

  console.log('[Migration Phase 4] Successfully applied schema updates without data loss.');
}

if (require.main === module) {
  try {
    runPhase4Migration();
    process.exit(0);
  } catch (err) {
    console.error('[Migration Phase 4] Failed:', err);
    process.exit(1);
  }
}

module.exports = { runPhase4Migration };
