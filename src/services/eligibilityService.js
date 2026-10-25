const { ELIGIBILITY_INTERVAL_DAYS } = require('../config/constants');

/**
 * Calculates whether a donor is medically and operationally eligible to donate blood.
 * Rule: Last donation must be >= 90 days ago AND availability toggle must be ON.
 */
function checkDonorEligibility(donor) {
  if (!donor) {
    return {
      isEligible: false,
      reason: 'Donor profile not found.',
      isAvailable: false,
      daysSinceLastDonation: null,
      daysRemaining: null,
      nextEligibleDate: null
    };
  }

  const isAvailable = Boolean(donor.is_available);
  const lastDonationDateStr = donor.last_donation_date;

  if (!lastDonationDateStr) {
    // Never donated or no recorded date
    return {
      isEligible: isAvailable,
      reason: isAvailable
        ? 'Eligible to donate (No recent donation recorded)'
        : 'Currently unavailable (Availability toggle is OFF)',
      isAvailable,
      daysSinceLastDonation: null,
      daysRemaining: 0,
      nextEligibleDate: null
    };
  }

  const today = new Date();
  const lastDonation = new Date(lastDonationDateStr);
  const diffTime = today.getTime() - lastDonation.getTime();
  const daysSince = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  const nextEligible = new Date(lastDonation);
  nextEligible.setDate(nextEligible.getDate() + ELIGIBILITY_INTERVAL_DAYS);
  const nextEligibleDateStr = nextEligible.toISOString().split('T')[0];

  const intervalMet = daysSince >= ELIGIBILITY_INTERVAL_DAYS;
  const daysRemaining = intervalMet ? 0 : ELIGIBILITY_INTERVAL_DAYS - daysSince;

  let reason = '';
  if (intervalMet && isAvailable) {
    reason = 'Eligible to donate.';
  } else if (!isAvailable && !intervalMet) {
    reason = `Availability is turned OFF and ${daysRemaining} days remaining before next eligible donation.`;
  } else if (!isAvailable) {
    reason = 'Availability is turned OFF.';
  } else {
    reason = `Recovery interval required: ${daysRemaining} day(s) remaining until eligible (${nextEligibleDateStr}).`;
  }

  return {
    isEligible: intervalMet && isAvailable,
    intervalMet,
    isAvailable,
    daysSinceLastDonation: daysSince,
    daysRemaining,
    nextEligibleDate: nextEligibleDateStr,
    reason
  };
}

module.exports = {
  checkDonorEligibility
};
