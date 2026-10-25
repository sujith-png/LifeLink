const db = require('../config/database');

/**
 * Migration: Add OTP security columns to `otps` table
 * - attempts: number of incorrect verification attempts (max 5)
 * - verified_at: timestamp when code was verified
 * - is_consumed: flag indicating whether verified code was consumed to create request/account
 */
function runOtpSecurityMigration() {
  console.log('[Migration] Checking OTP security columns in otps table...');
  const tableInfo = db.prepare('PRAGMA table_info(otps)').all();
  const existingCols = tableInfo.map(c => c.name);

  if (!existingCols.includes('attempts')) {
    db.prepare('ALTER TABLE otps ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0').run();
    console.log('[Migration] Added column "attempts" to otps table.');
  }

  if (!existingCols.includes('verified_at')) {
    db.prepare('ALTER TABLE otps ADD COLUMN verified_at DATETIME').run();
    console.log('[Migration] Added column "verified_at" to otps table.');
  }

  if (!existingCols.includes('is_consumed')) {
    db.prepare('ALTER TABLE otps ADD COLUMN is_consumed INTEGER NOT NULL DEFAULT 0').run();
    console.log('[Migration] Added column "is_consumed" to otps table.');
  }

  console.log('[Migration] OTP security schema migration completed successfully.');
}

if (require.main === module) {
  runOtpSecurityMigration();
}

module.exports = { runOtpSecurityMigration };
