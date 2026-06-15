import { parseAadhaarQrPayload, scanAadhaarQr } from "./aadhaar-qr.js";
import {
  CONFIG,
  buildCustomerDisplayName,
  calculateSittingBill,
  completePrivateSession,
  createPrivateSession,
  escapeHtml,
  formatCurrency,
  formatTime,
  getPrivateSittingConfig,
  getTodayKey,
  listenToActivePrivateSessions,
  listenToPrivateSessions,
  maskMobile,
  showToast,
  updatePrivateSession
} from "./firebase.js";
import { buildSittingEntryHtmlPreview, buildSittingEntryPdf } from "./private-sitting-pdf.js";
import { isSittingSyncConfigured, syncSittingCheckIn, syncSittingCheckout } from "./sitting-sync.js";

const state = {
  activeSessions: new Map(),
  allSessions: [],
  selectedSittingId: null,
  selectedSessionId: null,
  checkInDraft: null,
  qrStop: null,
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
  sessionModal: document.querySelector("#psSessionModal"),
  sessionBody: document.querySelector("#psSessionBody"),
  closeCheckIn: document.querySelector("#closePsCheckIn"),
  closeSession: document.querySelector("#closePsSession"),
  confirmCheckIn: document.querySelector("#confirmPsCheckIn"),
  endSessionBtn: document.querySelector("#endPsSession")
};

function emptyCustomer() {
  return { name: "", idNumber: "", dob: "", gender: "", photoDataUrl: "", qrScanned: false };
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

function getCheckInMs(session) {
  return session?.checkInAt?.toMillis?.() || Date.now();
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
    .reduce((sum, session) => sum + Number(session.billedAmount || 0), 0);
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
      class="ps-sitting-card ${sitting.theme} ${sitting.wide ? "ps-wide" : ""} ${occupied ? "occupied" : "available"}"
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
      <strong>${formatCurrency(session.billedAmount || 0)}</strong>
    </article>
  `).join("");
}

function renderSettings() {
  if (!elements.settingsPanel) return;
  const syncReady = isSittingSyncConfigured();
  elements.settingsPanel.innerHTML = `
    <section class="ps-settings-card">
      <h3>Google Sync</h3>
      <p>${syncReady ? "Apps Script URL configured." : "Add CONFIG.APPS_SCRIPT_URL in firebase.js after deploying google-apps-script/private-sitting-sync.gs."}</p>
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
}

function renderPrivateSitting() {
  renderStats();
  renderActiveCustomers();
  renderSittingGrid();
  renderReports();
  renderSettings();
}

function customerBlockHtml(customer, index) {
  return `
    <section class="ps-customer-block" data-customer-index="${index}">
      <div class="ps-customer-head">
        <h3>Customer ${index + 1}</h3>
        <button class="ghost-btn ps-scan-qr-btn" type="button" data-scan-index="${index}">Scan Aadhaar QR</button>
      </div>
      <label class="ps-field">
        <span>Name</span>
        <input type="text" name="name-${index}" value="${escapeHtml(customer.name)}" maxlength="60" required>
      </label>
      <label class="ps-field">
        <span>ID Number</span>
        <input type="text" name="idNumber-${index}" value="${escapeHtml(customer.idNumber)}" maxlength="20" required>
      </label>
      <label class="ps-field">
        <span>Date of Birth</span>
        <input type="text" name="dob-${index}" value="${escapeHtml(customer.dob)}" placeholder="DD/MM/YYYY" required>
      </label>
      <label class="ps-field">
        <span>Gender</span>
        <input type="text" name="gender-${index}" value="${escapeHtml(customer.gender)}" maxlength="10">
      </label>
      <div class="ps-photo-row">
        <button class="secondary-btn ps-photo-btn" type="button" data-photo-index="${index}">Capture ID Photo ${index + 1}</button>
        <input type="file" accept="image/*" capture="environment" hidden data-photo-input="${index}">
        ${customer.photoDataUrl ? `<img class="ps-photo-preview" src="${customer.photoDataUrl}" alt="Customer ${index + 1} ID photo">` : `<div class="ps-photo-preview empty">No photo yet</div>`}
      </div>
    </section>
  `;
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

  elements.checkInForm.querySelectorAll("[data-scan-index]").forEach((button) => {
    button.onclick = async () => {
      try {
        if (state.qrStop) await state.qrStop();
        state.qrStop = await scanAadhaarQr((parsed) => {
          const idx = Number(button.dataset.scanIndex);
          draft.customers[idx] = { ...draft.customers[idx], ...parsed, qrScanned: true };
          renderCheckInForm();
          updateCheckInPreview();
        }, () => showToast("QR scanner unavailable"));
      } catch {
        showToast("Could not open QR scanner");
      }
    };
  });

  elements.checkInForm.querySelectorAll("[data-photo-index]").forEach((button) => {
    const input = elements.checkInForm.querySelector(`[data-photo-input="${button.dataset.photoIndex}"]`);
    button.onclick = () => input?.click();
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const idx = Number(button.dataset.photoIndex);
      draft.customers[idx].photoDataUrl = await readFileAsDataUrl(file);
      renderCheckInForm();
      updateCheckInPreview();
    };
  });

  elements.checkInForm.oninput = () => {
    draft.mobile = elements.checkInForm.querySelector('[name="mobile"]')?.value || "";
    draft.customers = draft.customers.map((customer, index) => ({
      ...customer,
      name: elements.checkInForm.querySelector(`[name="name-${index}"]`)?.value || "",
      idNumber: elements.checkInForm.querySelector(`[name="idNumber-${index}"]`)?.value || "",
      dob: elements.checkInForm.querySelector(`[name="dob-${index}"]`)?.value || "",
      gender: elements.checkInForm.querySelector(`[name="gender-${index}"]`)?.value || ""
    }));
    updateCheckInPreview();
  };
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
  const ready = state.checkInDraft.customers.every((customer) => customer.photoDataUrl);
  if (!ready) {
    elements.checkInPreview.innerHTML = `<p class="ps-empty-note">Capture both ID photos to generate entry preview.</p>`;
    return;
  }
  elements.checkInPreview.innerHTML = buildSittingEntryHtmlPreview(state.checkInDraft);
}

