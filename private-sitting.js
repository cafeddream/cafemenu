import {
  CONFIG,
  buildCustomerDisplayName,
  allocateSplitAcrossPayments,
  calculateSittingBill,
  completePrivateSession,
  computeDiscount,
  createPrivateSession,
  escapeHtml,
  filterSessionFoodOrders,
  formatCurrency,
  formatTime,
  getPrivateSittingConfig,
  getPrivateSittings,
  getTodayKey,
  listenToActivePrivateSessions,
  loadRuntimeConfig,
  markOrderCreditPending,
  maskMobile,
  normalizeCreditCustomer,
  normalizePaymentAmounts,
  recordSittingCreditPending,
  recordSittingPayment,
  serverTimestamp,
  showToast,
  subscribeActiveOrders,
  subscribeRuntimeConfig,
  updatePrivateSession,
  verifyOrderPayment
} from "./firebase.js";
import { openAdminOrderModal } from "./admin-orders.js";
import { buildSittingEntryHtmlPreview, buildSittingPdfFileName, buildSittingSessionPdf, compressPhotoDataUrl, formatCheckInLabel, isValidPdfBase64, mergeCustomersWithPhotos, preloadJsPdf, withTimeout } from "./private-sitting-pdf.js";
import { initIdCropCamera, openGalleryPhotoPicker, openIdCropCamera } from "./private-sitting-camera.js";
import { fetchSessionPhotos, syncSittingCheckIn, syncSittingCheckout, uploadSittingPhotos } from "./sitting-sync.js";
import { syncPendingOrderToSheet } from "./report-sync.js";
import { renderAdminSettings } from "./admin-settings.js";

function getPsTableIds() {
  return new Set(getPrivateSittings().map((sitting) => sitting.id));
}

const state = {
  activeSessions: new Map(),
  tableOrders: [],
  selectedSittingId: null,
  selectedSessionId: null,
  checkInDraft: null,
  checkInSubmitting: false,
  checkoutDraft: null,
  checkoutSubmitting: false,
  checkoutSplitDriver: null,
  foodOrderReturnSessionId: null,
  timerHandle: null,
  settingsMounted: false
};

const elements = {
  sittingGrid: document.querySelector("#psSittingGrid"),
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
  checkoutSplitBtn: document.querySelector("#psCheckoutSplit"),
  checkoutSplitPanel: document.querySelector("#psSplitPanel"),
  checkoutSplitOnlineAmount: document.querySelector("#psSplitOnlineAmount"),
  checkoutSplitCashAmount: document.querySelector("#psSplitCashAmount"),
  checkoutSplitCreditAmount: document.querySelector("#psSplitCreditAmount"),
  checkoutSplitCreditCustomer: document.querySelector("#psSplitCreditCustomer"),
  checkoutSplitCreditName: document.querySelector("#psSplitCreditName"),
  checkoutSplitCreditMobile: document.querySelector("#psSplitCreditMobile"),
  checkoutSplitPaymentHint: document.querySelector("#psSplitPaymentHint"),
  checkoutSplitBackBtn: document.querySelector("#psSplitBackBtn"),
  checkoutSplitConfirmBtn: document.querySelector("#psSplitConfirmBtn"),
  checkoutPendingBtn: document.querySelector("#psCheckoutPending"),
  checkoutPendingPanel: document.querySelector("#psCheckoutPendingPanel"),
  checkoutPendingName: document.querySelector("#psCheckoutPendingName"),
  checkoutPendingMobile: document.querySelector("#psCheckoutPendingMobile"),
  checkoutPendingBackBtn: document.querySelector("#psCheckoutPendingBackBtn"),
  checkoutPendingConfirmBtn: document.querySelector("#psCheckoutPendingConfirmBtn"),
  checkoutDiscountType: document.querySelector("#psCheckoutDiscountType"),
  checkoutDiscountValue: document.querySelector("#psCheckoutDiscountValue"),
  checkoutFinalPayable: document.querySelector("#psCheckoutFinalPayable")
};

