import {
  CONFIG,
  buildCustomerDisplayName,
  calculateSittingBill,
  completePrivateSession,
  computeDiscount,
  createPrivateSession,
  escapeHtml,
  filterSessionFoodOrders,
  formatCurrency,
  formatTime,
  getPrivateSittingConfig,
  getTodayKey,
  listenToActiveOrders,
  listenToActivePrivateSessions,
  listenToPrivateSessions,
  maskMobile,
  recordSittingPayment,
  serverTimestamp,
  showToast,
  updatePrivateSession,
  verifyOrderPayment
} from "./firebase.js";
import { openAdminOrderModal } from "./admin-orders.js";
import { buildSittingEntryHtmlPreview, buildSittingPdfFileName, buildSittingSessionPdf, compressPhotoDataUrl, formatCheckInLabel, isValidPdfBase64, mergeCustomersWithPhotos, preloadJsPdf, withTimeout } from "./private-sitting-pdf.js";
import { fetchSessionPhotos, isSittingSyncConfigured, syncSittingCheckIn, syncSittingCheckout, uploadSittingPhotos } from "./sitting-sync.js";
import {
  connectPrinter,
  disconnectPrinter,
  getBaudRate,
  getPrinterStatus,
  isSerialSupported,
  reconnectSavedPrinter,
  setBaudRate
} from "./printer-serial.js";
import { printTestReceipt } from "./thermal-print.js";

const PS_TABLE_IDS = new Set(CONFIG.PRIVATE_SITTINGS.map((sitting) => sitting.id));

const state = {
  activeSessions: new Map(),
  allSessions: [],
  tableOrders: [],
  selectedSittingId: null,
  selectedSessionId: null,
  checkInDraft: null,
  checkInSubmitting: false,
  checkoutDraft: null,
  checkoutSubmitting: false,
  foodOrderReturnSessionId: null,
  timerHandle: null
};

const elements = {
  statsTotal: document.querySelector("#psStatTotal"),
  statsOccupied: document.querySelector("#psStatOccupied"),
  statsAvailable: document.querySelector("#psStatAvailable"),
  statsRevenue: document.querySelector("#psStatRevenue"),
  activeList: document.querySelector("#psActiveList"),
  sittingGrid: document.querySelector("#psSittingGrid"),
  reportsList: document.querySelector("#psReportsList"),
  settingsPanel: document.querySelector("#psSettingsPanel"),
  checkInModal: document.querySelector("#psCheckInModal"),
  checkInTitle: document.querySelector("#psCheckInTitle"),
  checkInForm: document.querySelector("#psCheckInForm"),
  checkInPreview: document.querySelector("#psCheckInPreview"),
  checkInError: document.querySelector("#psCheckInError"),
  sessionModal: document.querySelector("#psSessionModal"),
  sessionBody: document.querySelector("#psSessionBody"),
  closeCheckIn: document.querySelector("#closePsCheckIn"),
  closeSession: document.querySelector("#closePsSession"),
  confirmCheckIn: document.querySelector("#confirmPsCheckIn"),
  orderFoodBtn: document.querySelector("#psOrderFoodBtn"),
  checkoutBtn: document.querySelector("#psCheckoutBtn"),
  checkoutModal: document.querySelector("#psCheckoutModal"),
  checkoutBody: document.querySelector("#psCheckoutBody"),
  closeCheckout: document.querySelector("#closePsCheckout"),
  checkoutCashBtn: document.querySelector("#psCheckoutCash"),
  checkoutOnlineBtn: document.querySelector("#psCheckoutOnline"),
  checkoutDiscountType: document.querySelector("#psCheckoutDiscountType"),
  checkoutDiscountValue: document.querySelector("#psCheckoutDiscountValue"),
  checkoutFinalPayable: document.querySelector("#psCheckoutFinalPayable")
};

const CHECK_IN_BTN_LABEL = "Confirm Check-in";
const CHECKOUT_CASH_LABEL = "Cash";
const CHECKOUT_ONLINE_LABEL = "Online";

function setCheckInBusy(busy) {
  if (!elements.confirmCheckIn) return;
  if (busy) {
    if (!elements.confirmCheckIn.dataset.originalLabel) {
      elements.confirmCheckIn.dataset.originalLabel = elements.confirmCheckIn.textContent || CHECK_IN_BTN_LABEL;
    }
    elements.confirmCheckIn.disabled = true;
    elements.confirmCheckIn.textContent = "Checking in...";
    return;
  }
  elements.confirmCheckIn.disabled = false;
  elements.confirmCheckIn.textContent = elements.confirmCheckIn.dataset.originalLabel || CHECK_IN_BTN_LABEL;
}

function setCheckoutBusy(busy) {
  const buttons = [elements.checkoutCashBtn, elements.checkoutOnlineBtn];
  buttons.forEach((button) => {
    if (!button) return;
    if (busy) {
      if (!button.dataset.originalLabel) {
        button.dataset.originalLabel = button.textContent || button.id === "psCheckoutCash"
          ? CHECKOUT_CASH_LABEL
          : CHECKOUT_ONLINE_LABEL;
      }
      button.disabled = true;
      button.textContent = "Processing...";
      return;
    }
    button.disabled = false;
    button.textContent = button.dataset.originalLabel
      || (button.id === "psCheckoutCash" ? CHECKOUT_CASH_LABEL : CHECKOUT_ONLINE_LABEL);
  });
}

function showCheckInError(message) {
  if (!elements.checkInError) return;
  elements.checkInError.textContent = message;
  elements.checkInError.hidden = false;
}

function clearCheckInError() {
  if (!elements.checkInError) return;
  elements.checkInError.textContent = "";
  elements.checkInError.hidden = true;
}

function buildRawCustomerPhotos(customers = []) {
  return customers.map((customer) => ({
    photoFrontDataUrl: customer.photoFrontDataUrl || "",
    photoBackDataUrl: customer.photoBackDataUrl || ""
  }));
}

