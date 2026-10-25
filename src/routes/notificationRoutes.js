const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { authenticate } = require('../middleware/auth');

// All notification endpoints require authentication
router.use(authenticate);

// GET /api/notifications
router.get('/', notificationController.getMyNotifications);

// PATCH /api/notifications/mark-all-read
router.patch('/mark-all-read', notificationController.markAllAsRead);

// PATCH /api/notifications/:id/read
router.patch('/:id/read', notificationController.markAsRead);

module.exports = router;
