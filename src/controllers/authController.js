const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const { JWT_SECRET } = require('../middleware/auth');
const { checkDonorEligibility } = require('../services/eligibilityService');
const { validateAndNormalizeIndianPhone } = require('../utils/phoneValidator');

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

exports.register = async (req, res) => {
  try {
    const {
      email,
      password,
      role = 'donor',
      name,
      phone,
      blood_group,
      city,
      area_pincode,
      latitude,
      longitude,
      last_donation_date,
      is_available = 1
    } = req.body;

    const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existingUser) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
    }

    let cleanPhone = null;
    if (role === 'donor') {
      if (!name || name.trim().length < 2) {
        return res.status(400).json({ success: false, message: 'Please provide your full name.' });
      }

      const phoneVal = validateAndNormalizeIndianPhone(phone);
      if (!phoneVal.valid) {
        return res.status(400).json({ success: false, message: phoneVal.message });
      }
      cleanPhone = phoneVal.phone10;

      // Check active blocklist
      const blocked = db.prepare('SELECT id, reason FROM blocklist WHERE phone = ? AND is_active = 1').get(cleanPhone);
      if (blocked) {
        return res.status(403).json({
          success: false,
          message: `This phone number has been blocked by administrators. Reason: ${blocked.reason || 'Violation of terms'}`
        });
      }

      const existingDonor = db.prepare('SELECT id FROM donors WHERE phone = ?').get(cleanPhone);
      if (existingDonor) {
        return res.status(409).json({
          success: false,
          message: 'A donor with this mobile number is already registered.'
        });
      }
    }

    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(password, salt);

    let newUser;
    let newDonor = null;

    // Use transaction for atomic user + donor creation
    const createUserTx = db.transaction(() => {
      const userInsert = db.prepare(`
        INSERT INTO users (email, password_hash, role)
        VALUES (?, ?, ?)
      `).run(email.toLowerCase(), passwordHash, role);

      const userId = Number(userInsert.lastInsertRowid);
      newUser = { id: userId, email: email.toLowerCase(), role };

      if (role === 'donor') {
        const donorInsert = db.prepare(`
          INSERT INTO donors (
            user_id, name, phone, blood_group, city, area_pincode,
            latitude, longitude, last_donation_date, is_available
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          userId,
          name,
          cleanPhone,
          blood_group.toUpperCase(),
          city,
          area_pincode,
          latitude ? parseFloat(latitude) : null,
          longitude ? parseFloat(longitude) : null,
          last_donation_date || null,
          is_available ? 1 : 0
        );

        newDonor = db.prepare('SELECT * FROM donors WHERE id = ?').get(Number(donorInsert.lastInsertRowid));
      }
    });

    createUserTx();

    const token = generateToken(newUser);
    const eligibility = newDonor ? checkDonorEligibility(newDonor) : null;

    return res.status(201).json({
      success: true,
      message: 'Account registered successfully.',
      token,
      user: newUser,
      donor: newDonor ? { ...newDonor, eligibility } : null
    });
  } catch (error) {
    console.error('[AuthController.register] Error:', error);
    return res.status(500).json({ success: false, message: 'Registration failed. Please try again later.' });
  }
};

exports.login = (req, res) => {
  try {
    const identifier = (req.body.identifier || req.body.email || req.body.phone || '').trim();
    const { password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({ success: false, message: 'Email or phone number and password are required.' });
    }

    let user = null;

    // Check if identifier contains '@' -> treat as email
    if (identifier.includes('@')) {
      user = db.prepare('SELECT * FROM users WHERE email = ?').get(identifier.toLowerCase());
    } else {
      // Treat as phone number or fallback
      const phoneVal = validateAndNormalizeIndianPhone(identifier);
      if (phoneVal.valid) {
        const donor = db.prepare('SELECT user_id FROM donors WHERE phone = ?').get(phoneVal.phone10);
        if (donor && donor.user_id) {
          user = db.prepare('SELECT * FROM users WHERE id = ?').get(donor.user_id);
        }
      }
      // If not found via donor phone, try email lookup as fallback
      if (!user) {
        user = db.prepare('SELECT * FROM users WHERE email = ?').get(identifier.toLowerCase());
      }
    }

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email, phone number, or password.' });
    }

    const isValid = bcrypt.compareSync(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ success: false, message: 'Invalid email, phone number, or password.' });
    }

    const safeUser = { id: user.id, email: user.email, role: user.role };
    const token = generateToken(safeUser);

    let donor = null;
    if (user.role === 'donor') {
      donor = db.prepare('SELECT * FROM donors WHERE user_id = ?').get(user.id);
      if (donor) {
        donor.eligibility = checkDonorEligibility(donor);
      }
    }

    return res.json({
      success: true,
      message: 'Logged in successfully.',
      token,
      user: safeUser,
      donor
    });
  } catch (error) {
    console.error('[AuthController.login] Error:', error);
    return res.status(500).json({ success: false, message: 'Login failed. Please try again later.' });
  }
};

exports.getMe = (req, res) => {
  try {
    const user = req.user;
    let donor = null;

    if (user.role === 'donor') {
      donor = db.prepare('SELECT * FROM donors WHERE user_id = ?').get(user.id);
      if (donor) {
        donor.eligibility = checkDonorEligibility(donor);
      }
    }

    return res.json({
      success: true,
      user,
      donor
    });
  } catch (error) {
    console.error('[AuthController.getMe] Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve profile.' });
  }
};
