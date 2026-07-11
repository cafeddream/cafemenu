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
Staff manage table and counter orders from admin.html; kitchen uses kitchen.html.
*/

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
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
  Timestamp,
  updateDoc,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

export const MENU_CACHE_KEY = "cafe_menu_cache_v1";

export const CONFIG = {
  GOOGLE_SHEET_CSV_URL: "PASTE_YOUR_SHEET_CSV_URL_HERE",
  UPI_ID: "paytmqr6xusep@ptys",
  UPI_NAME: "RAMAN",
  RESTAURANT_NAME: "Cafe D Dream",
  KITCHEN_TIMER_MINUTES: 20,
  AUTO_PRINT_RECEIPTS: false,
  AUTO_SHARE_RECEIPTS: false,
  PRINTER_CONFIG: {
    name: "MPT-II",
    baudRate: 115200,
    allowedBluetoothServiceClassIds: [
      "e7810a71-73ae-499d-8c15-faa9aaf9843d",
      "49535343-fe7d-4ae5-8fa9-9fdfcf3e0c83"
    ]
  },
  RECEIPT_LOGO_SRC: "./assets/receipt-logo.png",
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbxyUGP3kohv-GZH5GDOcmd6vpW-cwW2MmVjqY8F5uUfR3h4szcLpjuC6tDFj8ocdQu2Bw/exec",
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

const DEFAULT_PRIVATE_SITTINGS = JSON.parse(JSON.stringify(CONFIG.PRIVATE_SITTINGS));
const DEFAULT_TABLE_SECTIONS = JSON.parse(JSON.stringify(CONFIG.TABLE_SECTIONS));
const DEFAULT_ALLOWED_TABLES = CONFIG.TABLES.slice();

const ADMIN_UNLOCK_KEY = "cafe_admin_unlock_until";
const ADMIN_UNLOCK_MS = 30 * 60 * 1000;
const ADMIN_COOLDOWN_KEY = "cafe_admin_pin_cooldown_until";
const ADMIN_FAILURES_KEY = "cafe_admin_pin_failures";
const ADMIN_MAX_PIN_FAILURES = 5;
const ADMIN_COOLDOWN_MS = 2 * 60 * 1000;

let runtimeConfigData = null;
let runtimeUnsubscribe = null;
const runtimeConfigListeners = new Set();

function notifyRuntimeConfigListeners() {
  runtimeConfigListeners.forEach((listener) => {
    try {
      listener(runtimeConfigData);
    } catch (error) {
      console.warn("Runtime config listener failed:", error);
    }
  });
}

function rebuildConfigTables() {
  const sections = getTableSections();
  CONFIG.TABLE_SECTIONS = sections.map((section) => ({
    ...section,
    tables: [...(section.tables || [])]
  }));
  CONFIG.TABLES = CONFIG.TABLE_SECTIONS.flatMap((section) => section.tables);
  CONFIG.ORDER_SECTIONS = CONFIG.TABLE_SECTIONS.filter((section) => section.id !== "private-sitting");
}

export function getPrivateSittings() {
  return runtimeConfigData?.privateSittings?.length
    ? runtimeConfigData.privateSittings
    : DEFAULT_PRIVATE_SITTINGS;
}

function mergeTableSectionsWithDefaults(raw) {
  const sections = Array.isArray(raw) && raw.length ? raw : DEFAULT_TABLE_SECTIONS;
  const hasDineInSections = sections.some((section) => (
    section.id === "party-hall" || section.id === "tatoo-studio" || section.id === "hotel"
  ));
  if (hasDineInSections) return sections;

  const privateSitting = sections.find((section) => section.id === "private-sitting")
    || DEFAULT_TABLE_SECTIONS.find((section) => section.id === "private-sitting");
  const dineInSections = DEFAULT_TABLE_SECTIONS.filter((section) => section.id !== "private-sitting");
  return [privateSitting, ...dineInSections].filter(Boolean);
}

export function getTableSections() {
  const raw = runtimeConfigData?.tableSections?.length
    ? runtimeConfigData.tableSections
    : DEFAULT_TABLE_SECTIONS;
  return mergeTableSectionsWithDefaults(raw);
}

export function getAllowedTables() {
  if (Array.isArray(runtimeConfigData?.allowedTables) && runtimeConfigData.allowedTables.length) {
    return runtimeConfigData.allowedTables;
  }
  return getTableSections().flatMap((section) => section.tables);
}

async function seedRuntimeConfig() {
  await setDoc(doc(db, "appConfig", "runtime"), {
    privateSittings: DEFAULT_PRIVATE_SITTINGS,
    tableSections: DEFAULT_TABLE_SECTIONS,
    allowedTables: DEFAULT_ALLOWED_TABLES,
    updatedAt: serverTimestamp(),
    updatedBy: auth.currentUser?.email || ""
  }, { merge: true });
}

export async function loadRuntimeConfig() {
  const runtimeRef = doc(db, "appConfig", "runtime");
  const snapshot = await getDoc(runtimeRef);
  if (!snapshot.exists()) {
    if (auth.currentUser) {
      await seedRuntimeConfig();
      const seeded = await getDoc(runtimeRef);
      runtimeConfigData = seeded.exists() ? seeded.data() : null;
    } else {
      runtimeConfigData = null;
    }
  } else {
    runtimeConfigData = snapshot.data();
  }
  rebuildConfigTables();
  notifyRuntimeConfigListeners();
  return runtimeConfigData;
}

export function subscribeRuntimeConfig(listener) {
  if (typeof listener === "function") {
    runtimeConfigListeners.add(listener);
    if (runtimeConfigData) listener(runtimeConfigData);
  }

  if (!runtimeUnsubscribe) {
    runtimeUnsubscribe = onSnapshot(doc(db, "appConfig", "runtime"), (snapshot) => {
      runtimeConfigData = snapshot.exists() ? snapshot.data() : null;
      rebuildConfigTables();
      notifyRuntimeConfigListeners();
    }, (error) => {
      console.warn("Runtime config subscription failed:", error);
    });
  }

  return () => {
    if (typeof listener === "function") {
      runtimeConfigListeners.delete(listener);
    }
  };
}

async function saveRuntimeConfig(payload) {
  await setDoc(doc(db, "appConfig", "runtime"), {
    ...payload,
    updatedAt: serverTimestamp(),
    updatedBy: auth.currentUser?.email || ""
  }, { merge: true });
}

function menuItemSlug(category, name) {
  const base = `${category}-${name}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return base || `item-${Date.now()}`;
}

async function hashSecurityPin(pin) {
  const bytes = new TextEncoder().encode(String(pin));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function getPinFailureCount() {
  return Number(sessionStorage.getItem(ADMIN_FAILURES_KEY) || 0);
}

function recordPinFailure() {
  const failures = getPinFailureCount() + 1;
  sessionStorage.setItem(ADMIN_FAILURES_KEY, String(failures));
  if (failures >= ADMIN_MAX_PIN_FAILURES) {
    sessionStorage.setItem(ADMIN_COOLDOWN_KEY, String(Date.now() + ADMIN_COOLDOWN_MS));
    sessionStorage.setItem(ADMIN_FAILURES_KEY, "0");
  }
}

function clearPinFailures() {
  sessionStorage.removeItem(ADMIN_FAILURES_KEY);
  sessionStorage.removeItem(ADMIN_COOLDOWN_KEY);
}

export function isPinCooldownActive() {
  const until = Number(sessionStorage.getItem(ADMIN_COOLDOWN_KEY) || 0);
  if (!until) return false;
  if (Date.now() < until) return true;
  sessionStorage.removeItem(ADMIN_COOLDOWN_KEY);
  return false;
}

export function getPinCooldownRemainingMs() {
  const until = Number(sessionStorage.getItem(ADMIN_COOLDOWN_KEY) || 0);
  return Math.max(0, until - Date.now());
}

export function isAdminSettingsUnlocked() {
  const until = Number(sessionStorage.getItem(ADMIN_UNLOCK_KEY) || 0);
  if (!until) return false;
  if (Date.now() < until) return true;
  sessionStorage.removeItem(ADMIN_UNLOCK_KEY);
  return false;
}

export function unlockAdminSettings() {
  sessionStorage.setItem(ADMIN_UNLOCK_KEY, String(Date.now() + ADMIN_UNLOCK_MS));
}

export function lockAdminSettings() {
  sessionStorage.removeItem(ADMIN_UNLOCK_KEY);
}

export async function getSecurityConfig() {
  try {
    const snapshot = await getDoc(doc(db, "appConfig", "security"));
    return snapshot.exists() ? snapshot.data() : null;
  } catch (error) {
    const code = String(error?.code || "");
    if (code === "permission-denied" || code === "unavailable") {
      console.warn("Security config unavailable:", code);
      return null;
    }
    throw error;
  }
}

export async function setSecurityPin(pin) {
  const normalized = String(pin || "").trim();
  if (!/^\d{4,8}$/.test(normalized)) {
    throw new Error("PIN must be 4 to 8 digits");
  }
  await setDoc(doc(db, "appConfig", "security"), {
    pinHash: await hashSecurityPin(normalized),
    updatedAt: serverTimestamp(),
    updatedBy: auth.currentUser?.email || ""
  }, { merge: true });
}

export async function verifySecurityPin(pin) {
  if (isPinCooldownActive()) {
    return { ok: false, reason: "cooldown" };
  }
  const config = await getSecurityConfig();
  if (!config?.pinHash) {
    return { ok: false, reason: "not_set" };
  }
  const pinHash = await hashSecurityPin(String(pin || "").trim());
  if (pinHash === config.pinHash) {
    clearPinFailures();
    unlockAdminSettings();
    return { ok: true };
  }
  recordPinFailure();
  return { ok: false, reason: "wrong" };
}

async function fetchMenuFromFirestore() {
  const snapshot = await getDocs(collection(db, "menuItems"));
  return sortMenuItems(snapshot.docs
    .map((entry) => {
      const data = entry.data();
      return {
        itemId: entry.id,
        category: data.category,
        name: data.name,
        price: Number(data.price),
        available: data.available === false ? "no" : "yes",
        sortOrder: Number(data.sortOrder || 0)
      };
    })
    .filter((item) => item.category && item.name && Number.isFinite(item.price) && item.available !== "no"));
}

function sortMenuItems(items = []) {
  return [...items].sort((left, right) => {
    const categoryCompare = String(left.category).localeCompare(String(right.category));
    if (categoryCompare !== 0) return categoryCompare;
    return Number(left.sortOrder || 0) - Number(right.sortOrder || 0);
  });
}

export function mergeMenuSources(sheetItems = [], firestoreItems = []) {
  const merged = new Map();

  sheetItems.forEach((item, index) => {
    const category = String(item.category || "").trim();
    const name = String(item.name || "").trim();
    const price = Number(item.price);
    if (!category || !name || !Number.isFinite(price)) return;
    if (String(item.available || "yes").toLowerCase() === "no") return;

    const itemId = item.itemId || menuItemSlug(category, name);
    merged.set(itemId, {
      itemId,
      category,
      name,
      price,
      available: "yes",
      sortOrder: Number(item.sortOrder ?? index)
    });
  });

  firestoreItems.forEach((item) => {
    if (!item?.itemId) return;
    merged.set(item.itemId, { ...item });
  });

  return sortMenuItems([...merged.values()]);
}

export async function fetchSheetMenu() {
  const url = CONFIG.GOOGLE_SHEET_CSV_URL;
  const isPlaceholder = !url || url.includes("PASTE_YOUR_SHEET_CSV_URL_HERE");
  const fetchUrl = isPlaceholder ? "./sample-menu.csv" : url;
  const response = await fetch(fetchUrl, { cache: "no-store" });
  if (!response.ok) throw new Error("Menu request failed");
  const items = parseMenuCsv(await response.text());
  return items.map((item, index) => ({
    itemId: menuItemSlug(item.category, item.name),
    category: item.category,
    name: item.name,
    price: Number(item.price),
    available: item.available !== "no" ? "yes" : "no",
    sortOrder: index
  }));
}

export async function listMenuItems() {
  return fetchMenuFromFirestore();
}

export async function upsertMenuItem({ itemId, category, name, price, available = true, sortOrder = 0 }) {
  const cleanCategory = String(category || "").trim();
  const cleanName = String(name || "").trim();
  const cleanPrice = Number(price);
  if (!cleanCategory || !cleanName || !Number.isFinite(cleanPrice)) {
    throw new Error("Category, name, and price are required");
  }
  const id = itemId || menuItemSlug(cleanCategory, cleanName);
  await setDoc(doc(db, "menuItems", id), {
    category: cleanCategory,
    name: cleanName,
    price: cleanPrice,
    available: available !== false,
    sortOrder: Number(sortOrder || 0),
    updatedAt: serverTimestamp()
  }, { merge: true });
  window.dispatchEvent(new CustomEvent("menu-updated"));
  return id;
}

export async function updateMenuPrice(itemId, price) {
  const cleanPrice = Number(price);
  if (!itemId || !Number.isFinite(cleanPrice)) {
    throw new Error("Valid item and price required");
  }
  await updateDoc(doc(db, "menuItems", itemId), {
    price: cleanPrice,
    updatedAt: serverTimestamp()
  });
  window.dispatchEvent(new CustomEvent("menu-updated"));
}

export async function deleteMenuItem(itemId) {
  if (!itemId) throw new Error("Item ID required");
  await deleteDoc(doc(db, "menuItems", itemId));
  window.dispatchEvent(new CustomEvent("menu-updated"));
}

export async function importMenuFromSheet() {
  const items = await fetchSheetMenu();
  const batch = writeBatch(db);
  items.forEach((item, index) => {
    batch.set(doc(db, "menuItems", item.itemId), {
      category: item.category,
      name: item.name,
      price: Number(item.price),
      available: true,
      sortOrder: index,
      updatedAt: serverTimestamp()
    });
  });
  await batch.commit();
  writeMenuCache(items);
  window.dispatchEvent(new CustomEvent("menu-updated"));
  return items.length;
}

export async function upsertPrivateSitting({ id, ratePerHour, theme = "ps-green", wide = false }) {
  const sittingId = String(id || "").trim();
  const rate = Number(ratePerHour);
  if (!sittingId || !Number.isFinite(rate)) {
    throw new Error("Sitting ID and rate are required");
  }

  const sittings = getPrivateSittings().map((sitting) => ({ ...sitting }));
  const existingIndex = sittings.findIndex((sitting) => sitting.id === sittingId);
  const entry = { id: sittingId, ratePerHour: rate, theme: theme || "ps-green" };
  if (wide) entry.wide = true;

  if (existingIndex >= 0) {
    sittings[existingIndex] = { ...sittings[existingIndex], ...entry };
  } else {
    sittings.push(entry);
  }

  const sections = getTableSections().map((section) => ({
    ...section,
    tables: [...(section.tables || [])]
  }));
  const privateSection = sections.find((section) => section.id === "private-sitting");
  if (privateSection && !privateSection.tables.includes(sittingId)) {
    privateSection.tables.push(sittingId);
  }

  await saveRuntimeConfig({
    privateSittings: sittings,
    tableSections: sections,
    allowedTables: sections.flatMap((section) => section.tables)
  });
}

export async function updateSittingRate(sittingId, ratePerHour) {
  const existing = getPrivateSittingConfig(sittingId);
  if (!existing) throw new Error("Sitting not found");
  await upsertPrivateSitting({
    id: sittingId,
    ratePerHour,
    theme: existing.theme,
    wide: Boolean(existing.wide)
  });
}

export async function deletePrivateSitting(sittingId) {
  const cleanId = String(sittingId || "").trim();
  if (!cleanId) throw new Error("Sitting ID required");

  const activeSessions = await getDocs(query(
    collection(db, "privateSessions"),
    where("sittingId", "==", cleanId),
    where("status", "==", "active")
  ));
  if (!activeSessions.empty) {
    throw new Error("Cannot delete sitting with an active session");
  }

  const sittings = getPrivateSittings().filter((sitting) => sitting.id !== cleanId);
  const sections = getTableSections().map((section) => ({
    ...section,
    tables: section.id === "private-sitting"
      ? section.tables.filter((tableId) => tableId !== cleanId)
      : [...section.tables]
  }));

  await saveRuntimeConfig({
    privateSittings: sittings,
    tableSections: sections,
    allowedTables: sections.flatMap((section) => section.tables)
  });
}

const app = initializeApp(CONFIG.FIREBASE);
export const auth = getAuth(app);
export const db = getFirestore(app);
export { serverTimestamp };

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

export function reportArchiveRef(dateKey) {
  return doc(db, "reportArchive", dateKey);
}

export async function getReportArchiveStatus(dateKey) {
  const snapshot = await getDoc(reportArchiveRef(dateKey));
  if (!snapshot.exists()) {
    return { uploaded: false, purged: false };
  }
  const data = snapshot.data();
  return {
    uploaded: Boolean(data.uploadedAt),
    purged: Boolean(data.purgedAt),
    driveFileId: data.driveFileId || null,
    summary: data.summary || null
  };
}

export async function markReportArchived(dateKey, { driveFileId, summary } = {}) {
  await setDoc(reportArchiveRef(dateKey), {
    uploadedAt: serverTimestamp(),
    driveFileId: driveFileId || null,
    summary: summary || null
  }, { merge: true });
}

export async function markReportPurged(dateKey) {
  await setDoc(reportArchiveRef(dateKey), {
    purgedAt: serverTimestamp()
  }, { merge: true });
}

export function privateSessionRef(sessionId) {
  return doc(db, "privateSessions", sessionId);
}

export function partySessionRef(partyId) {
  return doc(db, "partySessions", partyId);
}

export const PARTY_ORDER_TABLE = "HUT";

function createPartySessionId() {
  return `party-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createPrivateSessionId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `ps-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getPrivateSittingConfig(sittingId) {
  return getPrivateSittings().find((sitting) => sitting.id === sittingId) || null;
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

export function filterPartyFoodOrders(orders = [], partyId) {
  return orders.filter((order) => (
    order.paymentStatus === "session_hold"
    && order.partySessionId === partyId
  ));
}

function timestampFromDateInput(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? Timestamp.fromDate(date) : null;
}

export async function createPartyBooking(payload) {
  const partyId = createPartySessionId();
  const ref = partySessionRef(partyId);
  const scheduledStart = timestampFromDateInput(payload.scheduledStart);
  const scheduledEnd = timestampFromDateInput(payload.scheduledEnd);
  if (!scheduledStart || !scheduledEnd) {
    throw new Error("Valid schedule from/to required");
  }
  await setDoc(ref, {
    partyId,
    name: String(payload.name || "").trim(),
    gathering: Math.max(1, Math.round(Number(payload.gathering || 1))),
    ratePerHour: Math.max(1, Math.round(Number(payload.ratePerHour || 500))),
    scheduledStart,
    scheduledEnd,
    plannedItems: Array.isArray(payload.plannedItems) ? payload.plannedItems : [],
    notes: String(payload.notes || "").trim(),
    externalItems: [],
    otherCharges: [],
    orderIds: [],
    status: "booked",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return partyId;
}

export async function startPartySession(partyId, walkInPayload = null) {
  const ref = partySessionRef(partyId);
  const snap = await getDoc(ref);
  if (!snap.exists() && walkInPayload) {
    await setDoc(ref, {
      partyId,
      name: String(walkInPayload.name || "").trim(),
      gathering: Math.max(1, Math.round(Number(walkInPayload.gathering || 1))),
      ratePerHour: Math.max(1, Math.round(Number(walkInPayload.ratePerHour || 500))),
      plannedItems: [],
      notes: "",
      externalItems: [],
      otherCharges: [],
      orderIds: [],
      status: "active",
      actualStart: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    return partyId;
  }
  if (!snap.exists()) throw new Error("Party booking not found");
  const data = snap.data();
  if (data.status === "active") throw new Error("Party already active");
  if (data.status === "completed") throw new Error("Party already completed");
  await updateDoc(ref, {
    status: "active",
    actualStart: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return partyId;
}

export async function placePartyFoodOrder(partyId, cartItems) {
  const cleanItems = cleanOrderItems(cartItems);
  if (!cleanItems.length) return null;
  const tableId = PARTY_ORDER_TABLE;
  const newOrderId = createOrderId(tableId);
  const ref = activeOrderRef(newOrderId);
  const legacyRef = orderRef(tableId);
  const data = {
    orderId: newOrderId,
    tableId,
    partySessionId: partyId,
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
    transaction.update(partySessionRef(partyId), {
      orderIds: arrayUnion(newOrderId),
      updatedAt: serverTimestamp()
    });
  });
  return getDoc(ref);
}

export async function appendPartyExternalItem(partyId, item) {
  const entry = {
    name: String(item.name || "").trim(),
    qty: Math.max(1, Math.round(Number(item.qty || 1))),
    rate: Math.max(0, Math.round(Number(item.rate || 0)))
  };
  if (!entry.name) throw new Error("Item name required");
  await updateDoc(partySessionRef(partyId), {
    externalItems: arrayUnion(entry),
    updatedAt: serverTimestamp()
  });
}

export async function setPartyOtherCharges(partyId, charges = []) {
  await updateDoc(partySessionRef(partyId), {
    otherCharges: charges.map((row) => ({
      label: String(row.label || "").trim(),
      amount: Math.max(0, Math.round(Number(row.amount || 0)))
    })).filter((row) => row.label && row.amount > 0),
    updatedAt: serverTimestamp()
  });
}

export function buildPartyBillDraft(party, orders = [], checkOutAt = new Date()) {
  const hall = calculateSittingBill(party.actualStart, party.ratePerHour, checkOutAt);
  const cafeOrders = filterPartyFoodOrders(orders, party.partyId);
  const cafeFoodTotal = cafeOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const externalItems = Array.isArray(party.externalItems) ? party.externalItems : [];
  const externalFoodTotal = externalItems.reduce(
    (sum, item) => sum + (Number(item.qty || 0) * Number(item.rate || 0)),
    0
  );
  const otherCharges = Array.isArray(party.otherCharges) ? party.otherCharges : [];
  const otherChargesTotal = otherCharges.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const grossTotal = hall.billedAmount + cafeFoodTotal + externalFoodTotal + otherChargesTotal;
  return {
    hall,
    hallCharges: hall.billedAmount,
    cafeFoodTotal,
    externalFoodTotal,
    otherChargesTotal,
    grossTotal,
    cafeOrders,
    externalItems,
    otherCharges
  };
}

export async function completePartySession(partyId, checkoutData) {
  const ref = partySessionRef(partyId);
  await updateDoc(ref, {
    ...checkoutData,
    status: "completed",
    actualEnd: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

export function listenToPartySessions(callback, onError) {
  const q = query(collection(db, "partySessions"), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snapshot) => {
    callback(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
  }, onError || console.error);
}

export async function fetchActivePartySessionsOnce() {
  const q = query(collection(db, "partySessions"), where("status", "==", "active"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
}

export async function recordPartyPayment(partyId, amount, paymentMethod = "cash", discount = null, customerProfile = null) {
  const paymentDocument = doc(db, "dailySummaries", getTodayKey(), "payments", `party-${partyId}`);
  const summaryDocument = dailySummaryRef();
  const discountInfo = computeDiscount(amount, discount);
  const finalAmount = discountInfo.finalTotal;
  const payment = normalizePaymentAmounts(finalAmount, paymentMethod);
  const customerFields = payment.creditAmount > 0 && customerProfile
    ? normalizeCreditCustomer(customerProfile)
    : {};

  await runTransaction(db, async (transaction) => {
    const paymentSnapshot = await transaction.get(paymentDocument);
    if (paymentSnapshot.exists()) return;

    const summaryPatch = {
      date: getTodayKey(),
      updatedAt: serverTimestamp()
    };
    const collected = payment.cashAmount + payment.onlineAmount;
    if (collected > 0) {
      summaryPatch.total = increment(collected);
      summaryPatch.grossTotal = increment(discountInfo.grossTotal);
      summaryPatch.discountTotal = increment(discountInfo.discountAmount);
      summaryPatch.cash = increment(payment.cashAmount);
      summaryPatch.online = increment(payment.onlineAmount);
    }
    if (payment.creditAmount > 0) {
      summaryPatch.pendingTotal = increment(payment.creditAmount);
      summaryPatch.pendingOrders = increment(1);
    }
    transaction.set(summaryDocument, summaryPatch, { merge: true });

    transaction.set(paymentDocument, {
      partyId,
      amount: finalAmount,
      grossTotal: discountInfo.grossTotal,
      discountAmount: discountInfo.discountAmount,
      paymentMethod: payment.paymentMethod,
      cashAmount: payment.cashAmount,
      onlineAmount: payment.onlineAmount,
      creditAmount: payment.creditAmount || 0,
      type: "party_session",
      ...customerFields,
      paidAt: serverTimestamp()
    });
  });
}

export async function markPartyOrdersSettled(orderIds = []) {
  await Promise.all(orderIds.filter(Boolean).map(async (orderId) => {
    const ref = activeOrderRef(orderId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const order = snap.data();
    const tableId = order.tableId;
    await deleteDoc(ref);
    const legacyRef = orderRef(tableId);
    const legacySnap = await getDoc(legacyRef);
    if (legacySnap.exists() && (legacySnap.data().orderId || "") === orderId) {
      await deleteDoc(legacyRef).catch(() => {});
    }
    await logAuditEntry("party_order_cleared", tableId, { orderId });
  }));
}

export async function recordSittingPayment(sessionId, amount, paymentMethod = "cash", discount = null) {
  const paymentDocument = doc(db, "dailySummaries", getTodayKey(), "payments", `sitting-${sessionId}`);
  const summaryDocument = dailySummaryRef();
  const discountInfo = computeDiscount(amount, discount);
  const finalAmount = discountInfo.finalTotal;
  const payment = normalizePaymentAmounts(finalAmount, paymentMethod);
  const collected = payment.cashAmount + payment.onlineAmount;
  const creditAmount = payment.creditAmount || 0;

  await runTransaction(db, async (transaction) => {
    const paymentSnapshot = await transaction.get(paymentDocument);
    if (paymentSnapshot.exists()) return;

    const summaryPatch = {
      date: getTodayKey(),
      grossTotal: increment(discountInfo.grossTotal),
      discountTotal: increment(discountInfo.discountAmount),
      privateSittings: increment(1),
      privateSittingTotal: increment(finalAmount),
      updatedAt: serverTimestamp()
    };
    if (collected > 0) {
      summaryPatch.total = increment(collected);
      summaryPatch.cash = increment(payment.cashAmount);
      summaryPatch.online = increment(payment.onlineAmount);
    }
    if (creditAmount > 0) {
      summaryPatch.pendingTotal = increment(creditAmount);
      summaryPatch.pendingOrders = increment(1);
    }
    transaction.set(summaryDocument, summaryPatch, { merge: true });

    transaction.set(paymentDocument, {
      sessionId,
      amount: finalAmount,
      grossTotal: discountInfo.grossTotal,
      discountAmount: discountInfo.discountAmount,
      paymentMethod: payment.paymentMethod,
      cashAmount: payment.cashAmount,
      onlineAmount: payment.onlineAmount,
      creditAmount: payment.creditAmount || 0,
      type: "private_sitting",
      paidAt: serverTimestamp()
    });
  });

  await logAuditEntry("sitting_paid", null, {
    sessionId,
    amount: finalAmount,
    grossTotal: discountInfo.grossTotal,
    discountAmount: discountInfo.discountAmount,
    paymentMethod: payment.paymentMethod,
    cashAmount: payment.cashAmount,
    onlineAmount: payment.onlineAmount
  });
}

export async function recordSittingCreditPending(sessionId, amount, customerProfile, discount = null) {
  const paymentDocument = doc(db, "dailySummaries", getTodayKey(), "payments", `sitting-pending-${sessionId}`);
  const summaryDocument = dailySummaryRef();
  const customerFields = normalizeCreditCustomer(customerProfile);
  const discountInfo = computeDiscount(amount, discount);
  const finalAmount = discountInfo.finalTotal;

  await runTransaction(db, async (transaction) => {
    const paymentSnapshot = await transaction.get(paymentDocument);
    if (paymentSnapshot.exists()) return;

    transaction.set(summaryDocument, {
      date: getTodayKey(),
      pendingTotal: increment(finalAmount),
      pendingOrders: increment(1),
      updatedAt: serverTimestamp()
    }, { merge: true });

    transaction.set(paymentDocument, {
      sessionId,
      amount: finalAmount,
      grossTotal: discountInfo.grossTotal,
      discountAmount: discountInfo.discountAmount,
      paymentMethod: "pending",
      type: "private_sitting",
      customerName: customerFields.customerName,
      customerMobile: customerFields.customerMobile,
      customerMobileNormalized: customerFields.customerMobileNormalized,
      creditedAt: serverTimestamp()
    });
  });

  await logAuditEntry("sitting_credit_pending", null, {
    sessionId,
    amount: finalAmount,
    grossTotal: discountInfo.grossTotal,
    discountAmount: discountInfo.discountAmount,
    customerName: customerFields.customerName,
    customerMobile: customerFields.customerMobileNormalized
  });

  return {
    sessionId,
    amount: finalAmount,
    grossTotal: discountInfo.grossTotal,
    discountAmount: discountInfo.discountAmount,
    customerName: customerFields.customerName,
    customerMobile: customerFields.customerMobileNormalized
  };
}

export async function createPrivateSession(payload) {
  const sessionId = createPrivateSessionId();
  const ref = privateSessionRef(sessionId);
  await setDoc(ref, {
    sessionId,
    sittingId: payload.sittingId,
    mobile: payload.mobile,
    customers: payload.customers,
    customerPhotos: payload.customerPhotos || [],
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
    customerPhotos: deleteField(),
    photoDriveIds: deleteField(),
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

export async function fetchActivePrivateSessionsOnce() {
  const sessionsQuery = query(
    collection(db, "privateSessions"),
    where("status", "==", "active")
  );
  const snapshot = await getDocs(sessionsQuery);
  return snapshot.docs.map((sessionDoc) => ({ id: sessionDoc.id, ...sessionDoc.data() }));
}

export async function fetchActiveOrdersOnce() {
  const snapshot = await getDocs(collection(db, "activeOrders"));
  return snapshot.docs.map((orderDoc) => ({
    id: orderDoc.id,
    orderId: orderDoc.id,
    ...orderDoc.data()
  }));
}

export function listenToPrivateSessions(callback, onError) {
  return onSnapshot(collection(db, "privateSessions"), (snapshot) => {
    callback(snapshot.docs.map((sessionDoc) => ({ id: sessionDoc.id, ...sessionDoc.data() })));
  }, onError);
}

export function listenToRecentCompletedPrivateSessions(limitCount = 40, callback, onError) {
  const capped = Math.max(1, Math.min(limitCount, 100));
  const sessionsQuery = query(
    collection(db, "privateSessions"),
    where("status", "==", "completed"),
    limit(capped)
  );
  return onSnapshot(sessionsQuery, (snapshot) => {
    const sessions = snapshot.docs
      .map((sessionDoc) => ({ id: sessionDoc.id, ...sessionDoc.data() }))
      .sort((a, b) => (b.checkOutAt?.toMillis?.() || 0) - (a.checkOutAt?.toMillis?.() || 0))
      .slice(0, capped);
    callback(sessions);
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

// Fetches menu by merging Google Sheet base with Firestore admin edits.
export async function fetchMenu() {
  let sheetItems = [];
  let firestoreItems = [];

  try {
    sheetItems = await fetchSheetMenu();
  } catch (error) {
    console.warn("Sheet menu fetch failed:", error);
    const cached = readMenuCache();
    if (cached?.items?.length) {
      sheetItems = cached.items;
    }
  }

  try {
    firestoreItems = await fetchMenuFromFirestore();
  } catch (error) {
    console.warn("Firestore menu fetch failed:", error);
  }

  const merged = mergeMenuSources(sheetItems, firestoreItems);
  if (merged.length) {
    writeMenuCache(merged);
    return merged;
  }

  const cached = readMenuCache();
  if (cached?.items?.length) return cached.items;
  throw new Error("Menu unavailable");
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

// Resolves cash/online/udhaar amounts from stored order/session data (backward compatible).
export function resolvePaymentAmounts(record = {}) {
  const total = Math.round(Number(record.total ?? record.finalTotal ?? record.grandTotal ?? record.billedAmount ?? 0));
  const cashStored = record.cashAmount;
  const onlineStored = record.onlineAmount;
  const creditStored = record.creditAmount;
  if (Number.isFinite(Number(cashStored)) || Number.isFinite(Number(onlineStored)) || Number.isFinite(Number(creditStored))) {
    return {
      cashAmount: Math.round(Number(cashStored || 0)),
      onlineAmount: Math.round(Number(onlineStored || 0)),
      creditAmount: Math.round(Number(creditStored || 0))
    };
  }
  if (record.paymentMethod === "online") {
    return { cashAmount: 0, onlineAmount: total, creditAmount: 0 };
  }
  if (record.paymentMethod === "pending" || record.paymentStatus === "credit_pending") {
    return { cashAmount: 0, onlineAmount: 0, creditAmount: total };
  }
  return { cashAmount: total, onlineAmount: 0, creditAmount: 0 };
}

// Normalizes cash / online / udhaar / split payment input against a final payable total.
export function normalizePaymentAmounts(finalTotal, paymentInput = "cash") {
  const total = Math.max(0, Math.round(Number(finalTotal || 0)));
  if (paymentInput === "pending") {
    return { paymentMethod: "pending", cashAmount: 0, onlineAmount: 0, creditAmount: total };
  }
  if (paymentInput && typeof paymentInput === "object" && !Array.isArray(paymentInput)) {
    const cash = Math.max(0, Math.round(Number(paymentInput.cash ?? paymentInput.cashAmount ?? 0)));
    const online = Math.max(0, Math.round(Number(paymentInput.online ?? paymentInput.onlineAmount ?? 0)));
    const credit = Math.max(0, Math.round(Number(paymentInput.credit ?? paymentInput.creditAmount ?? paymentInput.udhaar ?? 0)));
    if (cash + online + credit !== total) {
      throw new Error(`Payment must equal ${formatCurrency(total)} (entered ${formatCurrency(cash + online + credit)})`);
    }
    if (credit === total && cash === 0 && online === 0) {
      return { paymentMethod: "pending", cashAmount: 0, onlineAmount: 0, creditAmount: credit };
    }
    let paymentMethod = "cash";
    if (credit > 0) paymentMethod = "mixed";
    else if (cash > 0 && online > 0) paymentMethod = "split";
    else if (online > 0) paymentMethod = "online";
    return { paymentMethod, cashAmount: cash, onlineAmount: online, creditAmount: credit };
  }
  const method = paymentInput === "online" ? "online" : "cash";
  return {
    paymentMethod: method,
    cashAmount: method === "cash" ? total : 0,
    onlineAmount: method === "online" ? total : 0,
    creditAmount: 0
  };
}

export function formatPaymentMethodLabel(record = {}) {
  if (record.paymentMethod === "pending" || record.paymentStatus === "credit_pending") {
    return "Udhaar";
  }
  const total = Math.round(Number(record.total ?? record.finalTotal ?? record.grandTotal ?? 0));
  const amounts = resolvePaymentAmounts({ ...record, total });
  const parts = [];
  if (amounts.cashAmount > 0) parts.push(`Cash ${formatCurrency(amounts.cashAmount)}`);
  if (amounts.onlineAmount > 0) parts.push(`Online ${formatCurrency(amounts.onlineAmount)}`);
  if (amounts.creditAmount > 0) parts.push(`Udhaar ${formatCurrency(amounts.creditAmount)}`);
  if (parts.length > 1) return parts.join(" + ");
  if (amounts.onlineAmount > 0) return "Online";
  if (amounts.creditAmount > 0) return "Udhaar";
  return "Cash";
}

// Allocates a split payment across multiple payable parts (e.g. sitting + food orders).
export function allocateSplitAcrossPayments(partAmounts, paymentInput, grandTotal = null) {
  const amounts = partAmounts.map((amount) => Math.max(0, Math.round(Number(amount || 0))));
  const total = grandTotal != null
    ? Math.max(0, Math.round(Number(grandTotal)))
    : amounts.reduce((sum, amount) => sum + amount, 0);
  const payment = normalizePaymentAmounts(total, paymentInput);
  if (!amounts.length) return [];

  const allocations = [];
  let cashAssigned = 0;
  let onlineAssigned = 0;
  let creditAssigned = 0;

  amounts.forEach((amount, index) => {
    if (index === amounts.length - 1) {
      const cashAmount = payment.cashAmount - cashAssigned;
      const onlineAmount = payment.onlineAmount - onlineAssigned;
      const creditAmount = (payment.creditAmount || 0) - creditAssigned;
      let paymentMethod = payment.paymentMethod;
      if (creditAmount > 0) paymentMethod = creditAmount === amount ? "pending" : "mixed";
      else if (cashAmount > 0 && onlineAmount > 0) paymentMethod = "split";
      else if (onlineAmount > 0) paymentMethod = "online";
      else paymentMethod = "cash";
      allocations.push({ paymentMethod, cashAmount, onlineAmount, creditAmount });
      return;
    }
    const share = total > 0 ? amount / total : 0;
    const cashAmount = Math.round(payment.cashAmount * share);
    const creditAmount = Math.round((payment.creditAmount || 0) * share);
    const onlineAmount = amount - cashAmount - creditAmount;
    let paymentMethod = "cash";
    if (creditAmount > 0) paymentMethod = creditAmount === amount ? "pending" : "mixed";
    else if (cashAmount > 0 && onlineAmount > 0) paymentMethod = "split";
    else if (onlineAmount > 0) paymentMethod = "online";
    allocations.push({ paymentMethod, cashAmount, onlineAmount, creditAmount });
    cashAssigned += cashAmount;
    onlineAssigned += onlineAmount;
    creditAssigned += creditAmount;
  });

  return allocations;
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

function createReceiptPayload(order, paymentInput, discountInfo = null) {
  const items = normalizeOrderItems(order.items || []);
  const grossTotal = calculateTotal(items);
  const discount = discountInfo || computeDiscount(grossTotal, null);
  const total = discount.finalTotal;
  const orderId = order.orderId;
  const payment = normalizePaymentAmounts(total, paymentInput ?? order.paymentMethod ?? "cash");
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
    paymentMethod: formatPaymentMethodLabel({ ...payment, total }),
    cashAmount: payment.cashAmount,
    onlineAmount: payment.onlineAmount,
    paymentMethodKey: payment.paymentMethod,
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

// Places a counter order only after staff chooses a payment method.
export async function placeCounterOrderWithPayment(tableId, cartItems, paymentMethod = "cash", discount = null, customerProfile = null) {
  const cleanItems = cleanOrderItems(cartItems);

  if (!cleanItems.length) return null;

  const customerFields = buildCounterCustomerFields(customerProfile);
  const newOrderId = createOrderId(tableId);
  const orderDocument = activeOrderRef(newOrderId);
  const legacyDocument = orderRef(tableId);
  const summaryDocument = dailySummaryRef();
  let orderIdForAudit = newOrderId;
  let discountForAudit = null;
  let paymentForAudit = null;

  await runTransaction(db, async (transaction) => {
    const grossDue = calculateTotal(cleanItems);
    const discountInfo = computeDiscount(grossDue, discount);
    const amountDue = discountInfo.finalTotal;
    const payment = normalizePaymentAmounts(amountDue, paymentMethod);
    paymentForAudit = payment;
    const creditAmount = payment.creditAmount || 0;
    const collected = payment.cashAmount + payment.onlineAmount;
    const paymentStatus = creditAmount === amountDue
      ? "credit_pending"
      : (creditAmount > 0 ? "partial_credit" : "verified_paid");
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
      paymentStatus,
      preferredPaymentMethod: payment.paymentMethod,
      paymentMethod: payment.paymentMethod,
      cashAmount: payment.cashAmount,
      onlineAmount: payment.onlineAmount,
      creditAmount,
      timestamp: serverTimestamp(),
      paidAt: serverTimestamp(),
      kitchenStartedAt: serverTimestamp(),
      paidTotal: collected,
      paidItems: cleanItems,
      updatedAt: serverTimestamp(),
      ...customerFields
    };

    transaction.set(orderDocument, orderData);
    transaction.set(legacyDocument, orderData);

    if (!paymentSnapshot.exists()) {
      const receipt = createReceiptPayload(orderData, paymentMethod, discountInfo);
      transaction.set(summaryDocument, {
        date: getTodayKey(),
        grossTotal: increment(discountInfo.grossTotal),
        discountTotal: increment(discountInfo.discountAmount),
        foodOrders: increment(1),
        ...(collected > 0 ? {
          total: increment(collected),
          cash: increment(payment.cashAmount),
          online: increment(payment.onlineAmount)
        } : {}),
        ...(creditAmount > 0 ? {
          pendingTotal: increment(creditAmount),
          pendingOrders: increment(1)
        } : {}),
        updatedAt: serverTimestamp()
      }, { merge: true });

      transaction.set(paymentDocument, {
        orderId: newOrderId,
        tableId,
        amount: amountDue,
        grossTotal: discountInfo.grossTotal,
        discountAmount: discountInfo.discountAmount,
        paymentMethod: payment.paymentMethod,
        cashAmount: payment.cashAmount,
        onlineAmount: payment.onlineAmount,
        creditAmount,
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
        customerName: customerFields.customerName,
        customerMobile: customerFields.customerMobile,
        customerMobileNormalized: customerFields.customerMobileNormalized,
        paymentStatus: "verified_paid",
        paymentMethod: payment.paymentMethod,
        cashAmount: payment.cashAmount,
        onlineAmount: payment.onlineAmount,
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
    paymentMethod: paymentForAudit?.paymentMethod ?? "cash",
    cashAmount: paymentForAudit?.cashAmount ?? 0,
    onlineAmount: paymentForAudit?.onlineAmount ?? 0
  });

  return getDoc(orderDocument);
}

export function normalizeCreditCustomer(profile = {}) {
  const name = String(profile.name || profile.customerName || "").trim();
  const mobile = normalizeIndianMobile(profile.mobile || profile.customerMobile || "");
  if (name.length < 2) {
    throw new Error("Customer name required for pending (udhaar)");
  }
  if (!mobile) {
    throw new Error("Valid 10-digit mobile required for pending (udhaar)");
  }
  return {
    customerName: name.slice(0, 60),
    customerMobile: mobile,
    customerMobileNormalized: mobile
  };
}

function buildCounterCustomerFields(customerProfile = null) {
  if (!customerProfile) {
    return {
      customerName: null,
      customerMobile: null,
      customerMobileNormalized: null
    };
  }
  const name = String(customerProfile.name || customerProfile.customerName || "").trim().slice(0, 60);
  const mobile = normalizeIndianMobile(customerProfile.mobile || customerProfile.customerMobile || "");
  if (!name && !mobile) {
    return {
      customerName: null,
      customerMobile: null,
      customerMobileNormalized: null
    };
  }
  return {
    customerName: name || null,
    customerMobile: mobile || null,
    customerMobileNormalized: mobile || null
  };
}

// Places a counter order on udhaar (credit pending) — kitchen sent, payment deferred.
export async function placeCounterOrderWithCredit(tableId, cartItems, customerProfile, discount = null) {
  const cleanItems = cleanOrderItems(cartItems);
  if (!cleanItems.length) return null;

  const customerFields = normalizeCreditCustomer(customerProfile);
  const newOrderId = createOrderId(tableId);
  const orderDocument = activeOrderRef(newOrderId);
  const legacyDocument = orderRef(tableId);
  const summaryDocument = dailySummaryRef();
  let discountForAudit = null;

  await runTransaction(db, async (transaction) => {
    const grossDue = calculateTotal(cleanItems);
    const discountInfo = computeDiscount(grossDue, discount);
    const amountDue = discountInfo.finalTotal;
    const historyDocument = tableHistoryOrderRef(tableId, newOrderId);
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
      paymentStatus: "credit_pending",
      paymentMethod: "pending",
      preferredPaymentMethod: "pending",
      timestamp: serverTimestamp(),
      creditedAt: serverTimestamp(),
      kitchenStartedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...customerFields
    };

    transaction.set(orderDocument, orderData);
    transaction.set(legacyDocument, orderData);

    transaction.set(summaryDocument, {
      date: getTodayKey(),
      pendingTotal: increment(amountDue),
      pendingOrders: increment(1),
      updatedAt: serverTimestamp()
    }, { merge: true });

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
      status: "preparing",
      placedBy: "counter",
      paymentStatus: "credit_pending",
      paymentMethod: "pending",
      orderedAt: orderData.timestamp,
      creditedAt: serverTimestamp(),
      savedAt: serverTimestamp(),
      ...customerFields
    });
  });

  await logAuditEntry("counter_order_credit", tableId, {
    orderId: newOrderId,
    total: discountForAudit?.finalTotal ?? 0,
    grossTotal: discountForAudit?.grossTotal ?? null,
    discountAmount: discountForAudit?.discountAmount ?? 0,
    customerName: customerFields.customerName,
    customerMobile: customerFields.customerMobileNormalized
  });

  return getDoc(orderDocument);
}

// Marks an existing unpaid order as udhaar (credit pending).
export async function markOrderCreditPending(orderId, customerProfile, discount = null) {
  const orderDocument = activeOrderRef(orderId);
  const summaryDocument = dailySummaryRef();
  const customerFields = normalizeCreditCustomer(customerProfile);
  let tableId = null;
  let currentOrderId = orderId;
  let discountInfo = null;
  let orderItems = [];

  await runTransaction(db, async (transaction) => {
    const orderSnapshot = await transaction.get(orderDocument);
    if (!orderSnapshot.exists()) {
      throw new Error("Order not found");
    }

    const order = orderSnapshot.data();
    if (order.paymentStatus === "verified_paid") {
      throw new Error("Paid orders cannot be marked pending");
    }
    if (order.paymentStatus === "credit_pending") {
      throw new Error("Order is already pending (udhaar)");
    }
    if (order.paymentStatus === "voided") {
      throw new Error("Voided orders cannot be marked pending");
    }

    tableId = order.tableId;
    currentOrderId = order.orderId || orderId;
    const payableItems = normalizeOrderItems(order.items || []);
    orderItems = payableItems;
    const grossDue = calculateTotal(payableItems);
    discountInfo = computeDiscount(grossDue, discount);
    const amountDue = discountInfo.finalTotal;
    const historyDocument = tableHistoryOrderRef(tableId, currentOrderId);
    const legacyDocument = orderRef(tableId);

    const updateData = {
      status: "preparing",
      paymentStatus: "credit_pending",
      paymentMethod: "pending",
      preferredPaymentMethod: "pending",
      creditedAt: serverTimestamp(),
      kitchenStartedAt: serverTimestamp(),
      items: payableItems,
      total: amountDue,
      grossTotal: discountInfo.grossTotal,
      discountType: discountInfo.discountType,
      discountValue: discountInfo.discountValue,
      discountAmount: discountInfo.discountAmount,
      finalTotal: amountDue,
      paymentClaimedAt: null,
      updatedAt: serverTimestamp(),
      ...customerFields
    };

    transaction.update(orderDocument, updateData);
    const legacySnapshot = await transaction.get(legacyDocument);
    if (legacySnapshot.exists()) {
      const legacyOrderId = legacySnapshot.data().orderId || "";
      if (!legacyOrderId || legacyOrderId === currentOrderId) {
        transaction.update(legacyDocument, updateData);
      }
    }

    transaction.set(summaryDocument, {
      date: getTodayKey(),
      pendingTotal: increment(amountDue),
      pendingOrders: increment(1),
      updatedAt: serverTimestamp()
    }, { merge: true });

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
      status: "preparing",
      placedBy: order.placedBy || "customer",
      paymentStatus: "credit_pending",
      paymentMethod: "pending",
      privateSessionId: order.privateSessionId || null,
      orderedAt: order.timestamp || null,
      creditedAt: serverTimestamp(),
      savedAt: serverTimestamp(),
      ...customerFields
    });
  });

  await logAuditEntry("order_credit_pending", tableId, {
    orderId: currentOrderId,
    grossTotal: discountInfo?.grossTotal ?? null,
    discountAmount: discountInfo?.discountAmount ?? 0,
    finalTotal: discountInfo?.finalTotal ?? null,
    customerName: customerFields.customerName,
    customerMobile: customerFields.customerMobileNormalized
  });

  return {
    orderId: currentOrderId,
    tableId,
    items: orderItems,
    total: discountInfo?.finalTotal ?? 0,
    grossTotal: discountInfo?.grossTotal ?? 0,
    discountAmount: discountInfo?.discountAmount ?? 0,
    customerName: customerFields.customerName,
    customerMobile: customerFields.customerMobileNormalized
  };
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

function normalizeVoidRemarks(remarks) {
  const clean = String(remarks || "").trim();
  if (clean.length < 3) {
    throw new Error("Enter a reason (at least 3 characters)");
  }
  return clean.slice(0, 200);
}

function buildItemsSummary(items = [], maxLen = 120) {
  const text = items
    .map((item) => `${item.name || "Item"} x${Number(item.qty || 0)}`)
    .join(", ");
  return text.length > maxLen ? `${text.slice(0, maxLen - 3)}...` : text;
}

export async function voidActiveOrder(orderId, remarks) {
  const voidRemarks = normalizeVoidRemarks(remarks);
  const snapshot = await getDoc(activeOrderRef(orderId));
  if (!snapshot.exists()) return false;

  const order = snapshot.data();
  if (order.paymentStatus === "verified_paid") {
    throw new Error("Paid orders cannot be voided");
  }
  if (order.paymentStatus === "credit_pending") {
    throw new Error("Pending (udhaar) orders cannot be voided");
  }
  if (order.paymentStatus === "voided") {
    throw new Error("Payment already voided for this order");
  }

  const tableId = order.tableId;
  const currentOrderId = order.orderId || orderId;
  const items = normalizeOrderItems(order.items || []);
  const grossTotal = calculateTotal(items);
  const updateData = {
    paymentStatus: "voided",
    voidRemarks,
    voidAmount: grossTotal,
    grossTotal,
    total: 0,
    finalTotal: 0,
    discountAmount: 0,
    discountType: "amount",
    discountValue: 0,
    status: "preparing",
    kitchenStartedAt: serverTimestamp(),
    voidedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  await updateDoc(activeOrderRef(orderId), updateData);
  await updateDoc(orderRef(tableId), updateData).catch(() => {});

  await setDoc(tableHistoryOrderRef(tableId, currentOrderId), {
    orderId: currentOrderId,
    tableId,
    items,
    total: 0,
    grossTotal,
    voidAmount: grossTotal,
    finalTotal: 0,
    discountAmount: 0,
    status: "preparing",
    paymentStatus: "voided",
    voidRemarks,
    placedBy: order.placedBy || "customer",
    customerName: order.customerName || null,
    customerMobile: order.customerMobile || null,
    customerMobileNormalized: order.customerMobileNormalized || null,
    privateSessionId: order.privateSessionId || null,
    orderedAt: order.timestamp || null,
    voidedAt: serverTimestamp(),
    savedAt: serverTimestamp()
  }, { merge: true });

  await logAuditEntry("order_voided", tableId, {
    orderId: currentOrderId,
    grossTotal,
    voidRemarks,
    placedBy: order.placedBy || "customer",
    itemsSummary: buildItemsSummary(items)
  });

  return true;
}

// Places a counter order with payment voided — kitchen still receives the order.
export async function voidPendingCounterOrder(tableId, items = [], grossTotal = 0, remarks) {
  const voidRemarks = normalizeVoidRemarks(remarks);
  const cleanItems = cleanOrderItems(items);
  if (!cleanItems.length) return null;

  const grossDue = Number(grossTotal) || calculateTotal(cleanItems);
  const newOrderId = createOrderId(tableId);
  const orderDocument = activeOrderRef(newOrderId);
  const legacyDocument = orderRef(tableId);

  await runTransaction(db, async (transaction) => {
    const orderData = {
      orderId: newOrderId,
      tableId,
      items: cleanItems,
      total: 0,
      grossTotal: grossDue,
      voidAmount: grossDue,
      finalTotal: 0,
      discountAmount: 0,
      discountType: "amount",
      discountValue: 0,
      status: "preparing",
      placedBy: "counter",
      paymentStatus: "voided",
      voidRemarks,
      timestamp: serverTimestamp(),
      kitchenStartedAt: serverTimestamp(),
      voidedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    transaction.set(orderDocument, orderData);
    transaction.set(legacyDocument, orderData);

    transaction.set(tableHistoryOrderRef(tableId, newOrderId), {
      orderId: newOrderId,
      tableId,
      items: cleanItems,
      total: 0,
      grossTotal: grossDue,
      voidAmount: grossDue,
      finalTotal: 0,
      discountAmount: 0,
      status: "preparing",
      placedBy: "counter",
      paymentStatus: "voided",
      voidRemarks,
      orderedAt: orderData.timestamp,
      voidedAt: serverTimestamp(),
      savedAt: serverTimestamp()
    });
  });

  await logAuditEntry("counter_order_voided", tableId, {
    orderId: newOrderId,
    grossTotal: grossDue,
    voidRemarks,
    itemCount: cleanItems.length,
    itemsSummary: buildItemsSummary(cleanItems)
  });

  return getDoc(orderDocument);
}

let activeOrdersSnapshot = [];
let activeOrdersUnsubscribe = null;
const activeOrdersListeners = new Set();
const activeOrdersErrorHandlers = new Set();

function notifyActiveOrdersListeners() {
  activeOrdersListeners.forEach((listener) => {
    try {
      listener(activeOrdersSnapshot);
    } catch (error) {
      console.warn("Active orders listener failed:", error);
    }
  });
}

export function subscribeActiveOrders(listener, onError) {
  if (typeof listener === "function") {
    activeOrdersListeners.add(listener);
    if (activeOrdersUnsubscribe) {
      listener(activeOrdersSnapshot);
    }
  }
  if (typeof onError === "function") {
    activeOrdersErrorHandlers.add(onError);
  }

  if (!activeOrdersUnsubscribe) {
    activeOrdersUnsubscribe = onSnapshot(collection(db, "activeOrders"), (snapshot) => {
      activeOrdersSnapshot = snapshot.docs.map((orderDoc) => ({ id: orderDoc.id, ...orderDoc.data() }));
      notifyActiveOrdersListeners();
    }, (error) => {
      activeOrdersErrorHandlers.forEach((handler) => {
        try {
          handler(error);
        } catch {
          // Ignore handler failures.
        }
      });
    });
  }

  return () => {
    if (typeof listener === "function") {
      activeOrdersListeners.delete(listener);
    }
    if (typeof onError === "function") {
      activeOrdersErrorHandlers.delete(onError);
    }
  };
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

async function recordOrderPayment(orderId, paymentMethod = "cash", nextStatus = "paid", discount = null) {
  const orderDocument = activeOrderRef(orderId);
  const summaryDocument = dailySummaryRef();
  let tableId = null;
  let discountInfo = null;
  let paymentForAudit = null;

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
    const payment = normalizePaymentAmounts(amountDue, paymentMethod);
    paymentForAudit = payment;
    const creditAmount = payment.creditAmount || 0;
    const collected = payment.cashAmount + payment.onlineAmount;
    const paymentStatus = creditAmount === amountDue
      ? "credit_pending"
      : (creditAmount > 0 ? "partial_credit" : "verified_paid");
    const paymentDocument = paymentRef(currentOrderId);
    const historyDocument = tableHistoryOrderRef(tableId, currentOrderId);
    const receiptDocument = receiptRef(currentOrderId);
    const paymentSnapshot = await transaction.get(paymentDocument);
    const receipt = createReceiptPayload(
      { ...order, orderId: currentOrderId, items: payableItems, total: amountDue },
      paymentMethod,
      discountInfo
    );

    transaction.update(orderDocument, {
      status: nextStatus,
      paymentStatus,
      paymentMethod: payment.paymentMethod,
      cashAmount: payment.cashAmount,
      onlineAmount: payment.onlineAmount,
      creditAmount,
      paidAt: serverTimestamp(),
      kitchenStartedAt: serverTimestamp(),
      items: payableItems,
      total: amountDue,
      grossTotal: discountInfo.grossTotal,
      discountType: discountInfo.discountType,
      discountValue: discountInfo.discountValue,
      discountAmount: discountInfo.discountAmount,
      finalTotal: amountDue,
      paidTotal: collected,
      paidItems: payableItems,
      receiptNumber: receipt.receiptNumber,
      paymentClaimedAt: null,
      updatedAt: serverTimestamp()
    });

    if (!paymentSnapshot.exists()) {
      const summaryPatch = {
        date: getTodayKey(),
        grossTotal: increment(discountInfo.grossTotal),
        discountTotal: increment(discountInfo.discountAmount),
        foodOrders: increment(1),
        updatedAt: serverTimestamp()
      };
      if (collected > 0) {
        summaryPatch.total = increment(collected);
        summaryPatch.cash = increment(payment.cashAmount);
        summaryPatch.online = increment(payment.onlineAmount);
      }
      if (creditAmount > 0) {
        summaryPatch.pendingTotal = increment(creditAmount);
        summaryPatch.pendingOrders = increment(1);
      }
      transaction.set(summaryDocument, summaryPatch, { merge: true });

      transaction.set(paymentDocument, {
        orderId: currentOrderId,
        tableId,
        amount: amountDue,
        grossTotal: discountInfo.grossTotal,
        discountAmount: discountInfo.discountAmount,
        paymentMethod: payment.paymentMethod,
        cashAmount: payment.cashAmount,
        onlineAmount: payment.onlineAmount,
        creditAmount,
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
        paymentStatus,
        paymentMethod: payment.paymentMethod,
        cashAmount: payment.cashAmount,
        onlineAmount: payment.onlineAmount,
        creditAmount,
        orderedAt: order.timestamp || null,
        paidAt: serverTimestamp(),
        receiptNumber: receipt.receiptNumber,
        savedAt: serverTimestamp()
      });
    }
  });

  await logAuditEntry("order_paid", tableId, {
    orderId,
    paymentMethod: paymentForAudit?.paymentMethod ?? "cash",
    cashAmount: paymentForAudit?.cashAmount ?? 0,
    onlineAmount: paymentForAudit?.onlineAmount ?? 0,
    grossTotal: discountInfo?.grossTotal ?? null,
    discountAmount: discountInfo?.discountAmount ?? 0,
    finalTotal: discountInfo?.finalTotal ?? null
  });
}

// Resets a customer payment claim on an active order so staff can re-verify.
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

// Verifies payment and releases the order to the kitchen without completing the table.
export async function verifyOrderPayment(orderId, paymentMethod = "online", discount = null) {
  await recordOrderPayment(orderId, paymentMethod, "preparing", discount);
}

// Marks an order as paid and updates the daily collection only once per order/day.
export async function markOrderPaid(orderId, paymentMethod = "cash", discount = null) {
  await recordOrderPayment(orderId, paymentMethod, "paid", discount);
}

// Deletes one served order from a table; clears legacy table doc when last order is removed.
export async function clearActiveOrder(orderId) {
  const snapshot = await getDoc(activeOrderRef(orderId));
  if (!snapshot.exists()) return false;

  const order = snapshot.data();
  if (order.paymentStatus === "session_hold" && order.privateSessionId) {
    throw new Error("Private sitting orders are cleared at checkout.");
  }
  if (order.paymentStatus === "session_hold" && order.partySessionId) {
    throw new Error("Party orders are cleared when the party is closed.");
  }

  const isSettledPaid = order.status === "paid"
    || order.paymentMethod === "party_settle"
    || (order.paymentStatus === "verified_paid" && order.status === "paid");

  if (!isSettledPaid && getPendingItems(order.items || []).length > 0) {
    throw new Error("Serve all items before clearing this order.");
  }

  const tableId = order.tableId;
  await deleteDoc(activeOrderRef(orderId));

  const remainingSnapshot = await getDocs(collection(db, "activeOrders"));
  const hasRemaining = remainingSnapshot.docs.some((orderDoc) => {
    const data = orderDoc.data();
    return data.tableId === tableId;
  });

  if (!hasRemaining) {
    await deleteDoc(orderRef(tableId)).catch(() => {});
    await logAuditEntry("table_cleared", tableId);
  } else {
    await logAuditEntry("order_cleared", tableId, {
      orderId,
      total: order.total || 0
    });
  }

  return true;
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

// Staff emergency: delete every document in activeOrders and clear legacy table order mirrors.
export async function clearAllActiveOrders() {
  const snapshot = await getDocs(collection(db, "activeOrders"));
  const orders = snapshot.docs.map((orderDoc) => ({
    id: orderDoc.id,
    ...orderDoc.data()
  }));

  if (!orders.length) {
    return { cleared: 0 };
  }

  const tableIds = new Set(orders.map((order) => order.tableId).filter(Boolean));
  const chunkSize = 400;

  for (let index = 0; index < orders.length; index += chunkSize) {
    const batch = writeBatch(db);
    orders.slice(index, index + chunkSize).forEach((order) => {
      batch.delete(activeOrderRef(order.orderId || order.id));
    });
    await batch.commit();
  }

  await Promise.all([...tableIds].map((tableId) => deleteDoc(orderRef(tableId)).catch(() => {})));

  await logAuditEntry("all_orders_cleared", null, {
    cleared: orders.length,
    tables: [...tableIds]
  });

  return { cleared: orders.length };
}

// Subscribes to today's collection summary.
export function listenToTodaySummary(callback, onError) {
  return onSnapshot(dailySummaryRef(), (snapshot) => {
    callback(snapshot.exists() ? snapshot.data() : { total: 0 });
  }, onError);
}

function historySortTime(order) {
  return toDate(order.savedAt)?.getTime()
    || toDate(order.creditedAt)?.getTime()
    || toDate(order.voidedAt)?.getTime()
    || toDate(order.paidAt)?.getTime()
    || 0;
}

// Loads recent paid order history for one table.
export async function fetchTableHistory(tableId, maxRows = 20) {
  const historyCollection = collection(db, "tableHistory", tableId, "orders");
  const [paidSnapshot, voidSnapshot, creditSnapshot] = await Promise.all([
    getDocs(query(historyCollection, orderBy("paidAt", "desc"), limit(maxRows))).catch(() => ({ docs: [] })),
    getDocs(query(historyCollection, orderBy("voidedAt", "desc"), limit(maxRows))).catch(() => ({ docs: [] })),
    getDocs(query(historyCollection, orderBy("creditedAt", "desc"), limit(maxRows))).catch(() => ({ docs: [] }))
  ]);

  const byOrderId = new Map();
  [...paidSnapshot.docs, ...voidSnapshot.docs, ...creditSnapshot.docs].forEach((historyDoc) => {
    const data = { id: historyDoc.id, ...historyDoc.data() };
    const key = data.orderId || historyDoc.id;
    const existing = byOrderId.get(key);
    if (!existing) {
      byOrderId.set(key, data);
      return;
    }
    byOrderId.set(key, { ...existing, ...data });
  });

  return [...byOrderId.values()].sort((a, b) => historySortTime(b) - historySortTime(a));
}

// Parses audit itemsSummary text into order item rows for reports.
export function parseItemsSummary(text) {
  const clean = String(text || "").trim();
  if (!clean) return [];
  return clean.split(",").map((part) => {
    const trimmed = part.trim();
    const match = trimmed.match(/^(.+?)\s+x(\d+)$/i);
    if (!match) return { name: trimmed, qty: 1, price: 0 };
    return { name: match[1].trim(), qty: Number(match[2]) || 1, price: 0 };
  }).filter((item) => item.name);
}

function voidOrderGrossValue(order) {
  return Number(order.grossTotal ?? order.voidAmount ?? order.amount ?? 0);
}

function resolveVoidOrderItems(order, auditRow) {
  if (order.items?.length) return order.items;
  if (auditRow?.items?.length) return auditRow.items;
  return parseItemsSummary(auditRow?.itemsSummary);
}

function collectVoidOrders(foodOrders, auditDetails = []) {
  const voidMap = new Map();

  foodOrders
    .filter((order) => order.paymentStatus === "voided")
    .forEach((order) => {
      if (order.orderId) voidMap.set(order.orderId, order);
    });

  auditDetails.forEach((row) => {
    const orderId = row.orderId;
    if (!orderId || orderId === "counter") return;

    const existing = voidMap.get(orderId);
    if (existing) {
      voidMap.set(orderId, {
        ...existing,
        items: resolveVoidOrderItems(existing, row),
        voidRemarks: existing.voidRemarks || row.voidRemarks || "",
        voidedAt: existing.voidedAt || row.createdAt,
        grossTotal: existing.grossTotal ?? row.grossTotal ?? row.amount,
        voidAmount: existing.voidAmount ?? row.amount ?? existing.grossTotal
      });
      return;
    }

    voidMap.set(orderId, {
      orderId,
      tableId: row.tableId,
      items: resolveVoidOrderItems({}, row),
      paymentStatus: "voided",
      voidRemarks: row.voidRemarks || "",
      grossTotal: Number(row.grossTotal ?? row.amount ?? 0),
      voidAmount: Number(row.amount ?? row.grossTotal ?? 0),
      voidedAt: row.createdAt,
      total: 0,
      discountAmount: 0
    });
  });

  return [...voidMap.values()];
}

// Aggregates paid orders into a sales report for one or more date keys (YYYY-MM-DD).
export function buildReportFromOrders(paidOrders, startKey, endKey, options = {}) {
  const includeVoidedItems = Boolean(options.includeVoidedItems);
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

  function addOrderItems(order) {
    (order.items || []).forEach((item) => {
      const key = `${item.name}|${item.price}`;
      const current = itemMap.get(key) || { name: item.name, price: Number(item.price || 0), qty: 0, total: 0 };
      current.qty += Number(item.qty || 0);
      current.total += Number(item.price || 0) * Number(item.qty || 0);
      itemMap.set(key, current);
    });
  }

  paidOrders.forEach((order) => {
    if (order.paymentStatus === "voided") {
      if (includeVoidedItems) addOrderItems(order);
      return;
    }
    if (order.paymentStatus === "credit_pending") {
      addOrderItems(order);
      return;
    }

    const total = Number(order.total || 0);
    const gross = Number(order.grossTotal ?? total);
    const discount = Number(order.discountAmount || 0);
    const amounts = resolvePaymentAmounts({ ...order, total });
    report.total += total;
    report.grossTotal += gross;
    report.discountTotal += discount;
    report.cash += amounts.cashAmount;
    report.online += amounts.onlineAmount;
    if (order.placedBy === "counter") report.counter += 1;
    else report.customer += 1;
    addOrderItems(order);
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

// Loads paid, void, and udhaar food orders across all tables for a date range.
export async function fetchFoodOrdersForDateRange(startKey, endKey, maxRows = 500) {
  const histories = await Promise.all(CONFIG.TABLES.map((tableId) => fetchTableHistory(tableId, maxRows)));
  const fromHistory = histories.flat().filter((order) => {
    if (order.paymentStatus === "voided") {
      const voidedAt = toDate(order.voidedAt);
      if (!voidedAt) return false;
      const key = getTodayKey(voidedAt);
      return key >= startKey && key <= endKey;
    }
    if (order.paymentStatus === "credit_pending") {
      const creditedAt = toDate(order.creditedAt);
      if (!creditedAt) return false;
      const key = getTodayKey(creditedAt);
      return key >= startKey && key <= endKey;
    }
    const paidAt = toDate(order.paidAt);
    if (!paidAt) return false;
    const key = getTodayKey(paidAt);
    return key >= startKey && key <= endKey;
  });

  const historyIds = new Set(fromHistory.map((order) => order.orderId || order.id).filter(Boolean));
  const activeSnapshot = await getDocs(collection(db, "activeOrders"));
  const fromActive = activeSnapshot.docs
    .map((orderDoc) => ({ id: orderDoc.id, orderId: orderDoc.id, ...orderDoc.data() }))
    .filter((order) => order.paymentStatus === "credit_pending")
    .filter((order) => {
      const creditedAt = toDate(order.creditedAt);
      if (!creditedAt) return false;
      const key = getTodayKey(creditedAt);
      return key >= startKey && key <= endKey;
    })
    .filter((order) => !historyIds.has(order.orderId || order.id));

  return [...fromHistory, ...fromActive]
    .sort((a, b) => {
      const aTime = toDate(a.voidedAt)?.getTime()
        || toDate(a.creditedAt)?.getTime()
        || toDate(a.paidAt)?.getTime()
        || 0;
      const bTime = toDate(b.voidedAt)?.getTime()
        || toDate(b.creditedAt)?.getTime()
        || toDate(b.paidAt)?.getTime()
        || 0;
      return bTime - aTime;
    });
}

// Loads paid food orders across all tables for a date range.
export async function fetchPaidFoodOrdersForDateRange(startKey, endKey, maxRows = 500) {
  const orders = await fetchFoodOrdersForDateRange(startKey, endKey, maxRows);
  return orders.filter((order) => order.paymentStatus !== "voided");
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

// Loads completed party sessions ended in a date range.
export async function fetchCompletedPartiesForDateRange(startKey, endKey) {
  const snapshot = await getDocs(collection(db, "partySessions"));
  return snapshot.docs
    .map((partyDoc) => ({ id: partyDoc.id, partyId: partyDoc.id, ...partyDoc.data() }))
    .filter((party) => {
      if (party.status !== "completed") return false;
      const endedAt = toDate(party.actualEnd) || toDate(party.updatedAt);
      if (!endedAt) return false;
      const key = getTodayKey(endedAt);
      return key >= startKey && key <= endKey;
    })
    .sort((a, b) => {
      const aTime = toDate(a.actualEnd)?.getTime() || toDate(a.updatedAt)?.getTime() || 0;
      const bTime = toDate(b.actualEnd)?.getTime() || toDate(b.updatedAt)?.getTime() || 0;
      return bTime - aTime;
    });
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

// Reads voided order audit entries within a date range.
export async function fetchVoidedOrdersForDateRange(startKey, endKey) {
  const summary = {
    voidOrderCount: 0,
    voidOrderAmount: 0,
    details: []
  };

  try {
    const voidQuery = query(
      collection(db, "auditLog"),
      where("action", "in", ["order_voided", "counter_order_voided"])
    );
    const snapshot = await getDocs(voidQuery);
    snapshot.docs.forEach((entry) => {
      const data = entry.data();
      const createdAt = toDate(data.createdAt);
      if (!createdAt) return;
      const key = getTodayKey(createdAt);
      if (key < startKey || key > endKey) return;
      const details = data.details || {};
      const amount = Number(details.grossTotal || details.total || 0);
      const isCounter = data.action === "counter_order_voided";
      summary.details.push({
        date: key,
        time: createdAt.toLocaleString(),
        createdAt: data.createdAt,
        tableId: data.tableId || "",
        orderId: details.orderId || (isCounter ? "counter" : ""),
        amount,
        grossTotal: amount,
        voidRemarks: details.voidRemarks || "",
        itemsSummary: details.itemsSummary || "",
        type: isCounter ? "counter_pending" : "order"
      });
      summary.voidOrderCount += 1;
      summary.voidOrderAmount += amount;
    });
  } catch {
    // Audit log may be unavailable; report still renders without voids.
  }

  summary.details.sort((a, b) => String(b.time).localeCompare(String(a.time)));
  return summary;
}

// Reads aggregated daily summary docs across a date range (same source as Today's Collection).
export async function fetchDailySummaries(startKey, endKey) {
  const keys = listDateKeys(startKey, endKey);
  const docs = await Promise.all(keys.map((key) => getDoc(dailySummaryRef(key))));
  const totals = {
    total: 0,
    grossTotal: 0,
    discountTotal: 0,
    cash: 0,
    online: 0,
    pendingTotal: 0,
    pendingOrders: 0,
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
    totals.pendingTotal += Number(data.pendingTotal || 0);
    totals.pendingOrders += Number(data.pendingOrders || 0);
    totals.privateSittings += Number(data.privateSittings || 0);
    totals.privateSittingTotal += Number(data.privateSittingTotal || 0);
    totals.foodOrders += Number(data.foodOrders || 0);
  });
  return totals;
}

function sittingFeeAmount(session = {}) {
  return Number(session.sittingAmount ?? session.billedAmount ?? 0);
}

function partySaleAmount(party = {}) {
  return Number(party.finalTotal ?? party.grandTotal ?? 0);
}

// Builds a complete day-wise business report (no table selection required).
// Cash / Online / Net Collection come from dailySummaries (matches Today's Collection).
export async function fetchDayWiseReport(startKey, endKey) {
  const [foodOrders, sittings, parties, cancellations, voids, summaries] = await Promise.all([
    fetchFoodOrdersForDateRange(startKey, endKey),
    fetchCompletedSittingsForDateRange(startKey, endKey),
    fetchCompletedPartiesForDateRange(startKey, endKey),
    fetchCancellationsForDateRange(startKey, endKey),
    fetchVoidedOrdersForDateRange(startKey, endKey),
    fetchDailySummaries(startKey, endKey)
  ]);

  const salesFoodOrders = foodOrders.filter((order) => order.paymentStatus !== "voided");
  const paidFoodOrders = salesFoodOrders.filter((order) => (
    order.paymentStatus === "verified_paid" || order.paymentStatus === "partial_credit"
  ));
  const creditFoodOrders = salesFoodOrders.filter((order) => order.paymentStatus === "credit_pending");
  const voidOrders = collectVoidOrders(foodOrders, voids.details);
  const voidOrderGross = voidOrders.reduce((sum, order) => sum + voidOrderGrossValue(order), 0);
  const historyPendingGross = creditFoodOrders.reduce(
    (sum, order) => sum + Number(order.grossTotal ?? order.total ?? 0),
    0
  );
  const historyPendingTotal = creditFoodOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const itemsReport = buildReportFromOrders(
    [...paidFoodOrders, ...creditFoodOrders, ...voidOrders],
    startKey,
    endKey,
    { includeVoidedItems: true }
  );
  const foodSaleTotal = paidFoodOrders.reduce((sum, order) => {
    if (order.paymentStatus === "partial_credit") {
      return sum + Number(order.cashAmount || 0) + Number(order.onlineAmount || 0);
    }
    return sum + Number(order.total || 0);
  }, 0);
  const paidFoodGross = paidFoodOrders.reduce(
    (sum, order) => sum + Number(order.grossTotal ?? order.total ?? 0),
    0
  );
  const foodDiscountTotal = paidFoodOrders.reduce((sum, order) => sum + Number(order.discountAmount || 0), 0)
    + creditFoodOrders.reduce((sum, order) => sum + Number(order.discountAmount || 0), 0);

  // Fee-only sitting totals (exclude food already counted under food sales).
  const sittingSaleTotal = sittings.reduce((sum, session) => sum + sittingFeeAmount(session), 0);
  const sittingGrossTotal = sittings.reduce((sum, session) => {
    const fee = sittingFeeAmount(session);
    const food = Number(session.foodAmount || 0);
    const gross = Number(session.grossTotal || 0);
    if (gross > 0 && food > 0) return sum + Math.max(0, gross - food);
    return sum + (Number(session.grossTotal ?? session.sittingAmount ?? session.billedAmount ?? 0) || fee);
  }, 0);
  const sittingDiscountTotal = sittings.reduce((sum, session) => sum + Number(session.discountAmount || 0), 0);

  const partySaleTotal = parties.reduce((sum, party) => sum + partySaleAmount(party), 0);
  const partyGrossTotal = parties.reduce(
    (sum, party) => sum + Number(party.grossTotal ?? party.finalTotal ?? party.grandTotal ?? 0),
    0
  );
  const partyDiscountTotal = parties.reduce((sum, party) => sum + Number(party.discountAmount || 0), 0);

  const pendingOrderTotal = summaries.pendingTotal > 0 ? summaries.pendingTotal : historyPendingTotal;
  const pendingOrderGross = summaries.pendingTotal > 0 ? summaries.pendingTotal : historyPendingGross;
  const pendingOrderCount = summaries.pendingOrders > 0
    ? summaries.pendingOrders
    : creditFoodOrders.length;

  const grossTotal = paidFoodGross
    + historyPendingGross
    + sittingGrossTotal
    + partyGrossTotal
    + cancellations.cancelledWithPaymentAmount
    + voidOrderGross;
  const discountTotal = summaries.discountTotal > 0
    ? summaries.discountTotal
    : (foodDiscountTotal + sittingDiscountTotal + partyDiscountTotal);
  const paidOrderCount = paidFoodOrders.length + sittings.length + parties.length;

  const enrichedVoidDetails = voids.details.map((row) => {
    const full = voidOrders.find((order) => order.orderId === row.orderId);
    if (!full) {
      return {
        ...row,
        items: parseItemsSummary(row.itemsSummary)
      };
    }
    return {
      ...row,
      items: resolveVoidOrderItems(full, row),
      grossTotal: full.grossTotal ?? full.voidAmount ?? row.amount,
      voidRemarks: full.voidRemarks || row.voidRemarks,
      tableId: full.tableId || row.tableId,
      createdAt: full.voidedAt || row.createdAt
    };
  });

  const foodOrderIds = new Set(foodOrders.map((order) => order.orderId).filter(Boolean));
  const missingVoidOrders = voidOrders.filter((order) => order.orderId && !foodOrderIds.has(order.orderId));

  return {
    startDate: startKey,
    endDate: endKey,
    // Paid collection — same source as Today's Collection (menu).
    total: summaries.total,
    cash: summaries.cash,
    online: summaries.online,
    grossTotal,
    discountTotal,
    foodOrders: paidFoodOrders.length,
    foodSaleTotal,
    pendingOrderCount,
    pendingOrderGross,
    pendingOrderTotal,
    pendingOrderDetails: creditFoodOrders,
    privateSittings: sittings.length,
    privateSittingTotal: sittingSaleTotal,
    partySessions: parties.length,
    partySaleTotal,
    partyDetails: parties,
    paidOrderCount,
    totalOrders: paidOrderCount,
    cancelledWithPaymentCount: cancellations.cancelledWithPaymentCount,
    cancelledWithPaymentAmount: cancellations.cancelledWithPaymentAmount,
    cancelledWithoutPaymentCount: cancellations.cancelledWithoutPaymentCount,
    cancelledWithoutPaymentAmount: cancellations.cancelledWithoutPaymentAmount,
    voidOrderCount: voidOrders.length,
    voidOrderAmount: voidOrderGross,
    voidOrderGross: voidOrderGross,
    items: itemsReport.items,
    foodOrderDetails: [...foodOrders, ...missingVoidOrders],
    sittingDetails: sittings,
    cancellationDetails: cancellations.details,
    voidOrderDetails: enrichedVoidDetails
  };
}

export function getYesterdayKey(date = new Date()) {
  const previous = new Date(date);
  previous.setDate(previous.getDate() - 1);
  return getTodayKey(previous);
}

function dayBoundsForKey(dateKey) {
  return {
    start: new Date(`${dateKey}T00:00:00`),
    end: new Date(`${dateKey}T23:59:59.999`)
  };
}

async function deleteDocRefsInBatches(refs) {
  for (let index = 0; index < refs.length; index += 450) {
    const batch = writeBatch(db);
    refs.slice(index, index + 450).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
}

// Deletes report-source Firebase data for one calendar day after Drive archive.
export async function purgeReportDataForDate(dateKey) {
  if (!auth.currentUser) {
    throw new Error("Staff sign-in required");
  }

  const todayKey = getTodayKey();
  if (dateKey >= todayKey) {
    throw new Error("Cannot purge today or future report data");
  }

  const { start, end } = dayBoundsForKey(dateKey);
  const counts = { history: 0, audit: 0, summaries: 0, sessions: 0 };

  for (const tableId of CONFIG.TABLES) {
    const historyCollection = collection(db, "tableHistory", tableId, "orders");
    const [paidSnapshot, voidSnapshot, creditSnapshot] = await Promise.all([
      getDocs(query(historyCollection, where("paidAt", ">=", start), where("paidAt", "<=", end))).catch(() => ({ docs: [] })),
      getDocs(query(historyCollection, where("voidedAt", ">=", start), where("voidedAt", "<=", end))).catch(() => ({ docs: [] })),
      getDocs(query(historyCollection, where("creditedAt", ">=", start), where("creditedAt", "<=", end))).catch(() => ({ docs: [] }))
    ]);
    const orderIds = new Set();
    [...paidSnapshot.docs, ...voidSnapshot.docs, ...creditSnapshot.docs].forEach((historyDoc) => orderIds.add(historyDoc.id));
    const refs = [...orderIds].map((orderId) => doc(db, "tableHistory", tableId, "orders", orderId));
    await deleteDocRefsInBatches(refs);
    counts.history += refs.length;
  }

  const auditSnapshot = await getDocs(
    query(collection(db, "auditLog"), where("createdAt", ">=", start), where("createdAt", "<=", end))
  );
  await deleteDocRefsInBatches(auditSnapshot.docs.map((entry) => entry.ref));
  counts.audit = auditSnapshot.size;

  const paymentSnapshot = await getDocs(collection(db, "dailySummaries", dateKey, "payments"));
  await deleteDocRefsInBatches(paymentSnapshot.docs.map((paymentDoc) => paymentDoc.ref));
  const summarySnapshot = await getDoc(dailySummaryRef(dateKey));
  if (summarySnapshot.exists()) {
    await deleteDoc(dailySummaryRef(dateKey));
    counts.summaries = 1;
  }

  const sessionSnapshot = await getDocs(collection(db, "privateSessions"));
  const sessionRefs = sessionSnapshot.docs.filter((sessionDoc) => {
    const session = sessionDoc.data();
    if (session.status !== "completed") return false;
    const checkOutAt = toDate(session.checkOutAt);
    return Boolean(checkOutAt && getTodayKey(checkOutAt) === dateKey);
  }).map((sessionDoc) => sessionDoc.ref);
  await deleteDocRefsInBatches(sessionRefs);
  counts.sessions = sessionRefs.length;

  return counts;
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

export function buildPrivateSittingCheckoutReceipt(draft, paymentInput, discountInfo = null) {
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
  const payment = normalizePaymentAmounts(finalTotal, paymentInput ?? "cash");
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
    paymentMethod: formatPaymentMethodLabel({ ...payment, total: finalTotal }),
    cashAmount: payment.cashAmount,
    onlineAmount: payment.onlineAmount,
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
  const paymentInput = order?.cashAmount != null
    ? { cash: order.cashAmount, online: order.onlineAmount }
    : (paymentMethod || order?.paymentMethod || "cash");
  const payment = normalizePaymentAmounts(total, paymentInput);
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
    paymentMethod: formatPaymentMethodLabel({ ...payment, total }),
    cashAmount: payment.cashAmount,
    onlineAmount: payment.onlineAmount,
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
    `Gross Sales (incl. void + cancelled paid),${report.grossTotal ?? report.total}`,
    `Discount Given,${report.discountTotal ?? 0}`,
    `Net Collection (paid),${report.total}`,
    `Food Sales (paid),${report.foodSaleTotal ?? 0}`,
    `Food Orders (paid),${report.foodOrders ?? 0}`,
    `Private Sitting Sales,${report.privateSittingTotal ?? 0}`,
    `Private Sittings,${report.privateSittings ?? 0}`,
    `Paid Orders + Sittings,${report.paidOrderCount ?? report.totalOrders ?? 0}`,
    `Cancelled With Payment Count,${report.cancelledWithPaymentCount ?? 0}`,
    `Cancelled With Payment Amount,${report.cancelledWithPaymentAmount ?? 0}`,
    `Cancelled Without Payment Count,${report.cancelledWithoutPaymentCount ?? 0}`,
    `Cancelled Without Payment Amount,${report.cancelledWithoutPaymentAmount ?? 0}`,
    `Void Orders Count,${report.voidOrderCount ?? 0}`,
    `Void Orders Gross,${report.voidOrderGross ?? report.voidOrderAmount ?? 0}`,
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