function openCheckInModal(sittingId) {
  state.checkInDraft = createCheckInDraft(sittingId);
  state.selectedSittingId = sittingId;
  if (elements.checkInTitle) elements.checkInTitle.textContent = `Check-in — ${sittingId}`;
  renderCheckInForm();
  updateCheckInPreview();
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
    if (!customer.name?.trim() || !customer.idNumber?.trim() || !customer.dob?.trim()) {
      showToast(`Complete Customer ${i + 1} details`);
      return false;
    }
    if (!customer.photoDataUrl) {
      showToast(`Capture Customer ${i + 1} ID photo`);
      return false;
    }
  }
  return true;
}

async function submitCheckIn() {
  const draft = state.checkInDraft;
  if (!draft || !validateCheckInDraft(draft)) return;

  const sitting = getPrivateSittingConfig(draft.sittingId);
  if (!sitting) return;

  elements.confirmCheckIn.disabled = true;
  try {
    const checkInLabel = new Date().toLocaleString();
    const pdfDataUrl = await buildSittingEntryPdf({
      sittingId: draft.sittingId,
      mobile: draft.mobile,
      customers: draft.customers,
      checkInLabel
    });

    const customers = draft.customers.map((customer) => ({
      name: customer.name.trim(),
      idNumber: customer.idNumber.trim(),
      dob: customer.dob.trim(),
      gender: customer.gender.trim(),
      qrScanned: Boolean(customer.qrScanned)
    }));

    const sessionId = await createPrivateSession({
      sittingId: draft.sittingId,
      mobile: draft.mobile,
      customers,
      displayName: buildCustomerDisplayName(customers),
      ratePerHour: sitting.ratePerHour
    });

    try {
      const syncResult = await syncSittingCheckIn({
        sessionId,
        sittingId: draft.sittingId,
        mobile: draft.mobile,
        customers,
        photos: draft.customers.map((customer) => (customer.photoDataUrl || "").split(",")[1] || ""),
        pdfBase64: pdfDataUrl.split(",")[1] || "",
        checkInLabel,
        dateKey: getTodayKey()
      });

      if (syncResult?.ok) {
        await updatePrivateSession(sessionId, {
          sheetSynced: true,
          sheetRowNumber: syncResult.rowNumber,
          driveFolderUrl: syncResult.driveFolderUrl || "",
          photo1DriveUrl: syncResult.photo1DriveUrl || "",
          photo2DriveUrl: syncResult.photo2DriveUrl || "",
          pdfDriveUrl: syncResult.pdfDriveUrl || ""
        });
      } else if (!syncResult?.skipped) {
        showToast("Saved locally. Google sync pending.");
      }
    } catch {
      showToast("Check-in saved. Google sync failed — retry from settings later.");
    }

    closeCheckInModal();
    showToast(`${draft.sittingId} checked in`);
  } catch {
    showToast("Check-in failed. Please try again.");
  } finally {
    elements.confirmCheckIn.disabled = false;
  }
}

