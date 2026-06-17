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
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

export const MENU_CACHE_KEY = "cafe_menu_cache_v1";

export const CONFIG = {
  GOOGLE_SHEET_CSV_URL: "PASTE_YOUR_SHEET_CSV_URL_HERE",
  UPI_ID: "paytmqr6xusep@ptys",
  UPI_NAME: "RAMAN",
  RESTAURANT_NAME: "Cafe D Dream",
  KITCHEN_TIMER_MINUTES: 20,
  AUTO_PRINT_RECEIPTS: false,
  AUTO_SHARE_RECEIPTS: true,
  PRINTER_CONFIG: {
    name: "MPT-II",
    baudRate: 115200,
    allowedBluetoothServiceClassIds: [
      "e7810a71-73ae-499d-8c15-faa9aaf9843d",
      "49535343-fe7d-4ae5-8fa9-9fdfcf3e0c83"
    ]
  },
  RECEIPT_LOGO_SRC: "./assets/receipt-logo.png",
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbzfnFgCldbHh1_IQDrYaWgrc4nBEPJ9Pbh6b1DSqz4sLfWzMm5t9zdgGhTlhVKyxtzOAQ/exec",
  PRIVATE_SITTINGS: [
    { id: "PS 1", ratePerHour: 150, theme: "ps-green" },
    { id: "PS 2", ratePerHour: 150, theme: "ps-green" },
    { id: "PS 3", ratePerHour: 150, theme: "ps-green" },
    { id: "PS 4", ratePerHour: 200, theme: "ps-gold" },
    { id: "PS 5", ratePerHour: 200, theme: "ps-gold" },
    { id: "PS 6", ratePerHour: 200, theme: "ps-gold" },
    { id: "PS 7", ratePerHour: 300, theme: "ps-purple" },
    { id: "PS 8", ratePerHour: 400, theme: "ps-pink" },
    { id: "PS 9", ratePerHour: 400, theme: "ps-pink" },
    { id: "PS 10", ratePerHour: 500, theme: "ps-ruby", wide: true }
  ],
  TABLE_SECTIONS: [
    { id: "private-sitting", name: "Private Sitting", tables: ["PS 1", "PS 2", "PS 3", "PS 4", "PS 5", "PS 6", "PS 7", "PS 8", "PS 9", "PS 10"] },
    { id: "party-hall", name: "Party Hall", tables: ["COUNTER", "H 1", "H 2", "H 3", "H 4", "HUT"] },
    { id: "tatoo-studio", name: "Tatoo Studio", tables: ["T 1", "T 2", "T 3", "T 4"] },
    { id: "hotel", name: "Hotel", tables: ["D 1", "D 2", "D 3", "D 4", "D 5", "D 6", "D 7", "D 8", "D 9", "D 10"] }
  ],
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

CONFIG.TABLES = CONFIG.TABLE_SECTIONS.flatMap((section) => section.tables);
CONFIG.ORDER_SECTIONS = CONFIG.TABLE_SECTIONS.filter((section) => section.id !== "private-sitting");

const app = initializeApp(CONFIG.FIREBASE);
export const auth = getAuth(app);
export const db = getFirestore(app);

export function getKitchenTimerSeconds() {
  return Math.max(1, Number(CONFIG.KITCHEN_TIMER_MINUTES || 20)) * 60;
}

export const STATUS_LABELS = {
  new: "New Order",
  preparing: "Preparing",
  served: "Served",
  paid: "Paid"
};

export const ACTIVE_ORDER_STATUSES = ["new", "preparing", "served", "paid"];

// Returns the valid Firestore document reference for one table's active order.
export function orderRef(tableId) {
  return doc(db, "orders", tableId, "current", "order");
}

// Returns the canonical active order document. Billing is keyed by Order ID.
export function activeOrderRef(orderId) {
  return doc(db, "activeOrders", orderId);
}

export function receiptRef(orderId) {
  return doc(db, "receipts", orderId);
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

export function privateSessionRef(sessionId) {
  return doc(db, "privateSessions", sessionId);
}

function createPrivateSessionId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `ps-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getPrivateSittingConfig(sittingId) {
  return CONFIG.PRIVATE_SITTINGS.find((sitting) => sitting.id === sittingId) || null;
}

export function buildCustomerDisplayName(customers = []) {
  const names = customers.map((customer) => String(customer?.name || "").trim()).filter(Boolean);
  if (names.length >= 2) return `${names[0]} & ${names[1]}`;
  return names[0] || "Guests";
}

export function calculateSittingBill(checkInAt, ratePerHour, checkOutAt = new Date()) {
  const checkInMs = checkInAt?.toMillis?.() || Number(checkInAt) || Date.now();
  const checkOutMs = checkOutAt?.toMillis?.() || Number(checkOutAt) || Date.now();
  const durationMinutes = Math.max(0, Math.ceil((checkOutMs - checkInMs) / 60000));
  const rate = Number(ratePerHour || 0);
  const slabAmount = Math.ceil((rate / 4) / 10) * 10;
  const extraMinutes = Math.max(0, durationMinutes - 60);
  const extraSlabs = extraMinutes > 0 ? Math.ceil(extraMinutes / 15) : 0;
  const billedAmount = rate + (extraSlabs * slabAmount);

  return {
    durationMinutes,
    billedMinutes: Math.max(60, durationMinutes),
    billedAmount,
    extraSlabs,
    slabAmount
  };
}

export function filterSessionFoodOrders(orders = [], sessionId, tableId) {
  return orders.filter((order) => (
    order.tableId === tableId
    && order.paymentStatus === "session_hold"
    && order.privateSessionId === sessionId
  ));
}

export async function placePrivateSittingFoodOrder(tableId, sessionId, cartItems) {
  const cleanItems = cleanOrderItems(cartItems);

  if (!cleanItems.length) return null;

  const newOrderId = createOrderId(tableId);
  const ref = activeOrderRef(newOrderId);
  const legacyRef = orderRef(tableId);
  const data = {
    orderId: newOrderId,
    tableId,
    privateSessionId: sessionId,
    items: cleanItems,
    total: calculateTotal(cleanItems),
    status: "new",
    placedBy: "counter",
    paymentStatus: "session_hold",
    preferredPaymentMethod: null,
    timestamp: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  await runTransaction(db, async (transaction) => {
    transaction.set(ref, data);
    transaction.set(legacyRef, data);
  });

  await logAuditEntry("ps_food_order", tableId, {
    placedBy: "counter",
    orderId: newOrderId,
    sessionId,
    total: data.total
  });

  return getDoc(ref);
}

export async function recordSittingPayment(sessionId, amount, paymentMethod = "cash", discount = null) {
  const method = paymentMethod === "online" ? "online" : "cash";
  const paymentDocument = doc(db, "dailySummaries", getTodayKey(), "payments", `sitting-${sessionId}`);
  const summaryDocument = dailySummaryRef();
  const discountInfo = computeDiscount(amount, discount);
  const finalAmount = discountInfo.finalTotal;

  await runTransaction(db, async (transaction) => {
    const paymentSnapshot = await transaction.get(paymentDocument);
    if (paymentSnapshot.exists()) return;

    transaction.set(summaryDocument, {
      date: getTodayKey(),
      total: increment(finalAmount),
      grossTotal: increment(discountInfo.grossTotal),
      discountTotal: increment(discountInfo.discountAmount),
      cash: increment(method === "cash" ? finalAmount : 0),
      online: increment(method === "online" ? finalAmount : 0),
      privateSittings: increment(1),
      privateSittingTotal: increment(finalAmount),
      updatedAt: serverTimestamp()
    }, { merge: true });

    transaction.set(paymentDocument, {
      sessionId,
      amount: finalAmount,
      grossTotal: discountInfo.grossTotal,
      discountAmount: discountInfo.discountAmount,
      paymentMethod: method,
      type: "private_sitting",
      paidAt: serverTimestamp()
    });
  });

  await logAuditEntry("sitting_paid", null, {
    sessionId,
    amount: finalAmount,
    grossTotal: discountInfo.grossTotal,
    discountAmount: discountInfo.discountAmount,
    paymentMethod: method
  });
}

export async function createPrivateSession(payload) {
  const sessionId = createPrivateSessionId();
  const ref = privateSessionRef(sessionId);
  await setDoc(ref, {
    sessionId,
    sittingId: payload.sittingId,
    mobile: payload.mobile,
    customers: payload.customers,
    displayName: payload.displayName,
    ratePerHour: payload.ratePerHour,
    status: "active",
    checkInAt: serverTimestamp(),
    sheetSynced: false,
    createdBy: auth.currentUser?.uid || null,
    createdAt: serverTimestamp()
  });
  return sessionId;
}

export async function updatePrivateSession(sessionId, data) {
  await updateDoc(privateSessionRef(sessionId), {
    ...data,
    updatedAt: serverTimestamp()
  });
}

export async function completePrivateSession(sessionId, checkoutData) {
  await updateDoc(privateSessionRef(sessionId), {
    ...checkoutData,
    status: "completed",
    checkOutAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

export function listenToActivePrivateSessions(callback, onError) {
  const sessionsQuery = query(
    collection(db, "privateSessions"),
    where("status", "==", "active")
  );
  return onSnapshot(sessionsQuery, (snapshot) => {
    callback(snapshot.docs.map((sessionDoc) => ({ id: sessionDoc.id, ...sessionDoc.data() })));
  }, onError);
}

export function listenToPrivateSessions(callback, onError) {
  return onSnapshot(collection(db, "privateSessions"), (snapshot) => {
    callback(snapshot.docs.map((sessionDoc) => ({ id: sessionDoc.id, ...sessionDoc.data() })));
  }, onError);
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

// Normalizes a discount input into gross/discount/final amounts.
// discount = { type: "amount" | "percent", value: number }
export function computeDiscount(grossTotal, discount = null) {
  const gross = Math.max(0, Math.round(Number(grossTotal || 0)));
  let type = "amount";
  let value = 0;
  if (discount && typeof discount === "object") {
    type = discount.type === "percent" ? "percent" : "amount";
    value = Math.max(0, Number(discount.value || 0));
  }

  let discountAmount = 0;
  if (type === "percent") {
    value = Math.min(100, value);
    discountAmount = Math.round((gross * value) / 100);
  } else {
    discountAmount = Math.round(value);
  }
  discountAmount = Math.max(0, Math.min(gross, discountAmount));

  return {
    grossTotal: gross,
    discountType: type,
    discountValue: value,
    discountAmount,
    finalTotal: Math.max(0, gross - discountAmount)
  };
}

function cleanOrderItems(items = []) {
  return items
    .filter((item) => item.qty > 0)
    .map((item, index) => ({
      itemId: item.itemId || `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
      name: item.name,
      price: Number(item.price),
      qty: Number(item.qty),
      status: item.status === "served" ? "served" : "pending"
    }));
}

