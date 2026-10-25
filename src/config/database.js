const path = require('path');
const fs = require('fs');
require('dotenv').config();

const dbPath = process.env.DB_PATH || 'lifelink.db';
const resolvedDbPath = path.isAbsolute(dbPath) ? dbPath : path.resolve(process.cwd(), dbPath);

let db;

try {
  // Attempt to use better-sqlite3 if installed and binary is available
  const BetterSqlite3 = require('better-sqlite3');
  db = new BetterSqlite3(resolvedDbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  console.log('[Database] Connected using better-sqlite3 engine:', resolvedDbPath);
} catch (betterSqliteErr) {
  // Seamless fallback to Node.js built-in SQLite engine (node:sqlite DatabaseSync)
  try {
    const { DatabaseSync } = require('node:sqlite');
    const nativeDb = new DatabaseSync(resolvedDbPath);

    // Provide better-sqlite3 compatible helper interfaces
    nativeDb.pragma = function (pragmaStr) {
      return nativeDb.exec(`PRAGMA ${pragmaStr};`);
    };

    nativeDb.transaction = function (fn) {
      return function (...args) {
        nativeDb.exec('BEGIN');
        try {
          const res = fn(...args);
          nativeDb.exec('COMMIT');
          return res;
        } catch (err) {
          nativeDb.exec('ROLLBACK');
          throw err;
        }
      };
    };

    nativeDb.pragma('journal_mode = WAL');
    nativeDb.pragma('foreign_keys = ON');

    db = nativeDb;
    console.log('[Database] Connected using Node.js built-in node:sqlite engine:', resolvedDbPath);
  } catch (nativeErr) {
    console.error('[Database] Failed to initialize SQLite engine:', nativeErr);
    throw nativeErr;
  }
}

module.exports = db;
