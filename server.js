require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');
const path = require('path');
const db = require('./db');
const xero = require('./xero');

const app = express();
app.use(express.json({ limit: '15mb' })); // higher limit so dog photos / vaccination card images can be uploaded as base64
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-secret-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 24 * 30 },
}));

function requireCustomer(req, res, next) {
  if (!req.session.customerId) return res.status(401).json({ error: 'Please log in.' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Admin login required.' });
  next();
}
// Staff have access to the Collections & Deliveries view only — not bookings, clients, or Xero.
// Admin (isAdmin) automatically passes this too, since admins can see everything.
function requireStaff(req, res, next) {
  if (!req.session.isStaff && !req.session.isAdmin) return res.status(401).json({ error: 'Staff login required.' });
  next();
}
function publicCustomer(c) {
  const { passwordHash, ...rest } = c;
  return rest;
}

// Returns an array of YYYY-MM-DD strings for every night of a boarding stay (check-in inclusive, check-out exclusive — the dog isn't there the night they leave).
function nightsBetween(checkIn, checkOut) {
  const nights = [];
  let d = new Date(checkIn);
  const end = new Date(checkOut);
  while (d < end) {
    nights.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return nights.length ? nights : [checkIn];
}

// Counts how many dogs are already booked into boarding at a location on each given night,
// excluding cancelled bookings and optionally excluding one booking id (used when checking an edit).
function boardingOccupancy(location, nights, excludeBookingId) {
  const bookings = db.getBookings().filter((b) =>
    b.type === 'boarding' &&
    b.location === location &&
    b.status !== 'cancelled' &&
    b.id !== excludeBookingId
  );
  const counts = {};
  nights.forEach((n) => { counts[n] = 0; });
  bookings.forEach((b) => {
    nightsBetween(b.checkInDate, b.checkOutDate).forEach((n) => {
      if (counts[n] !== undefined) counts[n]++;
    });
  });
  return counts;
}

// ============ AUTH ============

app.post('/api/auth/register', async (req, res) => {
  const { firstName, lastName, email, phone, password, clientAccountNumber, emergencyNumber, location, packageType } = req.body;
  if (!firstName || !lastName || !email || !password) {
    return res.status(400).json({ error: 'First name, last name, email and password are required.' });
  }
  const customers = db.getCustomers();
  if (customers.find((c) => c.email.toLowerCase() === email.toLowerCase())) {
    return res.status(400).json({ error: 'An account with that email already exists.' });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const customer = {
    id: randomUUID(), firstName, lastName, fullName: `${firstName} ${lastName}`,
    email, phone: phone || '', address: '', passwordHash,
    clientAccountNumber: clientAccountNumber || '',
    emergencyNumber: emergencyNumber || '',
    location: location || 'kyalami',
    packageType: packageType || 'adhoc', // 'recurring' (invoiced 1st of month) or 'adhoc' (pay per visit)
    createdAt: new Date().toISOString(),
  };
  customers.push(customer);
  db.saveCustomers(customers);
  req.session.customerId = customer.id;
  res.json({ customer: publicCustomer(customer) });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const customers = db.getCustomers();
  const customer = customers.find((c) => c.email.toLowerCase() === (email || '').toLowerCase());
  if (!customer || !(await bcrypt.compare(password || '', customer.passwordHash))) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }
  req.session.customerId = customer.id;
  res.json({ customer: publicCustomer(customer) });
});

app.post('/api/auth/logout', (req, res) => { req.session.destroy(() => res.json({ ok: true })); });

app.get('/api/auth/me', (req, res) => {
  if (!req.session.customerId) return res.json({ customer: null });
  const customer = db.getCustomers().find((c) => c.id === req.session.customerId);
  res.json({ customer: customer ? publicCustomer(customer) : null });
});

app.post('/api/admin/login', (req, res) => {
  if (req.body.password && req.body.password === process.env.ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Incorrect admin password.' });
});

// Staff login is separate from admin — staff only ever see the Collections & Deliveries view.
app.post('/api/staff/login', (req, res) => {
  if (req.body.password && req.body.password === process.env.STAFF_PASSWORD) {
    req.session.isStaff = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Incorrect staff password.' });
});

// ============ PROFILE & PETS (incl. medical records) ============

app.put('/api/profile', requireCustomer, (req, res) => {
  const customers = db.getCustomers();
  const idx = customers.findIndex((c) => c.id === req.session.customerId);
  const { firstName, lastName, phone, address, clientAccountNumber, emergencyNumber, location, packageType } = req.body;
  customers[idx] = {
    ...customers[idx],
    firstName: firstName ?? customers[idx].firstName,
    lastName: lastName ?? customers[idx].lastName,
    fullName: `${firstName ?? customers[idx].firstName} ${lastName ?? customers[idx].lastName}`,
    phone: phone ?? customers[idx].phone,
    address: address ?? customers[idx].address,
    clientAccountNumber: clientAccountNumber ?? customers[idx].clientAccountNumber,
    emergencyNumber: emergencyNumber ?? customers[idx].emergencyNumber,
    location: location ?? customers[idx].location,
    packageType: packageType ?? customers[idx].packageType,
  };
  db.saveCustomers(customers);
  res.json({ customer: publicCustomer(customers[idx]) });
});

app.get('/api/pets', requireCustomer, (req, res) => {
  res.json({ pets: db.getPets().filter((p) => p.customerId === req.session.customerId) });
});

app.post('/api/pets', requireCustomer, (req, res) => {
  const {
    name, breed, age, notes, photoBase64, vaccinationCardBase64, vaccinationDate, dewormingDate, tickFleaDate,
    weight, sterilised, foodType, foodAmount, foodFrequency, medication, medicationDetails,
  } = req.body;
  if (!name) return res.status(400).json({ error: 'Dog name is required.' });
  const pets = db.getPets();
  const pet = {
    id: randomUUID(),
    customerId: req.session.customerId,
    name,
    species: 'Dog',
    breed: breed || '',
    age: age || '',
    notes: notes || '',
    photoBase64: photoBase64 || null,
    vaccinationCardBase64: vaccinationCardBase64 || null,
    vaccinationDate: vaccinationDate || null,
    dewormingDate: dewormingDate || null,
    tickFleaDate: tickFleaDate || null,
    weight: weight || '',
    sterilised: sterilised || 'unknown', // 'yes' | 'no' | 'under_6_months' | 'unknown'
    foodType: foodType || '',
    foodAmount: foodAmount || '',
    foodFrequency: foodFrequency || '',
    medication: medication || 'no', // 'yes' | 'no'
    medicationDetails: medicationDetails || '',
  };
  pets.push(pet);
  db.savePets(pets);
  res.json({ pet });
});

app.put('/api/pets/:id', requireCustomer, (req, res) => {
  const pets = db.getPets();
  const idx = pets.findIndex((p) => p.id === req.params.id && p.customerId === req.session.customerId);
  if (idx === -1) return res.status(404).json({ error: 'Dog not found.' });
  const fields = ['name', 'breed', 'age', 'notes', 'photoBase64', 'vaccinationCardBase64', 'vaccinationDate', 'dewormingDate', 'tickFleaDate', 'weight', 'sterilised', 'foodType', 'foodAmount', 'foodFrequency', 'medication', 'medicationDetails'];
  fields.forEach((f) => { if (req.body[f] !== undefined) pets[idx][f] = req.body[f]; });
  db.savePets(pets);
  res.json({ pet: pets[idx] });
});

app.delete('/api/pets/:id', requireCustomer, (req, res) => {
  const pets = db.getPets().filter((p) => !(p.id === req.params.id && p.customerId === req.session.customerId));
  db.savePets(pets);
  res.json({ ok: true });
});

// ============ SERVICES ============

app.get('/api/services', (req, res) => { res.json({ services: db.getServices() }); });
// ============ COLLECTIONS & DELIVERIES (staff view) ============

// Returns every booking that needs a physical pickup or dropoff: pet taxi pickup/dropoff flags,
// plus every boarding check-in (collection from kennel) and check-out (drop back to owner) day.
app.get('/api/staff/collections', requireStaff, (req, res) => {
  const bookings = db.getBookings();
  const customers = db.getCustomers();
  const pets = db.getPets();
  const services = db.getServices();

  const items = [];

  bookings.forEach((b) => {
    if (b.status === 'cancelled') return;
    const customer = customers.find((c) => c.id === b.customerId);
    const pet = pets.find((p) => p.id === b.petId);
    if (!customer) return;

    if (b.type === 'boarding') {
      if (b.transportPickup) {
        items.push(makeCollectionItem(b, customer, pet, 'pickup', b.checkInDate, `Collect for Doggy Hotel check-in (${b.checkInDate} → ${b.checkOutDate})`));
      }
      if (b.transportDropoff) {
        items.push(makeCollectionItem(b, customer, pet, 'dropoff', b.checkOutDate, `Drop off after Doggy Hotel check-out (${b.checkInDate} → ${b.checkOutDate})`));
      }
    } else {
      const service = services.find((s) => s.id === b.serviceId);
      if (b.transportPickup) {
        items.push(makeCollectionItem(b, customer, pet, 'pickup', b.date, service ? service.name : 'Service'));
      }
      if (b.transportDropoff) {
        items.push(makeCollectionItem(b, customer, pet, 'dropoff', b.date, service ? service.name : 'Service'));
      }
    }
  });

  items.sort((a, b) => a.date.localeCompare(b.date));
  res.json({ items });
});

function makeCollectionItem(booking, customer, pet, direction, date, reason) {
  return {
    bookingId: booking.id,
    direction, // 'pickup' = collecting the dog from the customer | 'dropoff' = returning the dog to the customer
    date,
    time: booking.time || '',
    reason,
    status: booking.status,
    customerName: customer.fullName,
    customerPhone: customer.phone,
    customerEmergencyNumber: customer.emergencyNumber,
    address: customer.address,
    petName: pet ? pet.name : 'Dog',
    petPhotoBase64: pet ? pet.photoBase64 : null,
    petNotes: pet ? pet.notes : '',
    collectionNotes: booking.collectionNotes || '',
    dropoffNotes: booking.dropoffNotes || '',
    mapsUrl: customer.address ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(customer.address)}` : null,
  };
}

// Staff (or admin) can jot down notes for a specific pickup/dropoff — e.g. gate code, where the dog hides, what time works.
app.put('/api/staff/bookings/:id/notes', requireStaff, (req, res) => {
  const bookings = db.getBookings();
  const idx = bookings.findIndex((b) => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Booking not found.' });
  const { collectionNotes, dropoffNotes } = req.body;
  if (collectionNotes !== undefined) bookings[idx].collectionNotes = collectionNotes;
  if (dropoffNotes !== undefined) bookings[idx].dropoffNotes = dropoffNotes;
  db.saveBookings(bookings);
  res.json({ booking: bookings[idx] });
});

app.get('/api/locations', (req, res) => { res.json({ locations: db.getLocations() }); });

// Public so the booking form can check live availability before submitting.
app.get('/api/boarding/availability', (req, res) => {
  const { location, checkInDate, checkOutDate } = req.query;
  if (!location || !checkInDate || !checkOutDate) return res.status(400).json({ error: 'location, checkInDate and checkOutDate are required.' });
  const loc = db.getLocations().find((l) => l.id === location);
  const capacity = loc ? loc.boardingCapacity : 15;
  const nights = nightsBetween(checkInDate, checkOutDate);
  const counts = boardingOccupancy(location, nights);
  const days = nights.map((n) => ({ date: n, booked: counts[n] || 0, capacity, full: (counts[n] || 0) >= capacity }));
  res.json({ capacity, days, available: !days.some((d) => d.full) });
});

// ============ BOOKINGS ============

app.get('/api/bookings', requireCustomer, (req, res) => {
  res.json({ bookings: db.getBookings().filter((b) => b.customerId === req.session.customerId) });
});

app.post('/api/bookings', requireCustomer, (req, res) => {
  const {
    petId, serviceId, date, time, notes,
    type, checkInDate, checkOutDate, location, transportPickup, transportDropoff,
  } = req.body;
  const bookingType = type === 'boarding' ? 'boarding' : 'standard';

  if (bookingType === 'boarding') {
    if (!petId || !checkInDate || !checkOutDate) {
      return res.status(400).json({ error: 'Dog, check-in date and check-out date are required for boarding.' });
    }
    const loc = location || 'kyalami';
    const locConfig = db.getLocations().find((l) => l.id === loc);
    const capacity = locConfig ? locConfig.boardingCapacity : 15;
    const nights = nightsBetween(checkInDate, checkOutDate);
    const counts = boardingOccupancy(loc, nights);
    const fullDays = nights.filter((n) => (counts[n] || 0) >= capacity);
    if (fullDays.length) {
      return res.status(409).json({ error: `${locConfig ? locConfig.name : loc} is fully booked for the doggy hotel on ${fullDays.join(', ')}. Please choose different dates or another location.` });
    }
  } else {
    if (!petId || !serviceId || !date || !time) {
      return res.status(400).json({ error: 'Dog, service, date and time are required.' });
    }
  }

  const pet = db.getPets().find((p) => p.id === petId && p.customerId === req.session.customerId);
  if (!pet) return res.status(400).json({ error: 'Invalid dog selected.' });

  let service = null;
  if (bookingType === 'standard') {
    service = db.getServices().find((s) => s.id === serviceId);
    if (!service) return res.status(400).json({ error: 'Invalid service selected.' });
  }

  const bookings = db.getBookings();
  const booking = {
    id: randomUUID().slice(0, 8),
    customerId: req.session.customerId,
    petId,
    type: bookingType,
    serviceId: serviceId || null,
    date: bookingType === 'boarding' ? checkInDate : date,
    time: time || '09:00',
    checkInDate: bookingType === 'boarding' ? checkInDate : null,
    checkOutDate: bookingType === 'boarding' ? checkOutDate : null,
    location: location || 'kyalami',
    transportPickup: !!transportPickup,
    transportDropoff: !!transportDropoff,
    collectionNotes: '', // staff-only notes for picking the dog up
    dropoffNotes: '', // staff-only notes for dropping the dog off
    notes: notes || '',
    status: 'pending',
    invoiceStatus: 'not_invoiced',
    xeroInvoiceId: null,
    createdAt: new Date().toISOString(),
  };
  bookings.push(booking);
  db.saveBookings(bookings);
  res.json({ booking });
});

app.delete('/api/bookings/:id', requireCustomer, (req, res) => {
  const bookings = db.getBookings();
  const idx = bookings.findIndex((b) => b.id === req.params.id && b.customerId === req.session.customerId);
  if (idx === -1) return res.status(404).json({ error: 'Booking not found.' });
  if (bookings[idx].status !== 'pending') return res.status(400).json({ error: 'Only pending bookings can be cancelled.' });
  bookings.splice(idx, 1);
  db.saveBookings(bookings);
  res.json({ ok: true });
});

// ============ ADMIN ============

app.get('/api/admin/bookings', requireAdmin, (req, res) => {
  const bookings = db.getBookings();
  const customers = db.getCustomers();
  const pets = db.getPets();
  const services = db.getServices();
  const enriched = bookings.map((b) => ({
    ...b,
    customer: publicCustomer(customers.find((c) => c.id === b.customerId) || {}),
    pet: pets.find((p) => p.id === b.petId) || null,
    service: services.find((s) => s.id === b.serviceId) || null,
  })).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  res.json({ bookings: enriched });
});

app.put('/api/admin/bookings/:id/status', requireAdmin, (req, res) => {
  const { status } = req.body;
  const bookings = db.getBookings();
  const idx = bookings.findIndex((b) => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Booking not found.' });
  bookings[idx].status = status;
  db.saveBookings(bookings);
  res.json({ booking: bookings[idx] });
});

app.get('/api/admin/customers', requireAdmin, (req, res) => {
  const pets = db.getPets();
  res.json({
    customers: db.getCustomers().map((c) => ({ ...publicCustomer(c), pets: pets.filter((p) => p.customerId === c.id) })),
  });
});

app.get('/api/admin/clients/:id', requireAdmin, (req, res) => {
  const customer = db.getCustomers().find((c) => c.id === req.params.id);
  if (!customer) return res.status(404).json({ error: 'Client not found.' });
  const pets = db.getPets().filter((p) => p.customerId === customer.id);
  const bookings = db.getBookings().filter((b) => b.customerId === customer.id);
  res.json({ customer: publicCustomer(customer), pets, bookings });
});

// ---- Xero connection ----

app.get('/api/admin/xero/status', requireAdmin, (req, res) => { res.json(xero.getStatus()); });

app.get('/api/admin/xero/connect', requireAdmin, async (req, res) => {
  if (!xero.isConfigured()) {
    return res.status(400).json({ error: 'Xero is not configured yet. Add XERO_CLIENT_ID, XERO_CLIENT_SECRET and XERO_REDIRECT_URI to your .env file first — see README.' });
  }
  const url = await xero.getConsentUrl();
  res.json({ url });
});

app.get('/xero/callback', async (req, res) => {
  try {
    await xero.handleCallback(req.protocol + '://' + req.get('host') + req.originalUrl);
    res.redirect('/admin.html?xero=connected');
  } catch (err) {
    console.error(err);
    res.redirect('/admin.html?xero=error');
  }
});

app.post('/api/admin/xero/disconnect', requireAdmin, (req, res) => { xero.disconnect(); res.json({ ok: true }); });

app.post('/api/admin/bookings/:id/invoice', requireAdmin, async (req, res) => {
  try {
    const bookings = db.getBookings();
    const idx = bookings.findIndex((b) => b.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Booking not found.' });
    const booking = bookings[idx];

    const customer = db.getCustomers().find((c) => c.id === booking.customerId);
    const pet = db.getPets().find((p) => p.id === booking.petId);
    if (!customer) return res.status(400).json({ error: 'Missing customer data for this booking.' });

    let lineItems;
    if (booking.type === 'boarding') {
      const nights = Math.max(1, Math.round((new Date(booking.checkOutDate) - new Date(booking.checkInDate)) / 86400000));
      const perNight = db.getServices().find((s) => s.id === 'la-night');
      lineItems = [{
        description: `Luxury Accommodation — ${pet ? pet.name : 'Dog'} (${booking.checkInDate} to ${booking.checkOutDate}, ${nights} night${nights > 1 ? 's' : ''})`,
        quantity: nights,
        unitAmount: perNight ? perNight.price : 327,
      }];
    } else {
      const service = db.getServices().find((s) => s.id === booking.serviceId);
      if (!service) return res.status(400).json({ error: 'Missing service data for this booking.' });
      lineItems = [{
        description: `${service.name} — ${pet ? pet.name : 'Dog'} (${booking.date} ${booking.time})`,
        quantity: 1,
        unitAmount: service.price,
      }];
    }

    const sendEmail = req.body.sendEmail !== false;
    const invoice = await xero.createInvoiceForBooking({ customer, booking, lineItems, sendEmail });

    bookings[idx].invoiceStatus = 'invoiced';
    bookings[idx].xeroInvoiceId = invoice.invoiceID;
    bookings[idx].xeroInvoiceNumber = invoice.invoiceNumber;
    db.saveBookings(bookings);

    res.json({ ok: true, invoiceNumber: invoice.invoiceNumber, invoiceId: invoice.invoiceID, emailed: sendEmail });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to create Xero invoice.' });
  }
});

const PORT = process.env.PORT || 3000;
db.init()
  .then(() => {
    app.listen(PORT, () => console.log(`Furry Kidz booking system running on http://localhost:${PORT} (${db.getStorageMode()} storage)`));
  })
  .catch((err) => {
    console.error('Failed to initialize storage:', err);
    process.exit(1);
  });
