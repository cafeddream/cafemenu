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

Step 3b: In Firebase Authentication, enable Email/Password and create a staff user
(email + strong password). Never put the password in this repo (especially if public on GitHub).
Staff sign in on admin/kitchen pages only. Deploy firestore.rules from this repo.

Step 4: Upload all files to GitHub and enable GitHub Pages for the repository.

Step 5: Generate QR codes for each table URL, such as:
https://yourname.github.io/your-repo/index.html?table=T1
Print one QR code per table.
*/

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  addDoc,
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

export const MENU_CACHE_KEY = "cafe_menu_cache_v1";

export const CONFIG = {
  GOOGLE_SHEET_CSV_URL: "PASTE_YOUR_SHEET_CSV_URL_HERE",
  UPI_ID: "paytmqr6xusep@ptys",
  UPI_NAME: "Cafe D Dream",
  RESTAURANT_NAME: "Cafe D Dream",
  KITCHEN_TIMER_MINUTES: 20,
  TABLES: ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10", "T11", "T12", "T13", "T14", "T15"],
  FIREBASE: {
    apiKey: "AIzaSyCTooPUmZqPwPWF_GUB_bI_7ULIYqE_PU8",
    authDomain: "cafe-d-dream.firebaseapp.com",
    projectId: "cafe-d-dream",
    storageBucket: "cafe-d-dream.firebasestorage.app",
    messagingSenderId: "499445996197",
    appId: "1:499445996197:web:8c9dd05edebb267072cb4c",
    measurementId: "G-X72457ZL05"
  }
};

const app = initializeApp(CONFIG.FIREBASE);
export const auth = getAuth(app);
export const db = getFirestore(app);

export function getKitchenTimerSeconds() {
  return Math.max(1, Number(CONFIG.KITCHEN_TIMER_MINUTES || 20)) * 60;
}

export const STATUS_LABELS = {
  new: "New Order",
  preparing: "Preparing",
  served: "Served - Pending Payment",
  paid: "Paid"
};

export const ACTIVE_ORDER_STATUSES = ["new", "preparing", "served", "paid"];

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

export const KITCHEN_ORDER_TIMER_SECONDS = getKitchenTimerSeconds();
const KITCHEN_TIMER_GREEN = [25, 163, 91];
const KITCHEN_TIMER_AMBER = [232, 163, 23];
const KITCHEN_TIMER_RED = [215, 51, 51];

function lerpChannel(start, end, amount) {
  return Math.round(start + (end - start) * amount);
}

function rgbString([r, g, b]) {
  return `rgb(${r}, ${g}, ${b})`;
}

function blendRgb(start, end, amount) {
  return rgbString([
    lerpChannel(start[0], end[0], amount),
    lerpChannel(start[1], end[1], amount),
    lerpChannel(start[2], end[2], amount)
  ]);
}

// Maps elapsed time on a 20-minute kitchen timer to a green -> amber -> red color.
export function kitchenTimerColor(progress) {
  const clamped = Math.min(1, Math.max(0, progress));
  if (clamped < 0.75) {
    return blendRgb(KITCHEN_TIMER_GREEN, KITCHEN_TIMER_AMBER, clamped / 0.75);
  }
  return blendRgb(KITCHEN_TIMER_AMBER, KITCHEN_TIMER_RED, (clamped - 0.75) / 0.25);
}

// Returns countdown, progress, and color state for one kitchen order timer.
export function getKitchenTimerState(timestamp) {
  const date = toDate(timestamp);
  const totalSec = getKitchenTimerSeconds();

  if (!date) {
    return {
      elapsedSec: 0,
      remainingSec: totalSec,
      progress: 0,
      remainingFraction: 1,
      color: kitchenTimerColor(0),
      urgent: false,
      expired: false
    };
  }

  const elapsedSec = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  const remainingSec = Math.max(0, totalSec - elapsedSec);
  const progress = Math.min(1, elapsedSec / totalSec);

  return {
    elapsedSec,
    remainingSec,
    progress,
    remainingFraction: remainingSec / totalSec,
    color: kitchenTimerColor(progress),
    urgent: remainingSec > 0 && remainingSec <= 5 * 60,
    expired: remainingSec === 0
  };
}

