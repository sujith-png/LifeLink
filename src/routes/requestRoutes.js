const express = require('express');
const router = express.Router();
const requestController = require('../controllers/requestController');
const responseController = require('../controllers/responseController');
const { optionalAuth, authenticate, authorize } = require('../middleware/auth');
const { phoneRateLimiter } = require('../middleware/rateLimiter');
const { handleRequisitionSlipUpload } = require('../middleware/upload');
const { sanitizeBody } = require('../middleware/validate');

// POST /api/requests - Create an emergency request with mandatory file upload and OTP
router.post(
  '/',
  optionalAuth,
  handleRequisitionSlipUpload,
  phoneRateLimiter,
  requestController.createRequest
);

// GET /api/requests - Public emergency board listing
router.get('/', optionalAuth, requestController.getPublicRequests);

// GET /api/requests/:id - Retrieve public/authorized request details
router.get('/:id', optionalAuth, requestController.getRequestById);

// GET /api/requests/:id/matched-donors - View list of matched donors (authenticated)
router.get('/:id/matched-donors', authenticate, requestController.getMatchedDonors);

// GET /api/requests/:id/progress - Real-time emergency progress breakdown
router.get('/:id/progress', optionalAuth, responseController.getProgress);

// POST /api/requests/:id/respond - Donor responds (Accepted / Declined)
router.post(
  '/:id/respond',
  authenticate,
  authorize(['donor']),
  sanitizeBody,
  responseController.respondToRequest
);

// PATCH /api/requests/:id/response-status - Donor updates commitment status
router.patch(
  '/:id/response-status',
  authenticate,
  authorize(['donor']),
  sanitizeBody,
  responseController.updateResponseStatus
);

// GET /api/requests/:id/my-response - Donor retrieves their response and contact phone if accepted
router.get('/:id/my-response', authenticate, responseController.getMyResponse);

// GET /api/requests/:id/accepted-donors - Requester views list of committed donors
router.get('/:id/accepted-donors', authenticate, responseController.getAcceptedDonors);

// PATCH /api/requests/:id/fulfill - Requester or admin marks request as fulfilled
router.patch('/:id/fulfill', authenticate, sanitizeBody, responseController.fulfillRequest);

// PATCH /api/requests/:id/cancel - Requester or admin cancels request
router.patch('/:id/cancel', authenticate, sanitizeBody, responseController.cancelRequest);

// POST /api/requests/:id/report - Report suspicious or abusive emergency request
router.post('/:id/report', sanitizeBody, requestController.reportRequest);

// POST /api/requests/:id/feedback - Donor submits post-donation authenticity feedback
router.post(
  '/:id/feedback',
  authenticate,
  authorize(['donor']),
  sanitizeBody,
  requestController.submitFeedback
);

// GET /api/requests/:id/trust-score - Requester trust score and verification breakdown
router.get('/:id/trust-score', optionalAuth, requestController.getTrustScore);

module.exports = router;
