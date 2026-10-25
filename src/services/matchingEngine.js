const db = require('../config/database');
const { BLOOD_COMPATIBILITY, ELIGIBILITY_INTERVAL_DAYS, DEFAULT_MATCH_RADIUS_KM } = require('../config/constants');
const { checkDonorEligibility } = require('./eligibilityService');

/**
 * Calculates Great-Circle distance in Kilometers between two coordinates using Haversine formula
 */
function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) {
    return null;
  }

  const R = 6371; // Earth's mean radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10; // Round to 1 decimal place (e.g. 4.2 km)
}

/**
 * Matching Engine:
 * Identifies medically eligible donors compatible with patient blood group within city / proximity
 */
function findMatchingDonors(request, maxRadiusKm = DEFAULT_MATCH_RADIUS_KM) {
  const patientBlood = (request.blood_group || '').toUpperCase();
  const compatibleDonorsList = BLOOD_COMPATIBILITY[patientBlood];

  if (!compatibleDonorsList || compatibleDonorsList.length === 0) {
    console.warn(`[MatchingEngine] Unknown recipient blood group: ${patientBlood}`);
    return [];
  }

  // Build parameterized placeholders for compatible blood groups
  const bloodPlaceholders = compatibleDonorsList.map(() => '?').join(',');

  // Query donors with compatible blood group who have availability ON
  const sql = `
    SELECT d.*, u.email as user_email
    FROM donors d
    JOIN users u ON d.user_id = u.id
    WHERE d.is_available = 1
      AND d.blood_group IN (${bloodPlaceholders})
  `;

  const candidates = db.prepare(sql).all(...compatibleDonorsList);

  const reqLat = request.latitude != null ? parseFloat(request.latitude) : null;
  const reqLng = request.longitude != null ? parseFloat(request.longitude) : null;
  const reqCity = (request.city || '').trim().toLowerCase();

  const matched = [];

  for (const donor of candidates) {
    // 1. Strict Medical Eligibility verification (90-day interval)
    const eligibility = checkDonorEligibility(donor);
    if (!eligibility.isEligible) {
      continue;
    }

    const donorLat = donor.latitude != null ? parseFloat(donor.latitude) : null;
    const donorLng = donor.longitude != null ? parseFloat(donor.longitude) : null;
    const donorCity = (donor.city || '').trim().toLowerCase();

    let distanceKm = null;
    let isLocationMatch = false;

    // 2. Proximity calculation
    if (reqLat != null && reqLng != null && donorLat != null && donorLng != null) {
      distanceKm = calculateHaversineDistance(reqLat, reqLng, donorLat, donorLng);
      if (distanceKm <= maxRadiusKm) {
        isLocationMatch = true;
      }
    }

    // Fallback: match by identical city
    if (reqCity && donorCity === reqCity) {
      isLocationMatch = true;
    }

    if (isLocationMatch) {
      matched.push({
        id: donor.id,
        user_id: donor.user_id,
        name: donor.name,
        blood_group: donor.blood_group,
        city: donor.city,
        area_pincode: donor.area_pincode,
        distanceKm,
        isExactCity: donorCity === reqCity,
        last_donation_date: donor.last_donation_date,
        // Notice: donor.phone is excluded here for privacy!
      });
    }
  }

  // 3. Sort by distance ascending (closest first), followed by exact city match
  matched.sort((a, b) => {
    if (a.distanceKm != null && b.distanceKm != null) {
      return a.distanceKm - b.distanceKm;
    }
    if (a.distanceKm != null) return -1;
    if (b.distanceKm != null) return 1;
    return 0;
  });

  return matched;
}

module.exports = {
  findMatchingDonors,
  calculateHaversineDistance
};
