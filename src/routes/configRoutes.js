const express = require('express');
const router = express.Router();
const FirebaseConfig = require('../config/firebase');

/**
 * GET /api/config/firebase
 * Returns public Firebase web client credentials and setup diagnostics.
 * NOTE: Private keys, service account credentials, and secrets are NEVER returned here.
 */
router.get('/firebase', (req, res) => {
  const isClientConfigured = FirebaseConfig.isClientConfigured();
  const isAdminConfigured = FirebaseConfig.isAdminConfigured();
  const missing = FirebaseConfig.getMissingConfig();
  const publicConfig = FirebaseConfig.getPublicClientConfig();

  return res.json({
    success: true,
    configured: isClientConfigured,
    adminConfigured: isAdminConfigured,
    missing,
    config: publicConfig
  });
});

module.exports = router;