function openSessionModal(sessionId) {
  const session = state.activeSessions.get(sessionId);
  if (!session || !elements.sessionBody) return;
  state.selectedSessionId = sessionId;
  const billPreview = calculateSittingBill(session.checkInAt, session.ratePerHour);
  const customers = session.customers || [];

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
        <div>ID: ${escapeHtml(customer.idNumber || "-")}</div>
        <div>DOB: ${escapeHtml(customer.dob || "-")}</div>
      </section>
    `).join("")}
    <div class="ps-session-bill">
      <span>Rate</span><strong>₹${session.ratePerHour}/hr</strong>
      <span>Current bill</span><strong>${formatCurrency(billPreview.billedAmount)}</strong>
    </div>
  `;
  if (elements.sessionModal) elements.sessionModal.hidden = false;
}

function closeSessionModal() {
  if (elements.sessionModal) elements.sessionModal.hidden = true;
  state.selectedSessionId = null;
}

async function endSelectedSession() {
  const sessionId = state.selectedSessionId;
  const session = state.activeSessions.get(sessionId);
  if (!session) return;

  elements.endSessionBtn.disabled = true;
  try {
    const checkout = calculateSittingBill(session.checkInAt, session.ratePerHour);
    await completePrivateSession(sessionId, {
      durationMinutes: checkout.durationMinutes,
      billedMinutes: checkout.billedMinutes,
      billedAmount: checkout.billedAmount
    });

    if (session.sheetRowNumber) {
      try {
        await syncSittingCheckout({
          sessionId,
          sheetRowNumber: session.sheetRowNumber,
          checkOutLabel: new Date().toLocaleString(),
          durationMinutes: checkout.durationMinutes,
          billedAmount: checkout.billedAmount
        });
      } catch {
        showToast("Session ended. Sheet update failed.");
      }
    }

    closeSessionModal();
    showToast(`${session.sittingId} ended — ${formatCurrency(checkout.billedAmount)}`);
  } catch {
    showToast("Could not end session");
  } finally {
    elements.endSessionBtn.disabled = false;
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
  elements.endSessionBtn?.addEventListener("click", endSelectedSession);
}

function subscribePrivateSitting() {
  listenToActivePrivateSessions((sessions) => {
    state.activeSessions = new Map(
      sessions.map((session) => [session.sessionId || session.id, session])
    );
    renderPrivateSitting();
  }, () => showToast("Private sitting connection error"));

  listenToPrivateSessions((sessions) => {
    state.allSessions = sessions;
    renderStats();
    renderReports();
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
