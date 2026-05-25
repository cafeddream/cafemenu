/*
SETUP INSTRUCTIONS

Step 1: Create a Firebase project, enable Firestore Database, and copy your
Firebase web app config keys into CONFIG.FIREBASE below.

Step 2: Create a Google Sheet with these columns in the first row:
category | item_name | price | available
You can import sample-menu.csv from this project as a starter menu. In Google
Sheets, choose File > Share > Publish to web, publish the sheet as CSV, then
paste that CSV URL into CONFIG.GOOGLE_SHEET_CSV_URL.

Step 3: Update UPI_ID and UPI_NAME in CONFIG if your payment details change.

Step 4: Upload all files to GitHub and enable GitHub Pages for the repository.

Step 5: Generate QR codes for each table URL, such as:
https://yourname.github.io/your-repo/index.html?table=T1
Print one QR code per table.
*/

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

export const CONFIG = {
  GOOGLE_SHEET_CSV_URL: "PASTE_YOUR_SHEET_CSV_URL_HERE",
  UPI_ID: "paytmqr6xusep@ptys",
  UPI_NAME: "Cafe D Dream",
  RESTAURANT_NAME: "Cafe D Dream",
  TABLES: ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10", "T11", "T12", "T13", "T14", "T15"],
  FIREBASE: {
    apiKey: "AIzaSyCTgoPUmZgPwPWF_GUB_bI_7ULIYgE_PU8",
    authDomain: "cafe-d-dream.firebaseapp.com",
    projectId: "cafe-d-dream",
    storageBucket: "cafe-d-dream.firebasestorage.app",
    messagingSenderId: "499445996197",
    appId: "1:499445996197:web:8c9dd05edebb267072cb4c",
    measurementId: "G-X72457ZL05"
  }
};

const app = initializeApp(CONFIG.FIREBASE);
export const db = getFirestore(app);
export const auth = getAuth(app);

export const STATUS_LABELS = {
  new: "New Order",
  preparing: "Preparing",
  served: "Served - Pending Payment",
  paid: "Paid"
};

// Returns the valid Firestore document reference for one table's active order.
export function orderRef(tableId) {
  return doc(db, "orders", tableId, "current", "order");
}

// Returns the Firestore document used to store one day's collection total.
export function dailySummaryRef(dateKey = getTodayKey()) {
  return doc(db, "dailySummaries", dateKey);
}

// Returns the payment marker document for idempotent collection counting.
export function paymentRef(orderId, dateKey = getTodayKey()) {
  return doc(db, "dailySummaries", dateKey, "payments", orderId);
}

// Returns the saved history document for one completed table order.
export function tableHistoryOrderRef(tableId, orderId) {
  return doc(db, "tableHistory", tableId, "orders", orderId);
}

// Signs staff into Firebase Auth for protected admin and kitchen screens.
export function signInStaff(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

// Signs staff out of Firebase Auth.
export function signOutStaff() {
  return signOut(auth);
}

// Watches staff login state and calls back whenever it changes.
export function onStaffAuthState(callback) {
  return onAuthStateChanged(auth, callback);
}

// Generates a stable order id for paid history and daily collection records.
function createOrderId(tableId) {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${tableId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Creates a stable YYYY-MM-DD date key using the user's local date.
export function getTodayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Converts a Firestore timestamp, Date, or millisecond value to a Date object.
export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value === "number") return new Date(value);
  return null;
}

// Formats an order timestamp for compact counter cards.
export function formatTime(value) {
  const date = toDate(value);
  if (!date) return "Just now";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Calculates elapsed minutes since an order was placed.
export function minutesSince(value) {
  const date = toDate(value);
  if (!date) return 0;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
}

// Formats Indian rupee amounts without decimal places.
export function formatCurrency(amount) {
  return `₹${Number(amount || 0).toLocaleString("en-IN")}`;
}

// Sanitizes menu/order item names before inserting into the DOM.
export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Parses a CSV line while respecting quoted fields and escaped quotes.
function parseCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += char;
    }
  }

  cells.push(cell.trim());
  return cells;
}

// Parses Google Sheets CSV rows into available menu items.
export function parseMenuCsv(csvText) {
  const lines = csvText
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map((header) => header.toLowerCase().trim());
  const categoryIndex = headers.indexOf("category");
  const nameIndex = headers.indexOf("item_name");
  const priceIndex = headers.indexOf("price");
  const availableIndex = headers.indexOf("available");

  if ([categoryIndex, nameIndex, priceIndex, availableIndex].includes(-1)) {
    throw new Error("Invalid menu CSV headers");
  }

  return lines.slice(1).map(parseCsvLine)
    .map((row) => ({
      category: row[categoryIndex],
      name: row[nameIndex],
      price: Number(row[priceIndex]),
      available: String(row[availableIndex] || "").toLowerCase()
    }))
    .filter((item) => item.category && item.name && Number.isFinite(item.price) && item.available !== "no");
}

