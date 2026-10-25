const fs = require('fs');
const path = require('path');
const db = require('../config/database');

function runMigrations() {
  console.log('[Migration] Starting database migration...');
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  // Execute the schema script
  db.exec(schemaSql);

  const { runPhase4Migration } = require('./migrate_phase4');
  runPhase4Migration();

  const { runDocumentVerificationMigration } = require('./migrate_document_verification');
  runDocumentVerificationMigration();

  const { runOtpSecurityMigration } = require('./migrate_otp_security');
  runOtpSecurityMigration();

  const { migrateFirebaseTokens } = require('./migrate_firebase_tokens');
  migrateFirebaseTokens();

  console.log('[Migration] Database schema migrated successfully.');
}

if (require.main === module) {
  try {
    runMigrations();
    process.exit(0);
  } catch (error) {
    console.error('[Migration] Migration failed:', error);
    process.exit(1);
  }
}

module.exports = { runMigrations };
