PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- 1. USERS: Authentication credentials & account role
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT CHECK(role IN ('donor', 'requester', 'admin')) NOT NULL DEFAULT 'donor',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. DONORS: Medical eligibility, blood group & availability
CREATE TABLE IF NOT EXISTS donors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    blood_group TEXT CHECK(blood_group IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')) NOT NULL,
    city TEXT NOT NULL COLLATE NOCASE,
    area_pincode TEXT NOT NULL,
    latitude REAL,
    longitude REAL,
    last_donation_date DATE,
    is_available INTEGER NOT NULL DEFAULT 1 CHECK(is_available IN (0, 1)),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 3. REQUESTS: Emergency blood requests with verification workflow and lifecycle
CREATE TABLE IF NOT EXISTS requests (
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
    document_status TEXT CHECK(document_status IN (
        'PENDING', 'VERIFIED', 'REJECTED', 'MISSING'
    )) NOT NULL DEFAULT 'PENDING',
    document_rejection_reason TEXT,
    document_verified_by INTEGER,
    document_verified_at DATETIME,
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

-- 4. RESPONSES: Donor commitment to emergency requests with rich tracking
CREATE TABLE IF NOT EXISTS responses (
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

-- 5. NOTIFICATIONS: Alerts dispatched to users
CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    request_id INTEGER,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'in_app',
    verification_badge TEXT,
    is_read INTEGER NOT NULL DEFAULT 0 CHECK(is_read IN (0, 1)),
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE SET NULL
);

-- 6. REQUEST_ESCALATIONS: Resilient state for staged notifications
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

-- 7. REQUEST_LIFECYCLE_LOGS: Audit trail of lifecycle state transitions
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

-- 8. REPORTS: Flagging spam, abuse or fake requests
CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL,
    reporter_ip TEXT,
    reporter_phone TEXT,
    reason TEXT NOT NULL,
    details TEXT,
    status TEXT CHECK(status IN ('pending', 'action_taken', 'dismissed')) NOT NULL DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE
);

-- 9. BLOOD_BANKS: Verified directory with official hospital landline numbers
CREATE TABLE IF NOT EXISTS blood_banks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    city TEXT NOT NULL COLLATE NOCASE,
    address TEXT NOT NULL,
    phone TEXT NOT NULL,
    official_hospital_phone TEXT,
    latitude REAL,
    longitude REAL,
    operating_hours TEXT DEFAULT '24/7',
    is_verified INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 10. VERIFICATION_LOGS: Audit trail of all admin verification actions
CREATE TABLE IF NOT EXISTS verification_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL,
    admin_user_id INTEGER NOT NULL,
    old_status TEXT NOT NULL,
    new_status TEXT NOT NULL,
    verification_method TEXT CHECK(verification_method IN (
        'phone_call_hospital', 'document_check', 'otp_automated', 'manual_review'
    )) NOT NULL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE,
    FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 11. BLOCKLIST: Blocked phone numbers
CREATE TABLE IF NOT EXISTS blocklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT UNIQUE NOT NULL,
    reason TEXT NOT NULL,
    blocked_by_user_id INTEGER,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (blocked_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- 12. FEEDBACK: Post-donation authenticity feedback from accepted donors
CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL,
    donor_id INTEGER NOT NULL,
    was_genuine TEXT CHECK(was_genuine IN ('yes', 'no', 'not_sure')) NOT NULL,
    comments TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(request_id, donor_id),
    FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE,
    FOREIGN KEY (donor_id) REFERENCES donors(id) ON DELETE CASCADE
);

-- 13. OTPS: Verification codes for emergency request submissions
CREATE TABLE IF NOT EXISTS otps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL,
    code TEXT NOT NULL,
    purpose TEXT NOT NULL DEFAULT 'post_request',
    expires_at DATETIME NOT NULL,
    is_used INTEGER NOT NULL DEFAULT 0 CHECK(is_used IN (0, 1)),
    attempts INTEGER NOT NULL DEFAULT 0,
    verified_at DATETIME,
    is_consumed INTEGER NOT NULL DEFAULT 0 CHECK(is_consumed IN (0, 1)),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_donors_blood_city ON donors(blood_group, city, is_available);
CREATE INDEX IF NOT EXISTS idx_requests_status_urgency ON requests(status, urgency, city, is_hidden);
CREATE INDEX IF NOT EXISTS idx_requests_phone ON requests(contact_phone, status);
CREATE INDEX IF NOT EXISTS idx_requests_verification ON requests(verification_status);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_responses_request ON responses(request_id);
CREATE INDEX IF NOT EXISTS idx_escalations_request ON request_escalations(request_id, is_escalating);
CREATE INDEX IF NOT EXISTS idx_escalations_due ON request_escalations(next_escalation_at, is_escalating);
CREATE INDEX IF NOT EXISTS idx_reports_request ON reports(request_id, status);
CREATE INDEX IF NOT EXISTS idx_blocklist_phone ON blocklist(phone, is_active);
CREATE INDEX IF NOT EXISTS idx_feedback_request ON feedback(request_id);