// Formats remaining kitchen timer seconds as M:SS.
export function formatKitchenTimer(remainingSec) {
  const minutes = Math.floor(remainingSec / 60);
  const seconds = remainingSec % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
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

// Normalizes Indian mobile numbers to the final 10 digits used for lookup.
export function normalizeIndianMobile(value) {
  const digits = String(value || "").replace(/\D/g, "");
  const withoutCountry = digits.length > 10 && digits.startsWith("91")
    ? digits.slice(2)
    : digits;
  const mobile = withoutCountry.slice(-10);
  return /^[6-9]\d{9}$/.test(mobile) ? mobile : "";
}

export function maskMobile(value) {
  const mobile = normalizeIndianMobile(value);
  return mobile ? `${mobile.slice(0, 2)}******${mobile.slice(-2)}` : "";
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

function readMenuCache() {
  try {
    const raw = localStorage.getItem(MENU_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.items)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeMenuCache(items) {
  try {
    localStorage.setItem(MENU_CACHE_KEY, JSON.stringify({
      items,
      savedAt: Date.now()
    }));
  } catch {
    // Storage may be unavailable in private mode.
  }
}

// Returns when the cached menu was last saved, if any.
export function getMenuCacheSavedAt() {
  return readMenuCache()?.savedAt || null;
}

// Fetches menu data from Google Sheets, with localStorage fallback when offline.
export async function fetchMenu() {
  const url = CONFIG.GOOGLE_SHEET_CSV_URL;
  const isPlaceholder = !url || url.includes("PASTE_YOUR_SHEET_CSV_URL_HERE");
  const fetchUrl = isPlaceholder ? "./sample-menu.csv" : url;

  try {
    const response = await fetch(fetchUrl, { cache: "no-store" });
    if (!response.ok) throw new Error("Menu request failed");
    const items = parseMenuCsv(await response.text());
    writeMenuCache(items);
    return items;
  } catch (error) {
    const cached = readMenuCache();
    if (cached?.items?.length) return cached.items;
    throw error;
  }
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

// Writes one staff audit log entry.
export async function logAuditEntry(action, tableId, details = {}) {
  await addDoc(collection(db, "auditLog"), {
    action,
    tableId: tableId || null,
    details,
    staffUid: auth.currentUser?.uid || null,
    createdAt: serverTimestamp()
  });
}

// Places a new order or appends to the current unpaid order for a table.
export async function placeOrAppendOrder(tableId, cartItems, placedBy = "customer", customerProfile = null) {
  const cleanItems = cartItems
    .filter((item) => item.qty > 0)
    .map((item) => ({ name: item.name, price: Number(item.price), qty: Number(item.qty) }));

  if (!cleanItems.length) return null;

  const cleanProfile = customerProfile && placedBy === "customer"
    ? {
        customerName: String(customerProfile.name || "").trim().slice(0, 60),
        customerMobile: normalizeIndianMobile(customerProfile.mobile),
        customerMobileNormalized: normalizeIndianMobile(customerProfile.mobile)
      }
    : {};

  const ref = orderRef(tableId);
  const newOrderId = createOrderId(tableId);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    let items = cleanItems;
    let status = "new";
    let timestamp = serverTimestamp();
    let orderId = newOrderId;
    let paymentStatus = "pending";
    let preferredPaymentMethod = null;

    if (snapshot.exists()) {
      const current = snapshot.data();
      if (current.status && current.status !== "paid") {
        items = mergeItems(current.items || [], cleanItems);
        status = current.status === "new" ? "new" : current.status;
        timestamp = current.timestamp || serverTimestamp();
        orderId = current.orderId || newOrderId;
        paymentStatus = current.paymentStatus || paymentStatus;
        preferredPaymentMethod = current.preferredPaymentMethod || preferredPaymentMethod;
      }
    }

    transaction.set(ref, {
      orderId,
      tableId,
      items,
      total: calculateTotal(items),
      status,
      placedBy,
      paymentStatus,
      preferredPaymentMethod,
      timestamp,
      updatedAt: serverTimestamp(),
      ...cleanProfile
    });
  });

  if (placedBy === "counter") {
    await logAuditEntry("order_placed", tableId, { placedBy });
  }

  return getDoc(ref);
}

// Finds live/current orders for a customer mobile across configured tables.
export async function findActiveOrdersByMobile(mobile) {
  const normalized = normalizeIndianMobile(mobile);
  if (!normalized) return [];

  const snapshots = await Promise.all(CONFIG.TABLES.map((tableId) => getDoc(orderRef(tableId))));
  return snapshots
    .filter((snapshot) => snapshot.exists())
    .map((snapshot, index) => ({ id: CONFIG.TABLES[index], ...snapshot.data() }))
    .filter((order) => (
      ACTIVE_ORDER_STATUSES.includes(order.status || "new")
      && order.customerMobileNormalized === normalized
    ));
}

// Cancels the current table order (staff only).
export async function cancelOrder(tableId) {
  const snapshot = await getDoc(orderRef(tableId));
  if (!snapshot.exists()) return;
  await deleteDoc(orderRef(tableId));
  await logAuditEntry("order_cancelled", tableId, {
    orderId: snapshot.data().orderId || null,
    total: snapshot.data().total || 0
  });
}

// Resets a customer payment claim so staff can re-verify.
export async function rejectPaymentClaim(tableId) {
  await updateDoc(orderRef(tableId), {
    paymentStatus: "pending",
    preferredPaymentMethod: null,
    paymentClaimedAt: null,
    cashRequestedAt: null,
    updatedAt: serverTimestamp()
  });
  await logAuditEntry("payment_claim_rejected", tableId);
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

async function recordOrderPayment(tableId, paymentMethod = "cash", nextStatus = "paid") {
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
      status: nextStatus,
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
        placedBy: order.placedBy || "customer",
        customerName: order.customerName || null,
        customerMobile: order.customerMobile || null,
        customerMobileNormalized: order.customerMobileNormalized || null,
        paymentStatus: "verified_paid",
        paymentMethod: method,
        orderedAt: order.timestamp || null,
        paidAt: serverTimestamp(),
        savedAt: serverTimestamp()
      });
    }
  });

  await logAuditEntry("order_paid", tableId, { paymentMethod: method });
}