function stripPhotoBase64(dataUrl) {
  if (!dataUrl) return "";
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

function buildPhotosUploadPayload(customerPhotos = []) {
  return customerPhotos.map((photo, index) => ({
    prefix: `C${index + 1}`,
    frontBase64: stripPhotoBase64(photo.photoFrontDataUrl),
    backBase64: stripPhotoBase64(photo.photoBackDataUrl)
  }));
}

function collectPhotoFileIds(photoDriveIds = []) {
  return photoDriveIds.flatMap((entry) => [entry.frontId, entry.backId].filter(Boolean));
}

function withRejectTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))
  ]);
}

function formatCheckInError(error) {
  const code = error?.code || "";
  const message = String(error?.message || "");
  if (message.includes("Could not save session") || message.includes("Timed out") || code === "unavailable") {
    return "Could not save session. Check internet and try again.";
  }
  if (code === "permission-denied") {
    return "Permission denied. Sign in again as staff.";
  }
  return message || "Check-in failed. Please try again.";
}

async function runCheckInBackground(sessionId, draft, customers, checkInLabel, customerPhotos) {
  const pdfFileName = buildSittingPdfFileName(draft.sittingId, sessionId);
  const customersForPdf = mergeCustomersWithPhotos(customers, customerPhotos);
  const dateKey = getTodayKey();
  const photosPayload = buildPhotosUploadPayload(customerPhotos);
  const hasPhotos = photosPayload.some((photo) => photo.frontBase64 || photo.backBase64);

  const buildPdfBase64 = async () => {
    try {
      const pdfDataUrl = await withTimeout(
        buildSittingSessionPdf({
          sittingId: draft.sittingId,
          mobile: draft.mobile,
          sessionId,
          displayName: buildCustomerDisplayName(customers),
          customers: customersForPdf,
          checkInLabel,
          checkOutLabel: "—"
        }),
        30000,
        null
      );
      return pdfDataUrl ? (pdfDataUrl.split(",")[1] || "") : "";
    } catch (error) {
      console.warn("Check-in PDF build failed:", error);
      return "";
    }
  };

  showToast("Check-in saved. Uploading to Drive...");
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  let pdfBase64 = await buildPdfBase64();

  const syncPayload = {
    sessionId,
    sittingId: draft.sittingId,
    mobile: draft.mobile,
    customers: customers.map(({ name, dob }) => ({ name, dob })),
    pdfBase64,
    pdfFileName,
    checkInLabel,
    dateKey
  };

  try {
    let syncResult = await syncSittingCheckIn(syncPayload);
    if (!syncResult?.ok || (!pdfBase64 && !syncResult.pdfFileId)) {
      await sleep(3000);
      if (!pdfBase64) {
        pdfBase64 = await buildPdfBase64();
        syncPayload.pdfBase64 = pdfBase64;
      }
      if (syncResult?.ok && syncResult.rowNumber) {
        syncPayload.sheetRowNumber = syncResult.rowNumber;
      }
      syncResult = await syncSittingCheckIn(syncPayload);
    }

    let photoFileIds = syncResult?.photoFileIds || [];
    if (hasPhotos) {
      try {
        const photoResult = await uploadSittingPhotos({
          sessionId,
          dateKey,
          photos: photosPayload
        });
        if (!photoResult?.ok && !photoResult?.skipped) {
          await sleep(2000);
          const retryPhoto = await uploadSittingPhotos({ sessionId, dateKey, photos: photosPayload });
          if (retryPhoto?.ok) photoFileIds = retryPhoto.photoFileIds || [];
        } else if (photoResult?.ok) {
          photoFileIds = photoResult.photoFileIds || [];
        }
      } catch (photoError) {
        console.warn("Drive photo upload failed:", photoError);
      }
    }

    if (syncResult?.ok) {
      const updateData = {
        sheetSynced: true,
        sheetRowNumber: syncResult.rowNumber,
        pdfDriveUrl: syncResult.pdfDriveUrl || "",
        pdfFileId: syncResult.pdfFileId || "",
        pdfFileName
      };
      if (photoFileIds.length) {
        updateData.photoDriveIds = photoFileIds;
      }
      const photosJson = JSON.stringify(customerPhotos);
      if (photosJson.length < 700000) {
        updateData.customerPhotos = customerPhotos;
        updateData.pdfCapturedAt = serverTimestamp();
      }
      await updatePrivateSession(sessionId, updateData);
      showToast(syncResult.pdfFileId ? "Session PDF saved to Google Drive." : "Check-in synced. PDF upload may still be pending.");
      return;
    }

    if (!syncResult?.skipped) {
      showToast("Session saved but Drive sync failed — retry after refresh");
    }
  } catch (error) {
    console.warn("Check-in sync failed:", error);
    showToast("Session saved but Drive sync failed — retry after refresh");
  }
}

function getSessionDateKey(session) {
  const ms = session?.checkInAt?.toMillis?.();
  if (ms) return getTodayKey(new Date(ms));
  return getTodayKey();
}

function resolveSheetRowNumber(session) {
  const row = Number(session?.sheetRowNumber || 0);
  return row >= 2 ? row : 0;
}

function getLiveSession(sessionId) {
  return [...state.activeSessions.values()].find((session) => {
    const id = session.sessionId || session.id;
    return id === sessionId;
  }) || null;
}

