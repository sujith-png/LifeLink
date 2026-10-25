const db = require('../config/database');

/**
 * Migration: Create verified_tokens table
 * Stores consumed Firebase verification tokens to prevent token replay attacks
 */
function migrateFirebaseTokens() {
  console.log('[Migration] Checking verified_tokens table for Firebase replay protection...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS verified_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      firebase_uid TEXT,
      phone TEXT NOT NULL,
      token_hash TEXT UNIQUE NOT NULL,
      purpose TEXT NOT NULL,
      created_at DATETIME NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_verified_tokens_hash ON verified_tokens(token_hash);
    CREATE INDEX IF NOT EXISTS idx_verified_tokens_phone ON verified_tokens(phone);
  `);

  console.log('[Migration] verified_tokens table ready.');
}

if (require.main === module) {
  migrateFirebaseTokens();
}

module.exports = { migrateFirebaseTokens };
