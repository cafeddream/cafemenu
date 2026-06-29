import {
  appendPartyExternalItem,
  buildPartyBillDraft,
  completePartySession,
  computeDiscount,
  createPartyBooking,
  escapeHtml,
  fetchMenu,
  formatCurrency,
  formatTime,
  listenToPartySessions,
  markPartyOrdersSettled,
  normalizeCreditCustomer,
  normalizePaymentAmounts,
  PARTY_ORDER_TABLE,
  recordPartyPayment,
  setPartyOtherCharges,
  showToast,
  startPartySession,
  subscribeActiveOrders
} from "./firebase.js";
import { openAdminOrderModal } from "./admin-orders.js";

const DEFAULT_RATE = 500;

const state = {
  parties: [],
  activePartyId: null,
  orders: [],
  billDraft: null,
  bookPlannedItems: [],
  otherChargeDraft: [],
  menuLoaded: false
};

const elements = {
  panel: document.querySelector("#psPartyPanel"),
  bookModal: document.querySelector("#partyBookModal"),
  bookForm: document.querySelector("#partyBookForm"),
  bookName: document.querySelector("#partyBookName"),
  bookStart: document.querySelector("#partyBookStart"),
  bookEnd: document.querySelector("#partyBookEnd"),
  bookGathering: document.querySelector("#partyBookGathering"),
  bookRate: document.querySelector("#partyBookRate"),
  bookPlannedList: document.querySelector("#partyBookPlannedList"),
  bookNotes: document.querySelector("#partyBookNotes"),
  bookAddMenuBtn: document.querySelector("#partyBookAddMenuBtn"),
  closeBook: document.querySelector("#closePartyBook"),
  startModal: document.querySelector("#partyStartModal"),
  startBookedList: document.querySelector("#partyStartBookedList"),
  walkInForm: document.querySelector("#partyWalkInForm"),
  walkInName: document.querySelector("#partyWalkInName"),
  walkInGathering: document.querySelector("#partyWalkInGathering"),
  walkInRate: document.querySelector("#partyWalkInRate"),
  closeStart: document.querySelector("#closePartyStart"),
  activeModal: document.querySelector("#partyActiveModal"),
  activeBody: document.querySelector("#partyActiveBody"),
  activeTitle: document.querySelector("#partyActiveTitle"),
  closeActive: document.querySelector("#closePartyActive"),
  addCafeBtn: document.querySelector("#partyAddCafeOrderBtn"),
  addExternalBtn: document.querySelector("#partyAddExternalBtn"),
  closePartyBtn: document.querySelector("#partyCloseBtn"),
  externalModal: document.querySelector("#partyExternalModal"),
  externalForm: document.querySelector("#partyExternalForm"),
  externalName: document.querySelector("#partyExternalName"),
  externalQty: document.querySelector("#partyExternalQty"),
  externalRate: document.querySelector("#partyExternalRate"),
  closeExternal: document.querySelector("#closePartyExternal"),
  billModal: document.querySelector("#partyBillModal"),
  billBody: document.querySelector("#partyBillBody"),
  billDiscountType: document.querySelector("#partyBillDiscountType"),
  billDiscountValue: document.querySelector("#partyBillDiscountValue"),
  billFinalPayable: document.querySelector("#partyBillFinalPayable"),
  billPaymentActions: document.querySelector("#partyBillPaymentActions"),
  billSplitPanel: document.querySelector("#partyBillSplitPanel"),
  billSplitCash: document.querySelector("#partyBillSplitCash"),
  billSplitOnline: document.querySelector("#partyBillSplitOnline"),
  billSplitCredit: document.querySelector("#partyBillSplitCredit"),
  billSplitCreditCustomer: document.querySelector("#partyBillSplitCreditCustomer"),
  billSplitCreditName: document.querySelector("#partyBillSplitCreditName"),
  billSplitCreditMobile: document.querySelector("#partyBillSplitCreditMobile"),
  billSplitHint: document.querySelector("#partyBillSplitHint"),
  billSplitBack: document.querySelector("#partyBillSplitBack"),
  billSplitConfirm: document.querySelector("#partyBillSplitConfirm"),
  billPendingPanel: document.querySelector("#partyBillPendingPanel"),
  billPendingName: document.querySelector("#partyBillPendingName"),
  billPendingMobile: document.querySelector("#partyBillPendingMobile"),
  billPendingBack: document.querySelector("#partyBillPendingBack"),
  billPendingConfirm: document.querySelector("#partyBillPendingConfirm"),
  billCash: document.querySelector("#partyBillCash"),
  billOnline: document.querySelector("#partyBillOnline"),
  billSplit: document.querySelector("#partyBillSplit"),
  billPending: document.querySelector("#partyBillPending"),
  closeBill: document.querySelector("#closePartyBill")
};

