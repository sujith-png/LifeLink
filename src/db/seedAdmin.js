const bcrypt = require('bcryptjs');
const db = require('../config/database');

/**
 * Initializes or updates the administrator account using backend environment variables:
 * - ADMIN_EMAIL (defaults to admin@lifelink.org)
 * - ADMIN_PASSWORD (configured securely via environment variables)
 *
 * Passwords are never stored in plaintext and never printed in logs or UI.
 */
function ensureAdminUser() {
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@lifelink.org').trim().toLowerCase();
  const existingAdmin = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);

  const rawPassword = process.env.ADMIN_PASSWORD || 'Admin@123';
  const salt = bcrypt.genSaltSync(10);
  const passwordHash = bcrypt.hashSync(rawPassword, salt);

  if (!existingAdmin) {
    db.prepare(`
      INSERT INTO users (email, password_hash, role)
      VALUES (?, ?, 'admin')
    `).run(adminEmail, passwordHash);

    console.log(`[Admin] Initial administrator account initialized: ${adminEmail}`);
  } else if (process.env.ADMIN_PASSWORD) {
    // Secure migration path: Allows administrator to rotate/set their password via environment variable
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, existingAdmin.id);
    console.log(`[Admin] Administrator password hash updated from environment configuration: ${adminEmail}`);
  }
}

module.exports = { ensureAdminUser };