async function buildCheckoutPdfForSync(liveSession, checkOutLabel) {
  await preloadJsPdf();
  const sessionId = liveSession.sessionId || liveSession.id;
  const pdfFileName = liveSession.pdfFileName
    || buildSittingPdfFileName(liveSession.sittingId, sessionId);
  const customers = liveSession.customers || [];
  const photoDriveIds = liveSession.photoDriveIds || [];
  const photoFileIdsToDelete = collectPhotoFileIds(photoDriveIds);
  const checkInLabel = formatCheckInLabel(liveSession.checkInAt, liveSession.checkInLabel);

  let customerPhotos = [];

  if (photoDriveIds.length && photoFileIdsToDelete.length) {
    try {
      const fetchResult = await fetchSessionPhotos(photoFileIdsToDelete);
      if (fetchResult?.ok && fetchResult.photos) {
        customerPhotos = photoDriveIds.map((entry) => ({
          photoFrontDataUrl: entry.frontId && fetchResult.photos[entry.frontId]
            ? `data:image/jpeg;base64,${fetchResult.photos[entry.frontId]}`
            : "",
          photoBackDataUrl: entry.backId && fetchResult.photos[entry.backId]
            ? `data:image/jpeg;base64,${fetchResult.photos[entry.backId]}`
            : ""
        }));
      }
    } catch (error) {
      console.warn("Drive photo fetch failed:", error);
    }
  }

  if (!customerPhotos.some((photo) => photo.photoFrontDataUrl || photo.photoBackDataUrl) && liveSession.customerPhotos?.length) {
    customerPhotos = liveSession.customerPhotos;
  }

  const customersForPdf = mergeCustomersWithPhotos(customers, customerPhotos);

  try {
    const pdfDataUrl = await withTimeout(
      buildSittingSessionPdf({
        sittingId: liveSession.sittingId,
        mobile: liveSession.mobile,
        sessionId,
        displayName: liveSession.displayName || buildCustomerDisplayName(customers),
        customers: customersForPdf,
        checkInAt: liveSession.checkInAt,
        checkInLabel,
        checkOutLabel
      }),
      45000,
      null
    );
    const pdfBase64 = pdfDataUrl ? (pdfDataUrl.split(",")[1] || "") : "";
    if (isValidPdfBase64(pdfBase64)) {
      return { pdfBase64, pdfFileName, photoFileIdsToDelete };
    }
  } catch (error) {
    console.warn("Checkout PDF build failed:", error);
  }

  return { pdfBase64: "", pdfFileName, photoFileIdsToDelete };
}

function emptyCustomer() {
  return {
    name: "",
    dob: "",
    photoFrontDataUrl: "",
    photoBackDataUrl: ""
  };
}

function createCheckInDraft(sittingId) {
  return {
    sittingId,
    mobile: "",
    customers: [emptyCustomer(), emptyCustomer()]
  };
}

function getSessionForSitting(sittingId) {
  return [...state.activeSessions.values()].find((session) => session.sittingId === sittingId) || null;
}