const CHECK_IN_BTN_LABEL = "Confirm Check-in";
const CHECKOUT_CASH_LABEL = "Cash";
const CHECKOUT_ONLINE_LABEL = "Online";
const CHECKOUT_SPLIT_LABEL = "Split";
const CHECKOUT_PENDING_LABEL = "Udhaar";

const SESSION_PEOPLE_ICON = "<svg class=\"ps-session-icon\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path fill=\"currentColor\" d=\"M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S7.66 5 6 5C4.34 5 3 6.34 3 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-4.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-4.5c0-2.33-4.67-3.5-7-3.5z\"/></svg>";

const SESSION_BIRTHDAY_ICON = "<span class=\"ps-session-birthday-chip\" aria-hidden=\"true\"><svg class=\"ps-session-icon ps-session-birthday-icon\" viewBox=\"0 0 24 24\"><path fill=\"currentColor\" d=\"M12 6c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm-1 3H7v2h1v7c0 1.1.9 2 2 2h4c1.1 0 2-.9 2-2v-7h1V9h-4v-.59c.59-.34 1-.98 1-1.73 0-1.1-.9-2-2-2s-2 .9-2 2c0 .75.41 1.39 1 1.73V9zm1 2h2v7h-2v-7z\"/></svg></span>";

const CHECKIN_FIELD_ICONS = {
  mobile: "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path fill=\"currentColor\" d=\"M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z\"/></svg>",
  name: "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path fill=\"currentColor\" d=\"M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z\"/></svg>",
  dob: "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path fill=\"currentColor\" d=\"M19 4h-1V2h-2v2H8V2H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zM5 8V6h14v2H5z\"/></svg>"
};

function checkInInputHtml({ name, type = "text", value = "", placeholder, iconKey, attrs = "", ariaLabel = "" }) {
  const icon = CHECKIN_FIELD_ICONS[iconKey] || "";
  const aria = ariaLabel ? ` aria-label="${escapeHtml(ariaLabel)}"` : "";
  const isDate = type === "date";
  const wrapClass = isDate ? "ps-field-input-wrap ps-field-input-wrap--date" : "ps-field-input-wrap";
  const wrapAttrs = isDate && placeholder ? ` data-placeholder="${escapeHtml(placeholder)}"` : "";
  return `
    <label class="ps-field ps-field--icon">
      <span class="${wrapClass}"${wrapAttrs}>
        <span class="ps-field-icon" aria-hidden="true">${icon}</span>
        <input type="${type}" name="${name}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}"${aria} ${attrs}>
      </span>
    </label>
  `;
}

function renderSessionCustomerCard(customer, index) {
  return `
    <section class="ps-session-customer" aria-label="Guest ${index + 1}">
      <span class="ps-session-customer-icon">${SESSION_PEOPLE_ICON}</span>
      <div class="ps-session-customer-name">${escapeHtml(customer.name || "-")}</div>
      <div class="ps-session-customer-dob">
        ${SESSION_BIRTHDAY_ICON}
        <span>${escapeHtml(formatDobLabel(customer.dob))}</span>
      </div>
    </section>
  `;
}