function normalizeOrderItems(items = []) {
  return items
    .filter((item) => Number(item.qty || 0) > 0)
    .map((item, index) => ({
      itemId: item.itemId || `${item.name || "item"}-${item.price || 0}-${index}`,
      name: item.name,
      price: Number(item.price || 0),
      qty: Number(item.qty || 0),
      status: item.status === "served" ? "served" : "pending",
      servedAt: item.servedAt || null
    }));
}

function getPendingItems(items = []) {
  return normalizeOrderItems(items).filter((item) => item.status !== "served");
}

function getOrderServingStatus(items = []) {
  return getPendingItems(items).length ? "preparing" : "served";
}

function createReceiptNumber(orderId) {
  return `R-${String(orderId || createOrderId("ORD")).slice(0, 8).toUpperCase()}`;
}

function createReceiptPayload(order, paymentMethod, discountInfo = null) {
  const items = normalizeOrderItems(order.items || []);
  const grossTotal = calculateTotal(items);
  const discount = discountInfo || computeDiscount(grossTotal, null);
  const total = discount.finalTotal;
  const orderId = order.orderId;
  return {
    receiptNumber: order.receiptNumber || createReceiptNumber(orderId),
    orderId,
    tableId: order.tableId,
    cafeName: CONFIG.RESTAURANT_NAME,
    logoSrc: CONFIG.RECEIPT_LOGO_SRC,
    items,
    total,
    subtotal: grossTotal,
    grossTotal,
    discountAmount: discount.discountAmount,
    discountType: discount.discountType,
    discountValue: discount.discountValue,
    paymentMethod: paymentMethod === "online" ? "Online" : "Cash",
    paymentStatus: "Verified",
    generatedAt: serverTimestamp()
  };
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

// Places a new independent order. Table ID is only a location/grouping label.
export async function placeOrAppendOrder(tableId, cartItems, placedBy = "customer", customerProfile = null) {
  const cleanItems = cleanOrderItems(cartItems);

  if (!cleanItems.length) return null;

  const cleanProfile = customerProfile && placedBy === "customer"
    ? {
        customerName: String(customerProfile.name || "").trim().slice(0, 60),
        customerMobile: normalizeIndianMobile(customerProfile.mobile),
        customerMobileNormalized: normalizeIndianMobile(customerProfile.mobile)
      }
    : {};

  const newOrderId = createOrderId(tableId);
  const ref = activeOrderRef(newOrderId);
  const legacyRef = orderRef(tableId);
  const data = {
      orderId: newOrderId,
      tableId,
      items: cleanItems,
      total: calculateTotal(cleanItems),
      status: "new",
      placedBy,
      paymentStatus: "pending",
      preferredPaymentMethod: null,
      timestamp: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...cleanProfile
    };

  await runTransaction(db, async (transaction) => {
    transaction.set(ref, data);
    transaction.set(legacyRef, data);
  });

  if (placedBy === "counter") {
    await logAuditEntry("order_placed", tableId, { placedBy, orderId: newOrderId, total: data.total });
  }

  return getDoc(ref);
}

// Places a counter order only after staff chooses a payment method.
export async function placeCounterOrderWithPayment(tableId, cartItems, paymentMethod = "cash", discount = null) {
  const cleanItems = cleanOrderItems(cartItems);

  if (!cleanItems.length) return null;

  const method = paymentMethod === "online" ? "online" : "cash";
  const newOrderId = createOrderId(tableId);
  const orderDocument = activeOrderRef(newOrderId);
  const legacyDocument = orderRef(tableId);
  const summaryDocument = dailySummaryRef();
  let orderIdForAudit = newOrderId;
  let discountForAudit = null;

  await runTransaction(db, async (transaction) => {
    const grossDue = calculateTotal(cleanItems);
    const discountInfo = computeDiscount(grossDue, discount);
    const amountDue = discountInfo.finalTotal;
    const paymentDocument = paymentRef(newOrderId);
    const historyDocument = tableHistoryOrderRef(tableId, newOrderId);
    const receiptDocument = receiptRef(newOrderId);
    const paymentSnapshot = await transaction.get(paymentDocument);
    orderIdForAudit = newOrderId;
    discountForAudit = discountInfo;
    const orderData = {
      orderId: newOrderId,
      tableId,
      items: cleanItems,
      total: amountDue,
      grossTotal: discountInfo.grossTotal,
      discountType: discountInfo.discountType,
      discountValue: discountInfo.discountValue,
      discountAmount: discountInfo.discountAmount,
      finalTotal: amountDue,
      status: "preparing",
      placedBy: "counter",
      paymentStatus: "verified_paid",
      preferredPaymentMethod: method,
      paymentMethod: method,
      timestamp: serverTimestamp(),
      paidAt: serverTimestamp(),
      kitchenStartedAt: serverTimestamp(),
      paidTotal: amountDue,
      paidItems: cleanItems,
      updatedAt: serverTimestamp()
    };

    transaction.set(orderDocument, orderData);
    transaction.set(legacyDocument, orderData);

    if (!paymentSnapshot.exists()) {
      const receipt = createReceiptPayload(orderData, method, discountInfo);
      transaction.set(summaryDocument, {
        date: getTodayKey(),
        total: increment(amountDue),
        grossTotal: increment(discountInfo.grossTotal),
        discountTotal: increment(discountInfo.discountAmount),
        cash: increment(method === "cash" ? amountDue : 0),
        online: increment(method === "online" ? amountDue : 0),
        foodOrders: increment(1),
        updatedAt: serverTimestamp()
      }, { merge: true });

      transaction.set(paymentDocument, {
        orderId: newOrderId,
        tableId,
        amount: amountDue,
        grossTotal: discountInfo.grossTotal,
        discountAmount: discountInfo.discountAmount,
        paymentMethod: method,
        type: "food_order",
        paidAt: serverTimestamp()
      });

      transaction.set(receiptDocument, receipt);

      transaction.set(historyDocument, {
        orderId: newOrderId,
        tableId,
        items: cleanItems,
        total: amountDue,
        grossTotal: discountInfo.grossTotal,
        discountType: discountInfo.discountType,
        discountValue: discountInfo.discountValue,
        discountAmount: discountInfo.discountAmount,
        finalTotal: amountDue,
        status: "paid",
        placedBy: "counter",
        customerName: null,
        customerMobile: null,
        customerMobileNormalized: null,
        paymentStatus: "verified_paid",
        paymentMethod: method,
        orderedAt: orderData.timestamp,
        paidAt: serverTimestamp(),
        receiptNumber: receipt.receiptNumber,
        savedAt: serverTimestamp()
      });
    }
  });

  await logAuditEntry("counter_order_paid", tableId, {
    orderId: orderIdForAudit,
    total: discountForAudit?.finalTotal ?? 0,
    grossTotal: discountForAudit?.grossTotal ?? null,
    discountAmount: discountForAudit?.discountAmount ?? 0,
    paymentMethod: method
  });

  return getDoc(orderDocument);
}

// Finds live/current orders for a customer mobile across configured tables.
export async function findActiveOrdersByMobile(mobile) {
  const normalized = normalizeIndianMobile(mobile);
  if (!normalized) return [];

  const snapshot = await getDocs(collection(db, "activeOrders"));
  return snapshot.docs
    .map((orderDoc) => ({ id: orderDoc.id, ...orderDoc.data() }))
    .filter((order) => (
      ACTIVE_ORDER_STATUSES.includes(order.status || "new")
      && order.customerMobileNormalized === normalized
    ));
}

// Cancels the current table order (staff only).
export async function cancelOrder(tableId) {
  const snapshot = await getDoc(orderRef(tableId));
  if (!snapshot.exists()) return false;
  const status = snapshot.data().status || "new";
  if (status === "served" || status === "paid") return false;

  await deleteDoc(orderRef(tableId));
  await logAuditEntry("order_cancelled", tableId, {
    orderId: snapshot.data().orderId || null,
    total: snapshot.data().total || 0
  });
  return true;
}

export async function cancelActiveOrder(orderId) {
  const snapshot = await getDoc(activeOrderRef(orderId));
  if (!snapshot.exists()) return false;
  const order = snapshot.data();
  const status = order.status || "new";
  if (status === "served" || status === "paid") return false;
  const wasPaid = order.paymentStatus === "verified_paid";
  await deleteDoc(activeOrderRef(orderId));
  await logAuditEntry("order_cancelled", order.tableId, {
    orderId,
    total: order.total || 0,
    paymentStatus: order.paymentStatus || "pending",
    wasPaid,
    discountAmount: order.discountAmount || 0
  });
  return true;
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

export async function rejectActivePaymentClaim(orderId) {
  const snapshot = await getDoc(activeOrderRef(orderId));
  if (!snapshot.exists()) return;
  await updateDoc(activeOrderRef(orderId), {
    paymentStatus: "pending",
    preferredPaymentMethod: null,
    paymentClaimedAt: null,
    cashRequestedAt: null,
    updatedAt: serverTimestamp()
  });
  await logAuditEntry("payment_claim_rejected", snapshot.data().tableId, { orderId });
}

// Subscribes to a table's current order and returns the unsubscribe function.
export function listenToOrder(tableId, callback, onError) {
  return onSnapshot(orderRef(tableId), (snapshot) => {
    callback(snapshot.exists() ? { id: tableId, ...snapshot.data() } : null);
  }, onError);
}

export function listenToActiveOrder(orderId, callback, onError) {
  return onSnapshot(activeOrderRef(orderId), (snapshot) => {
    callback(snapshot.exists() ? { id: orderId, ...snapshot.data() } : null);
  }, onError);
}

export function listenToActiveOrders(callback, onError) {
  return onSnapshot(collection(db, "activeOrders"), (snapshot) => {
    callback(snapshot.docs.map((orderDoc) => ({ id: orderDoc.id, ...orderDoc.data() })));
  }, onError);
}

// Updates one order status in Firestore.
export async function updateOrderStatus(tableId, status) {
  await updateDoc(orderRef(tableId), {
    status,
    updatedAt: serverTimestamp()
  });
}

export async function updateActiveOrderStatus(orderId, status) {
  await updateDoc(activeOrderRef(orderId), {
    status,
    updatedAt: serverTimestamp()
  });
}

export async function markOrderItemsServed(orderId, servedItemIds = []) {
  const servedSet = new Set(servedItemIds);
  const ref = activeOrderRef(orderId);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) return;
    const order = snapshot.data();
    const items = normalizeOrderItems(order.items || []).map((item) => (
      servedSet.has(item.itemId)
        ? { ...item, status: "served", servedAt: new Date() }
        : item
    ));
    transaction.update(ref, {
      items,
      status: getOrderServingStatus(items),
      updatedAt: serverTimestamp()
    });
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

export async function claimActiveOrderPaymentDone(orderId) {
  await updateDoc(activeOrderRef(orderId), {
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

async function recordOrderPayment(orderId, paymentMethod = "cash", nextStatus = "paid", discount = null) {
  const orderDocument = activeOrderRef(orderId);
  const summaryDocument = dailySummaryRef();
  const method = paymentMethod === "online" ? "online" : "cash";
  let tableId = null;
  let discountInfo = null;

  await runTransaction(db, async (transaction) => {
    const orderSnapshot = await transaction.get(orderDocument);
    if (!orderSnapshot.exists()) return;

    const order = orderSnapshot.data();
    tableId = order.tableId;
    const currentOrderId = order.orderId || orderId;
    const payableItems = normalizeOrderItems(order.items || []);
    const grossDue = calculateTotal(payableItems);
    discountInfo = computeDiscount(grossDue, discount);
    const amountDue = discountInfo.finalTotal;
    const paymentDocument = paymentRef(currentOrderId);
    const historyDocument = tableHistoryOrderRef(tableId, currentOrderId);
    const receiptDocument = receiptRef(currentOrderId);
    const paymentSnapshot = await transaction.get(paymentDocument);
    const receipt = createReceiptPayload(
      { ...order, orderId: currentOrderId, items: payableItems, total: amountDue },
      method,
      discountInfo
    );

    transaction.update(orderDocument, {
      status: nextStatus,
      paymentStatus: "verified_paid",
      paymentMethod: method,
      paidAt: serverTimestamp(),
      kitchenStartedAt: serverTimestamp(),
      items: payableItems,
      total: amountDue,
      grossTotal: discountInfo.grossTotal,
      discountType: discountInfo.discountType,
      discountValue: discountInfo.discountValue,
      discountAmount: discountInfo.discountAmount,
      finalTotal: amountDue,
      paidTotal: amountDue,
      paidItems: payableItems,
      receiptNumber: receipt.receiptNumber,
      paymentClaimedAt: null,
      updatedAt: serverTimestamp()
    });

    if (!paymentSnapshot.exists()) {
      transaction.set(summaryDocument, {
        date: getTodayKey(),
        total: increment(amountDue),
        grossTotal: increment(discountInfo.grossTotal),
        discountTotal: increment(discountInfo.discountAmount),
        cash: increment(method === "cash" ? amountDue : 0),
        online: increment(method === "online" ? amountDue : 0),
        foodOrders: increment(1),
        updatedAt: serverTimestamp()
      }, { merge: true });

      transaction.set(paymentDocument, {
        orderId: currentOrderId,
        tableId,
        amount: amountDue,
        grossTotal: discountInfo.grossTotal,
        discountAmount: discountInfo.discountAmount,
        paymentMethod: method,
        type: "food_order",
        paidAt: serverTimestamp()
      });

      transaction.set(receiptDocument, receipt);

      transaction.set(historyDocument, {
        orderId: currentOrderId,
        tableId,
        items: payableItems,
        total: amountDue,
        grossTotal: discountInfo.grossTotal,
        discountType: discountInfo.discountType,
        discountValue: discountInfo.discountValue,
        discountAmount: discountInfo.discountAmount,
        finalTotal: amountDue,
        status: "paid",
        placedBy: order.placedBy || "customer",
        customerName: order.customerName || null,
        customerMobile: order.customerMobile || null,
        customerMobileNormalized: order.customerMobileNormalized || null,
        paymentStatus: "verified_paid",
        paymentMethod: method,
        orderedAt: order.timestamp || null,
        paidAt: serverTimestamp(),
        receiptNumber: receipt.receiptNumber,
        savedAt: serverTimestamp()
      });
    }
  });

  await logAuditEntry("order_paid", tableId, {
    orderId,
    paymentMethod: method,
    grossTotal: discountInfo?.grossTotal ?? null,
    discountAmount: discountInfo?.discountAmount ?? 0,
    finalTotal: discountInfo?.finalTotal ?? null
  });
}

// Verifies payment and releases the order to the kitchen without completing the table.
export async function verifyOrderPayment(orderId, paymentMethod = "online", discount = null) {
  await recordOrderPayment(orderId, paymentMethod, "preparing", discount);
}

// Marks an order as paid and updates the daily collection only once per order/day.
export async function markOrderPaid(orderId, paymentMethod = "cash", discount = null) {
  await recordOrderPayment(orderId, paymentMethod, "paid", discount);
}

// Deletes the current order for a table after payment.
export async function clearTable(tableId) {
  const snapshot = await getDocs(collection(db, "activeOrders"));
  const tableOrders = snapshot.docs
    .map((orderDoc) => ({ id: orderDoc.id, ...orderDoc.data() }))
    .filter((order) => order.tableId === tableId);
  const hasPendingItems = tableOrders.some((order) => getPendingItems(order.items || []).length > 0);
  if (hasPendingItems) throw new Error("Cannot clear table while items are pending.");
  await Promise.all(tableOrders.map((order) => deleteDoc(activeOrderRef(order.id || order.orderId))));
  await deleteDoc(orderRef(tableId)).catch(() => {});
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
    grossTotal: 0,
    discountTotal: 0,
    cash: 0,
    online: 0,
    counter: 0,
    customer: 0,
    items: []
  };
  const itemMap = new Map();

  paidOrders.forEach((order) => {
    const total = Number(order.total || 0);
    const gross = Number(order.grossTotal ?? total);
    const discount = Number(order.discountAmount || 0);
    const method = order.paymentMethod === "online" ? "online" : "cash";
    report.total += total;
    report.grossTotal += gross;
    report.discountTotal += discount;
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

// Lists inclusive YYYY-MM-DD date keys between two date keys.
function listDateKeys(startKey, endKey) {
  const keys = [];
  const start = new Date(`${startKey}T00:00:00`);
  const end = new Date(`${endKey}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return [startKey];
  }
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    keys.push(getTodayKey(d));
  }
  return keys;
}

// Loads paid food orders across all tables for a date range.
export async function fetchPaidFoodOrdersForDateRange(startKey, endKey, maxRows = 500) {
  const histories = await Promise.all(CONFIG.TABLES.map((tableId) => fetchTableHistory(tableId, maxRows)));
  return histories.flat()
    .filter((order) => {
      const paidAt = toDate(order.paidAt);
      if (!paidAt) return false;
      const key = getTodayKey(paidAt);
      return key >= startKey && key <= endKey;
    })
    .sort((a, b) => (toDate(b.paidAt)?.getTime() || 0) - (toDate(a.paidAt)?.getTime() || 0));
}

// Loads completed private sitting sessions checked out in a date range.
export async function fetchCompletedSittingsForDateRange(startKey, endKey) {
  const snapshot = await getDocs(collection(db, "privateSessions"));
  return snapshot.docs
    .map((sessionDoc) => ({ id: sessionDoc.id, ...sessionDoc.data() }))
    .filter((session) => {
      if (session.status !== "completed") return false;
      const checkOutAt = toDate(session.checkOutAt);
      if (!checkOutAt) return false;
      const key = getTodayKey(checkOutAt);
      return key >= startKey && key <= endKey;
    })
    .sort((a, b) => (toDate(b.checkOutAt)?.getTime() || 0) - (toDate(a.checkOutAt)?.getTime() || 0));
}

// Reads cancellation audit entries within a date range.
export async function fetchCancellationsForDateRange(startKey, endKey) {
  const summary = {
    cancelledWithPaymentCount: 0,
    cancelledWithPaymentAmount: 0,
    cancelledWithoutPaymentCount: 0,
    cancelledWithoutPaymentAmount: 0,
    details: []
  };

  try {
    const cancelQuery = query(collection(db, "auditLog"), where("action", "==", "order_cancelled"));
    const snapshot = await getDocs(cancelQuery);
    snapshot.docs.forEach((entry) => {
      const data = entry.data();
      const createdAt = toDate(data.createdAt);
      if (!createdAt) return;
      const key = getTodayKey(createdAt);
      if (key < startKey || key > endKey) return;
      const details = data.details || {};
      const amount = Number(details.total || 0);
      const wasPaid = Boolean(details.wasPaid);
      const row = {
        date: key,
        time: createdAt.toLocaleString(),
        tableId: data.tableId || "",
        orderId: details.orderId || "",
        amount,
        wasPaid
      };
      summary.details.push(row);
      if (wasPaid) {
        summary.cancelledWithPaymentCount += 1;
        summary.cancelledWithPaymentAmount += amount;
      } else {
        summary.cancelledWithoutPaymentCount += 1;
        summary.cancelledWithoutPaymentAmount += amount;
      }
    });
  } catch {
    // Audit log may be unavailable; report still renders without cancellations.
  }

  summary.details.sort((a, b) => String(b.time).localeCompare(String(a.time)));
  return summary;
}

// Reads aggregated daily summary docs across a date range.
export async function fetchDailySummaries(startKey, endKey) {
  const keys = listDateKeys(startKey, endKey);
  const docs = await Promise.all(keys.map((key) => getDoc(dailySummaryRef(key))));
  const totals = {
    total: 0,
    grossTotal: 0,
    discountTotal: 0,
    cash: 0,
    online: 0,
    privateSittings: 0,
    privateSittingTotal: 0,
    foodOrders: 0
  };
  docs.forEach((snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    totals.total += Number(data.total || 0);
    totals.grossTotal += Number(data.grossTotal || data.total || 0);
    totals.discountTotal += Number(data.discountTotal || 0);
    totals.cash += Number(data.cash || 0);
    totals.online += Number(data.online || 0);
    totals.privateSittings += Number(data.privateSittings || 0);
    totals.privateSittingTotal += Number(data.privateSittingTotal || 0);
    totals.foodOrders += Number(data.foodOrders || 0);
  });
  return totals;
}

// Builds a complete day-wise business report (no table selection required).
export async function fetchDayWiseReport(startKey, endKey) {
  const [foodOrders, sittings, cancellations] = await Promise.all([
    fetchPaidFoodOrdersForDateRange(startKey, endKey),
    fetchCompletedSittingsForDateRange(startKey, endKey),
    fetchCancellationsForDateRange(startKey, endKey)
  ]);

  const itemsReport = buildReportFromOrders(foodOrders, startKey, endKey);
  const foodSaleTotal = foodOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const foodGrossTotal = foodOrders.reduce((sum, order) => sum + Number(order.grossTotal ?? order.total ?? 0), 0);
  const foodDiscountTotal = foodOrders.reduce((sum, order) => sum + Number(order.discountAmount || 0), 0);
  const sittingSaleTotal = sittings.reduce((sum, session) => sum + Number(session.grandTotal ?? session.billedAmount ?? 0), 0);
  const sittingGrossTotal = sittings.reduce((sum, session) => sum + Number(session.grossTotal ?? session.grandTotal ?? session.billedAmount ?? 0), 0);
  const sittingDiscountTotal = sittings.reduce((sum, session) => sum + Number(session.discountAmount || 0), 0);

  const foodCash = foodOrders
    .filter((order) => order.paymentMethod !== "online")
    .reduce((sum, order) => sum + Number(order.total || 0), 0);
  const foodOnline = foodOrders
    .filter((order) => order.paymentMethod === "online")
    .reduce((sum, order) => sum + Number(order.total || 0), 0);
  const sittingCash = sittings
    .filter((session) => session.paymentMethod !== "online")
    .reduce((sum, session) => sum + Number(session.grandTotal ?? session.billedAmount ?? 0), 0);
  const sittingOnline = sittings
    .filter((session) => session.paymentMethod === "online")
    .reduce((sum, session) => sum + Number(session.grandTotal ?? session.billedAmount ?? 0), 0);

  const grossTotal = foodGrossTotal + sittingGrossTotal;
  const discountTotal = foodDiscountTotal + sittingDiscountTotal;
  const total = foodSaleTotal + sittingSaleTotal;

  return {
    startDate: startKey,
    endDate: endKey,
    total,
    grossTotal,
    discountTotal,
    cash: foodCash + sittingCash,
    online: foodOnline + sittingOnline,
    foodOrders: foodOrders.length,
    foodSaleTotal,
    privateSittings: sittings.length,
    privateSittingTotal: sittingSaleTotal,
    totalOrders: foodOrders.length + sittings.length,
    cancelledWithPaymentCount: cancellations.cancelledWithPaymentCount,
    cancelledWithPaymentAmount: cancellations.cancelledWithPaymentAmount,
    cancelledWithoutPaymentCount: cancellations.cancelledWithoutPaymentCount,
    cancelledWithoutPaymentAmount: cancellations.cancelledWithoutPaymentAmount,
    items: itemsReport.items,
    foodOrderDetails: foodOrders,
    sittingDetails: sittings,
    cancellationDetails: cancellations.details
  };
}

// Builds a today's report from saved paid history across all configured tables.
export async function fetchTodayReport() {
  const todayKey = getTodayKey();
  return fetchReportForDateRange(todayKey, todayKey);
}

export async function fetchReceipt(orderId) {
  const snapshot = await getDoc(receiptRef(orderId));
  return snapshot.exists() ? { id: orderId, ...snapshot.data() } : null;
}

export function formatTableDisplayName(tableId) {
  const raw = String(tableId || "").trim();
  if (!raw.includes(" ")) return raw;
  const parts = raw.split(/\s+/);
  if (parts.length === 2 && /^\d+$/.test(parts[1])) {
    return `${parts[0]}${parts[1]}`;
  }
  return raw.replace(/\s+/g, "");
}

export function formatReceiptTableLine(tableId) {
  return `Table: ${formatTableDisplayName(tableId)}`;
}

export function toWhatsAppPhone(mobile) {
  const normalized = normalizeIndianMobile(mobile);
  if (normalized) return `91${normalized}`;
  const digits = String(mobile || "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  return null;
}

export function buildWhatsAppDirectUrl(mobile, text = "") {
  const phone = toWhatsAppPhone(mobile);
  if (!phone) return null;
  const base = `https://wa.me/${phone}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

export function buildPrivateSittingCheckoutReceipt(draft, method, discountInfo = null) {
  const session = draft?.session || {};
  const sitting = draft?.sitting || {};
  const durationMinutes = Number(sitting.durationMinutes || 0);
  const sittingLine = {
    name: `Private Sitting (${durationMinutes} min)`,
    qty: 1,
    price: Number(draft?.sittingAmount || 0)
  };
  const foodItems = [];
  (draft?.foodOrders || []).forEach((order) => {
    (order.items || []).forEach((item) => {
      foodItems.push({
        name: item.name,
        qty: Number(item.qty || 0),
        price: Number(item.price || 0)
      });
    });
  });
  const items = [sittingLine, ...foodItems];
  const grossTotal = Number(discountInfo?.grossTotal ?? draft?.grandTotal ?? 0);
  const discountAmount = Number(discountInfo?.discountAmount || 0);
  const finalTotal = Number(discountInfo?.finalTotal ?? draft?.grandTotal ?? grossTotal);
  const sessionId = draft?.sessionId || session.sessionId || session.id || "";
  return {
    receiptNumber: `PS-${String(sessionId).slice(0, 8).toUpperCase()}`,
    orderId: sessionId,
    tableId: session.sittingId || "",
    cafeName: CONFIG.RESTAURANT_NAME,
    logoSrc: CONFIG.RECEIPT_LOGO_SRC,
    items,
    total: finalTotal,
    subtotal: grossTotal,
    grossTotal,
    discountAmount,
    tax: 0,
    paymentMethod: method === "online" ? "Online" : "Cash",
    paymentStatus: "Verified",
    generatedAt: new Date()
  };
}

export function buildReceiptFromOrder(order, paymentMethod = "cash") {
  const items = normalizeOrderItems(order?.items || []);
  const total = Number(order?.total ?? calculateTotal(items));
  const grossTotal = Number(order?.grossTotal ?? total);
  const discountAmount = Number(order?.discountAmount || 0);
  const orderId = order?.orderId || order?.id || "";
  const method = paymentMethod === "online" ? "online" : "cash";
  return {
    receiptNumber: order?.receiptNumber || createReceiptNumber(orderId),
    orderId,
    tableId: order?.tableId || "",
    cafeName: CONFIG.RESTAURANT_NAME,
    logoSrc: CONFIG.RECEIPT_LOGO_SRC,
    items,
    total,
    subtotal: grossTotal,
    grossTotal,
    discountAmount,
    tax: 0,
    paymentMethod: method === "online" ? "Online" : "Cash",
    paymentStatus: order?.paymentStatus === "verified_paid" ? "Verified" : "Pending",
    generatedAt: new Date()
  };
}

export function receiptToThermalHtml(receipt) {
  if (!receipt) return "";
  const generated = toDate(receipt.generatedAt) || new Date();
  const tableLine = formatReceiptTableLine(receipt.tableId);
  const orderShort = String(receipt.orderId || "").slice(0, 8).toUpperCase();
  const discountAmount = Number(receipt.discountAmount || 0);
  const subtotal = Number(receipt.subtotal ?? receipt.grossTotal ?? receipt.total ?? 0);
  const tax = Number(receipt.tax || 0);
  const grandTotal = Number(receipt.total ?? subtotal + tax - discountAmount);
  const rows = (receipt.items || []).map((item) => {
    const qty = Number(item.qty || 0);
    const price = Number(item.price || 0);
    const lineTotal = price * qty;
    return `
    <tr>
      <td class="receipt-item-name">${escapeHtml(item.name)}</td>
      <td class="receipt-qty">${qty}</td>
      <td class="receipt-price">${formatCurrency(price)}</td>
      <td class="receipt-line-total">${formatCurrency(lineTotal)}</td>
    </tr>
  `;
  }).join("");
  return `
    <section class="thermal-receipt">
      <img class="receipt-logo" src="${escapeHtml(receipt.logoSrc || CONFIG.RECEIPT_LOGO_SRC)}" alt="${escapeHtml(receipt.cafeName || CONFIG.RESTAURANT_NAME)} logo">
      <h1>${escapeHtml(receipt.cafeName || CONFIG.RESTAURANT_NAME)}</h1>
      <p class="receipt-meta">Order: ${escapeHtml(orderShort)}</p>
      <p class="receipt-meta">Receipt: ${escapeHtml(receipt.receiptNumber || "")}</p>
      <p class="receipt-meta">${escapeHtml(generated.toLocaleString())}</p>
      <p class="receipt-meta">${escapeHtml(tableLine)}</p>
      <hr>
      <table class="receipt-items">
        <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <hr>
      <p class="receipt-total"><span>Subtotal</span><strong>${formatCurrency(subtotal)}</strong></p>
      ${discountAmount > 0 ? `<p class="receipt-total"><span>Discount</span><strong>-${formatCurrency(discountAmount)}</strong></p>` : ""}
      ${tax > 0 ? `<p class="receipt-total"><span>Tax</span><strong>${formatCurrency(tax)}</strong></p>` : ""}
      <p class="receipt-total receipt-grand-total"><span>Grand Total</span><strong>${formatCurrency(grandTotal)}</strong></p>
      <p class="receipt-meta">Payment: ${escapeHtml(receipt.paymentMethod || "")}</p>
      <p class="receipt-meta">Status: ${escapeHtml(receipt.paymentStatus || "Verified")}</p>
      <hr>
      <p class="receipt-thanks">Thank You<br>Visit Again</p>
    </section>
  `;
}

export function downloadReceiptHtml(receipt) {
  const html = buildReceiptDocumentHtml(receipt);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${receipt.receiptNumber || receipt.orderId}.html`;
  link.click();
  URL.revokeObjectURL(url);
}

export function buildReceiptDocumentHtml(receipt) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(receipt?.receiptNumber || "Receipt")}</title>
  <style>
    @page { size: 58mm auto; margin: 0; }
    html, body { margin: 0; padding: 0; width: 58mm; color: #000; background: #fff; }
    body { font-family: "Courier New", Courier, monospace; font-size: 11px; line-height: 1.25; }
    .thermal-receipt { width: 52mm; margin: 0 auto; padding: 2mm 0; }
    .receipt-logo { display: block; width: 28mm; max-height: 22mm; object-fit: contain; filter: grayscale(1) contrast(1.4); margin: 0 auto 4px; }
    h1 { font-size: 14px; text-align: center; margin: 0 0 4px; font-weight: 700; }
    .receipt-meta { margin: 2px 0; font-size: 10px; }
    hr { border: 0; border-top: 1px dashed #000; margin: 5px 0; }
    .receipt-items { width: 100%; border-collapse: collapse; font-size: 10px; }
    .receipt-items th, .receipt-items td { padding: 2px 0; vertical-align: top; }
    .receipt-item-name { text-align: left; max-width: 24mm; word-break: break-word; }
    .receipt-qty { text-align: center; width: 7mm; }
    .receipt-price, .receipt-line-total { text-align: right; width: 12mm; }
    .receipt-total { display: flex; justify-content: space-between; gap: 4px; font-size: 11px; margin: 2px 0; }
    .receipt-grand-total { font-size: 12px; font-weight: 700; }
    .receipt-thanks { text-align: center; font-weight: 700; margin-top: 4px; }
    @media print {
      html, body { margin: 0 !important; padding: 0 !important; }
    }
  </style>
</head>
<body>${receiptToThermalHtml(receipt)}</body>
</html>`;
}

// Converts a report object to CSV text for download.
export function reportToCsv(report) {
  const lines = [
    `Report,${report.startDate},to,${report.endDate}`,
    `Gross Sale,${report.grossTotal ?? report.total}`,
    `Discount Given,${report.discountTotal ?? 0}`,
    `Net Collection,${report.total}`,
    `Food Sales,${report.foodSaleTotal ?? 0}`,
    `Food Orders,${report.foodOrders ?? 0}`,
    `Private Sitting Sales,${report.privateSittingTotal ?? 0}`,
    `Private Sittings,${report.privateSittings ?? 0}`,
    `Total Orders,${report.totalOrders ?? report.orders ?? 0}`,
    `Cancelled With Payment Count,${report.cancelledWithPaymentCount ?? 0}`,
    `Cancelled With Payment Amount,${report.cancelledWithPaymentAmount ?? 0}`,
    `Cancelled Without Payment Count,${report.cancelledWithoutPaymentCount ?? 0}`,
    `Cancelled Without Payment Amount,${report.cancelledWithoutPaymentAmount ?? 0}`,
    "",
    "Item,Price,Qty,Line Total"
  ];

  (report.items || []).forEach((item) => {
    lines.push(`"${String(item.name).replaceAll('"', '""')}",${item.price},${item.qty},${item.total}`);
  });

  return `${lines.join("\n")}\n`;
}

// Builds the QR service URL for the current UPI payment details.
export function buildUpiQrUrl(tableId, total, orderId = tableId) {
  const upiString = buildUpiString(tableId, total, orderId);
  return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(upiString)}`;
}

// Builds the universal UPI intent string used by Paytm, Google Pay, PhonePe, and BHIM.
export function buildUpiString(tableId, total, orderId = tableId) {
  return `upi://pay?${buildUpiQuery(tableId, total, orderId)}`;
}

// Builds app-specific payment links plus a universal UPI fallback.
export function buildPaymentLinks(tableId, total, orderId = tableId) {
  const query = buildUpiQuery(tableId, total, orderId);
  return {
    upi: `upi://pay?${query}`,
    googlePay: `tez://upi/pay?${query}`,
    paytm: `paytmmp://pay?${query}`,
    phonePe: `phonepe://pay?${query}`
  };
}

// Encodes common UPI payment parameters for QR and app links.
function buildUpiQuery(tableId, total, orderId = tableId) {
  return new URLSearchParams({
    pa: CONFIG.UPI_ID,
    pn: CONFIG.UPI_NAME,
    am: String(Number(total || 0)),
    cu: "INR"
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

export function showRichToast(title, lines = []) {
  const toast = document.createElement("div");
  toast.className = "toast rich-toast";
  const detailLines = lines
    .filter((line) => line !== null && line !== undefined && String(line).trim())
    .map((line) => `<span>${escapeHtml(line)}</span>`)
    .join("");
  toast.innerHTML = `
    <strong><span aria-hidden="true">&#128276;</span> ${escapeHtml(title)}</strong>
    ${detailLines ? `<div>${detailLines}</div>` : ""}
  `;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 250);
  }, 3200);
}
