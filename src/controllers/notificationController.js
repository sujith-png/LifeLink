const NotificationService = require('../services/notificationService');

exports.getMyNotifications = (req, res) => {
  try {
    const userId = req.user.id;
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 30;

    const notifications = NotificationService.getUserNotifications(userId, limit);
    const unreadCount = NotificationService.getUnreadCount(userId);

    return res.json({
      success: true,
      unreadCount,
      notifications
    });
  } catch (err) {
    console.error('[NotificationController.getMyNotifications] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch notifications.' });
  }
};

exports.markAsRead = (req, res) => {
  try {
    const userId = req.user.id;
    const notificationId = parseInt(req.params.id, 10);

    NotificationService.markAsRead(notificationId, userId);

    return res.json({
      success: true,
      message: 'Notification marked as read.'
    });
  } catch (err) {
    console.error('[NotificationController.markAsRead] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update notification.' });
  }
};

exports.markAllAsRead = (req, res) => {
  try {
    const userId = req.user.id;

    NotificationService.markAllAsRead(userId);

    return res.json({
      success: true,
      message: 'All notifications marked as read.'
    });
  } catch (err) {
    console.error('[NotificationController.markAllAsRead] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update notifications.' });
  }
};
