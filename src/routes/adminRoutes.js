const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { authenticate, authorize } = require('../middleware/auth');
const { sanitizeBody } = require('../middleware/validate');

// All routes in adminRoutes require authenticated Admin role
router.use(authenticate, authorize(['admin']));

// Platform stats
router.get('/stats', adminController.getStats);

// Verification queue & actions
router.get('/verification-queue', adminController.getVerificationQueue);
router.get('/requests/:id/slip', adminController.getRequisitionSlip);
router.get('/requests/:id/document', adminController.getRequisitionSlip);
router.patch('/requests/:id/verify-document', sanitizeBody, adminController.verifyDocument);
router.post('/requests/:id/verify-document', sanitizeBody, adminController.verifyDocument);
router.patch('/requests/:id/verify', sanitizeBody, adminController.updateVerificationStatus);
router.get('/verification-logs', adminController.getVerificationLogs);
router.get('/verification-logs/:id', adminController.getVerificationLogs);

// Abuse & fraud reports moderation
router.get('/reports', adminController.getAllReports);
router.get('/requests/:id/reports', adminController.getReportsForRequest);
router.patch('/requests/:id/restore', sanitizeBody, adminController.restoreHiddenRequest);
router.patch('/requests/:id/uphold-reports', sanitizeBody, adminController.upholdReports);

// Phone blocklist management
router.get('/blocklist', adminController.getBlocklist);
router.post('/blocklist', sanitizeBody, adminController.addToBlocklist);
router.patch('/blocklist/:phone/unblock', adminController.unblockPhone);

module.exports = router;
