const db = require('../config/database');

const SAMPLE_BLOOD_BANKS = [
  {
    name: 'KEM Hospital Blood Bank',
    city: 'Mumbai',
    address: 'Acharya Donde Marg, Parel, Mumbai - 400012',
    phone: '022-24107000',
    official_hospital_phone: '022-24107000',
    latitude: 19.0028,
    longitude: 72.8427,
    operating_hours: '24/7'
  },
  {
    name: 'Tata Memorial Hospital Blood Bank',
    city: 'Mumbai',
    address: 'Dr. E Borges Road, Parel, Mumbai - 400012',
    phone: '022-24177000',
    official_hospital_phone: '022-24177000',
    latitude: 19.0044,
    longitude: 72.8432,
    operating_hours: '24/7'
  },
  {
    name: 'Lilavati Hospital & Research Centre',
    city: 'Mumbai',
    address: 'A-791, Bandra Reclamation, Bandra West, Mumbai - 400050',
    phone: '022-26751000',
    official_hospital_phone: '022-26751000',
    latitude: 19.0514,
    longitude: 72.8295,
    operating_hours: '24/7'
  },
  {
    name: 'AIIMS Blood Bank & Transfusion Center',
    city: 'Delhi',
    address: 'Sri Aurobindo Marg, Ansari Nagar, New Delhi - 110029',
    phone: '011-26588500',
    official_hospital_phone: '011-26588500',
    latitude: 28.5672,
    longitude: 77.2100,
    operating_hours: '24/7'
  },
  {
    name: 'Safdarjung Hospital Regional Blood Bank',
    city: 'Delhi',
    address: 'Ring Road, Opposite AIIMS, New Delhi - 110029',
    phone: '011-26165060',
    official_hospital_phone: '011-26165060',
    latitude: 28.5694,
    longitude: 77.2078,
    operating_hours: '24/7'
  },
  {
    name: 'Victoria Hospital Blood Bank (BMCRI)',
    city: 'Bengaluru',
    address: 'Fort Road, Near City Market, Bengaluru - 560002',
    phone: '080-26701150',
    official_hospital_phone: '080-26701150',
    latitude: 12.9642,
    longitude: 77.5756,
    operating_hours: '24/7'
  },
  {
    name: 'Manipal Hospital Transfusion Medicine',
    city: 'Bengaluru',
    address: '98, HAL Old Airport Road, Kodihalli, Bengaluru - 560017',
    phone: '080-25024444',
    official_hospital_phone: '080-25024444',
    latitude: 12.9592,
    longitude: 77.6499,
    operating_hours: '24/7'
  },
  {
    name: 'Sassoon General Hospital Blood Center',
    city: 'Pune',
    address: 'Near Pune Railway Station, Station Road, Pune - 411001',
    phone: '020-26128000',
    official_hospital_phone: '020-26128000',
    latitude: 18.5284,
    longitude: 73.8739,
    operating_hours: '24/7'
  },
  {
    name: 'Ruby Hall Clinic Rotary Blood Bank',
    city: 'Pune',
    address: '40, Sassoon Road, Sangamvadi, Pune - 411001',
    phone: '020-66455100',
    official_hospital_phone: '020-66455100',
    latitude: 18.5326,
    longitude: 73.8778,
    operating_hours: '24/7'
  },
  {
    name: 'Rajiv Gandhi Government General Hospital Blood Bank',
    city: 'Chennai',
    address: 'EVR Periyar Salai, Park Town, Chennai - 600003',
    phone: '044-25305000',
    official_hospital_phone: '044-25305000',
    latitude: 13.0810,
    longitude: 80.2785,
    operating_hours: '24/7'
  }
];

function seedBloodBanks() {
  const existingCount = db.prepare('SELECT COUNT(*) as count FROM blood_banks').get().count;
  if (existingCount >= SAMPLE_BLOOD_BANKS.length) {
    return;
  }

  const insert = db.prepare(`
    INSERT INTO blood_banks (
      name, city, address, phone, official_hospital_phone, latitude, longitude, operating_hours, is_verified
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);

  const tx = db.transaction(() => {
    for (const b of SAMPLE_BLOOD_BANKS) {
      const exists = db.prepare('SELECT id FROM blood_banks WHERE name = ? AND city = ?').get(b.name, b.city);
      if (!exists) {
        insert.run(b.name, b.city, b.address, b.phone, b.official_hospital_phone, b.latitude, b.longitude, b.operating_hours);
      }
    }
  });

  tx();
  console.log(`[Seed] Seeded ${SAMPLE_BLOOD_BANKS.length} verified hospitals & blood banks with official telephone contacts.`);
}

if (require.main === module) {
  seedBloodBanks();
}

module.exports = { seedBloodBanks, SAMPLE_BLOOD_BANKS };
