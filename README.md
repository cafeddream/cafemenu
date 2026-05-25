# Cafe D Dream — Table Ordering System

Static PWA for QR table ordering, counter admin, and kitchen display. Data lives in **Firestore**; menu comes from a published **Google Sheet CSV**.

## Pages

| Page | URL | Who |
|------|-----|-----|
| Customer menu | `index.html?table=T1` | Guests (QR per table) |
| Counter | `admin.html` | Staff (sign-in required) |
| Kitchen | `kitchen.html` | Staff (sign-in required) |

## Setup

1. **Firebase** — Create project, enable Firestore and **Email/Password** Authentication.
2. **Staff user** — In Firebase Auth, create a user matching `CONFIG.STAFF_EMAIL` / `CONFIG.STAFF_PASSWORD` in [`firebase.js`](firebase.js).
3. **Firestore rules** — Deploy [`firestore.rules`](firestore.rules):
   ```bash
   firebase deploy --only firestore:rules
   ```
4. **Config** — Edit `CONFIG` in [`firebase.js`](firebase.js): Firebase keys, Google Sheet CSV URL, UPI, tables, `KITCHEN_TIMER_MINUTES`.
5. **Menu sheet** — Columns: `category`, `item_name`, `price`, `available`. Publish as CSV (or use `sample-menu.csv` locally).
6. **Hosting** — Upload to GitHub Pages or any static host. Generate QR codes:  
   `https://your-site/index.html?table=T1` (one per table).

## Security (important if the repo is public on GitHub)

### What is OK to be public
- **Firebase web config** (`apiKey`, `projectId`, etc.) — these are not secret; protection is **Firestore rules** + **Authentication**.
- Customer menu code and table QR URLs.

### What must NOT be in GitHub
- **Staff password** — only exists in [Firebase Console → Authentication](https://console.firebase.google.com). Staff type it on the login screen; it is **not** stored in this project anymore.
- Treat **UPI ID** as business info, not a login secret.

### What staff login actually protects
Even if someone clones your repo, they **cannot** (with rules deployed):
- Mark orders paid or change kitchen status without signing in as your Firebase staff user
- Edit daily sales totals or paid history
- Delete orders from the database

They **can** still (by design, for QR ordering):
- Place customer orders on a table if they know `?table=T1`

So the benefit is **database rules + Firebase Auth**, not hiding the JavaScript. Create **one strong staff password** in Firebase only. If you previously committed a password to GitHub, **change it in Firebase Auth** immediately.

### Checklist
1. Deploy `firestore.rules`
2. Enable Email/Password auth; create one staff user with a strong password (not in code)
3. Do not link `admin.html` on customer-facing posters (counter/kitchen URL only for staff)

## Features

- Customer cart, UPI/cash payment flow, live order status on payment screen
- Counter: clickable tables, take/add orders, mark paid, cancel order, reject payment claim, print bill
- Kitchen: 20-minute countdown timer (configurable), color green → red
- Sales report with date range and CSV export
- Menu cached in `localStorage` when the sheet is unreachable