// Fetches menu data from Google Sheets, falling back to sample-menu.csv for local demos.
export async function fetchMenu() {
  const url = CONFIG.GOOGLE_SHEET_CSV_URL;
  const isPlaceholder = !url || url.includes("PASTE_YOUR_SHEET_CSV_URL_HERE");
  const fetchUrl = isPlaceholder ? "./sample-menu.csv" : url;
  const response = await fetch(fetchUrl, { cache: "no-store" });

  if (!response.ok) {
    throw new Error("Menu request failed");
  }

  return parseMenuCsv(await response.text());
}

// Groups menu items by category while preserving sheet order.
export function groupByCategory(items) {
  return items.reduce((groups, item) => {
    if (!groups[item.category]) groups[item.category] = [];
    groups[item.category].push(item);
    return groups;
  }, {});
}

// Merges new cart items into existing order items by item name and price.
export function mergeItems(existingItems = [], newItems = []) {
  const merged = new Map();

  [...existingItems, ...newItems].forEach((item) => {
    const key = `${item.name}|${item.price}`;
    const current = merged.get(key) || { name: item.name, price: Number(item.price), qty: 0 };
    current.qty += Number(item.qty || 0);
    if (current.qty > 0) merged.set(key, current);
  });

  return [...merged.values()];
}

// Calculates an order total from item price and quantity.
export function calculateTotal(items = []) {
  return items.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0), 0);
}

// Places a new order or appends to the current unpaid order for a table.
export async function placeOrAppendOrder(tableId, cartItems) {
  const cleanItems = cartItems
    .filter((item) => item.qty > 0)
    .map((item) => ({ name: item.name, price: Number(item.price), qty: Number(item.qty) }));

  if (!cleanItems.length) return null;

  const ref = orderRef(tableId);
  const newOrderId = createOrderId(tableId);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    let items = cleanItems;
    let status = "new";
    let timestamp = serverTimestamp();
    let orderId = newOrderId;

    if (snapshot.exists()) {
      const current = snapshot.data();
      if (current.status && current.status !== "paid") {
        items = mergeItems(current.items || [], cleanItems);
        status = current.status;
        timestamp = current.timestamp || serverTimestamp();
        orderId = current.orderId || newOrderId;
      }
    }

    transaction.set(ref, {
      orderId,
      tableId,
      items,
      total: calculateTotal(items),
      status,
      paymentStatus: "pending",
      timestamp,
      updatedAt: serverTimestamp()
    });
  });

  return getDoc(ref);
}

// Subscribes to a table's current order and returns the unsubscribe function.
export function listenToOrder(tableId, callback, onError) {
  return onSnapshot(orderRef(tableId), (snapshot) => {
    callback(snapshot.exists() ? { id: tableId, ...snapshot.data() } : null);
  }, onError);
}

// Updates one order status in Firestore.
export async function updateOrderStatus(tableId, status) {
  await updateDoc(orderRef(tableId), {
    status,
    updatedAt: serverTimestamp()
  });
}

