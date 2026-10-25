const express = require('express');
const router = express.Router();
const donorController = require('../controllers/donorController');
const { authenticate, authorize } = require('../middleware/auth');
const { sanitizeBody } = require('../middleware/validate');

// Public donor summary (aggregates only, no PII)
router.get('/summary', donorController.getPublicSummary);

// Protected donor profile endpoints
router.get('/profile', authenticate, authorize(['donor']), donorController.getProfile);
router.put('/profile', authenticate, authorize(['donor']), sanitizeBody, donorController.updateProfile);
router.patch('/availability', authenticate, authorize(['donor']), donorController.toggleAvailability);
router.post('/record-donation', authenticate, authorize(['donor']), sanitizeBody, donorController.recordDonation);

module.exports = router;
