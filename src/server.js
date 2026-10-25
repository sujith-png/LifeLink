require('dotenv').config();
const http = require('http');
const app = require('./app');
const { runMigrations } = require('./db/migrate');
const { ensureAdminUser } = require('./db/seedAdmin');

const PORT = process.env.PORT || 3000;

// Ensure database schema and seed admin user on startup
try {
  runMigrations();
  ensureAdminUser();
} catch (err) {
  console.error('[Server] Initialization error:', err);
}

const LifecycleService = require('./services/lifecycleService');
const EscalationService = require('./services/escalationService');

const server = http.createServer(app);

// Periodic background runner: auto-expire overdue requests and process due alert escalations
const lifecycleInterval = setInterval(async () => {
  try {
    LifecycleService.autoExpirePastDeadlineRequests();
    await EscalationService.processDueEscalations();
  } catch (err) {
    console.error('[Background Worker] Periodic cycle error:', err.message);
  }
}, 30 * 1000);
lifecycleInterval.unref();

server.listen(PORT, () => {
  console.log(`=================================================`);
  console.log(`  LifeLink Emergency Blood Donor Finder Running `);
  console.log(`  URL: http://localhost:${PORT}                 `);
  console.log(`  Administration: Protected & Authenticated     `);
  console.log(`=================================================`);
});

module.exports = server;
