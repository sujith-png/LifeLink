const db = require('../config/database');

/**
 * Blood Bank & Hospital Directory Controller
 */
exports.getBloodBanks = (req, res) => {
  try {
    const { city, q } = req.query;
    let query = `
      SELECT 
        id, name, city, address, phone, official_hospital_phone,
        latitude, longitude, operating_hours, is_verified, created_at
      FROM blood_banks
      WHERE 1=1
    `;
    const params = [];

    if (city && city.trim()) {
      query += ` AND LOWER(city) = LOWER(?) `;
      params.push(city.trim());
    }

    if (q && q.trim()) {
      query += ` AND (
        LOWER(name) LIKE '%' || LOWER(?) || '%' OR
        LOWER(city) LIKE '%' || LOWER(?) || '%' OR
        LOWER(address) LIKE '%' || LOWER(?) || '%'
      ) `;
      const term = q.trim();
      params.push(term, term, term);
    }

    query += ` ORDER BY city ASC, name ASC `;

    const bloodBanks = db.prepare(query).all(...params);

    // Also get list of distinct cities for quick filtering dropdowns
    const cities = db.prepare(`SELECT DISTINCT city FROM blood_banks ORDER BY city ASC`).all().map(c => c.city);

    return res.json({
      success: true,
      count: bloodBanks.length,
      cities,
      bloodBanks
    });
  } catch (error) {
    console.error('[BloodBankController.getBloodBanks] Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve blood bank directory.' });
  }
};
