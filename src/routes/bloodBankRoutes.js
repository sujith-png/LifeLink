const express = require('express');
const router = express.Router();
const bloodBankController = require('../controllers/bloodBankController');

// GET /api/blood-banks - Search and list verified blood banks & hospitals
router.get('/', bloodBankController.getBloodBanks);

module.exports = router;