function getParty(partyId) {
  return state.parties.find((row) => row.partyId === partyId || row.id === partyId) || null;
}

function formatSchedule(party) {
  const start = party.scheduledStart ? formatTime(party.scheduledStart) : "—";
  const end = party.scheduledEnd ? formatTime(party.scheduledEnd) : "—";
  return `${start} → ${end}`;
}

function formatDuration(ms) {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function renderPlannedItemsList(container, items) {
  if (!container) return;
  if (!items.length) {
    container.innerHTML = "<p class=\"subtle\">No items yet</p>";
    return;
  }
  container.innerHTML = items.map((item) => `
    <div class="party-line-item">
      <span>${escapeHtml(item.name)} × ${item.qty}</span>
      <span>${formatCurrency(item.qty * item.price)}</span>
    </div>
  `).join("");
}

function renderPartyHome() {
  if (!elements.panel) return;
  const active = state.parties.filter((p) => p.status === "active");
  const booked = state.parties.filter((p) => p.status === "booked");
  const completed = state.parties.filter((p) => p.status === "completed").slice(0, 5);

  elements.panel.innerHTML = `
    <div class="ps-section-head">
      <h2>Party</h2>
    </div>
    <div class="party-action-row">
      <button class="primary-btn" type="button" id="partyOpenBookBtn">Book Party</button>
      <button class="secondary-btn" type="button" id="partyOpenStartBtn">Start Party</button>
    </div>
    ${active.length ? `
      <section class="party-section">
        <h3 class="party-subhead">Active</h3>
        <div class="party-card-list">
          ${active.map((party) => `
            <button class="party-card party-card--active" type="button" data-party-open="${escapeHtml(party.partyId)}">
              <strong>${escapeHtml(party.name)}</strong>
              <span>${party.gathering} guests · ${formatCurrency(party.ratePerHour)}/hr</span>
            </button>
          `).join("")}
        </div>
      </section>
    ` : ""}
    ${booked.length ? `
      <section class="party-section">
        <h3 class="party-subhead">Upcoming</h3>
        <div class="party-card-list">
          ${booked.map((party) => `
            <article class="party-card">
              <strong>${escapeHtml(party.name)}</strong>
              <span>${formatSchedule(party)}</span>
              <span>${party.gathering} guests · ${formatCurrency(party.ratePerHour)}/hr</span>
            </article>
          `).join("")}
        </div>
      </section>
    ` : ""}
    ${completed.length ? `
      <section class="party-section">
        <h3 class="party-subhead">Completed recently</h3>
        <div class="party-card-list">
          ${completed.map((party) => `
            <article class="party-card party-card--done">
              <strong>${escapeHtml(party.name)}</strong>
              <span>${formatCurrency(party.finalTotal || party.grandTotal || 0)}</span>
            </article>
          `).join("")}
        </div>
      </section>
    ` : ""}
    ${!active.length && !booked.length && !completed.length ? "<p class=\"party-empty-hint\">No parties yet. Book or start one.</p>" : ""}
  `;

  elements.panel.querySelector("#partyOpenBookBtn")?.addEventListener("click", openBookModal);
  elements.panel.querySelector("#partyOpenStartBtn")?.addEventListener("click", openStartModal);
  elements.panel.querySelectorAll("[data-party-open]").forEach((btn) => {
    btn.addEventListener("click", () => openActiveParty(btn.dataset.partyOpen));
  });
}

export function refreshPartyView() {
  renderPartyHome();
  if (state.activePartyId) renderActivePartyBody();
}

function openBookModal() {
  state.bookPlannedItems = [];
  if (elements.bookRate) elements.bookRate.value = String(DEFAULT_RATE);
  if (elements.bookForm) elements.bookForm.reset();
  if (elements.bookRate) elements.bookRate.value = String(DEFAULT_RATE);
  renderPlannedItemsList(elements.bookPlannedList, state.bookPlannedItems);
  if (elements.bookModal) elements.bookModal.hidden = false;
}

function closeBookModal() {
  if (elements.bookModal) elements.bookModal.hidden = true;
}

function openStartModal() {
  renderStartBookedList();
  if (elements.walkInRate) elements.walkInRate.value = String(DEFAULT_RATE);
  if (elements.startModal) elements.startModal.hidden = false;
}

function closeStartModal() {
  if (elements.startModal) elements.startModal.hidden = true;
}

function renderStartBookedList() {
  if (!elements.startBookedList) return;
  const booked = state.parties.filter((p) => p.status === "booked");
  if (!booked.length) {
    elements.startBookedList.innerHTML = "<p class=\"subtle\">No scheduled bookings</p>";
    return;
  }
  elements.startBookedList.innerHTML = booked.map((party) => `
    <button class="party-card" type="button" data-party-start="${escapeHtml(party.partyId)}">
      <strong>${escapeHtml(party.name)}</strong>
      <span>${formatSchedule(party)} · ${party.gathering} guests</span>
    </button>
  `).join("");
  elements.startBookedList.querySelectorAll("[data-party-start]").forEach((btn) => {
    btn.addEventListener("click", () => void startFromBooking(btn.dataset.partyStart));
  });
}

async function startFromBooking(partyId) {
  try {
    await startPartySession(partyId);
    closeStartModal();
    openActiveParty(partyId);
    showToast("Party started");
  } catch (error) {
    showToast(error?.message || "Could not start party");
  }
}

async function submitWalkIn(event) {
  event.preventDefault();
  const name = elements.walkInName?.value?.trim() || "";
  const gathering = Number(elements.walkInGathering?.value || 0);
  const ratePerHour = Number(elements.walkInRate?.value || DEFAULT_RATE);
  if (!name) {
    showToast("Name required");
    return;
  }
  try {
    const partyId = `party-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await startPartySession(partyId, { name, gathering, ratePerHour });
    closeStartModal();
    openActiveParty(partyId);
    showToast("Walk-in party started");
  } catch (error) {
    showToast(error?.message || "Could not start party");
  }
}

async function submitBook(event) {
  event.preventDefault();
  try {
    await createPartyBooking({
      name: elements.bookName?.value,
      scheduledStart: elements.bookStart?.value,
      scheduledEnd: elements.bookEnd?.value,
      gathering: elements.bookGathering?.value,
      ratePerHour: elements.bookRate?.value || DEFAULT_RATE,
      plannedItems: state.bookPlannedItems.map((item) => ({
        itemId: item.itemId || makeItemKey(item),
        name: item.name,
        price: item.price,
        qty: item.qty
      })),
      notes: elements.bookNotes?.value
    });
    closeBookModal();
    showToast("Party booked");
  } catch (error) {
    showToast(error?.message || "Booking failed");
  }
}

function makeItemKey(item) {
  return `${item.name}|${item.price}`;
}

function openActiveParty(partyId) {
  state.activePartyId = partyId;
  const party = getParty(partyId);
  if (elements.activeTitle) elements.activeTitle.textContent = party?.name || "Active Party";
  renderActivePartyBody();
  if (elements.activeModal) elements.activeModal.hidden = false;
}

function closeActiveModal() {
  state.activePartyId = null;
  if (elements.activeModal) elements.activeModal.hidden = true;
}

function renderActivePartyBody() {
  const party = getParty(state.activePartyId);
  if (!party || !elements.activeBody) return;
  const checkInMs = party.actualStart?.toMillis?.() || Date.now();
  const bill = buildPartyBillDraft(party, state.orders);
  const timer = formatDuration(Date.now() - checkInMs);

  elements.activeBody.innerHTML = `
    <div class="party-active-meta">
      <p><strong>${escapeHtml(party.name)}</strong> · ${party.gathering} guests</p>
      <p>Timer: <span class="party-live-timer">${timer}</span> · ${formatCurrency(party.ratePerHour)}/hr</p>
      ${party.scheduledStart ? `<p class="subtle">Scheduled: ${formatSchedule(party)}</p>` : ""}
      ${party.notes ? `<p class="subtle">Notes: ${escapeHtml(party.notes)}</p>` : ""}
    </div>
    <section class="party-section">
      <h3 class="party-subhead">Cafe orders</h3>
      ${bill.cafeOrders.length ? bill.cafeOrders.map((order) => `
        <div class="party-line-item">
          <span>${escapeHtml((order.items || []).map((i) => `${i.name}×${i.qty}`).join(", "))}</span>
          <span>${formatCurrency(order.total || 0)}</span>
        </div>
      `).join("") : "<p class=\"subtle\">No cafe orders yet</p>"}
    </section>
    <section class="party-section">
      <h3 class="party-subhead">External items</h3>
      ${bill.externalItems.length ? bill.externalItems.map((item) => `
        <div class="party-line-item">
          <span>${escapeHtml(item.name)} × ${item.qty}</span>
          <span>${formatCurrency(item.qty * item.rate)}</span>
        </div>
      `).join("") : "<p class=\"subtle\">No external items</p>"}
    </section>
    <p class="party-running-total">Running total: ${formatCurrency(bill.grossTotal)}</p>
  `;
}

function openExternalModal() {
  if (elements.externalForm) elements.externalForm.reset();
  if (elements.externalQty) elements.externalQty.value = "1";
  if (elements.externalModal) elements.externalModal.hidden = false;
}

function closeExternalModal() {
  if (elements.externalModal) elements.externalModal.hidden = true;
}

async function submitExternal(event) {
  event.preventDefault();
  if (!state.activePartyId) return;
  try {
    await appendPartyExternalItem(state.activePartyId, {
      name: elements.externalName?.value,
      qty: elements.externalQty?.value,
      rate: elements.externalRate?.value
    });
    closeExternalModal();
    renderActivePartyBody();
    showToast("External item added");
  } catch (error) {
    showToast(error?.message || "Could not add item");
  }
}

function openBillModal() {
  const party = getParty(state.activePartyId);
  if (!party) return;
  state.billDraft = buildPartyBillDraft(party, state.orders);
  state.otherChargeDraft = [...(party.otherCharges || [])];
  renderBillBody();
  updateBillPayable();
  hideBillPaymentPanels();
  if (elements.billModal) elements.billModal.hidden = false;
}

function closeBillModal() {
  state.billDraft = null;
  if (elements.billModal) elements.billModal.hidden = true;
}

function renderBillBody() {
  if (!elements.billBody || !state.billDraft) return;
  const d = state.billDraft;
  elements.billBody.innerHTML = `
    <div class="party-bill-lines">
      <div class="party-line-item"><span>Party Hall (${d.hall.durationMinutes} min)</span><span>${formatCurrency(d.hallCharges)}</span></div>
      <div class="party-line-item"><span>Cafe Food</span><span>${formatCurrency(d.cafeFoodTotal)}</span></div>
      <div class="party-line-item"><span>External Food</span><span>${formatCurrency(d.externalFoodTotal)}</span></div>
      <div class="party-line-item"><span>Other Charges</span><span id="partyOtherTotal">${formatCurrency(d.otherChargesTotal)}</span></div>
    </div>
    <div class="party-other-charges">
      <label class="ps-field"><span>Add other charge</span>
        <div class="party-other-row">
          <input type="text" id="partyOtherLabel" placeholder="Label" maxlength="60">
          <input type="number" id="partyOtherAmount" min="1" step="1" placeholder="₹">
          <button class="secondary-btn" type="button" id="partyAddOtherBtn">Add</button>
        </div>
      </label>
      <div id="partyOtherList">${state.otherChargeDraft.map((row) => `
        <div class="party-line-item"><span>${escapeHtml(row.label)}</span><span>${formatCurrency(row.amount)}</span></div>
      `).join("")}</div>
    </div>
    <p class="party-bill-gross"><strong>Gross: ${formatCurrency(computeBillGross())}</strong></p>
  `;
  elements.billBody.querySelector("#partyAddOtherBtn")?.addEventListener("click", addOtherChargeRow);
}

function computeBillGross() {
  if (!state.billDraft) return 0;
  const otherTotal = state.otherChargeDraft.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  return state.billDraft.hallCharges + state.billDraft.cafeFoodTotal + state.billDraft.externalFoodTotal + otherTotal;
}

function addOtherChargeRow() {
  const label = elements.billBody?.querySelector("#partyOtherLabel")?.value?.trim() || "";
  const amount = Number(elements.billBody?.querySelector("#partyOtherAmount")?.value || 0);
  if (!label || amount <= 0) {
    showToast("Label and amount required");
    return;
  }
  state.otherChargeDraft.push({ label, amount: Math.round(amount) });
  renderBillBody();
  updateBillPayable();
}

function readBillDiscount() {
  return {
    type: elements.billDiscountType?.value || "amount",
    value: Number(elements.billDiscountValue?.value || 0)
  };
}

function updateBillPayable() {
  const gross = computeBillGross();
  const info = computeDiscount(gross, readBillDiscount());
  if (elements.billFinalPayable) {
    elements.billFinalPayable.textContent = `Final Payable: ${formatCurrency(info.finalTotal)}`;
  }
  updateBillSplitValidation();
}

function hideBillPaymentPanels() {
  if (elements.billSplitPanel) elements.billSplitPanel.hidden = true;
  if (elements.billPendingPanel) elements.billPendingPanel.hidden = true;
  if (elements.billPaymentActions) elements.billPaymentActions.hidden = false;
}

function showBillSplitPanel() {
  if (elements.billSplitCash) elements.billSplitCash.value = "0";
  if (elements.billSplitOnline) elements.billSplitOnline.value = "0";
  if (elements.billSplitCredit) elements.billSplitCredit.value = "0";
  if (elements.billPaymentActions) elements.billPaymentActions.hidden = true;
  if (elements.billPendingPanel) elements.billPendingPanel.hidden = true;
  if (elements.billSplitPanel) elements.billSplitPanel.hidden = false;
  updateBillSplitValidation();
}

function showBillPendingPanel() {
  if (elements.billPaymentActions) elements.billPaymentActions.hidden = true;
  if (elements.billSplitPanel) elements.billSplitPanel.hidden = true;
  if (elements.billPendingPanel) elements.billPendingPanel.hidden = false;
}

function readBillSplitInput() {
  return {
    cash: Number(elements.billSplitCash?.value || 0) || 0,
    online: Number(elements.billSplitOnline?.value || 0) || 0,
    credit: Number(elements.billSplitCredit?.value || 0) || 0
  };
}

function updateBillSplitValidation() {
  if (!elements.billSplitPanel || elements.billSplitPanel.hidden) return;
  const info = computeDiscount(computeBillGross(), readBillDiscount());
  const { cash, online, credit } = readBillSplitInput();
  const entered = cash + online + credit;
  const match = entered === info.finalTotal;
  if (elements.billSplitCreditCustomer) elements.billSplitCreditCustomer.hidden = credit <= 0;
  if (elements.billSplitHint) {
    const remaining = info.finalTotal - entered;
    elements.billSplitHint.textContent = match
      ? `Total: ${formatCurrency(entered)}`
      : (remaining > 0 ? `Remaining: ${formatCurrency(remaining)}` : `Over by ${formatCurrency(-remaining)}`);
    elements.billSplitHint.classList.toggle("split-payment-hint--error", !match);
  }
  if (elements.billSplitConfirm) elements.billSplitConfirm.disabled = !match;
}

async function finalizePartyPayment(method, customerProfile = null) {
  const partyId = state.activePartyId;
  const party = getParty(partyId);
  if (!party || !state.billDraft) return;

  const gross = computeBillGross();
  const discount = readBillDiscount();
  const discountInfo = computeDiscount(gross, discount);

  try {
    if (method !== "pending" && typeof method === "object" && (method.credit || 0) > 0) {
      normalizeCreditCustomer(customerProfile || {
        name: elements.billSplitCreditName?.value || elements.billPendingName?.value,
        mobile: elements.billSplitCreditMobile?.value || elements.billPendingMobile?.value
      });
    } else if (method === "pending") {
      normalizeCreditCustomer(customerProfile || {
        name: elements.billPendingName?.value,
        mobile: elements.billPendingMobile?.value
      });
    }
  } catch (error) {
    showToast(error?.message || "Name and mobile required for udhaar");
    return;
  }

  const customer = method === "pending" || (typeof method === "object" && (method.credit || 0) > 0)
    ? normalizeCreditCustomer(customerProfile || {
      name: elements.billSplitCreditName?.value || elements.billPendingName?.value,
      mobile: elements.billSplitCreditMobile?.value || elements.billPendingMobile?.value
    })
    : {};

  try {
    await setPartyOtherCharges(partyId, state.otherChargeDraft);
    const payment = normalizePaymentAmounts(discountInfo.finalTotal, method);

    await recordPartyPayment(partyId, gross, method, discount, customer);

    await markPartyOrdersSettled(
      state.billDraft.cafeOrders.map((order) => order.orderId || order.id)
    );

    await completePartySession(partyId, {
      hallCharges: state.billDraft.hallCharges,
      cafeFoodTotal: state.billDraft.cafeFoodTotal,
      externalFoodTotal: state.billDraft.externalFoodTotal,
      otherCharges: state.otherChargeDraft,
      otherChargesTotal: state.otherChargeDraft.reduce((s, r) => s + r.amount, 0),
      grossTotal: discountInfo.grossTotal,
      discountType: discountInfo.discountType,
      discountValue: discountInfo.discountValue,
      discountAmount: discountInfo.discountAmount,
      finalTotal: discountInfo.finalTotal,
      grandTotal: discountInfo.finalTotal,
      paymentMethod: payment.paymentMethod,
      paymentStatus: payment.creditAmount === discountInfo.finalTotal ? "credit_pending" : "verified_paid",
      cashAmount: payment.cashAmount,
      onlineAmount: payment.onlineAmount,
      creditAmount: payment.creditAmount || 0,
      customerName: customer.customerName || null,
      customerMobile: customer.customerMobile || null,
      customerMobileNormalized: customer.customerMobileNormalized || null
    });

    closeBillModal();
    closeActiveModal();
    showToast(`Party closed — ${formatCurrency(discountInfo.finalTotal)}`);
  } catch (error) {
    showToast(error?.message || "Payment failed");
  }
}

function bindPartyUi() {
  elements.closeBook?.addEventListener("click", closeBookModal);
  elements.bookForm?.addEventListener("submit", submitBook);
  elements.bookAddMenuBtn?.addEventListener("click", () => {
    openAdminOrderModal(PARTY_ORDER_TABLE, {
      planOnly: true,
      onPlanConfirm: (items) => {
        state.bookPlannedItems = items;
        renderPlannedItemsList(elements.bookPlannedList, state.bookPlannedItems);
      }
    });
  });
  elements.closeStart?.addEventListener("click", closeStartModal);
  elements.walkInForm?.addEventListener("submit", submitWalkIn);
  elements.closeActive?.addEventListener("click", closeActiveModal);
  elements.addCafeBtn?.addEventListener("click", () => {
    if (!state.activePartyId) return;
    openAdminOrderModal(PARTY_ORDER_TABLE, { partyId: state.activePartyId });
  });
  elements.addExternalBtn?.addEventListener("click", openExternalModal);
  elements.closeExternal?.addEventListener("click", closeExternalModal);
  elements.externalForm?.addEventListener("submit", submitExternal);
  elements.closePartyBtn?.addEventListener("click", openBillModal);
  elements.closeBill?.addEventListener("click", closeBillModal);
  elements.billCash?.addEventListener("click", () => void finalizePartyPayment("cash"));
  elements.billOnline?.addEventListener("click", () => void finalizePartyPayment("online"));
  elements.billSplit?.addEventListener("click", showBillSplitPanel);
  elements.billPending?.addEventListener("click", showBillPendingPanel);
  elements.billSplitBack?.addEventListener("click", hideBillPaymentPanels);
  elements.billPendingBack?.addEventListener("click", hideBillPaymentPanels);
  elements.billSplitConfirm?.addEventListener("click", () => {
    const info = computeDiscount(computeBillGross(), readBillDiscount());
    const input = readBillSplitInput();
    try {
      normalizePaymentAmounts(info.finalTotal, input);
    } catch (error) {
      showToast(error?.message || "Amounts must match payable");
      return;
    }
    if (input.credit === info.finalTotal) {
      void finalizePartyPayment("pending");
      return;
    }
    void finalizePartyPayment(input);
  });
  elements.billPendingConfirm?.addEventListener("click", () => void finalizePartyPayment("pending"));
  [elements.billSplitCash, elements.billSplitOnline, elements.billSplitCredit].forEach((input) => {
    input?.addEventListener("input", updateBillSplitValidation);
  });
  elements.billDiscountType?.addEventListener("change", updateBillPayable);
  elements.billDiscountValue?.addEventListener("input", updateBillPayable);
}

export function initPartyOrders() {
  if (!elements.panel) return;
  bindPartyUi();
  listenToPartySessions((parties) => {
    state.parties = parties;
    renderPartyHome();
    if (state.activePartyId) renderActivePartyBody();
  });
  subscribeActiveOrders((orders) => {
    state.orders = orders;
    if (state.activePartyId) renderActivePartyBody();
  });
  void fetchMenu().then(() => { state.menuLoaded = true; });
  renderPartyHome();
}
