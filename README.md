# Cafe D Dream — Manager & Kitchen

Static PWA for staff-managed table orders, private sitting, and kitchen display. Data lives in **Firestore**; menu comes from a published **Google Sheet CSV**. There is **no customer QR ordering page** — all orders are entered by staff from the manager app.

## Pages

| Page | URL | Who |
|------|-----|-----|
| Manager | `admin.html` | Staff (sign-in required) |
| Kitchen | `kitchen.html` | Staff (sign-in required) |

Food orders are taken from the **Orders** tab (Party Hall, Tattoo Studio, Hotel tables + counter). Private sitting (PS 1–10) is managed on the **Sitting** tab.

## Setup

1. **Firebase** — Create project, enable Firestore and **Email/Password** Authentication.
2. **Staff user** — In Firebase Auth, create a staff user with a strong password.
3. **Firestore rules** — Deploy [`firestore.rules`](firestore.rules):
   ```bash
   firebase deploy --only firestore:rules
   ```
4. **Config** — Edit `CONFIG` in [`firebase.js`](firebase.js): Firebase keys, Google Sheet CSV URL, UPI, `KITCHEN_TIMER_MINUTES`.
5. **Menu sheet** — Columns: `category`, `item_name`, `price`, `available`. Publish as CSV (or use `sample-menu.csv` locally).
6. **Hosting** — Upload to GitHub Pages or any static host. Staff open `admin.html` only.

## Security (important if the repo is public on GitHub)

### What is OK to be public
- **Firebase web config** (`apiKey`, `projectId`, etc.) — protection is **Firestore rules** + **Authentication**.

### What must NOT be in GitHub
- **Staff password** — only in Firebase Console → Authentication.

### What staff login protects
- Table orders, mark paid, kitchen status, daily sales, order deletion — all require staff sign-in.

### Checklist
1. Deploy `firestore.rules` (staff-only writes on orders).
2. Google Cloud → Credentials → enable **Cloud Firestore API** and **Identity Toolkit API**.
3. Do not expose staff login credentials on customer-facing materials.

## Private Sitting Manager (`admin.html`)

The manager app covers PS 1–10 (occupancy, couple check-in, timers, billing) and dine-in table orders under the **Orders** tab.

### Google Drive + Sheet sync (Apps Script)

1. Create a Google Sheet for private sitting records.
2. Open **Extensions → Apps Script**, paste [`google-apps-script/private-sitting-sync.gs`](google-apps-script/private-sitting-sync.gs).
3. Run once to allow Drive access.
4. **Deploy → New deployment → Web app** (Execute as: Me, Who has access: Anyone).
5. Copy the Web App URL into `CONFIG.APPS_SCRIPT_URL` in [`firebase.js`](firebase.js).
6. Deploy updated [`firestore.rules`](firestore.rules) (adds `privateSessions`).

Check-in flow per couple: **mobile**, **Customer 1 & 2** (name, DOB calendar, front + back ID photo each), auto PDF, Drive folder `Private Sitting/YYYY-MM-DD/`, Sheet row append.

### Daily sales reports (auto → Drive)

After redeploying [`google-apps-script/private-sitting-sync.gs`](google-apps-script/private-sitting-sync.gs) with the `saveSalesReport` action:

- **Midnight** (admin app open) or **first open next morning**: yesterday's sales PDF uploads to `Cafe D Dream/Sales Reports/YYYY-MM-DD/`
- A summary row appends to the **Sales Reports** sheet tab
- On successful upload, that day's Firebase report data is cleared (archive lives on Drive)

Keep the admin tablet/app open overnight for exact midnight upload, or rely on morning catch-up.
