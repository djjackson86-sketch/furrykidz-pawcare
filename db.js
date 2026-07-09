// db.js — lightweight JSON file storage. Swap for Postgres/MySQL once you outgrow it (you have 1700 clients, so plan to migrate before going live).
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const FILES = {
  customers: path.join(DATA_DIR, 'customers.json'),
  pets: path.join(DATA_DIR, 'pets.json'),
  bookings: path.join(DATA_DIR, 'bookings.json'),
  services: path.join(DATA_DIR, 'services.json'),
  locations: path.join(DATA_DIR, 'locations.json'),
  xeroTokens: path.join(DATA_DIR, 'xero_tokens.json'),
};

function load(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function save(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

// Seeded from the Furry Kidz price list, effective 1 March 2026.
if (!fs.existsSync(FILES.services)) {
  save(FILES.services, [
    // Daycare
    { id: 'dc-extra', category: 'Daycare Services', name: 'Extra daycare day (recurring package clients)', price: 200.00 },
    { id: 'dc-adhoc', category: 'Daycare Services', name: 'Adhoc per day (not on recurring package)', price: 227.00 },
    { id: 'dc-assess', category: 'Daycare Services', name: 'Assessment day', price: 214.00 },
    { id: 'dc-social', category: 'Daycare Services', name: 'Socialisation evaluation', price: 257.00 },
    // Barkery
    { id: 'bk-daycare', category: 'Barkery Services', name: 'Hosting Birthday during daycare', price: 188.00 },
    { id: 'bk-parent', category: 'Barkery Services', name: 'Hosting Birthday with Parent (per hr or part)', price: 296.00 },
    // Pet Taxi
    { id: 'taxi-8km', category: 'Pet Taxi', name: 'To and from Furry Kidz — first 8km', price: 85.00 },
    { id: 'taxi-12km', category: 'Pet Taxi', name: 'Pet Taxi 8–12km', price: 104.00 },
    { id: 'taxi-25km', category: 'Pet Taxi', name: 'Pet Taxi 12–25km', price: 178.00 },
    { id: 'taxi-vet', category: 'Pet Taxi', name: 'Vet visits and supervision (per 30min)', price: 130.00 },
    { id: 'taxi-food', category: 'Pet Taxi', name: 'Food Collection & drop off (per 30min)', price: 130.00 },
    // Luxury Accommodation
    { id: 'la-night', category: 'Luxury Accommodation', name: 'Per night / dog', price: 327.00 },
    { id: 'la-after9', category: 'Luxury Accommodation', name: 'Day of collection if collected after 9am', price: 200.00 },
    { id: 'la-before9', category: 'Luxury Accommodation', name: 'Collected before 9am', price: 0 },
    // Parasite Control
    { id: 'pc-brav-1', category: 'Parasite Control', name: 'Bravecto 2 – 4.5kg', price: 357.00 },
    { id: 'pc-brav-2', category: 'Parasite Control', name: 'Bravecto 4.5 – 10kg', price: 357.00 },
    { id: 'pc-brav-3', category: 'Parasite Control', name: 'Bravecto 10 – 20kg', price: 410.00 },
    { id: 'pc-brav-4', category: 'Parasite Control', name: 'Bravecto 20 – 40kg', price: 504.00 },
    { id: 'pc-brav-5', category: 'Parasite Control', name: 'Bravecto 40 – 56kg', price: 645.00 },
    { id: 'pc-dew-puppy', category: 'Parasite Control', name: 'Puppy deworming 5kg', price: 45.00 },
    { id: 'pc-dew-small', category: 'Parasite Control', name: 'Small dog deworming 12.5kg', price: 60.00 },
    { id: 'pc-dew-med', category: 'Parasite Control', name: 'Medium dog deworming 25kg', price: 90.00 },
    { id: 'pc-dew-large', category: 'Parasite Control', name: 'Large dog deworming 37.5kg', price: 140.00 },
    // Grooming Spa
    { id: 'gr-anal', category: 'Grooming Spa', name: 'Express Anal Glands', price: 135.00 },
    { id: 'gr-pedicure', category: 'Grooming Spa', name: 'Pedicure', price: 96.00 },
    { id: 'gr-hygiene', category: 'Grooming Spa', name: 'Hygiene cut / Under paw shave', price: 71.00 },
    { id: 'gr-bb-puppy', category: 'Grooming Spa', name: 'Puppy/Small bath & brush <8kg', price: 265.00 },
    { id: 'gr-bb-med', category: 'Grooming Spa', name: 'Medium bath & brush 8.1–15kg', price: 326.00 },
    { id: 'gr-bb-large', category: 'Grooming Spa', name: 'Large bath & brush 15.1–25kg', price: 380.00 },
    { id: 'gr-bb-xl', category: 'Grooming Spa', name: 'XL bath & brush 25.1–35kg', price: 440.00 },
    { id: 'gr-cut-puppy', category: 'Grooming Spa', name: 'Puppy/Small cut <8kg', price: 325.00 },
    { id: 'gr-cut-med', category: 'Grooming Spa', name: 'Medium cut 8.1–15kg', price: 390.00 },
    { id: 'gr-cut-large', category: 'Grooming Spa', name: 'Large cut 15.1–25kg', price: 440.00 },
    { id: 'gr-cut-xl', category: 'Grooming Spa', name: 'XL cut 25.1–35kg', price: 525.00 },
  ]);
}
if (!fs.existsSync(FILES.locations)) save(FILES.locations, [
  { id: 'kyalami', name: 'Kyalami', boardingCapacity: 15 },
  { id: 'noordwyk', name: 'Noordwyk', boardingCapacity: 15 },
]);
if (!fs.existsSync(FILES.customers)) save(FILES.customers, []);
if (!fs.existsSync(FILES.pets)) save(FILES.pets, []);
if (!fs.existsSync(FILES.bookings)) save(FILES.bookings, []);
if (!fs.existsSync(FILES.xeroTokens)) save(FILES.xeroTokens, null);

module.exports = {
  getCustomers: () => load(FILES.customers, []),
  saveCustomers: (d) => save(FILES.customers, d),
  getPets: () => load(FILES.pets, []),
  savePets: (d) => save(FILES.pets, d),
  getBookings: () => load(FILES.bookings, []),
  saveBookings: (d) => save(FILES.bookings, d),
  getServices: () => load(FILES.services, []),
  saveServices: (d) => save(FILES.services, d),
  getLocations: () => load(FILES.locations, []),
  getXeroTokens: () => load(FILES.xeroTokens, null),
  saveXeroTokens: (d) => save(FILES.xeroTokens, d),
};
