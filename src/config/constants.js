const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

// RBC compatibility: recipient -> allowed donor blood groups
const BLOOD_COMPATIBILITY = {
  'O-': ['O-'],
  'O+': ['O+', 'O-'],
  'A-': ['A-', 'O-'],
  'A+': ['A+', 'A-', 'O+', 'O-'],
  'B-': ['B-', 'O-'],
  'B+': ['B+', 'B-', 'O+', 'O-'],
  'AB-': ['AB-', 'A-', 'B-', 'O-'],
  'AB+': ['AB+', 'AB-', 'A+', 'A-', 'B+', 'B-', 'O+', 'O-']
};

const URGENCY_LEVELS = ['Critical', 'Urgent', 'Normal'];

const USER_ROLES = ['donor', 'requester', 'admin'];

const REQUEST_STATUSES = ['Open', 'Fulfilled', 'Expired'];

const ELIGIBILITY_INTERVAL_DAYS = 90;

const DEFAULT_MATCH_RADIUS_KM = 25;

module.exports = {
  BLOOD_GROUPS,
  BLOOD_COMPATIBILITY,
  URGENCY_LEVELS,
  USER_ROLES,
  REQUEST_STATUSES,
  ELIGIBILITY_INTERVAL_DAYS,
  DEFAULT_MATCH_RADIUS_KM
};
