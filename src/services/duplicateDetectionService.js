const db = require('../config/database');

/**
 * Duplicate Emergency Detection Engine
 * Scans for active open requests that may represent the same medical emergency.
 */
class DuplicateDetectionService {
  /**
   * Check for potential duplicate requests
   * Compares phone number, hospital name, blood group, patient name, and needed_by window.
   */
  static detectPotentialDuplicate({ contact_phone, hospital_name, blood_group, patient_name, city }) {
    const cleanPhone = (contact_phone || '').replace(/[\s-]/g, '');
    const cleanHospital = (hospital_name || '').trim().toLowerCase();
    const cleanPatient = (patient_name || '').trim().toLowerCase();
    const cleanCity = (city || '').trim().toLowerCase();
    const blood = (blood_group || '').toUpperCase();

    // 1. Exact active phone match (Already enforced, but returned here for duplicate clarity)
    const phoneMatch = db.prepare(`
      SELECT id, patient_name, blood_group, hospital_name, city, created_at, status
      FROM requests
      WHERE contact_phone = ? AND status = 'Open'
    `).get(cleanPhone);

    if (phoneMatch) {
      return {
        isDuplicate: true,
        reason: 'same_phone',
        confidence: 'high',
        message: `An active open request (#${phoneMatch.id}) with the same contact phone number is already registered.`,
        existingRequest: phoneMatch
      };
    }

    // 2. Similar hospital, blood group, and patient name in same city within recent open requests
    const candidates = db.prepare(`
      SELECT id, patient_name, blood_group, hospital_name, city, created_at, status
      FROM requests
      WHERE status = 'Open'
        AND blood_group = ?
        AND LOWER(city) = ?
    `).all(blood, cleanCity);

    let hospitalNotice = null;

    for (const req of candidates) {
      const candidateHospital = req.hospital_name.toLowerCase();
      const candidatePatient = req.patient_name.toLowerCase();

      // Check if hospital names overlap significantly
      const sameHospital = candidateHospital.includes(cleanHospital) || cleanHospital.includes(candidateHospital);
      // Check if patient names match
      const samePatient = candidatePatient === cleanPatient;

      if (sameHospital && samePatient) {
        return {
          isDuplicate: true,
          reason: 'same_patient_and_hospital',
          confidence: 'high',
          message: `A potentially identical emergency request (#${req.id} for "${req.patient_name}" at "${req.hospital_name}") is currently active.`,
          existingRequest: req
        };
      }

      if (sameHospital && !samePatient && !hospitalNotice) {
        hospitalNotice = {
          isDuplicate: false,
          noticeOnly: true,
          reason: 'same_hospital_and_blood_group',
          confidence: 'medium',
          message: `Notice: Another emergency request (#${req.id}) for ${req.blood_group} blood at "${req.hospital_name}" is currently open.`,
          existingRequest: req
        };
      }
    }

    if (hospitalNotice) {
      return hospitalNotice;
    }

    return {
      isDuplicate: false,
      reason: null,
      confidence: 'none',
      existingRequest: null
    };
  }
}

module.exports = DuplicateDetectionService;
