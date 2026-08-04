# Fleet Wolf Driver Dashboard — Geotab Add-In

Phase 1 + 2: read-only stats (stops, mileage, fuel, HOS) plus a simple
cash calculator (mileage × rate, minus estimated fuel cost). No load
entry yet — that's Phase 3.

## Files
- `config.json` — Add-In manifest MyGeotab reads to register the tab
- `index.html` — dashboard markup
- `styles.css` — styling
- `app.js` — Geotab API calls + UI logic

## Setup

1. **Create a GitHub repo** (e.g. `driver-dashboard-addin`), push these
   files, then enable GitHub Pages (Settings → Pages → deploy from
   `main` branch, root folder).
2. **Update `config.json`** — replace `YOUR-GITHUB-USERNAME` in both
   URLs with your actual GitHub Pages URL once it's live.
3. **Add an icon** — drop a square `icon.svg` (or swap the extension in
   config.json) in the repo root.
4. **Register in MyGeotab**:
   - System Settings → Add-Ins → Add New Add-In
   - Paste the full contents of `config.json`
   - Save — a new "Driver Dashboard" item appears in the left nav
5. Open it, pick a vehicle from the dropdown, and it should populate.

## Known things to double-check once you're testing against real data

- **Fuel diagnostic name** — `app.js` looks up a Diagnostic named
  exactly `"Fuel Used"`. Some fleets/engine types report it under a
  slightly different name (e.g. `"Fuel Used (Trip)"`). If the fuel
  card shows `n/a`, check System Settings → Engine & Maintenance →
  Diagnostics in MyGeotab for the exact name on your devices and
  update the search in `loadFuel()`.
- **HOS requires ELD/HOS-enabled drivers** — `DutyStatusAvailability`
  only returns data for drivers actively running HOS (e.g. via
  Geotab Drive with HOS enabled). Non-HOS drivers will show `n/a`.
- **Driver-device linkage** — HOS is pulled by finding the most recent
  `DriverChange` record for the selected device to figure out who's
  driving. If a vehicle is shared or a driver forgets to log in on
  Drive, this may point to the wrong (or a stale) driver.
- **Units** — distance and fuel come back from the API in metric
  (km, liters); `app.js` converts to miles/gallons. Confirm that's
  actually what your brokers want to see.

## Phase 3 preview (not built yet)

Load entry needs somewhere to persist data (Geotab Add-Ins don't have
their own database). Options worth considering when we get there:
Airtable/Google Sheets (fast to stand up, fine for low volume) vs. a
small hosted backend like Supabase or Firebase (better if you want
multiple brokers/users, history, and mileage-vs-load reconciliation).
