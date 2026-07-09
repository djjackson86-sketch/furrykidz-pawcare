# Furry Kidz Pet Services — Booking System

- **Client membership portal** (`/index.html`) — clients sign up, add their dogs (with photo, vaccination card, vaccination/deworming/tick & flea dates), and book services from the real price list.
- **Admin dashboard** (`/admin.html`) — manage all bookings, search/view every client's full dog medical record, and invoice via Xero.
- **Turso-backed data layer** — runtime app state is stored server-side in Turso (`app_state` table) when `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` are configured; JSON files remain a local/offline fallback.
- **Real Xero integration** — invoicing a booking creates/reuses the customer as a Xero contact, creates an authorised invoice, and emails it from Xero.

## 1. Install
```
npm install
```

## 2. Set up Xero
1. https://developer.xero.com/app/manage → New App → Web app.
2. Redirect URI must exactly match `.env` — `http://localhost:3000/xero/callback` locally, your real domain in production.
3. Copy Client ID/Secret into `.env` (copied from `.env.example`). Set `SESSION_SECRET` and `ADMIN_PASSWORD` too.

## 3. Run
```
npm start
```
- Client portal: http://localhost:3000/
- Admin: http://localhost:3000/admin.html (log in with `ADMIN_PASSWORD`)
- In Admin → Xero Setup → Connect to Xero.

## Dog medical records
Each dog profile stores: photo, vaccination card image, vaccination date, last deworming date, last tick & flea treatment date. The portal and admin record view both show colour-coded status badges (Up to date / Due soon / Overdue / No record) calculated from those dates — deworming assumed valid 90 days, tick & flea (Bravecto) 84 days, vaccination 365 days. Adjust the validity windows in `public/app.js` (`treatmentStatus` function) if your vet's intervals differ.

## Price list
Pulled from your "1 March 2026" price list — Daycare, Barkery, Pet Taxi, Luxury Accommodation, Parasite Control, Grooming Spa — all in `data/services.json` (auto-created from `db.js` on first run). Edit prices there directly, or add an admin UI for it later. The system reminds you it auto-increases yearly on 1 March — that part you'll need to do by hand each year (or I can add a scheduled price-bump feature later).

## Collections & Deliveries (staff view)
A separate, restricted page at `/staff.html` for whoever does pickups/dropoffs. It logs in with its own `STAFF_PASSWORD` (set in `.env`) — staff accounts can only ever see this one page; the API rejects any attempt to reach bookings, clients, or Xero with a staff session. It only shows collection-relevant info, grouped by date:
- Who's being collected/dropped off, and why (boarding check-in/out, or a service with pet taxi requested)
- Customer phone, emergency contact, address, and a one-tap "Navigate there" link (opens Google Maps directions)
- The dog's general notes (temperament etc.)
- Editable **Collection message** and **Drop-off message** boxes — gate codes, where the dog hides, who to leave them with — saved per booking and visible to whoever's doing that run.

Admins automatically have access to this page too (linked from the admin sidebar), since they can see everything.

## Doggy hotel capacity
Each location has a kennel capacity (defaults to **15 spots — change this to your real number**) in `data/locations.json`, auto-created on first run. When a customer books boarding, the system checks every night of their stay against existing bookings at that location and blocks the booking if any night is already full, telling them exactly which dates are unavailable. Edit `boardingCapacity` per location in that file (or in `db.js` before first run) to match how many dogs you can actually board at Kyalami vs Noordwyk.

## Your 1700 existing clients
This JSON-file storage is fine for testing but **will not comfortably handle 1700 clients with photos/medical files long-term** — before going live, your brother should migrate `data/*.json` to a real database (Postgres is a solid free option on most hosts) and bulk-import your existing client list (I can help generate that import script once you export your current client data, e.g. from JotForm or wherever it lives now).

## Security notes before going live (for your brother)
- Put it behind HTTPS.
- Migrate from JSON files to a real database.
- Replace the single shared `ADMIN_PASSWORD` with individual staff logins.
- Set strong unique `SESSION_SECRET` / `ADMIN_PASSWORD`.
- Rate-limit login endpoints.
- Decide a real photo/file storage approach (S3 etc.) once volume grows — base64-in-JSON works for now but isn't ideal at scale.

## Project structure
```
server.js / xero.js / db.js
public/index.html   — client portal
public/admin.html   — admin dashboard
public/style.css / app.js
data/                — JSON "database" fallback + seed files
.env.example
```

## Turso database
When `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` are set, `db.js` initializes a Turso `app_state` table and stores the app datasets (`customers`, `pets`, `bookings`, `services`, `locations`, `xeroTokens`) as server-side JSON values. This keeps the existing app code simple while moving runtime data off Render's ephemeral filesystem.

For local/offline development without Turso env vars, the app still falls back to `data/*.json`.
