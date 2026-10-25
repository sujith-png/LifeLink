const db = require('../config/database');
const { checkDonorEligibility } = require('../services/eligibilityService');
const { BLOOD_GROUPS } = require('../config/constants');

exports.getProfile = (req, res) => {
  try {
    const userId = req.user.id;
    const donor = db.prepare('SELECT * FROM donors WHERE user_id = ?').get(userId);

    if (!donor) {
      return res.status(404).json({ success: false, message: 'Donor profile not found.' });
    }

    const eligibility = checkDonorEligibility(donor);

    return res.json({
      success: true,
      donor: {
        ...donor,
        eligibility
      }
    });
  } catch (error) {
    console.error('[DonorController.getProfile] Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch donor profile.' });
  }
};

exports.updateProfile = (req, res) => {
  try {
    const userId = req.user.id;
    const {
      name,
      phone,
      blood_group,
      city,
      area_pincode,
      latitude,
      longitude,
      last_donation_date
    } = req.body;

    const donor = db.prepare('SELECT id FROM donors WHERE user_id = ?').get(userId);
    if (!donor) {
      return res.status(404).json({ success: false, message: 'Donor profile not found.' });
    }

    if (blood_group && !BLOOD_GROUPS.includes(blood_group.toUpperCase())) {
      return res.status(400).json({ success: false, message: 'Invalid blood group.' });
    }

    db.prepare(`
      UPDATE donors
      SET name = COALESCE(?, name),
          phone = COALESCE(?, phone),
          blood_group = COALESCE(?, blood_group),
          city = COALESCE(?, city),
          area_pincode = COALESCE(?, area_pincode),
          latitude = COALESCE(?, latitude),
          longitude = COALESCE(?, longitude),
          last_donation_date = COALESCE(?, last_donation_date),
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `).run(
      name || null,
      phone || null,
      blood_group ? blood_group.toUpperCase() : null,
      city || null,
      area_pincode || null,
      latitude !== undefined && latitude !== '' ? parseFloat(latitude) : null,
      longitude !== undefined && longitude !== '' ? parseFloat(longitude) : null,
      last_donation_date !== undefined ? (last_donation_date || null) : null,
      userId
    );

    const updated = db.prepare('SELECT * FROM donors WHERE user_id = ?').get(userId);
    const eligibility = checkDonorEligibility(updated);

    return res.json({
      success: true,
      message: 'Profile updated successfully.',
      donor: { ...updated, eligibility }
    });
  } catch (error) {
    console.error('[DonorController.updateProfile] Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update profile.' });
  }
};

exports.toggleAvailability = (req, res) => {
  try {
    const userId = req.user.id;
    const { is_available } = req.body;

    const donor = db.prepare('SELECT * FROM donors WHERE user_id = ?').get(userId);
    if (!donor) {
      return res.status(404).json({ success: false, message: 'Donor profile not found.' });
    }

    // If is_available is explicitly sent, use it; otherwise toggle current value
    const newStatus = (is_available !== undefined)
      ? (is_available ? 1 : 0)
      : (donor.is_available ? 0 : 1);

    db.prepare(`
      UPDATE donors
      SET is_available = ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `).run(newStatus, userId);

    const updated = db.prepare('SELECT * FROM donors WHERE user_id = ?').get(userId);
    const eligibility = checkDonorEligibility(updated);

    return res.json({
      success: true,
      message: `Availability turned ${newStatus === 1 ? 'ON' : 'OFF'}.`,
      donor: { ...updated, eligibility }
    });
  } catch (error) {
    console.error('[DonorController.toggleAvailability] Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update availability.' });
  }
};

exports.recordDonation = (req, res) => {
  try {
    const userId = req.user.id;
    const donationDate = req.body.date || new Date().toISOString().split('T')[0];

    const donor = db.prepare('SELECT * FROM donors WHERE user_id = ?').get(userId);
    if (!donor) {
      return res.status(404).json({ success: false, message: 'Donor profile not found.' });
    }

    db.prepare(`
      UPDATE donors
      SET last_donation_date = ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `).run(donationDate, userId);

    const updated = db.prepare('SELECT * FROM donors WHERE user_id = ?').get(userId);
    const eligibility = checkDonorEligibility(updated);

    return res.json({
      success: true,
      message: 'New donation recorded successfully.',
      donor: { ...updated, eligibility }
    });
  } catch (error) {
    console.error('[DonorController.recordDonation] Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to record donation.' });
  }
};

exports.getPublicSummary = (req, res) => {
  try {
    const stats = db.prepare(`
      SELECT 
        COUNT(*) as total_donors,
        SUM(CASE WHEN is_available = 1 THEN 1 ELSE 0 END) as available_donors
      FROM donors
    `).get();

    const bloodGroupCounts = db.prepare(`
      SELECT blood_group, COUNT(*) as count 
      FROM donors 
      WHERE is_available = 1 
      GROUP BY blood_group
    `).all();

    return res.json({
      success: true,
      stats: {
        totalDonors: stats.total_donors || 0,
        availableDonors: stats.available_donors || 0,
        bloodGroupCounts
      }
    });
  } catch (error) {
    console.error('[DonorController.getPublicSummary] Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch donor summary.' });
  }
};
