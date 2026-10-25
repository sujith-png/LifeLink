const db = require('../config/database');

function runDocumentVerificationMigration() {
  console.log('[Migration] Checking document verification columns in requests table...');

  try {
    const columns = db.prepare("PRAGMA table_info(requests)").all().map(c => c.name);

    if (!columns.includes('document_status')) {
      console.log('[Migration] Adding column document_status to requests...');
      db.exec("ALTER TABLE requests ADD COLUMN document_status TEXT DEFAULT 'PENDING'");
    }

    if (!columns.includes('document_rejection_reason')) {
      console.log('[Migration] Adding column document_rejection_reason to requests...');
      db.exec("ALTER TABLE requests ADD COLUMN document_rejection_reason TEXT");
    }

    if (!columns.includes('document_verified_by')) {
      console.log('[Migration] Adding column document_verified_by to requests...');
      db.exec("ALTER TABLE requests ADD COLUMN document_verified_by INTEGER REFERENCES users(id)");
    }

    if (!columns.includes('document_verified_at')) {
      console.log('[Migration] Adding column document_verified_at to requests...');
      db.exec("ALTER TABLE requests ADD COLUMN document_verified_at DATETIME");
    }

    // Backfill document_status for existing requests
    db.prepare(`
      UPDATE requests 
      SET document_status = 'MISSING' 
      WHERE (requisition_slip_filename IS NULL OR requisition_slip_filename = '')
        AND (document_status IS NULL OR document_status = 'PENDING')
    `).run();

    db.prepare(`
      UPDATE requests 
      SET document_status = 'VERIFIED' 
      WHERE verification_status IN ('Document Verified', 'Hospital Confirmed')
        AND requisition_slip_filename IS NOT NULL 
        AND requisition_slip_filename != ''
        AND (document_status IS NULL OR document_status = 'PENDING')
    `).run();

    db.prepare(`
      UPDATE requests 
      SET document_status = 'REJECTED' 
      WHERE verification_status = 'Rejected'
        AND (document_status IS NULL OR document_status = 'PENDING')
    `).run();

    db.prepare(`
      UPDATE requests 
      SET document_status = 'PENDING' 
      WHERE requisition_slip_filename IS NOT NULL 
        AND requisition_slip_filename != '' 
        AND (document_status IS NULL OR document_status = '')
    `).run();

    console.log('[Migration] Document verification schema migration completed successfully.');
  } catch (err) {
    console.error('[Migration] Document verification schema migration failed:', err);
    throw err;
  }
}

module.exports = { runDocumentVerificationMigration };
