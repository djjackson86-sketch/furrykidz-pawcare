// telegram.js — server-side Telegram notifications for Furry Kidz.
// Keep bot tokens in environment variables only; never commit secrets.

const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';

function enabled() {
  return process.env.TELEGRAM_NOTIFICATIONS_ENABLED !== 'false'
    && !!process.env.TELEGRAM_BOT_TOKEN
    && !!process.env.TELEGRAM_CHAT_ID;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(value) {
  if (value === undefined || value === null || value === '') return '—';
  return `R${Number(value || 0).toFixed(2)}`;
}

function zaDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

function todayZA() {
  const p = zaDateParts(new Date());
  return `${p.year}-${p.month}-${p.day}`;
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function tomorrowZA() {
  return addDays(todayZA(), 1);
}

function serviceNameFor(booking, services) {
  if (booking.type === 'boarding') return 'Doggy Hotel';
  const service = services.find((s) => s.id === booking.serviceId);
  return service ? service.name : 'Service';
}

function bookingPrice(booking, services) {
  if (booking.type === 'boarding') return null;
  const service = services.find((s) => s.id === booking.serviceId);
  return service ? service.price : null;
}

function customerFor(booking, customers) {
  return customers.find((c) => c.id === booking.customerId) || {};
}

function petFor(booking, pets) {
  return pets.find((p) => p.id === booking.petId) || {};
}

function bookingLine(booking, { customers, pets, services }, options = {}) {
  const customer = customerFor(booking, customers);
  const pet = petFor(booking, pets);
  const service = serviceNameFor(booking, services);
  const price = bookingPrice(booking, services);
  const datePart = booking.type === 'boarding'
    ? `${booking.checkInDate || booking.date}${booking.checkOutDate ? ` → ${booking.checkOutDate}` : ''}`
    : booking.date;
  const timePart = booking.time ? ` ${booking.time}` : '';
  const transport = [];
  if (booking.transportPickup) transport.push(`pickup${booking.transportPickupWindow ? ` ${String(booking.transportPickupWindow).toUpperCase()}` : ''}`);
  if (booking.transportDropoff) transport.push(`dropoff${booking.transportDropoffWindow ? ` ${String(booking.transportDropoffWindow).toUpperCase()}` : ''}`);
  const bits = [
    `• <b>${escapeHtml(service)}</b>`,
    `  📅 ${escapeHtml(datePart || '—')}${escapeHtml(timePart)}`,
    `  👤 ${escapeHtml(customer.fullName || 'Client')}${customer.phone ? ` · ${escapeHtml(customer.phone)}` : ''}`,
    `  🐶 ${escapeHtml(pet.name || 'Dog')}`,
  ];
  if (price !== null) bits.push(`  💰 ${money(price)}`);
  if (transport.length) bits.push(`  🚐 ${escapeHtml(transport.join(' · '))}`);
  if (options.includeStatus) bits.push(`  📌 ${escapeHtml(booking.status || 'pending')}`);
  return bits.join('\n');
}

async function sendMessage(text) {
  if (!enabled()) return { ok: false, skipped: true, reason: 'telegram_not_configured' };
  const url = `${TELEGRAM_API_BASE}${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
  const data = await res.json().catch(() => ({ ok: false, description: 'Invalid Telegram response' }));
  if (!res.ok || !data.ok) {
    const err = new Error(data.description || `Telegram HTTP ${res.status}`);
    err.telegram = data;
    throw err;
  }
  return data;
}

async function notifyNewCustomer(customer) {
  const text = [
    '🐾 <b>Furry Kidz</b>',
    '━━━━━━━━━━━━━━',
    '👤 <b>New customer account</b>',
    '',
    `Name: <b>${escapeHtml(customer.fullName || `${customer.firstName || ''} ${customer.lastName || ''}`.trim())}</b>`,
    `Email: ${escapeHtml(customer.email || '—')}`,
    `Phone: ${escapeHtml(customer.phone || '—')}`,
    `Location: ${escapeHtml(customer.location || '—')}`,
    `Package: ${escapeHtml(customer.packageType || '—')}`,
    customer.privacyConsentAccepted ? '🔒 POPIA consent captured' : '⚠️ POPIA consent missing',
  ].join('\n');
  return sendMessage(text);
}

async function notifyNewBooking(customer, pet, newBookings, services) {
  const count = newBookings.length;
  const first = newBookings[0] || {};
  const serviceLabels = newBookings.map((b) => serviceNameFor(b, services));
  const total = newBookings.reduce((sum, b) => {
    const p = bookingPrice(b, services);
    return p === null ? sum : sum + Number(p || 0);
  }, 0);
  const transport = [];
  if (first.transportPickup) transport.push(`pickup${first.transportPickupWindow ? ` ${String(first.transportPickupWindow).toUpperCase()}` : ''}`);
  if (first.transportDropoff) transport.push(`dropoff${first.transportDropoffWindow ? ` ${String(first.transportDropoffWindow).toUpperCase()}` : ''}`);
  const datePart = first.type === 'boarding'
    ? `${first.checkInDate || first.date}${first.checkOutDate ? ` → ${first.checkOutDate}` : ''}`
    : first.date;
  const text = [
    '🐾 <b>Furry Kidz</b>',
    '━━━━━━━━━━━━━━',
    count === 1 ? '📋 <b>New booking request</b>' : `📋 <b>New booking request</b> (${count} services)`,
    '',
    `👤 ${escapeHtml(customer.fullName || 'Client')}${customer.phone ? ` · ${escapeHtml(customer.phone)}` : ''}`,
    `🐶 ${escapeHtml(pet.name || 'Dog')}`,
    `📅 ${escapeHtml(datePart || '—')}${first.time ? ` ${escapeHtml(first.time)}` : ''}`,
    `🧾 ${escapeHtml(serviceLabels.join(', '))}`,
    first.type !== 'boarding' ? `💰 ${money(total)}` : '',
    transport.length ? `🚐 ${escapeHtml(transport.join(' · '))}` : '',
    first.notes ? `📝 ${escapeHtml(first.notes)}` : '',
  ].filter(Boolean).join('\n');
  return sendMessage(text);
}

function buildDailySummary({ bookings, customers, pets, services }, targetDate = tomorrowZA()) {
  const active = bookings.filter((b) => b.status !== 'cancelled');
  const standard = active.filter((b) => b.type !== 'boarding' && b.date === targetDate);
  const checkIns = active.filter((b) => b.type === 'boarding' && b.checkInDate === targetDate);
  const checkOuts = active.filter((b) => b.type === 'boarding' && b.checkOutDate === targetDate);
  const transport = active.filter((b) => (
    (b.transportPickup && ((b.type === 'boarding' ? b.checkInDate : b.date) === targetDate))
    || (b.transportDropoff && ((b.type === 'boarding' ? b.checkOutDate : b.date) === targetDate))
  ));

  const lines = [
    '🐾 <b>Furry Kidz</b>',
    '━━━━━━━━━━━━━━',
    `📅 <b>Tomorrow summary: ${escapeHtml(targetDate)}</b>`,
    '',
    `Bookings/services: ${standard.length}`,
    `Hotel check-ins: ${checkIns.length}`,
    `Hotel check-outs: ${checkOuts.length}`,
    `Transport items: ${transport.length}`,
  ];

  if (!standard.length && !checkIns.length && !checkOuts.length && !transport.length) {
    lines.push('', '✅ Nothing due tomorrow.');
    return lines.join('\n');
  }

  if (standard.length) {
    lines.push('', '<b>Bookings/services</b>');
    standard.forEach((b) => lines.push(bookingLine(b, { customers, pets, services }, { includeStatus: true })));
  }
  if (checkIns.length) {
    lines.push('', '<b>Doggy Hotel check-ins</b>');
    checkIns.forEach((b) => lines.push(bookingLine(b, { customers, pets, services }, { includeStatus: true })));
  }
  if (checkOuts.length) {
    lines.push('', '<b>Doggy Hotel check-outs</b>');
    checkOuts.forEach((b) => lines.push(bookingLine(b, { customers, pets, services }, { includeStatus: true })));
  }
  if (transport.length) {
    lines.push('', '<b>Transport</b>');
    transport.forEach((b) => lines.push(bookingLine(b, { customers, pets, services }, { includeStatus: true })));
  }
  return lines.join('\n');
}

async function sendDailySummary(db, targetDate = tomorrowZA()) {
  return sendMessage(buildDailySummary({
    bookings: db.getBookings(),
    customers: db.getCustomers(),
    pets: db.getPets(),
    services: db.getServices(),
  }, targetDate));
}

module.exports = {
  enabled,
  sendMessage,
  notifyNewCustomer,
  notifyNewBooking,
  buildDailySummary,
  sendDailySummary,
  tomorrowZA,
};