function formatDuration(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const hours = String(Math.floor(totalSec / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
  const seconds = String(totalSec % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function formatDobLabel(value = "") {
  if (!value) return "-";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" });
}

function getCheckInMs(session) {
  return session?.checkInAt?.toMillis?.() || Date.now();
}

function customerHasAllPhotos(customer) {
  return Boolean(customer.photoFrontDataUrl && customer.photoBackDataUrl);
}

function getMaxDobForAdult() {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 18);
  return date.toISOString().slice(0, 10);
}

function isAdultDob(dob = "") {
  if (!dob) return false;
  return dob <= getMaxDobForAdult();
}

function getSessionFoodOrders(session) {
  if (!session) return [];
  const sessionId = session.sessionId || session.id;
  return filterSessionFoodOrders(state.tableOrders, sessionId, session.sittingId);
}

function getTodaySittingRevenue() {
  const today = getTodayKey();
  return state.allSessions
    .filter((session) => session.status === "completed")
    .filter((session) => {
      const outMs = session.checkOutAt?.toMillis?.() || 0;
      if (!outMs) return false;
      return getTodayKey(new Date(outMs)) === today;
    })
    .reduce((sum, session) => sum + Number(session.grandTotal ?? session.billedAmount ?? 0), 0);
}

function renderStats() {
  const total = CONFIG.PRIVATE_SITTINGS.length;
  const occupied = state.activeSessions.size;
  const available = Math.max(0, total - occupied);
  if (elements.statsTotal) elements.statsTotal.textContent = String(total);
  if (elements.statsOccupied) elements.statsOccupied.textContent = String(occupied).padStart(2, "0");
  if (elements.statsAvailable) elements.statsAvailable.textContent = String(available).padStart(2, "0");
  if (elements.statsRevenue) elements.statsRevenue.textContent = formatCurrency(getTodaySittingRevenue());
}

function renderActiveCustomers() {
  if (!elements.activeList) return;
  const sessions = [...state.activeSessions.values()].sort((a, b) => getCheckInMs(a) - getCheckInMs(b));
  if (!sessions.length) {
    elements.activeList.innerHTML = `<p class="ps-empty-note">No active customers right now.</p>`;
    return;
  }

  elements.activeList.innerHTML = sessions.map((session) => {
    const elapsed = formatDuration(Date.now() - getCheckInMs(session));
    return `
      <button class="ps-active-row" type="button" data-session="${escapeHtml(session.sessionId || session.id)}">
        <span class="ps-active-sitting">${escapeHtml(session.sittingId)}</span>
        <span class="ps-active-names">${escapeHtml(session.displayName || "Guests")}</span>
        <span class="ps-active-meta">${escapeHtml(maskMobile(session.mobile || ""))} · ${escapeHtml(formatTime(session.checkInAt))}</span>
        <strong class="ps-active-timer" data-checkin="${getCheckInMs(session)}">${elapsed}</strong>
      </button>
    `;
  }).join("");

  elements.activeList.querySelectorAll("[data-session]").forEach((button) => {
    button.onclick = () => openSessionModal(button.dataset.session);
  });
}

function sittingCardHtml(sitting) {
  const session = getSessionForSitting(sitting.id);
  const occupied = Boolean(session);
  return `
    <button
      class="ps-sitting-card ${sitting.wide ? "ps-wide" : ""} ${occupied ? "occupied" : "available"}"
      type="button"
      data-sitting="${escapeHtml(sitting.id)}"
    >
      <span class="ps-sitting-no">${escapeHtml(sitting.id.replace("PS ", ""))}</span>
      <strong>${escapeHtml(sitting.id)}</strong>
      <span>₹${sitting.ratePerHour}/hr</span>
      <em>${occupied ? "Occupied" : "Available"}</em>
    </button>
  `;
}

function renderSittingGrid() {
  if (!elements.sittingGrid) return;
  elements.sittingGrid.innerHTML = CONFIG.PRIVATE_SITTINGS.map(sittingCardHtml).join("");
  elements.sittingGrid.querySelectorAll("[data-sitting]").forEach((button) => {
    button.onclick = () => {
      const sittingId = button.dataset.sitting;
      const session = getSessionForSitting(sittingId);
      if (session) openSessionModal(session.sessionId || session.id);
      else openCheckInModal(sittingId);
    };
  });
}

function renderReports() {
  if (!elements.reportsList) return;
  const rows = [...state.allSessions]
    .filter((session) => session.status === "completed")
    .sort((a, b) => (b.checkOutAt?.toMillis?.() || 0) - (a.checkOutAt?.toMillis?.() || 0))
    .slice(0, 40);

  if (!rows.length) {
    elements.reportsList.innerHTML = `<p class="ps-empty-note">No completed sitting sessions yet.</p>`;
    return;
  }

  elements.reportsList.innerHTML = rows.map((session) => `
    <article class="ps-report-row">
      <div>
        <strong>${escapeHtml(session.sittingId)} · ${escapeHtml(session.displayName || "Guests")}</strong>
        <span>${escapeHtml(formatTime(session.checkInAt))} - ${escapeHtml(formatTime(session.checkOutAt))}</span>
      </div>
      <strong>${formatCurrency(session.grandTotal ?? session.billedAmount ?? 0)}</strong>
    </article>
  `).join("");
}

function getPrinterStatusLabel(status) {
  if (!status.supported) return "Web Serial not supported";
  if (status.connected) {
    const parts = [`Connected — ${status.deviceName}`, `Baud ${status.baudRate}`];
    if (status.portInfoLabel) parts.push(status.portInfoLabel);
    return parts.join(" · ");
  }
  if (status.lastError) return `Disconnected — ${status.lastError}`;
  return "Disconnected";
}

function refreshPrinterStatusUi() {
  const statusNode = document.querySelector("#psPrinterStatus");
  const badgeNode = document.querySelector("#psPrinterStatusBadge");
  const connectBtn = document.querySelector("#psPrinterConnect");
  const reconnectBtn = document.querySelector("#psPrinterReconnect");
  const disconnectBtn = document.querySelector("#psPrinterDisconnect");
  const testBtn = document.querySelector("#psPrinterTest");
  const baudSelect = document.querySelector("#psPrinterBaud");
  const status = getPrinterStatus();

  if (statusNode) {
    statusNode.textContent = getPrinterStatusLabel(status);
  }
  if (badgeNode) {
    badgeNode.classList.toggle("connected", status.connected);
    badgeNode.classList.toggle("disconnected", !status.connected);
    badgeNode.textContent = status.connected ? "Connected" : "Disconnected";
  }
  if (connectBtn) {
    connectBtn.disabled = !status.supported || status.connected;
  }
  if (reconnectBtn) {
    reconnectBtn.disabled = !status.supported || status.connected;
  }
  if (disconnectBtn) {
    disconnectBtn.disabled = !status.connected;
  }
  if (testBtn) {
    testBtn.disabled = !status.connected;
  }
  if (baudSelect && !status.connected) {
    baudSelect.value = String(status.baudRate);
    baudSelect.disabled = false;
  }
  if (baudSelect && status.connected) {
    baudSelect.disabled = true;
  }
}

function renderSettings() {
  if (!elements.settingsPanel) return;
  const syncReady = isSittingSyncConfigured();
  const serialReady = isSerialSupported();
  const currentBaud = getBaudRate();
  elements.settingsPanel.innerHTML = `
    <section class="ps-settings-card ps-printer-card">
      <div class="ps-printer-head">
        <h3>Printer (MPT-II)</h3>
        <span class="ps-printer-badge disconnected" id="psPrinterStatusBadge">Disconnected</span>
      </div>
      <p class="ps-printer-help">Pair MPT-II in Bluetooth settings first (PIN 0000). Keep printer ON and in range. Use Chrome browser, not WebView.</p>
      <p class="ps-printer-help">If connected but blank, change baud rate and reconnect.</p>
      <label class="ps-printer-baud-field">
        <span>Baud rate</span>
        <select id="psPrinterBaud" ${serialReady ? "" : "disabled"}>
          <option value="9600" ${currentBaud === 9600 ? "selected" : ""}>9600</option>
          <option value="115200" ${currentBaud === 115200 ? "selected" : ""}>115200</option>
          <option value="19200" ${currentBaud === 19200 ? "selected" : ""}>19200</option>
        </select>
      </label>
      <p class="ps-printer-status" id="psPrinterStatus">${serialReady ? "Disconnected" : "Web Serial not supported"}</p>
      <div class="ps-printer-actions">
        <button class="primary-btn" id="psPrinterConnect" type="button" ${serialReady ? "" : "disabled"}>Connect Printer</button>
        <button class="secondary-btn" id="psPrinterReconnect" type="button" ${serialReady ? "" : "disabled"}>Reconnect Saved Printer</button>
        <button class="secondary-btn" id="psPrinterDisconnect" type="button" disabled>Disconnect</button>
        <button class="secondary-btn" id="psPrinterTest" type="button" disabled>Test Print</button>
      </div>
    </section>
    <section class="ps-settings-card">
      <h3>Google Sync</h3>
      <p>${syncReady ? "Check-in PDF + ID photos go to Google Drive. Checkout rebuilds the full PDF with check-out time. Redeploy Apps Script after updating private-sitting-sync.gs." : "Add CONFIG.APPS_SCRIPT_URL in firebase.js after deploying google-apps-script/private-sitting-sync.gs."}</p>
    </section>
    <section class="ps-settings-card">
      <h3>Sitting Rates</h3>
      <ul class="ps-rate-list">
        ${CONFIG.PRIVATE_SITTINGS.map((sitting) => `
          <li><span>${escapeHtml(sitting.id)}</span><strong>₹${sitting.ratePerHour}/hr</strong></li>
        `).join("")}
      </ul>
    </section>
  `;
  refreshPrinterStatusUi();
}

function renderPrivateSitting() {
  renderStats();
  renderActiveCustomers();
  renderSittingGrid();
  renderReports();
  renderSettings();
}

function photoPreviewHtml(dataUrl, label) {
  return dataUrl
    ? `<img class="ps-photo-preview" src="${dataUrl}" alt="${escapeHtml(label)}">`
    : `<div class="ps-photo-preview empty">${escapeHtml(label)}</div>`;
}

function customerBlockHtml(customer, index) {
  return `
    <section class="ps-customer-block" data-customer-index="${index}">
      <div class="ps-customer-head">
        <h3>Customer ${index + 1}</h3>
      </div>
      <label class="ps-field">
        <span>Name</span>
        <input type="text" name="name-${index}" value="${escapeHtml(customer.name)}" maxlength="60" required>
      </label>
      <label class="ps-field">
        <span>Date of Birth</span>
        <input type="date" name="dob-${index}" value="${escapeHtml(customer.dob)}" max="${getMaxDobForAdult()}" required>
      </label>
      <div class="ps-photo-row">
        <div class="ps-photo-actions">
          <button class="secondary-btn ps-photo-btn" type="button" data-photo-side="front" data-photo-index="${index}">Capture ID Front</button>
          <input type="file" accept="image/*" capture="environment" hidden data-photo-input="front" data-photo-index="${index}">
          <button class="secondary-btn ps-photo-btn" type="button" data-photo-side="back" data-photo-index="${index}">Capture ID Back</button>
          <input type="file" accept="image/*" capture="environment" hidden data-photo-input="back" data-photo-index="${index}">
        </div>
        <div class="ps-photo-grid">
          ${photoPreviewHtml(customer.photoFrontDataUrl, "Front pending")}
          ${photoPreviewHtml(customer.photoBackDataUrl, "Back pending")}
        </div>
      </div>
    </section>
  `;
}

function syncDraftFromForm() {
  const draft = state.checkInDraft;
  if (!draft || !elements.checkInForm) return;

  draft.mobile = elements.checkInForm.querySelector('[name="mobile"]')?.value || "";
  draft.customers = draft.customers.map((customer, index) => ({
    ...customer,
    name: elements.checkInForm.querySelector(`[name="name-${index}"]`)?.value || "",
    dob: elements.checkInForm.querySelector(`[name="dob-${index}"]`)?.value || ""
  }));
}

function renderCheckInForm() {
  if (!elements.checkInForm || !state.checkInDraft) return;
  const draft = state.checkInDraft;
  elements.checkInForm.innerHTML = `
    <label class="ps-field">
      <span>Mobile Number</span>
      <input type="tel" name="mobile" value="${escapeHtml(draft.mobile)}" inputmode="numeric" maxlength="10" required>
    </label>
    ${draft.customers.map((customer, index) => customerBlockHtml(customer, index)).join("")}
  `;

  elements.checkInForm.querySelectorAll("[data-photo-side]").forEach((button) => {
    const side = button.dataset.photoSide;
    const index = button.dataset.photoIndex;
    const input = elements.checkInForm.querySelector(`[data-photo-input="${side}"][data-photo-index="${index}"]`);
    button.onclick = () => input?.click();
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const idx = Number(index);
      const photoButton = elements.checkInForm.querySelector(
        `[data-photo-side="${side}"][data-photo-index="${index}"]`
      );
      if (photoButton) {
        photoButton.disabled = true;
        photoButton.textContent = "Compressing...";
      }
      try {
        const dataUrl = await readFileAsDataUrl(file);
        const compressed = await compressPhotoDataUrl(dataUrl);
        if (!compressed) {
          showToast("Could not process photo. Try again.");
          return;
        }
        if (side === "front") draft.customers[idx].photoFrontDataUrl = compressed;
        else draft.customers[idx].photoBackDataUrl = compressed;
        renderCheckInForm();
        updateCheckInPreview();
      } catch (error) {
        console.warn("Photo capture failed:", error);
        showToast("Could not process photo. Try again.");
        renderCheckInForm();
      }
    };
  });

  const handleFormChange = () => {
    syncDraftFromForm();
    updateCheckInPreview();
  };
  elements.checkInForm.oninput = handleFormChange;
  elements.checkInForm.onchange = handleFormChange;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function updateCheckInPreview() {
  if (!elements.checkInPreview || !state.checkInDraft) return;
  const ready = state.checkInDraft.customers.every(customerHasAllPhotos);
  if (!ready) {
    elements.checkInPreview.innerHTML = `<p class="ps-empty-note">Capture front and back ID photos for both customers.</p>`;
    return;
  }
  elements.checkInPreview.innerHTML = buildSittingEntryHtmlPreview(state.checkInDraft);
}

function openCheckInModal(sittingId) {
  state.checkInDraft = createCheckInDraft(sittingId);
  state.checkInSubmitting = false;
  state.selectedSittingId = sittingId;
  clearCheckInError();
  if (elements.checkInTitle) elements.checkInTitle.textContent = `Check-in — ${sittingId}`;
  renderCheckInForm();
  updateCheckInPreview();
  preloadJsPdf();
  setCheckInBusy(false);
  if (elements.checkInModal) elements.checkInModal.hidden = false;
}

function closeCheckInModal() {
  if (elements.checkInModal) elements.checkInModal.hidden = true;
  state.checkInDraft = null;
}

function validateCheckInDraft(draft) {
  if (!/^[6-9][0-9]{9}$/.test(String(draft.mobile || ""))) {
    showToast("Enter a valid 10-digit mobile number");
    return false;
  }
  for (let i = 0; i < draft.customers.length; i += 1) {
    const customer = draft.customers[i];
    if (!customer.name?.trim() || !customer.dob?.trim()) {
      showToast(`Complete Customer ${i + 1} details`);
      return false;
    }
    if (!customer.photoFrontDataUrl) {
      showToast(`Capture Customer ${i + 1} ID front photo`);
      return false;
    }
    if (!customer.photoBackDataUrl) {
      showToast(`Capture Customer ${i + 1} ID back photo`);
      return false;
    }
    if (!isAdultDob(customer.dob)) {
      showToast("Customer must be 18 or older");
      return false;
    }
  }
  return true;
}

async function submitCheckIn() {
  if (state.checkInSubmitting) return;
  syncDraftFromForm();
  const draft = state.checkInDraft;
  if (!draft || !validateCheckInDraft(draft)) return;

  const sitting = getPrivateSittingConfig(draft.sittingId);
  if (!sitting) return;

  state.checkInSubmitting = true;
  clearCheckInError();
  setCheckInBusy(true);

  const checkInLabel = new Date().toLocaleString();
  const customers = draft.customers.map((customer) => ({
    name: customer.name.trim(),
    dob: customer.dob.trim()
  }));
  const backgroundDraft = {
    sittingId: draft.sittingId,
    mobile: draft.mobile
  };

  try {
    const sessionId = await withRejectTimeout(
      createPrivateSession({
        sittingId: draft.sittingId,
        mobile: draft.mobile,
        customers,
        displayName: buildCustomerDisplayName(customers),
        ratePerHour: sitting.ratePerHour
      }),
      20000,
      "Could not save session. Check internet and try again."
    );

    const customerPhotos = buildRawCustomerPhotos(draft.customers);

    closeCheckInModal();
    showToast(`${draft.sittingId} checked in`);
    runCheckInBackground(sessionId, backgroundDraft, customers, checkInLabel, customerPhotos);
  } catch (error) {
    console.error("Check-in failed:", error);
    const message = formatCheckInError(error);
    showCheckInError(message);
    showToast(message);
  } finally {
    state.checkInSubmitting = false;
    setCheckInBusy(false);
  }
}

function renderSessionBody(session) {
  if (!session || !elements.sessionBody) return;
  const customers = session.customers || [];
  const foodOrders = getSessionFoodOrders(session);
  const foodBadge = foodOrders.length
    ? `<span class="ps-food-badge">${foodOrders.length}</span>`
    : "";

  elements.sessionBody.innerHTML = `
    <div class="ps-session-head">
      <strong>${escapeHtml(session.sittingId)}</strong>
      <span>${escapeHtml(session.displayName || "Guests")}</span>
      <span>${escapeHtml(maskMobile(session.mobile || ""))}</span>
      <strong class="ps-session-timer" data-checkin="${getCheckInMs(session)}">${formatDuration(Date.now() - getCheckInMs(session))}</strong>
    </div>
    ${customers.map((customer, index) => `
      <section class="ps-session-customer">
        <h4>Customer ${index + 1}</h4>
        <div>${escapeHtml(customer.name || "-")}</div>
        <div>DOB: ${escapeHtml(formatDobLabel(customer.dob))}</div>
      </section>
    `).join("")}
    <div class="ps-session-bill">
      <span>Rate</span><strong>₹${session.ratePerHour}/hr</strong>
      <span>Food orders</span><strong>${foodOrders.length}</strong>
    </div>
  `;

  if (elements.orderFoodBtn) {
    elements.orderFoodBtn.innerHTML = `Order Food${foodBadge}`;
  }
}

function openSessionModal(sessionId) {
  const session = state.activeSessions.get(sessionId);
  if (!session) return;
  state.selectedSessionId = sessionId;
  renderSessionBody(session);
  if (elements.sessionModal) elements.sessionModal.hidden = false;
}

function closeSessionModal() {
  if (elements.sessionModal) elements.sessionModal.hidden = true;
  state.selectedSessionId = null;
}

function openFoodOrderForSession() {
  const sessionId = state.selectedSessionId;
  const session = state.activeSessions.get(sessionId);
  if (!session) {
    showToast("Session not found");
    return;
  }

  state.foodOrderReturnSessionId = sessionId;
  closeSessionModal();
  window.dispatchEvent(new CustomEvent("manager-set-tab", { detail: { tab: "orders" } }));

  openAdminOrderModal(session.sittingId, {
    deferPayment: true,
    sessionId: session.sessionId || session.id
  }).catch(() => {
    showToast("Could not open food ordering");
    if (state.foodOrderReturnSessionId) {
      openSessionModal(state.foodOrderReturnSessionId);
      state.foodOrderReturnSessionId = null;
    }
  });
}

function handleFoodOrderModalClosed(event) {
  const sessionId = state.foodOrderReturnSessionId || event.detail?.sessionId;
  state.foodOrderReturnSessionId = null;
  if (!sessionId) return;
  const mapKey = [...state.activeSessions.keys()].find((key) => {
    const active = state.activeSessions.get(key);
    return key === sessionId || active?.sessionId === sessionId || active?.id === sessionId;
  });
  if (mapKey && state.activeSessions.has(mapKey)) {
    openSessionModal(mapKey);
  }
}

function buildCheckoutDraft(session) {
  const sessionId = session.sessionId || session.id;
  const sitting = calculateSittingBill(session.checkInAt, session.ratePerHour);
  const foodOrders = getSessionFoodOrders(session);
  const foodAmount = foodOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const sittingAmount = sitting.billedAmount;
  return {
    sessionId,
    session,
    sitting,
    foodOrders,
    sittingAmount,
    foodAmount,
    grandTotal: sittingAmount + foodAmount
  };
}

function renderCheckoutModal(draft) {
  if (!elements.checkoutBody || !draft) return;

  const foodRows = draft.foodOrders.length
    ? draft.foodOrders.map((order) => `
      <div class="ps-checkout-food-item">
        <span>${escapeHtml(order.orderId?.slice(0, 8) || "Order")} · ${(order.items || []).length} item(s)</span>
        <strong>${formatCurrency(order.total || 0)}</strong>
      </div>
    `).join("")
    : `<p class="ps-empty-note">No food orders for this session.</p>`;

  elements.checkoutBody.innerHTML = `
    <div class="ps-checkout-row">
      <span>Sitting charge</span>
      <strong>${formatCurrency(draft.sittingAmount)}</strong>
    </div>
    <div class="ps-checkout-food-list">
      ${foodRows}
      <div class="ps-checkout-row">
        <span>Food subtotal</span>
        <strong>${formatCurrency(draft.foodAmount)}</strong>
      </div>
    </div>
    <div class="ps-checkout-total">
      <span>Grand total</span>
      <strong>${formatCurrency(draft.grandTotal)}</strong>
    </div>
  `;
}

function startCheckout() {
  const session = state.activeSessions.get(state.selectedSessionId);
  if (!session) return;
  state.checkoutDraft = buildCheckoutDraft(session);
  renderCheckoutModal(state.checkoutDraft);
  if (elements.checkoutDiscountType) elements.checkoutDiscountType.value = "amount";
  if (elements.checkoutDiscountValue) elements.checkoutDiscountValue.value = "";
  updateCheckoutDiscountDisplay();
  if (elements.checkoutModal) elements.checkoutModal.hidden = false;
}

function readCheckoutDiscount() {
  const type = elements.checkoutDiscountType?.value === "percent" ? "percent" : "amount";
  const value = Number(elements.checkoutDiscountValue?.value || 0);
  return { type, value: Number.isFinite(value) ? value : 0 };
}

function updateCheckoutDiscountDisplay() {
  if (!elements.checkoutFinalPayable) return;
  const grandTotal = Number(state.checkoutDraft?.grandTotal || 0);
  const info = computeDiscount(grandTotal, readCheckoutDiscount());
  elements.checkoutFinalPayable.textContent = info.discountAmount > 0
    ? `Final Payable: ${formatCurrency(info.finalTotal)} (− ${formatCurrency(info.discountAmount)})`
    : `Final Payable: ${formatCurrency(info.finalTotal)}`;
}

function closeCheckoutModal() {
  if (elements.checkoutModal) elements.checkoutModal.hidden = true;
  state.checkoutDraft = null;
}

function snapshotSessionForCheckout(session) {
  if (!session) return null;
  const sessionId = session.sessionId || session.id;
  return {
    sessionId,
    sittingId: session.sittingId,
    mobile: session.mobile,
    customers: session.customers ? [...session.customers] : [],
    customerPhotos: session.customerPhotos ? JSON.parse(JSON.stringify(session.customerPhotos)) : [],
    photoDriveIds: session.photoDriveIds ? JSON.parse(JSON.stringify(session.photoDriveIds)) : [],
    displayName: session.displayName,
    checkInAt: session.checkInAt,
    checkInLabel: session.checkInLabel,
    pdfFileId: session.pdfFileId || "",
    pdfFileName: session.pdfFileName || "",
    sheetRowNumber: session.sheetRowNumber
  };
}

async function runCheckoutBackground(sessionSnapshot, checkoutMeta) {
  const {
    sessionId,
    checkOutLabel,
    durationMinutes,
    sheetRowNumber,
    sessionDateKey
  } = checkoutMeta;

  showToast("Building session PDF...");

  const { pdfBase64, pdfFileName, photoFileIdsToDelete } = await buildCheckoutPdfForSync(sessionSnapshot, checkOutLabel);
  const pdfValid = isValidPdfBase64(pdfBase64);

  if (!sheetRowNumber) {
    showToast(pdfValid
      ? "Checkout saved. No sheet row — check in again to enable Drive sync."
      : "Checkout saved. PDF could not be built.");
    return;
  }

  const syncPdfBase64 = pdfValid ? pdfBase64 : "";
  const runCheckoutSync = () => syncSittingCheckout({
    sessionId,
    sheetRowNumber,
    checkOutLabel,
    durationMinutes,
    pdfBase64: syncPdfBase64,
    pdfFileName,
    pdfFileId: sessionSnapshot.pdfFileId || "",
    photoFileIdsToDelete: pdfValid ? photoFileIdsToDelete : [],
    dateKey: sessionDateKey
  });

  try {
    let syncResult = await runCheckoutSync();
    if (!syncResult?.ok) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      syncResult = await runCheckoutSync();
    }

    if (!syncResult?.ok) {
      showToast(`Checkout saved. Sheet sync failed: ${syncResult?.error || "unknown error"}`);
      return;
    }

    if (syncResult.pdfUploaded && syncResult.pdfFileId && syncResult.pdfDriveUrl) {
      await updatePrivateSession(sessionId, {
        pdfDriveUrl: syncResult.pdfDriveUrl,
        pdfFileId: syncResult.pdfFileId,
        pdfFileName
      });
      showToast("Checkout synced — sheet updated, PDF saved, temp photos removed.");
    } else if (syncResult.sheetUpdated) {
      showToast(pdfValid
        ? `Sheet updated. PDF upload failed: ${syncResult.pdfError || "unknown"}`
        : "Sheet updated. PDF could not be built.");
    }
  } catch (error) {
    console.warn("Checkout background sync failed:", error);
    showToast("Checkout saved. Drive sync failed in background.");
  }
}

async function confirmCheckout(method) {
  if (state.checkoutSubmitting) return;
  const draft = state.checkoutDraft;
  if (!draft) return;

  state.checkoutSubmitting = true;
  setCheckoutBusy(true);

  const discountInfo = computeDiscount(draft.grandTotal, readCheckoutDiscount());
  let remainingDiscount = discountInfo.discountAmount;
  const sittingDiscount = Math.min(remainingDiscount, draft.sittingAmount);
  remainingDiscount -= sittingDiscount;
  const foodOrderDiscounts = draft.foodOrders.map((order) => {
    const orderTotal = Number(order.total || 0);
    const applied = Math.min(remainingDiscount, orderTotal);
    remainingDiscount -= applied;
    return { orderId: order.orderId || order.id, discount: applied };
  });

  try {
    const liveSession = getLiveSession(draft.sessionId) || draft.session;
    const sessionSnapshot = snapshotSessionForCheckout(liveSession);
    const checkOutLabel = new Date().toLocaleString();
    const sheetRowNumber = resolveSheetRowNumber(liveSession) || resolveSheetRowNumber(draft.session);
    const sessionDateKey = getSessionDateKey(liveSession);

    await recordSittingPayment(draft.sessionId, draft.sittingAmount, method, {
      type: "amount",
      value: sittingDiscount
    });

    await Promise.all(
      foodOrderDiscounts
        .filter((entry) => entry.orderId)
        .map((entry) => verifyOrderPayment(entry.orderId, method, {
          type: "amount",
          value: entry.discount
        }))
    );

    await completePrivateSession(draft.sessionId, {
      durationMinutes: draft.sitting.durationMinutes,
      billedMinutes: draft.sitting.billedMinutes,
      billedAmount: draft.sittingAmount,
      sittingAmount: draft.sittingAmount,
      foodAmount: draft.foodAmount,
      grossTotal: discountInfo.grossTotal,
      discountType: discountInfo.discountType,
      discountValue: discountInfo.discountValue,
      discountAmount: discountInfo.discountAmount,
      grandTotal: discountInfo.finalTotal,
      paymentMethod: method
    });

    closeCheckoutModal();
    closeSessionModal();
    showToast(`${draft.session.sittingId} checked out — ${formatCurrency(discountInfo.finalTotal)}`);

    if (sessionSnapshot) {
      runCheckoutBackground(sessionSnapshot, {
        sessionId: draft.sessionId,
        checkOutLabel,
        durationMinutes: draft.sitting.durationMinutes,
        sheetRowNumber,
        sessionDateKey
      });
    }
  } catch {
    showToast("Checkout failed. Please try again.");
  } finally {
    state.checkoutSubmitting = false;
    setCheckoutBusy(false);
  }
}

function updateLiveTimers() {
  document.querySelectorAll(".ps-active-timer, .ps-session-timer").forEach((node) => {
    const checkInMs = Number(node.dataset.checkin || 0);
    if (!checkInMs) return;
    node.textContent = formatDuration(Date.now() - checkInMs);
  });
}

function bindPrivateSittingUi() {
  elements.closeCheckIn?.addEventListener("click", closeCheckInModal);
  elements.checkInModal?.addEventListener("click", (event) => {
    if (event.target === elements.checkInModal) closeCheckInModal();
  });
  elements.confirmCheckIn?.addEventListener("click", submitCheckIn);
  elements.closeSession?.addEventListener("click", closeSessionModal);
  elements.sessionModal?.addEventListener("click", (event) => {
    if (event.target === elements.sessionModal) closeSessionModal();
  });
  elements.orderFoodBtn?.addEventListener("click", openFoodOrderForSession);
  elements.checkoutBtn?.addEventListener("click", startCheckout);
  elements.closeCheckout?.addEventListener("click", closeCheckoutModal);
  elements.checkoutModal?.addEventListener("click", (event) => {
    if (event.target === elements.checkoutModal) closeCheckoutModal();
  });
  elements.checkoutCashBtn?.addEventListener("click", () => confirmCheckout("cash"));
  elements.checkoutOnlineBtn?.addEventListener("click", () => confirmCheckout("online"));
  elements.checkoutDiscountType?.addEventListener("change", updateCheckoutDiscountDisplay);
  elements.checkoutDiscountValue?.addEventListener("input", updateCheckoutDiscountDisplay);
  window.addEventListener("ps-food-order-modal-closed", handleFoodOrderModalClosed);
  bindPrinterSettingsUi();
}

function bindPrinterSettingsUi() {
  if (!elements.settingsPanel) return;

  elements.settingsPanel.addEventListener("change", (event) => {
    const baudSelect = event.target.closest("#psPrinterBaud");
    if (!baudSelect) return;
    setBaudRate(baudSelect.value);
    refreshPrinterStatusUi();
  });

  elements.settingsPanel.addEventListener("click", async (event) => {
    const connectBtn = event.target.closest("#psPrinterConnect");
    const reconnectBtn = event.target.closest("#psPrinterReconnect");
    const disconnectBtn = event.target.closest("#psPrinterDisconnect");
    const testBtn = event.target.closest("#psPrinterTest");

    if (connectBtn) {
      connectBtn.disabled = true;
      try {
        await connectPrinter({ prompt: true });
        showToast("Printer connected.");
      } catch (error) {
        if (error?.name === "NotFoundError") {
          showToast("No printer found. Pair MPT-II in Bluetooth, power ON, then try again.");
        } else {
          showToast(error?.message || "Could not connect printer.");
        }
      } finally {
        refreshPrinterStatusUi();
      }
      return;
    }

    if (reconnectBtn) {
      reconnectBtn.disabled = true;
      try {
        await reconnectSavedPrinter();
        showToast("Printer reconnected.");
      } catch (error) {
        showToast(error?.message || "Could not reconnect printer.");
      } finally {
        refreshPrinterStatusUi();
      }
      return;
    }

    if (disconnectBtn) {
      disconnectBtn.disabled = true;
      try {
        await disconnectPrinter();
        showToast("Printer disconnected.");
      } catch (error) {
        showToast(error?.message || "Could not disconnect printer.");
      } finally {
        refreshPrinterStatusUi();
      }
      return;
    }

    if (testBtn) {
      testBtn.disabled = true;
      try {
        await printTestReceipt();
        showToast("Test print sent.");
      } catch (error) {
        showToast(error?.message || "Test print failed.");
      } finally {
        refreshPrinterStatusUi();
      }
    }
  });

  window.addEventListener("printer-status-change", refreshPrinterStatusUi);
}

function subscribePrivateSitting() {
  listenToActivePrivateSessions((sessions) => {
    state.activeSessions = new Map(
      sessions.map((session) => [session.sessionId || session.id, session])
    );
    renderPrivateSitting();
    if (state.selectedSessionId && state.activeSessions.has(state.selectedSessionId)) {
      renderSessionBody(state.activeSessions.get(state.selectedSessionId));
    }
  }, () => showToast("Private sitting connection error"));

  listenToPrivateSessions((sessions) => {
    state.allSessions = sessions;
    renderStats();
    renderReports();
  }, () => {});

  listenToActiveOrders((orders) => {
    state.tableOrders = orders.filter((order) => PS_TABLE_IDS.has(order.tableId));
    if (state.selectedSessionId && state.activeSessions.has(state.selectedSessionId)) {
      renderSessionBody(state.activeSessions.get(state.selectedSessionId));
    }
  }, () => {});
}

export function initPrivateSitting() {
  bindPrivateSittingUi();
  subscribePrivateSitting();
  if (state.timerHandle) clearInterval(state.timerHandle);
  state.timerHandle = setInterval(updateLiveTimers, 1000);
  renderPrivateSitting();
}

export function refreshPrivateSittingView() {
  renderPrivateSitting();
}
