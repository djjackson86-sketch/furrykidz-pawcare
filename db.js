// db.js — Turso-backed app state with JSON-file fallback for local/offline dev.
const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const FILES = {
  customers: path.join(DATA_DIR, 'customers.json'),
  pets: path.join(DATA_DIR, 'pets.json'),
  bookings: path.join(DATA_DIR, 'bookings.json'),
  services: path.join(DATA_DIR, 'services.json'),
  locations: path.join(DATA_DIR, 'locations.json'),
  xeroTokens: path.join(DATA_DIR, 'xero_tokens.json'),
};

const DEFAULT_SERVICES = [
  { id: 'dc-extra', category: 'Daycare Services', name: 'Extra daycare day (recurring package clients)', price: 200.00 },
  { id: 'dc-adhoc', category: 'Daycare Services', name: 'Adhoc per day (not on recurring package)', price: 227.00 },
  { id: 'dc-assess', category: 'Daycare Services', name: 'Assessment day', price: 214.00 },
  { id: 'dc-social', category: 'Daycare Services', name: 'Socialisation evaluation', price: 257.00 },
  { id: 'bk-daycare', category: 'Barkery Services', name: 'Hosting Birthday during daycare', price: 188.00 },
  { id: 'bk-parent', category: 'Barkery Services', name: 'Hosting Birthday with Parent (per hr or part)', price: 296.00 },
  { id: 'taxi-8km', category: 'Pet Taxi', name: 'To and from Furry Kidz — first 8km', price: 85.00 },
  { id: 'taxi-12km', category: 'Pet Taxi', name: 'Pet Taxi 8–12km', price: 104.00 },
  { id: 'taxi-25km', category: 'Pet Taxi', name: 'Pet Taxi 12–25km', price: 178.00 },
  { id: 'taxi-vet', category: 'Pet Taxi', name: 'Vet visits and supervision (per 30min)', price: 130.00 },
  { id: 'taxi-food', category: 'Pet Taxi', name: 'Food Collection & drop off (per 30min)', price: 130.00 },
  { id: 'la-night', category: 'Luxury Accommodation', name: 'Per night / dog', price: 327.00 },
  { id: 'la-after9', category: 'Luxury Accommodation', name: 'Day of collection if collected after 9am', price: 200.00 },
  { id: 'la-before9', category: 'Luxury Accommodation', name: 'Collected before 9am', price: 0 },
  { id: 'pc-brav-1', category: 'Parasite Control', name: 'Bravecto 2 – 4.5kg', price: 357.00 },
  { id: 'pc-brav-2', category: 'Parasite Control', name: 'Bravecto 4.5 – 10kg', price: 357.00 },
  { id: 'pc-brav-3', category: 'Parasite Control', name: 'Bravecto 10 – 20kg', price: 410.00 },
  { id: 'pc-brav-4', category: 'Parasite Control', name: 'Bravecto 20 – 40kg', price: 504.00 },
  { id: 'pc-brav-5', category: 'Parasite Control', name: 'Bravecto 40 – 56kg', price: 645.00 },
  { id: 'pc-dew-puppy', category: 'Parasite Control', name: 'Puppy deworming 5kg', price: 45.00 },
  { id: 'pc-dew-small', category: 'Parasite Control', name: 'Small dog deworming 12.5kg', price: 60.00 },
  { id: 'pc-dew-med', category: 'Parasite Control', name: 'Medium dog deworming 25kg', price: 90.00 },
  { id: 'pc-dew-large', category: 'Parasite Control', name: 'Large dog deworming 37.5kg', price: 140.00 },
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
];
const DEFAULT_LOCATIONS = [
  { id: 'kyalami', name: 'Kyalami', boardingCapacity: 15 },
  { id: 'noordwyk', name: 'Noordwyk', boardingCapacity: 15 },
];

let client = null;
let storageMode = 'json';
const cache = {
  customers: [],
  pets: [],
  bookings: [],
  services: DEFAULT_SERVICES,
  locations: DEFAULT_LOCATIONS,
  xeroTokens: null,
};

function loadFile(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function saveFile(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function loadJsonFallback() {
  cache.customers = loadFile(FILES.customers, []);
  cache.pets = loadFile(FILES.pets, []);
  cache.bookings = loadFile(FILES.bookings, []);
  cache.services = loadFile(FILES.services, DEFAULT_SERVICES);
  cache.locations = loadFile(FILES.locations, DEFAULT_LOCATIONS);
  cache.xeroTokens = loadFile(FILES.xeroTokens, null);
  if (!fs.existsSync(FILES.services)) saveFile(FILES.services, cache.services);
  if (!fs.existsSync(FILES.locations)) saveFile(FILES.locations, cache.locations);
  if (!fs.existsSync(FILES.customers)) saveFile(FILES.customers, cache.customers);
  if (!fs.existsSync(FILES.pets)) saveFile(FILES.pets, cache.pets);
  if (!fs.existsSync(FILES.bookings)) saveFile(FILES.bookings, cache.bookings);
  if (!fs.existsSync(FILES.xeroTokens)) saveFile(FILES.xeroTokens, cache.xeroTokens);
}

async function tursoSet(key, value) {
  if (!client) return;
  await client.execute({
    sql: `INSERT INTO app_state (key, value, updated_at)
          VALUES (?, ?, datetime('now'))
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    args: [key, JSON.stringify(value)],
  });
}

async function tursoGet(key, fallback) {
  const result = await client.execute({ sql: 'SELECT value FROM app_state WHERE key = ? LIMIT 1', args: [key] });
  if (!result.rows.length) return fallback;
  try { return JSON.parse(result.rows[0].value); } catch { return fallback; }
}

async function init() {
  loadJsonFallback();

  const url = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN || process.env.TURSO_TOKEN;
  if (!url || !authToken) {
    console.log('Using JSON file storage (TURSO_DATABASE_URL/TURSO_AUTH_TOKEN not set).');
    return { mode: storageMode };
  }

  client = createClient({ url, authToken });
  await client.execute(`CREATE TABLE IF NOT EXISTS app_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  for (const [key, value] of Object.entries(cache)) {
    const existing = await tursoGet(key, undefined);
    if (existing === undefined) await tursoSet(key, value);
    else cache[key] = existing;
  }

  storageMode = 'turso';
  console.log('Using Turso database storage.');
  return { mode: storageMode };
}

function persist(key, data) {
  cache[key] = clone(data);
  if (client) {
    tursoSet(key, cache[key]).catch((err) => console.error(`Turso save failed for ${key}:`, err.message));
  } else {
    saveFile(FILES[key], cache[key]);
  }
}

module.exports = {
  init,
  getStorageMode: () => storageMode,
  getCustomers: () => clone(cache.customers),
  saveCustomers: (d) => persist('customers', d),
  getPets: () => clone(cache.pets),
  savePets: (d) => persist('pets', d),
  getBookings: () => clone(cache.bookings),
  saveBookings: (d) => persist('bookings', d),
  getServices: () => clone(cache.services),
  saveServices: (d) => persist('services', d),
  getLocations: () => clone(cache.locations),
  saveLocations: (d) => persist('locations', d),
  getXeroTokens: () => clone(cache.xeroTokens),
  saveXeroTokens: (d) => persist('xeroTokens', d),
};