function setCheckoutButtonLabel(button, text) {
  const label = button?.querySelector(".payment-option-label");
  if (label) label.textContent = text;
  else if (button) button.textContent = text;
}

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
  const buttons = [
    elements.checkoutCashBtn,
    elements.checkoutOnlineBtn,
    elements.checkoutSplitBtn,
    elements.checkoutPendingBtn,
    elements.checkoutSplitConfirmBtn,
    elements.checkoutPendingConfirmBtn
  ];
  buttons.forEach((button) => {
    if (!button) return;
    const label = button.querySelector(".payment-option-label");
    if (busy) {
      if (!button.dataset.originalLabel) {
        button.dataset.originalLabel = label?.textContent
          || (button.id === "psCheckoutCash"
            ? CHECKOUT_CASH_LABEL
            : button.id === "psCheckoutOnline"
              ? CHECKOUT_ONLINE_LABEL
              : button.id === "psCheckoutPending"
                ? CHECKOUT_PENDING_LABEL
                : CHECKOUT_SPLIT_LABEL);
      }
      button.disabled = true;
      if (label && button.id !== "psCheckoutSplit" && button.id !== "psCheckoutPending") {
        label.textContent = "Processing...";
      }
      return;
    }
    button.disabled = false;
    setCheckoutButtonLabel(
      button,
      button.dataset.originalLabel
        || (button.id === "psCheckoutCash"
          ? CHECKOUT_CASH_LABEL
          : button.id === "psCheckoutOnline"
            ? CHECKOUT_ONLINE_LABEL
            : button.id === "psCheckoutPending"
              ? CHECKOUT_PENDING_LABEL
              : CHECKOUT_SPLIT_LABEL)
    );
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

function isManagerTabActive(tabId) {
  return document.body.dataset.activeTab === tabId;
}

function onActiveSessionsChanged() {
  renderSittingGrid();
  if (state.selectedSessionId && state.activeSessions.has(state.selectedSessionId)) {
    renderSessionBody(state.activeSessions.get(state.selectedSessionId));
  }
}

function onPsTableOrdersChanged() {
  if (state.selectedSessionId && state.activeSessions.has(state.selectedSessionId)) {
    renderSessionBody(state.activeSessions.get(state.selectedSessionId));
  }
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

function sittingCardHtml(sitting) {
  const session = getSessionForSitting(sitting.id);
  const occupied = Boolean(session);
  return `
    <button
      class="ps-sitting-card ${occupied ? "occupied" : "available"}"
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
  elements.sittingGrid.innerHTML = getPrivateSittings().map(sittingCardHtml).join("");
  elements.sittingGrid.querySelectorAll("[data-sitting]").forEach((button) => {
    button.onclick = () => {
      const sittingId = button.dataset.sitting;
      const session = getSessionForSitting(sittingId);
      if (session) openSessionModal(session.sessionId || session.id);
      else openCheckInModal(sittingId);
    };
  });
}

function renderSettings() {
  if (!elements.settingsPanel) return;
  if (!state.settingsMounted) {
    elements.settingsPanel.innerHTML = `
      <section class="ps-settings-card admin-settings-card admin-locked" id="adminSettingsMount">
        <div class="admin-settings-head">
          <h3>Admin Configuration</h3>
          <span class="admin-lock-badge">Loading</span>
        </div>
        <p>Loading admin settings...</p>
      </section>
    `;
    state.settingsMounted = true;
  }
  void renderAdminSettings(elements.settingsPanel);
}

function subscribePrivateSitting() {
  listenToActivePrivateSessions((sessions) => {
    state.activeSessions = new Map(
      sessions.map((session) => [session.sessionId || session.id, session])
    );
    onActiveSessionsChanged();
  }, () => showToast("Private sitting connection error"));

  subscribeActiveOrders((orders) => {
    state.tableOrders = orders.filter((order) => getPsTableIds().has(order.tableId));
    onPsTableOrdersChanged();
  }, () => {});
}

function photoPreviewHtml(dataUrl, label) {
  return dataUrl
    ? `<img class="ps-photo-preview" src="${dataUrl}" alt="${escapeHtml(label)}">`
    : `<div class="ps-photo-preview empty">${escapeHtml(label)}</div>`;
}

function customerBlockHtml(customer, index) {
  return `
    <section class="ps-customer-block" data-customer-index="${index}">
      ${checkInInputHtml({
        name: `name-${index}`,
        value: customer.name,
        placeholder: "Enter name here",
        iconKey: "name",
        ariaLabel: "Name",
        attrs: 'maxlength="60" required'
      })}
      ${checkInInputHtml({
        name: `dob-${index}`,
        type: "date",
        value: customer.dob,
        placeholder: "Enter DOB here",
        iconKey: "dob",
        ariaLabel: "Date of birth",
        attrs: `max="${getMaxDobForAdult()}" required`
      })}
      <div class="ps-photo-row">
        <div class="ps-photo-actions">
          <button class="secondary-btn ps-photo-btn" type="button" data-photo-side="front" data-photo-index="${index}">Capture ID Front</button>
          <button class="secondary-btn ps-photo-btn" type="button" data-photo-side="back" data-photo-index="${index}">Capture ID Back</button>
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

async function processIdPhotoDataUrl(dataUrl) {
  const compressed = await compressPhotoDataUrl(dataUrl);
  if (!compressed) {
    showToast("Could not process photo. Try again.");
    return "";
  }
  return compressed;
}

async function captureIdPhotoForCustomer(side, index) {
  const draft = state.checkInDraft;
  if (!draft) return;

  const idx = Number(index);
  const photoButton = elements.checkInForm?.querySelector(
    `[data-photo-side="${side}"][data-photo-index="${index}"]`
  );
  if (photoButton) {
    photoButton.disabled = true;
    photoButton.textContent = "Opening camera...";
  }

  try {
    let dataUrl = null;
    try {
      dataUrl = await openIdCropCamera();
    } catch (error) {
      console.warn("Camera unavailable:", error);
      showToast("Camera unavailable — pick from gallery");
      dataUrl = await openGalleryPhotoPicker();
    }
    if (!dataUrl) {
      renderCheckInForm();
      return;
    }

    if (photoButton) photoButton.textContent = "Compressing...";
    const compressed = await processIdPhotoDataUrl(dataUrl);
    if (!compressed) {
      renderCheckInForm();
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
}

function renderCheckInForm() {
  if (!elements.checkInForm || !state.checkInDraft) return;
  const draft = state.checkInDraft;
  elements.checkInForm.innerHTML = `
    ${checkInInputHtml({
      name: "mobile",
      type: "tel",
      value: draft.mobile,
      placeholder: "Enter mob. no. here",
      iconKey: "mobile",
      ariaLabel: "Mobile number",
      attrs: 'inputmode="numeric" maxlength="10" required'
    })}
    ${draft.customers.map((customer, index) => customerBlockHtml(customer, index)).join("")}
  `;

  elements.checkInForm.querySelectorAll("[data-photo-side]").forEach((button) => {
    const side = button.dataset.photoSide;
    const index = button.dataset.photoIndex;
    button.onclick = () => captureIdPhotoForCustomer(side, index);
  });

  const handleFormChange = () => {
    syncDraftFromForm();
    updateCheckInPreview();
  };
  elements.checkInForm.oninput = handleFormChange;
  elements.checkInForm.onchange = handleFormChange;
}

async function updateCheckInPreview() {
  if (!elements.checkInPreview || !state.checkInDraft) return;
  const ready = state.checkInDraft.customers.every(customerHasAllPhotos);
  if (!ready) {
    elements.checkInPreview.innerHTML = "";
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

function renderSessionFoodOrdersDetail(foodOrders = []) {
  return foodOrders.map((order) => {
    const items = order.items || [];
    const itemLines = items.length
      ? items.map((item) => `
        <li class="ps-session-food-line">
          <span>${Number(item.qty || 0)}× ${escapeHtml(item.name || "Item")}</span>
          <strong>${formatCurrency(Number(item.price || 0) * Number(item.qty || 0))}</strong>
        </li>
      `).join("")
      : `<li class="ps-session-food-line"><span>No items</span></li>`;
    return `
      <section class="ps-session-food-order">
        <header class="ps-session-food-order-head">
          <span>Order #${escapeHtml(String(order.orderId || order.id || "").slice(0, 8))}</span>
          <strong>${formatCurrency(order.total || 0)}</strong>
        </header>
        <ul class="ps-session-food-items">${itemLines}</ul>
      </section>
    `;
  }).join("");
}

function bindSessionFoodOrdersToggle() {
  const toggle = elements.sessionBody?.querySelector(".ps-food-orders-toggle");
  const panel = elements.sessionBody?.querySelector(".ps-session-food-orders");
  if (!toggle || !panel) return;

  toggle.addEventListener("click", () => {
    const open = panel.hidden;
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.classList.toggle("is-open", open);
  });
}

function renderSessionBody(session) {
  if (!session || !elements.sessionBody) return;
  const customers = session.customers || [];
  const foodOrders = getSessionFoodOrders(session);
  const foodCount = foodOrders.length;
  const foodBadge = foodCount
    ? `<span class="ps-food-badge">${foodCount}</span>`
    : "";
  const foodCountCell = foodCount > 0
    ? `<button type="button" class="ps-food-orders-toggle" aria-expanded="false" aria-label="Show ${foodCount} food order${foodCount === 1 ? "" : "s"}">${foodCount}</button>`
    : "<strong>0</strong>";

  elements.sessionBody.innerHTML = `
    <div class="ps-session-head">
      <strong>${escapeHtml(session.sittingId)}</strong>
      <span>${escapeHtml(session.displayName || "Guests")}</span>
      <span>${escapeHtml(maskMobile(session.mobile || ""))}</span>
      <strong class="ps-session-timer" data-checkin="${getCheckInMs(session)}">${formatDuration(Date.now() - getCheckInMs(session))}</strong>
    </div>
    ${customers.length ? `<div class="ps-session-customers">${customers.map(renderSessionCustomerCard).join("")}</div>` : ""}
    <div class="ps-session-bill">
      <span>Rate</span><strong>₹${session.ratePerHour}/hr</strong>
      <span>Food orders</span>${foodCountCell}
      ${foodCount ? `<div class="ps-session-food-orders" hidden>${renderSessionFoodOrdersDetail(foodOrders)}</div>` : ""}
    </div>
  `;

  bindSessionFoodOrdersToggle();

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
  hideCheckoutPaymentPanels();
  if (elements.checkoutPendingName) elements.checkoutPendingName.value = "";
  if (elements.checkoutPendingMobile) elements.checkoutPendingMobile.value = "";
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
  updateCheckoutSplitValidation();
}

function hideCheckoutSplitPanel() {
  if (elements.checkoutSplitPanel) elements.checkoutSplitPanel.hidden = true;
  const actions = elements.checkoutModal?.querySelector(".ps-checkout-actions");
  if (actions && !elements.checkoutPendingPanel?.hidden) return;
  if (actions) actions.hidden = false;
}

function hideCheckoutPendingPanel() {
  if (elements.checkoutPendingPanel) elements.checkoutPendingPanel.hidden = true;
  const actions = elements.checkoutModal?.querySelector(".ps-checkout-actions");
  if (actions && !elements.checkoutSplitPanel?.hidden) return;
  if (actions) actions.hidden = false;
}

function hideCheckoutPaymentPanels() {
  hideCheckoutSplitPanel();
  hideCheckoutPendingPanel();
}

function readCheckoutPendingFormValues() {
  return {
    name: elements.checkoutPendingName?.value?.trim() || "",
    mobile: elements.checkoutPendingMobile?.value?.trim() || ""
  };
}

function buildSessionCreditProfile(session, formValues = {}) {
  const primary = session?.customers?.[0] || {};
  return normalizeCreditCustomer({
    name: formValues.name || session?.displayName || primary.name || "",
    mobile: formValues.mobile || session?.mobile || primary.mobile || ""
  });
}

function hasCheckoutCreditProfile(session, formValues = {}) {
  try {
    buildSessionCreditProfile(session, formValues);
    return true;
  } catch {
    return false;
  }
}

function prefillCheckoutPendingFields(session) {
  const primary = session?.customers?.[0] || {};
  if (elements.checkoutPendingName) {
    elements.checkoutPendingName.value = session?.displayName || primary.name || "";
  }
  if (elements.checkoutPendingMobile) {
    elements.checkoutPendingMobile.value = session?.mobile || primary.mobile || "";
  }
}

function showCheckoutPendingPanel() {
  hideCheckoutSplitPanel();
  prefillCheckoutPendingFields(state.checkoutDraft?.session);
  const actions = elements.checkoutModal?.querySelector(".ps-checkout-actions");
  if (actions) actions.hidden = true;
  if (elements.checkoutPendingPanel) elements.checkoutPendingPanel.hidden = false;
  elements.checkoutPendingName?.focus();
}

function showCheckoutSplitPanel() {
  hideCheckoutPendingPanel();
  if (elements.checkoutSplitCashAmount) elements.checkoutSplitCashAmount.value = "0";
  if (elements.checkoutSplitOnlineAmount) elements.checkoutSplitOnlineAmount.value = "0";
  if (elements.checkoutSplitCreditAmount) elements.checkoutSplitCreditAmount.value = "0";
  if (elements.checkoutSplitCreditName) elements.checkoutSplitCreditName.value = "";
  if (elements.checkoutSplitCreditMobile) elements.checkoutSplitCreditMobile.value = "";
  const actions = elements.checkoutModal?.querySelector(".ps-checkout-actions");
  if (actions) actions.hidden = true;
  if (elements.checkoutSplitPanel) elements.checkoutSplitPanel.hidden = false;
  updateCheckoutSplitValidation();
  elements.checkoutSplitCashAmount?.focus();
}

function readCheckoutSplitInput() {
  const cash = Number(elements.checkoutSplitCashAmount?.value || 0);
  const online = Number(elements.checkoutSplitOnlineAmount?.value || 0);
  const credit = Number(elements.checkoutSplitCreditAmount?.value || 0);
  return {
    cash: Number.isFinite(cash) ? cash : 0,
    online: Number.isFinite(online) ? online : 0,
    credit: Number.isFinite(credit) ? credit : 0
  };
}

function updateCheckoutSplitValidation() {
  if (!elements.checkoutSplitPanel || elements.checkoutSplitPanel.hidden) return;
  const grandTotal = Number(state.checkoutDraft?.grandTotal || 0);
  const info = computeDiscount(grandTotal, readCheckoutDiscount());
  const { cash, online, credit } = readCheckoutSplitInput();
  const entered = cash + online + credit;
  const match = entered === info.finalTotal;
  if (elements.checkoutSplitCreditCustomer) {
    elements.checkoutSplitCreditCustomer.hidden = credit <= 0;
  }
  if (elements.checkoutSplitPaymentHint) {
    const remaining = info.finalTotal - entered;
    elements.checkoutSplitPaymentHint.textContent = match
      ? `Total: ${formatCurrency(entered)}`
      : (remaining > 0
        ? `Remaining: ${formatCurrency(remaining)}`
        : `Over by ${formatCurrency(-remaining)}`);
    elements.checkoutSplitPaymentHint.classList.toggle("split-payment-hint--error", !match);
  }
  if (elements.checkoutSplitConfirmBtn) elements.checkoutSplitConfirmBtn.disabled = !match;
}

function closeCheckoutModal() {
  if (elements.checkoutModal) elements.checkoutModal.hidden = true;
  hideCheckoutPaymentPanels();
  if (elements.checkoutPendingName) elements.checkoutPendingName.value = "";
  if (elements.checkoutPendingMobile) elements.checkoutPendingMobile.value = "";
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

async function syncPendingCheckoutToSheet(draft, sittingRecord, foodResults) {
  try {
    await syncPendingOrderToSheet({
      orderId: `sitting-${draft.sessionId}`,
      tableId: draft.session.sittingId,
      customerName: sittingRecord.customerName,
      customerMobile: sittingRecord.customerMobile,
      itemsSummary: `Private Sitting (${draft.sitting.durationMinutes} min)`,
      grossTotal: sittingRecord.grossTotal,
      discountAmount: sittingRecord.discountAmount,
      total: sittingRecord.amount
    });
    await Promise.all(foodResults.map((result) => syncPendingOrderToSheet({
      orderId: result.orderId,
      tableId: result.tableId,
      customerName: result.customerName,
      customerMobile: result.customerMobile,
      itemsSummary: (result.items || [])
        .map((item) => `${item.name || "Item"} x${Number(item.qty || 0)}`)
        .join(", "),
      grossTotal: result.grossTotal,
      discountAmount: result.discountAmount,
      total: result.total
    })));
  } catch (error) {
    console.warn("[pending] Sheet sync failed", error);
  }
}

async function confirmCheckout(method, customerProfile = null) {
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
  const sittingFinal = draft.sittingAmount - sittingDiscount;
  const foodFinals = draft.foodOrders.map((order) => {
    const entry = foodOrderDiscounts.find((row) => row.orderId === (order.orderId || order.id));
    return Number(order.total || 0) - Number(entry?.discount || 0);
  });
  const isPending = method === "pending";
  const isSplit = !isPending && method && typeof method === "object";
  let sittingPayment = method;
  let foodPayments = foodOrderDiscounts.map(() => method);
  if (isSplit) {
    const allocations = allocateSplitAcrossPayments(
      [sittingFinal, ...foodFinals],
      method,
      discountInfo.finalTotal
    );
    sittingPayment = {
      cash: allocations[0].cashAmount,
      online: allocations[0].onlineAmount,
      credit: allocations[0].creditAmount || 0
    };
    foodPayments = foodOrderDiscounts.map((entry, index) => ({
      cash: allocations[index + 1].cashAmount,
      online: allocations[index + 1].onlineAmount,
      credit: allocations[index + 1].creditAmount || 0
    }));
  }

  try {
    const liveSession = getLiveSession(draft.sessionId) || draft.session;
    const sessionSnapshot = snapshotSessionForCheckout(liveSession);
    const checkOutLabel = new Date().toLocaleString();
    const sheetRowNumber = resolveSheetRowNumber(liveSession) || resolveSheetRowNumber(draft.session);
    const sessionDateKey = getSessionDateKey(liveSession);

    if (isPending) {
      const profile = buildSessionCreditProfile(
        draft.session,
        customerProfile || readCheckoutPendingFormValues()
      );

      const sittingRecord = await recordSittingCreditPending(
        draft.sessionId,
        draft.sittingAmount,
        profile,
        { type: "amount", value: sittingDiscount }
      );

      const foodResults = await Promise.all(
        foodOrderDiscounts
          .filter((entry) => entry.orderId)
          .map((entry) => markOrderCreditPending(entry.orderId, profile, {
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
        paymentMethod: "pending",
        paymentStatus: "credit_pending",
        customerName: profile.customerName,
        customerMobile: profile.customerMobile,
        customerMobileNormalized: profile.customerMobileNormalized,
        creditedAt: serverTimestamp()
      });

      void syncPendingCheckoutToSheet(draft, sittingRecord, foodResults);

      closeCheckoutModal();
      closeSessionModal();
      showToast(`${draft.session.sittingId} checked out on udhaar — ${formatCurrency(discountInfo.finalTotal)}`);

      if (sessionSnapshot) {
        runCheckoutBackground(sessionSnapshot, {
          sessionId: draft.sessionId,
          checkOutLabel,
          durationMinutes: draft.sitting.durationMinutes,
          sheetRowNumber,
          sessionDateKey
        });
      }
      return;
    }

    const sessionPayment = normalizePaymentAmounts(discountInfo.finalTotal, method);

    await recordSittingPayment(draft.sessionId, draft.sittingAmount, sittingPayment, {
      type: "amount",
      value: sittingDiscount
    });

    await Promise.all(
      foodOrderDiscounts
        .filter((entry) => entry.orderId)
        .map((entry, index) => verifyOrderPayment(entry.orderId, foodPayments[index], {
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
      paymentMethod: sessionPayment.paymentMethod,
      cashAmount: sessionPayment.cashAmount,
      onlineAmount: sessionPayment.onlineAmount
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
  } catch (error) {
    showToast(error?.message || "Checkout failed. Please try again.");
  } finally {
    state.checkoutSubmitting = false;
    setCheckoutBusy(false);
  }
}

function updateLiveTimers() {
  document.querySelectorAll(".ps-session-timer").forEach((node) => {
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
  elements.checkoutSplitBtn?.addEventListener("click", showCheckoutSplitPanel);
  elements.checkoutSplitBackBtn?.addEventListener("click", hideCheckoutSplitPanel);
  elements.checkoutPendingBtn?.addEventListener("click", handleCheckoutPendingClick);
  elements.checkoutPendingBackBtn?.addEventListener("click", hideCheckoutPendingPanel);
  elements.checkoutPendingConfirmBtn?.addEventListener("click", () => {
    try {
      buildSessionCreditProfile(state.checkoutDraft?.session, readCheckoutPendingFormValues());
    } catch (error) {
      showToast(error?.message || "Name and mobile required for udhaar");
      return;
    }
    void confirmCheckout("pending");
  });
  elements.checkoutSplitConfirmBtn?.addEventListener("click", () => {
    const grandTotal = Number(state.checkoutDraft?.grandTotal || 0);
    const info = computeDiscount(grandTotal, readCheckoutDiscount());
    const input = readCheckoutSplitInput();
    try {
      normalizePaymentAmounts(info.finalTotal, input);
    } catch (error) {
      showToast(error?.message || "Split amounts must match final payable");
      return;
    }
    if (input.credit > 0) {
      try {
        buildSessionCreditProfile(state.checkoutDraft?.session, {
          name: elements.checkoutSplitCreditName?.value || "",
          mobile: elements.checkoutSplitCreditMobile?.value || ""
        });
      } catch (error) {
        showToast(error?.message || "Name and mobile required for udhaar");
        return;
      }
    }
    if (input.credit === info.finalTotal && input.cash === 0 && input.online === 0) {
      void confirmCheckout("pending", readCheckoutPendingFormValues());
      return;
    }
    void confirmCheckout(input, input.credit > 0 ? {
      name: elements.checkoutSplitCreditName?.value || "",
      mobile: elements.checkoutSplitCreditMobile?.value || ""
    } : null);
  });
  [elements.checkoutSplitCashAmount, elements.checkoutSplitOnlineAmount, elements.checkoutSplitCreditAmount].forEach((input) => {
    input?.addEventListener("input", updateCheckoutSplitValidation);
  });
  elements.checkoutDiscountType?.addEventListener("change", updateCheckoutDiscountDisplay);
  elements.checkoutDiscountValue?.addEventListener("input", updateCheckoutDiscountDisplay);
  window.addEventListener("ps-food-order-modal-closed", handleFoodOrderModalClosed);
}

function handleCheckoutPendingClick() {
  const session = state.checkoutDraft?.session;
  if (!session) return;
  if (hasCheckoutCreditProfile(session)) {
    void confirmCheckout("pending");
    return;
  }
  showCheckoutPendingPanel();
}

export async function initPrivateSitting() {
  initIdCropCamera();
  try {
    await loadRuntimeConfig();
  } catch (error) {
    console.warn("Runtime config load failed:", error);
  }
  subscribeRuntimeConfig(() => {
    renderSittingGrid();
    if (isManagerTabActive("settings") && state.settingsMounted) {
      void renderAdminSettings(elements.settingsPanel);
    }
  });
  window.addEventListener("runtime-config-updated", () => {
    renderSittingGrid();
  });
  bindPrivateSittingUi();
  subscribePrivateSitting();
  if (state.timerHandle) clearInterval(state.timerHandle);
  state.timerHandle = setInterval(updateLiveTimers, 1000);
  renderSittingGrid();
}

export function refreshPrivateSittingView(tabId = document.body.dataset.activeTab || "orders") {
  if (tabId === "sittings") {
    renderSittingGrid();
    return;
  }
  if (tabId === "settings") {
    renderSettings();
  }
}