// Verifies payment and releases the order to the kitchen without completing the table.
export async function verifyOrderPayment(tableId, paymentMethod = "online") {
  await recordOrderPayment(tableId, paymentMethod, "new");
}

// Marks an order as paid and updates the daily collection only once per order/day.
export async function markOrderPaid(tableId, paymentMethod = "cash") {
  await recordOrderPayment(tableId, paymentMethod, "paid");
}

// Deletes the current order for a table after payment.
export async function clearTable(tableId) {
  await deleteDoc(orderRef(tableId));
  await logAuditEntry("table_cleared", tableId);
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

// Aggregates paid orders into a sales report for one or more date keys (YYYY-MM-DD).
export function buildReportFromOrders(paidOrders, startKey, endKey) {
  const report = {
    startDate: startKey,
    endDate: endKey,
    orders: paidOrders.length,
    total: 0,
    cash: 0,
    online: 0,
    counter: 0,
    customer: 0,
    items: []
  };
  const itemMap = new Map();

  paidOrders.forEach((order) => {
    const total = Number(order.total || 0);
    const method = order.paymentMethod === "online" ? "online" : "cash";
    report.total += total;
    report[method] += total;
    if (order.placedBy === "counter") report.counter += 1;
    else report.customer += 1;

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

// Loads paid orders between two local date keys inclusive.
export async function fetchReportForDateRange(startKey, endKey) {
  const histories = await Promise.all(CONFIG.TABLES.map((tableId) => fetchTableHistory(tableId, 200)));
  const paidOrders = histories.flat().filter((order) => {
    const paidAt = toDate(order.paidAt);
    if (!paidAt) return false;
    const key = getTodayKey(paidAt);
    return key >= startKey && key <= endKey;
  });
  return buildReportFromOrders(paidOrders, startKey, endKey);
}

// Builds a today's report from saved paid history across all configured tables.
export async function fetchTodayReport() {
  const todayKey = getTodayKey();
  return fetchReportForDateRange(todayKey, todayKey);
}

// Converts a report object to CSV text for download.
export function reportToCsv(report) {
  const lines = [
    `Report,${report.startDate},to,${report.endDate}`,
    `Total,${report.total}`,
    `Cash,${report.cash}`,
    `Online,${report.online}`,
    `Bills,${report.orders}`,
    `Counter orders,${report.counter}`,
    `Customer orders,${report.customer}`,
    "",
    "Item,Price,Qty,Line Total"
  ];

  report.items.forEach((item) => {
    lines.push(`"${String(item.name).replaceAll('"', '""')}",${item.price},${item.qty},${item.total}`);
  });

  return `${lines.join("\n")}\n`;
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
    paytm: `paytmmp://pay?${query}`,
    phonePe: `phonepe://pay?${query}`
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

// Turns Firebase/Firestore errors into short user-facing text.
export function getFirebaseErrorMessage(error) {
  const code = error?.code || "";
  if (code === "permission-denied") {
    return "Permission denied. Deploy firestore.rules from this project to Firebase.";
  }
  if (code === "unavailable") {
    return "Firestore is offline or unreachable. Check internet connection.";
  }
  if (code === "auth/invalid-api-key" || code === "auth/api-key-not-valid") {
    return "Invalid Firebase API key. Update CONFIG.FIREBASE from Firebase Console.";
  }
  if (code.includes("api-key")) {
    return "Firebase API key problem. Check Google Cloud Credentials for this project.";
  }
  return error?.message || "Unknown error. Please refresh and try again.";
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
