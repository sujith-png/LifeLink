/**
 * Indian Mobile Phone Validator & Normalizer
 * Validates 10-digit Indian mobile numbers starting with 6, 7, 8, or 9.
 * Accepts optional +91, 91, or 0 prefixes and strips non-numeric characters.
 */

function validateAndNormalizeIndianPhone(inputPhone) {
  if (!inputPhone || typeof inputPhone !== 'string') {
    return {
      valid: false,
      message: 'Mobile phone number is required.'
    };
  }

  // Remove spaces, hyphens, dots, parentheses
  let cleaned = inputPhone.replace(/[\s\-.()]/g, '').trim();

  // Strip international +91 or 91 or trunk 0 prefixes
  if (cleaned.startsWith('+91')) {
    cleaned = cleaned.substring(3);
  } else if (cleaned.startsWith('91') && cleaned.length === 12) {
    cleaned = cleaned.substring(2);
  } else if (cleaned.startsWith('0') && cleaned.length === 11) {
    cleaned = cleaned.substring(1);
  }

  // An Indian mobile number must be exactly 10 digits and start with 6, 7, 8, or 9
  if (!/^[6-9]\d{9}$/.test(cleaned)) {
    return {
      valid: false,
      message: 'Please enter a valid 10-digit Indian mobile number (e.g., 9876543210).'
    };
  }

  return {
    valid: true,
    phone10: cleaned,
    phoneE164: `+91${cleaned}`
  };
}

module.exports = {
  validateAndNormalizeIndianPhone
};