// Records that the customer says they completed the online UPI payment.
export async function claimPaymentDone(tableId) {
  await updateDoc(orderRef(tableId), {
    paymentStatus: "customer_claimed_paid",
    preferredPaymentMethod: "online",
    paymentClaimedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

// Records that the customer wants to pay cash at the counter.
export async function requestCashAtCounter(tableId) {
  await updateDoc(orderRef(tableId), {
    paymentStatus: "cash_at_counter",
    preferredPaymentMethod: "cash",
    cashRequestedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

// Marks an order as paid and updates the daily collection only once per table/day.
export async function markOrderPaid(tableId, paymentMethod = "cash") {
  const orderDocument = orderRef(tableId);
  const summaryDocument = dailySummaryRef();
  const method = paymentMethod === "online" ? "online" : "cash";

  await runTransaction(db, async (transaction) => {
    const orderSnapshot = await transaction.get(orderDocument);
    if (!orderSnapshot.exists()) return;

    const order = orderSnapshot.data();
    const orderId = order.orderId || `${tableId}-${order.timestamp?.seconds || Date.now()}`;
    const paymentDocument = paymentRef(orderId);
    const historyDocument = tableHistoryOrderRef(tableId, orderId);
    const paymentSnapshot = await transaction.get(paymentDocument);

    transaction.update(orderDocument, {
      status: "paid",
      paymentStatus: "verified_paid",
      paymentMethod: method,
      paidAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    if (!paymentSnapshot.exists()) {
      transaction.set(summaryDocument, {
        date: getTodayKey(),
        total: increment(Number(order.total || 0)),
        cash: increment(method === "cash" ? Number(order.total || 0) : 0),
        online: increment(method === "online" ? Number(order.total || 0) : 0),
        updatedAt: serverTimestamp()
      }, { merge: true });

      transaction.set(paymentDocument, {
        orderId,
        tableId,
        amount: Number(order.total || 0),
        paymentMethod: method,
        paidAt: serverTimestamp()
      });

      transaction.set(historyDocument, {
        orderId,
        tableId,
        items: order.items || [],
        total: Number(order.total || 0),
        status: "paid",
        paymentStatus: "verified_paid",
        paymentMethod: method,
        orderedAt: order.timestamp || null,
        paidAt: serverTimestamp(),
        savedAt: serverTimestamp()
      });
    }
  });
}

// Deletes the current order for a table after payment.
export async function clearTable(tableId) {
  await deleteDoc(orderRef(tableId));
}

// Subscribes to today's collection summary.
export function listenToTodaySummary(callback, onError) {
  return onSnapshot(dailySummaryRef(), (snapshot) => {
    callback(snapshot.exists() ? snapshot.data() : { total: 0 });
  }, onError);
}

// Loads recent paid order history for one table.
export async function fetchTableHistory(tableId, maxRows = 20) {
  const historyQuery = query(
    collection(db, "tableHistory", tableId, "orders"),
    orderBy("paidAt", "desc"),
    limit(maxRows)
  );
  const snapshot = await getDocs(historyQuery);
  return snapshot.docs.map((historyDoc) => ({ id: historyDoc.id, ...historyDoc.data() }));
}

// Builds a today's report from saved paid history across all configured tables.
export async function fetchTodayReport() {
  const todayKey = getTodayKey();
  const histories = await Promise.all(CONFIG.TABLES.map((tableId) => fetchTableHistory(tableId, 100)));
  const paidOrders = histories.flat().filter((order) => {
    const paidAt = toDate(order.paidAt);
    return paidAt && getTodayKey(paidAt) === todayKey;
  });

  const report = {
    date: todayKey,
    orders: paidOrders.length,
    total: 0,
    cash: 0,
    online: 0,
    items: []
  };
  const itemMap = new Map();

  paidOrders.forEach((order) => {
    const total = Number(order.total || 0);
    const method = order.paymentMethod === "online" ? "online" : "cash";
    report.total += total;
    report[method] += total;

    (order.items || []).forEach((item) => {
      const key = `${item.name}|${item.price}`;
      const current = itemMap.get(key) || { name: item.name, price: Number(item.price || 0), qty: 0, total: 0 };
      current.qty += Number(item.qty || 0);
      current.total += Number(item.price || 0) * Number(item.qty || 0);
      itemMap.set(key, current);
    });
  });

  report.items = [...itemMap.values()].sort((a, b) => b.total - a.total);
  return report;
}

// Builds the QR service URL for the current UPI payment details.
export function buildUpiQrUrl(tableId, total) {
  const upiString = buildUpiString(tableId, total);
  return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(upiString)}`;
}

// Builds the universal UPI intent string used by Paytm, Google Pay, PhonePe, and BHIM.
export function buildUpiString(tableId, total) {
  return `upi://pay?${buildUpiQuery(tableId, total)}`;
}

// Builds app-specific payment links plus a universal UPI fallback.
export function buildPaymentLinks(tableId, total) {
  const query = buildUpiQuery(tableId, total);
  return {
    upi: `upi://pay?${query}`,
    googlePay: `tez://upi/pay?${query}`,
    paytm: `paytmmp://pay?${query}`
  };
}

// Encodes common UPI payment parameters for QR and app links.
function buildUpiQuery(tableId, total) {
  return new URLSearchParams({
    pa: CONFIG.UPI_ID,
    pn: CONFIG.UPI_NAME,
    am: String(Number(total || 0)),
    cu: "INR",
    tn: `Order_${tableId}`
  }).toString();
}

// Registers the service worker when the browser supports it.
export function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {
        console.warn("Service worker registration failed");
      });
    });
  }
}

// Displays a short floating message.
export function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 250);
  }, 2200);
}
