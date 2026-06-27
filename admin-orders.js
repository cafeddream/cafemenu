import {
  CONFIG,
  STATUS_LABELS,
  cancelActiveOrder,
  clearActiveOrder,
  computeDiscount,
  escapeHtml,
  fetchMenu,
  formatCurrency,
  formatTableDisplayName,
  formatTime,
  normalizePaymentAmounts,
  subscribeActiveOrders,
  markOrderCreditPending,
  maskMobile,
  normalizeCreditCustomer,
  placeCounterOrderWithCredit,
  placeCounterOrderWithPayment,
  placePrivateSittingFoodOrder,
  registerServiceWorker,
  showRichToast,
  showToast,
  updateActiveOrderStatus,
  verifyOrderPayment,
  voidActiveOrder,
  voidPendingCounterOrder
} from "./firebase.js";
import { syncPendingOrderToSheet } from "./report-sync.js";
import {
  shareReceiptForOrder,
  shareReceiptForOrderId
} from "./receipt-share.js";
import {
  buildMenuState,
  getCartTotals,
  renderCartList,
  renderCategoryRow,
  renderMenuList,
  updateCartItem
} from "./menu-cart.js";

const COUNTER_TABLE_ID = "COUNTER";

const state = {
  orders: new Map(),
  knownActive: new Set(),
  previousOrderIds: new Set(),
  previousPendingItemKeys: new Set(),
  hasReceivedOrdersSnapshot: false,
  hasNewCounterNotice: false,
  highlightTimers: new Map(),
  pendingPaidTable: null,
  pendingPaidOrderId: null,
  pendingPaymentItems: null,
  pendingPaymentIsCounterOrder: false,
  pendingPaymentGross: 0,
  pendingPaymentCustomerProfile: null,
  paymentVoidMode: false,
  hoverPreview: null,
  orderTableId: null,
  groupedMenu: {},
  categories: [],
  activeCategory: "",
  cart: new Map(),
  menuLoaded: false,
  menuSearchQuery: "",
  orderModalOptions: { deferPayment: false, sessionId: null }
};

let adminAudioContext = null;

const elements = {
  restaurant: document.querySelector("#adminRestaurant"),
  clock: document.querySelector("#managerClock") || document.querySelector("#clock"),
  tableGrid: document.querySelector("#psOrdersGrid"),
  newCounterOrderBtn: document.querySelector("#newCounterOrderBtn"),
  ordersView: document.querySelector("#psOrders"),
  signOutBtn: document.querySelector("#signOutBtn"),
  paymentMethodModal: document.querySelector("#paymentMethodModal"),
  closePaymentMethod: document.querySelector("#closePaymentMethod"),
  paymentMethodTable: document.querySelector("#paymentMethodTable"),
  paymentDiscountType: document.querySelector("#paymentDiscountType"),
  paymentDiscountValue: document.querySelector("#paymentDiscountValue"),
  paymentFinalPayable: document.querySelector("#paymentFinalPayable"),
  paymentDiscountControl: document.querySelector("#paymentDiscountControl"),
  paymentMethodActions: document.querySelector("#paymentMethodActions"),
  paidCashBtn: document.querySelector("#paidCashBtn"),
  paidOnlineBtn: document.querySelector("#paidOnlineBtn"),
  paidSplitBtn: document.querySelector("#paidSplitBtn"),
  splitPaymentPanel: document.querySelector("#splitPaymentPanel"),
  splitOnlineAmount: document.querySelector("#splitOnlineAmount"),
  splitCashAmount: document.querySelector("#splitCashAmount"),
  splitPaymentHint: document.querySelector("#splitPaymentHint"),
  splitPaymentBackBtn: document.querySelector("#splitPaymentBackBtn"),
  splitConfirmBtn: document.querySelector("#splitConfirmBtn"),
  paidPendingBtn: document.querySelector("#paidPendingBtn"),
  pendingCustomerPanel: document.querySelector("#pendingCustomerPanel"),
  pendingCustomerName: document.querySelector("#pendingCustomerName"),
  pendingCustomerMobile: document.querySelector("#pendingCustomerMobile"),
  pendingCustomerConfirmBtn: document.querySelector("#pendingCustomerConfirmBtn"),
  voidOrderBtn: document.querySelector("#voidOrderBtn"),
  voidOrderPanel: document.querySelector("#voidOrderPanel"),
  voidOrderRemarks: document.querySelector("#voidOrderRemarks"),
  voidOrderBackBtn: document.querySelector("#voidOrderBackBtn"),
  voidOrderConfirmBtn: document.querySelector("#voidOrderConfirmBtn"),
  adminOrderModal: document.querySelector("#adminOrderModal"),
  closeAdminOrder: document.querySelector("#closeAdminOrder"),
  adminOrderTitle: document.querySelector("#adminOrderTitle"),
  adminOrderMenuScreen: document.querySelector("#adminOrderMenuScreen"),
  adminOrderCartScreen: document.querySelector("#adminOrderCartScreen"),
  adminCategoryRow: document.querySelector("#adminCategoryRow"),
  adminMenuSearch: document.querySelector("#adminMenuSearch"),
  adminMenuList: document.querySelector("#adminMenuList"),
  adminCartList: document.querySelector("#adminCartList"),
  adminGrandTotal: document.querySelector("#adminGrandTotal"),
  adminBackToMenu: document.querySelector("#adminBackToMenu"),
  adminOrderCount: document.querySelector("#adminOrderCount"),
  adminOrderTotal: document.querySelector("#adminOrderTotal"),
  adminViewCartBtn: document.querySelector("#adminViewCartBtn"),
  adminPlaceOrderBtn: document.querySelector("#adminPlaceOrderBtn"),
  adminOrderCustomerFields: document.querySelector("#adminOrderCustomerFields"),
  adminCustomerName: document.querySelector("#adminCustomerName"),
  adminCustomerMobile: document.querySelector("#adminCustomerMobile")
};

// Starts the food orders counter inside the Orders tab.
export function initAdminOrders() {
  if (!elements.tableGrid) return;
  registerServiceWorker();
  const brandText = elements.restaurant?.querySelector(".ps-brand-text");
  if (brandText) brandText.textContent = CONFIG.RESTAURANT_NAME;
  else if (elements.restaurant) elements.restaurant.textContent = CONFIG.RESTAURANT_NAME;
  bindUi();
  startAdminApp();
}

function startAdminApp() {
  renderCounterOrders();
  startClock();
  subscribeToTables();
  preloadMenu();
  window.addEventListener("menu-updated", () => {
    void preloadMenu();
  });
}

function bindUi() {
  elements.closePaymentMethod.addEventListener("click", closePaymentMethodModal);
  elements.paymentMethodModal.addEventListener("click", (event) => {
    if (event.target === elements.paymentMethodModal) closePaymentMethodModal();
  });
  elements.paidCashBtn.addEventListener("click", () => confirmPaidWithMethod("cash"));
  elements.paidOnlineBtn.addEventListener("click", () => confirmPaidWithMethod("online"));
  elements.paidSplitBtn?.addEventListener("click", showSplitPaymentPanel);
  elements.splitPaymentBackBtn?.addEventListener("click", hideSplitPaymentPanel);
  elements.splitConfirmBtn?.addEventListener("click", () => void confirmSplitPayment());
  elements.splitOnlineAmount?.addEventListener("input", updateSplitPaymentValidation);
  elements.splitCashAmount?.addEventListener("input", updateSplitPaymentValidation);
  elements.paidPendingBtn?.addEventListener("click", handlePendingPaymentClick);
  elements.pendingCustomerConfirmBtn?.addEventListener("click", confirmPendingCustomerPanel);
  elements.voidOrderBtn?.addEventListener("click", showVoidOrderPanel);
  elements.voidOrderBackBtn?.addEventListener("click", hideVoidOrderPanel);
  elements.voidOrderConfirmBtn?.addEventListener("click", confirmVoidOrder);
  elements.paymentDiscountType?.addEventListener("change", () => {
    updatePaymentDiscountDisplay();
    updateSplitPaymentValidation();
  });
  elements.paymentDiscountValue?.addEventListener("input", () => {
    updatePaymentDiscountDisplay();
    updateSplitPaymentValidation();
  });
  elements.closeAdminOrder.addEventListener("click", closeAdminOrderModal);
  elements.adminOrderModal.addEventListener("click", (event) => {
    if (event.target === elements.adminOrderModal) closeAdminOrderModal();
  });
  elements.adminBackToMenu.addEventListener("click", () => showAdminOrderScreen("menu"));
  elements.adminMenuSearch?.addEventListener("input", () => {
    state.menuSearchQuery = elements.adminMenuSearch?.value || "";
    renderAdminMenu();
  });
  elements.adminViewCartBtn.addEventListener("click", () => {
    renderAdminCart();
    showAdminOrderScreen("cart");
  });
  elements.adminPlaceOrderBtn.addEventListener("click", placeAdminOrder);
  elements.newCounterOrderBtn?.addEventListener("click", () => {
    void openAdminOrderModal(COUNTER_TABLE_ID);
  });
  window.addEventListener("scroll", hideAdminHoverPreview, true);
  window.addEventListener("resize", hideAdminHoverPreview);
  window.addEventListener("pointerdown", unlockAdminAudio, { once: true });
  window.addEventListener("keydown", unlockAdminAudio, { once: true });
}

async function preloadMenu() {
  try {
    const items = await fetchMenu();
    const menuState = buildMenuState(items);
    state.groupedMenu = menuState.groupedMenu;
    state.categories = menuState.categories;
    state.activeCategory = menuState.activeCategory;
    state.menuLoaded = Boolean(state.activeCategory);
  } catch {
    // Menu loads again when opening order modal.
  }
}

function startClock() {
  if (!elements.clock) return;
  const tick = () => {
    elements.clock.textContent = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  };
  tick();
  setInterval(tick, 1000);
}

function renderEmptyCards() {
  renderCounterOrders();
}

function subscribeToTables() {
  subscribeActiveOrders((orders) => {
    const previousOrderIds = new Set(state.previousOrderIds);
    const previousPendingItemKeys = new Set(state.previousPendingItemKeys);
    const notifications = [];
    state.orders.clear();
    state.knownActive.clear();
    state.previousPendingItemKeys.clear();
    orders.forEach((order) => {
      const orderId = order.orderId || order.id;
      state.orders.set(orderId, { ...order, orderId });
      if (order.tableId === COUNTER_TABLE_ID) {
        state.knownActive.add(orderId);
      }
      getPendingItemKeys({ ...order, orderId }).forEach((key) => state.previousPendingItemKeys.add(key));
    });
    state.previousOrderIds = new Set(state.orders.keys());
    if (state.hasReceivedOrdersSnapshot) {
      state.orders.forEach((order) => {
        if (order.tableId !== COUNTER_TABLE_ID) return;
        const isNewOrder = !previousOrderIds.has(order.orderId);
        const hasNewItems = getPendingItemKeys(order).some((key) => !previousPendingItemKeys.has(key));
        if (isNewOrder || hasNewItems) {
          markAdminNotice();
          notifications.push({ order, isNewOrder });
        }
      });
    } else {
      state.hasReceivedOrdersSnapshot = true;
    }
    const flashedOrder = notifications[0]?.order || null;
    notifications.forEach(({ order, isNewOrder }) => notifyAdminOrder(order, isNewOrder));
    renderCounterOrders(flashedOrder?.orderId || null);
  }, () => showToast("Connection error, please refresh"));
}

function getCounterOrders() {
  return [...state.orders.values()]
    .filter((order) => order.tableId === COUNTER_TABLE_ID)
    .sort((a, b) => (a.timestamp?.toMillis?.() || 0) - (b.timestamp?.toMillis?.() || 0));
}

function renderCounterOrders(flashOrderId = null) {
  if (!elements.tableGrid) return;

  const orders = getCounterOrders();
  const headClass = state.hasNewCounterNotice ? "ps-counter-orders-head ps-counter-orders-head--alert" : "ps-counter-orders-head";
  const head = elements.ordersView?.querySelector(".ps-counter-orders-head");
  if (head) head.className = headClass;

  elements.tableGrid.innerHTML = orders.length
    ? `<div class="ps-order-list">${orders.map((order) => {
      const flash = flashOrderId && (order.orderId || order.id) === flashOrderId;
      return mobileOrderCardHtml(order, flash);
    }).join("")}</div>`
    : "<p class=\"subtle ps-order-empty\">No counter orders yet. Tap New Order to start.</p>";

  bindOrderActionButtons(elements.tableGrid);
}

function getOrdersForTable(tableId) {
  return [...state.orders.values()]
    .filter((order) => order.tableId === tableId)
    .sort((a, b) => (a.timestamp?.toMillis?.() || 0) - (b.timestamp?.toMillis?.() || 0));
}

function hasPendingItems(order) {
  return (order.items || []).some((item) => item.status !== "served");
}

function getOrderStatusLabel(order) {
  if (order.paymentStatus === "voided") {
    const status = order.status || "new";
    if (status === "served") return "Served (Void)";
    return "Payment Void";
  }
  if (order.paymentStatus === "credit_pending") {
    const status = order.status || "new";
    if (status === "served") return "Served (Udhaar)";
    return "Udhaar";
  }
  const status = order.status || "new";
  const paymentVerified = order.paymentStatus === "verified_paid";
  if (paymentVerified && status === "served") return "Served";
  if (paymentVerified) return "Payment Verified";
  return STATUS_LABELS[status] || status;
}

function mobileOrderCardHtml(order, flash = false) {
  const status = order.status || "new";
  const paymentVerified = order.paymentStatus === "verified_paid";
  const paymentVoided = order.paymentStatus === "voided";
  const paymentCredit = order.paymentStatus === "credit_pending";
  const statusLabel = getOrderStatusLabel(order);
  const statusClass = status === "served" || (paymentVerified && status === "served")
    ? "ps-order-status-served"
    : paymentVoided
      ? "ps-order-status-void"
      : paymentCredit
        ? "ps-order-status-pending"
      : status === "preparing"
      ? "ps-order-status-preparing"
      : "ps-order-status-new";
  const customerLine = order.customerName || order.customerMobileNormalized
    ? `<div class="ps-order-customer">${escapeHtml(order.customerName || "Customer")} ${order.customerMobileNormalized ? `<span>${escapeHtml(maskMobile(order.customerMobileNormalized))}</span>` : ""}</div>`
    : "";
  const itemLines = (order.items || []).map((item) => `
    <li class="ps-order-line">
      <span>${Number(item.qty || 0)}x ${escapeHtml(item.name)}</span>
      <strong>${formatCurrency(Number(item.price || 0) * Number(item.qty || 0))}</strong>
    </li>
  `).join("");
  const clearOrderEnabled = !hasPendingItems(order);

  return `
    <article class="ps-order-card status-${escapeHtml(status)} ${flash ? "flash" : ""}" data-order="${escapeHtml(order.orderId || order.id)}">
      <div class="ps-order-card-head">
        <div class="ps-order-card-meta">
          <span class="ps-order-card-id">Order #${escapeHtml(String(order.orderId || order.id).slice(0, 4))}</span>
          <span class="ps-order-card-time">${formatTime(order.timestamp)}</span>
        </div>
        <span class="ps-order-status-badge ${statusClass}">${escapeHtml(statusLabel)}</span>
      </div>
      ${customerLine}
      ${paymentVoided ? `<div class="payment-alert void-alert">Payment void — ${escapeHtml(order.voidRemarks || "no payment")}</div>` : ""}
      ${paymentCredit ? "<div class=\"payment-alert pending-alert\">Udhaar — payment pending</div>" : ""}
      <ul class="ps-order-lines">${itemLines || "<li class=\"ps-order-line\"><span>No items</span></li>"}</ul>
      <div class="ps-order-card-foot">
        <span>${formatTime(order.timestamp)}</span>
        <strong>${formatCurrency(order.total)}</strong>
      </div>
      <div class="card-actions" data-table="${escapeHtml(order.tableId)}" data-order="${escapeHtml(order.orderId || order.id)}" data-status="${escapeHtml(status)}">
        ${status === "new" || status === "preparing" ? "<button class=\"ghost-btn\" type=\"button\" data-action=\"cancel\">Cancel Order</button>" : ""}
        ${status !== "paid" && !paymentVerified && !paymentVoided && !paymentCredit
    ? "<button class=\"primary-btn\" type=\"button\" data-action=\"paid\">Confirm Payment</button>"
    : ""}
        <button class="ghost-btn" type="button" data-action="share">Share Receipt</button>
        <button class="danger-btn order-clear-btn" type="button" data-action="clear-order" ${clearOrderEnabled ? "" : "disabled"} title="${clearOrderEnabled ? "Clear this order" : "Serve all items before clearing"}">Clear Order</button>
      </div>
    </article>
  `;
}

async function handleOrderAction(button) {
  const tableId = button.closest(".card-actions").dataset.table;
  const orderId = button.closest(".card-actions").dataset.order;
  const action = button.dataset.action;
  button.disabled = true;

  try {
    if (action === "preparing") await updateActiveOrderStatus(orderId, "preparing");
    if (action === "cancel") {
      const currentOrder = state.orders.get(orderId);
      if (currentOrder?.status === "served" || currentOrder?.status === "paid") {
        showToast("Served orders cannot be cancelled.");
        button.disabled = false;
        return;
      }

      const displayName = formatTableDisplayName(tableId);
      if (window.confirm(`Cancel order ${String(orderId).slice(0, 8)} for ${displayName}?`)) {
        const cancelled = await cancelActiveOrder(orderId);
        if (!cancelled) {
          showToast("Served orders cannot be cancelled.");
          button.disabled = false;
        }
      } else {
        button.disabled = false;
      }
      return;
    }
    if (action === "paid") {
      openPaymentMethodModal(tableId, { orderId });
      button.disabled = false;
      return;
    }
    if (action === "clear-order") {
      await clearActiveOrder(orderId);
      showToast("Order cleared.");
      return;
    }
    if (action === "share") shareTableBill(tableId, orderId);
  } catch (error) {
    showToast(error?.message || "Connection error, please refresh");
    button.disabled = false;
  }
}

function bindOrderActionButtons(root) {
  root.querySelectorAll(".card-actions").forEach((actions) => {
    actions.addEventListener("click", (event) => event.stopPropagation());
  });

  root.querySelectorAll(".card-actions [data-action]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      await handleOrderAction(button);
    });
  });
}

function cloneOrderItems(items = []) {
  return items.map((item) => ({
    name: item.name,
    price: Number(item.price || 0),
    qty: Number(item.qty || 0)
  })).filter((item) => item.name && item.qty > 0);
}

function renderAdminFullItemsHtml(items = []) {
  if (!items.length) return "<li><span>No items</span></li>";
  return items.map((item) => `
    <li class="${item.status === "served" ? "served-item" : ""}">
      <span>${escapeHtml(item.name)}</span>
      <strong>x${Number(item.qty || 0)}</strong>
    </li>
  `).join("");
}

function renderAdminItemsHtml(items = []) {
  const visibleItems = items.slice(0, 3);
  const moreCount = Math.max(0, items.length - visibleItems.length);
  return `${visibleItems.map((item) => `
    <li class="${item.status === "served" ? "served-item" : ""}"><span>${escapeHtml(item.name)}</span><strong>x${Number(item.qty || 0)}</strong></li>
  `).join("")}${moreCount ? `
    <li class="order-more-line"><span>+${moreCount} more</span><strong></strong></li>
  ` : ""}`;
}

function renderAdminDetailItemsHtml(items = []) {
  if (!items.length) return "<li class=\"kitchen-detail-item\"><span>No items</span></li>";

  return items.map((item) => `
    <li class="kitchen-detail-item ${item.status === "served" ? "served-item" : ""}">
      <span class="kitchen-detail-qty">${Number(item.qty || 0)}&times;</span>
      <span class="kitchen-detail-name">${escapeHtml(item.name)}</span>
    </li>
  `).join("");
}

function getAdminHoverPreview() {
  if (state.hoverPreview) return state.hoverPreview;

  const preview = document.createElement("div");
  preview.className = "kitchen-hover-preview admin-hover-preview";
  preview.hidden = true;
  preview.setAttribute("aria-hidden", "true");
  document.body.append(preview);
  state.hoverPreview = preview;
  return preview;
}

function showAdminHoverPreview(orderBlock) {
  if (!orderBlock || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

  const orderId = orderBlock.dataset.order;
  const order = state.orders.get(orderId);
  if (!order) return;

  const preview = getAdminHoverPreview();
  const cardRect = orderBlock.getBoundingClientRect();
  preview.style.width = `${Math.min(360, Math.max(260, cardRect.width))}px`;
  preview.style.left = "0px";
  preview.style.top = "0px";
  preview.innerHTML = `
    <strong>Order ${escapeHtml(String(order.orderId || order.id).slice(0, 8))}</strong>
    <ul class="kitchen-detail-list">${renderAdminDetailItemsHtml(order.items || [])}</ul>
  `;
  preview.hidden = false;

  const previewRect = preview.getBoundingClientRect();
  const left = Math.min(
    window.innerWidth - previewRect.width - 12,
    Math.max(12, cardRect.left + 10)
  );
  const maxTop = Math.max(12, window.innerHeight - previewRect.height - 12);
  const top = Math.min(maxTop, Math.max(12, cardRect.top + 56));

  preview.style.left = `${left}px`;
  preview.style.top = `${top}px`;
}

function hideAdminHoverPreview() {
  if (state.hoverPreview) state.hoverPreview.hidden = true;
}

function shareTableBill(tableId, orderId) {
  const order = state.orders.get(orderId);
  if (!order) return;

  try {
    if (order.paymentStatus === "verified_paid" || order.receiptNumber) {
      shareReceiptForOrderId(order.orderId || orderId, order.customerMobile || "");
      return;
    }
    const method = order.paymentMethod || order.preferredPaymentMethod || "cash";
    shareReceiptForOrder(order, method);
  } catch (error) {
    console.warn("Share receipt failed:", error);
    showToast("Could not share receipt");
  }
}

function setPaymentModalVoidMode(enabled) {
  state.paymentVoidMode = enabled;
  if (elements.paymentDiscountControl) elements.paymentDiscountControl.hidden = enabled;
  if (elements.paymentMethodActions) elements.paymentMethodActions.hidden = enabled;
  if (elements.voidOrderPanel) elements.voidOrderPanel.hidden = !enabled;
  if (enabled) {
    hidePendingCustomerPanel();
    hideSplitPaymentPanel();
  } else if (elements.voidOrderRemarks) {
    elements.voidOrderRemarks.value = "";
  }
}

function showVoidOrderPanel() {
  setPaymentModalVoidMode(true);
  elements.voidOrderRemarks?.focus();
}

function hideVoidOrderPanel() {
  setPaymentModalVoidMode(false);
}

function hidePendingCustomerPanel() {
  if (elements.pendingCustomerPanel) elements.pendingCustomerPanel.hidden = true;
  if (elements.paymentMethodActions) {
    elements.paymentMethodActions.hidden = state.paymentVoidMode
      || !elements.splitPaymentPanel?.hidden;
  }
}

function hideSplitPaymentPanel() {
  if (elements.splitPaymentPanel) elements.splitPaymentPanel.hidden = true;
  if (elements.paymentMethodActions) {
    elements.paymentMethodActions.hidden = state.paymentVoidMode
      || !elements.pendingCustomerPanel?.hidden;
  }
}

function showSplitPaymentPanel() {
  const info = computeDiscount(state.pendingPaymentGross, readPaymentDiscount());
  if (elements.splitOnlineAmount) elements.splitOnlineAmount.value = String(info.finalTotal);
  if (elements.splitCashAmount) elements.splitCashAmount.value = "0";
  hidePendingCustomerPanel();
  if (elements.paymentMethodActions) elements.paymentMethodActions.hidden = true;
  if (elements.splitPaymentPanel) elements.splitPaymentPanel.hidden = false;
  updateSplitPaymentValidation();
  elements.splitOnlineAmount?.focus();
}

function readSplitPaymentInput() {
  const cash = Number(elements.splitCashAmount?.value || 0);
  const online = Number(elements.splitOnlineAmount?.value || 0);
  return { cash: Number.isFinite(cash) ? cash : 0, online: Number.isFinite(online) ? online : 0 };
}

function updateSplitPaymentValidation() {
  if (!elements.splitPaymentPanel || elements.splitPaymentPanel.hidden) return;
  const info = computeDiscount(state.pendingPaymentGross, readPaymentDiscount());
  const { cash, online } = readSplitPaymentInput();
  const entered = cash + online;
  const match = entered === info.finalTotal;
  if (elements.splitPaymentHint) {
    elements.splitPaymentHint.textContent = match
      ? `Total: ${formatCurrency(entered)}`
      : `Must equal ${formatCurrency(info.finalTotal)} (entered ${formatCurrency(entered)})`;
    elements.splitPaymentHint.classList.toggle("split-payment-hint--error", !match);
  }
  if (elements.splitConfirmBtn) elements.splitConfirmBtn.disabled = !match;
}

async function confirmSplitPayment() {
  const info = computeDiscount(state.pendingPaymentGross, readPaymentDiscount());
  const input = readSplitPaymentInput();
  try {
    normalizePaymentAmounts(info.finalTotal, input);
  } catch (error) {
    showToast(error?.message || "Split amounts must match final payable");
    return;
  }
  await confirmPaidWithMethod(input);
}

function showPendingCustomerPanel(order, cartProfile) {
  if (elements.pendingCustomerName) {
    elements.pendingCustomerName.value = cartProfile?.name || order?.customerName || "";
  }
  if (elements.pendingCustomerMobile) {
    elements.pendingCustomerMobile.value = cartProfile?.mobile || order?.customerMobile || order?.customerMobileNormalized || "";
  }
  hideSplitPaymentPanel();
  if (elements.paymentMethodActions) elements.paymentMethodActions.hidden = true;
  if (elements.pendingCustomerPanel) elements.pendingCustomerPanel.hidden = false;
  elements.pendingCustomerName?.focus();
}

function readOrderCustomerProfile() {
  const name = elements.adminCustomerName?.value?.trim() || "";
  const mobile = elements.adminCustomerMobile?.value?.trim() || "";
  if (!name && !mobile) return null;
  return { name, mobile };
}

function resolveCreditCustomer(order, cartProfile, formValues = {}) {
  const name = formValues.name
    || cartProfile?.name
    || order?.customerName
    || "";
  const mobile = formValues.mobile
    || cartProfile?.mobile
    || order?.customerMobile
    || order?.customerMobileNormalized
    || "";
  return normalizeCreditCustomer({ name, mobile });
}

function hasCompleteCreditProfile(order, cartProfile) {
  try {
    resolveCreditCustomer(order, cartProfile);
    return true;
  } catch {
    return false;
  }
}

function buildPendingItemsSummary(items = []) {
  return items
    .map((item) => `${item.name || "Item"} x${Number(item.qty || 0)}`)
    .join(", ");
}

async function syncPendingOrderRecord(meta) {
  try {
    await syncPendingOrderToSheet(meta);
  } catch (error) {
    console.warn("[pending] Sheet sync failed", error);
  }
}

function openPaymentMethodModal(tableId, options = {}) {
  const order = options.orderId ? state.orders.get(options.orderId) : null;
  const amount = Number(options.amount ?? order?.total ?? 0);
  state.pendingPaidTable = tableId;
  state.pendingPaidOrderId = options.orderId || null;
  state.pendingPaymentItems = options.items ? cloneOrderItems(options.items) : null;
  state.pendingPaymentIsCounterOrder = Boolean(options.isCounterOrder);
  state.pendingPaymentGross = amount;
  state.pendingPaymentCustomerProfile = options.customerProfile || null;
  hideVoidOrderPanel();
  hidePendingCustomerPanel();
  hideSplitPaymentPanel();
  elements.paymentMethodTable.innerHTML = `
    <span>Choose payment for counter order:</span>
    <strong>Bill Total: ${formatCurrency(amount)}</strong>
  `;
  if (elements.paymentDiscountType) elements.paymentDiscountType.value = "amount";
  if (elements.paymentDiscountValue) elements.paymentDiscountValue.value = "";
  updatePaymentDiscountDisplay();
  elements.paymentMethodModal.hidden = false;
}

function readPaymentDiscount() {
  const type = elements.paymentDiscountType?.value === "percent" ? "percent" : "amount";
  const value = Number(elements.paymentDiscountValue?.value || 0);
  return { type, value: Number.isFinite(value) ? value : 0 };
}

function updatePaymentDiscountDisplay() {
  if (!elements.paymentFinalPayable) return;
  const info = computeDiscount(state.pendingPaymentGross, readPaymentDiscount());
  elements.paymentFinalPayable.textContent = info.discountAmount > 0
    ? `Final Payable: ${formatCurrency(info.finalTotal)} (− ${formatCurrency(info.discountAmount)})`
    : `Final Payable: ${formatCurrency(info.finalTotal)}`;
}

function closePaymentMethodModal() {
  state.pendingPaidTable = null;
  state.pendingPaidOrderId = null;
  state.pendingPaymentItems = null;
  state.pendingPaymentIsCounterOrder = false;
  state.pendingPaymentGross = 0;
  state.pendingPaymentCustomerProfile = null;
  hideVoidOrderPanel();
  hidePendingCustomerPanel();
  hideSplitPaymentPanel();
  if (elements.paymentDiscountValue) elements.paymentDiscountValue.value = "";
  elements.paymentMethodModal.hidden = true;
}

function handlePendingPaymentClick() {
  const order = state.pendingPaidOrderId ? state.orders.get(state.pendingPaidOrderId) : null;
  if (hasCompleteCreditProfile(order, state.pendingPaymentCustomerProfile)) {
    void confirmPaidWithMethod("pending");
    return;
  }
  showPendingCustomerPanel(order, state.pendingPaymentCustomerProfile);
}

function confirmPendingCustomerPanel() {
  const order = state.pendingPaidOrderId ? state.orders.get(state.pendingPaidOrderId) : null;
  try {
    resolveCreditCustomer(order, state.pendingPaymentCustomerProfile, {
      name: elements.pendingCustomerName?.value || "",
      mobile: elements.pendingCustomerMobile?.value || ""
    });
  } catch (error) {
    showToast(error?.message || "Name and mobile required for udhaar");
    return;
  }
  void confirmPaidWithMethod("pending");
}

async function confirmVoidOrder() {
  const tableId = state.pendingPaidTable;
  if (!tableId) return;

  const remarks = elements.voidOrderRemarks?.value || "";
  const orderId = state.pendingPaidOrderId;
  const pendingItems = state.pendingPaymentItems ? cloneOrderItems(state.pendingPaymentItems) : null;
  const grossTotal = state.pendingPaymentGross;

  if (elements.voidOrderConfirmBtn) elements.voidOrderConfirmBtn.disabled = true;

  try {
    if (pendingItems?.length) {
      await voidPendingCounterOrder(tableId, pendingItems, grossTotal, remarks);
      closePaymentMethodModal();
      showToast(`Payment voided — order sent to kitchen (${formatTableDisplayName(tableId)})`);
      return;
    }

    if (!orderId) {
      showToast("No order to void");
      return;
    }

    const voided = await voidActiveOrder(orderId, remarks);
    if (!voided) {
      showToast("Order not found");
      return;
    }
    closePaymentMethodModal();
    showToast(`Payment voided — order sent to kitchen (${formatTableDisplayName(tableId)})`);
  } catch (error) {
    showToast(error?.message || "Could not void order");
  } finally {
    if (elements.voidOrderConfirmBtn) elements.voidOrderConfirmBtn.disabled = false;
  }
}

async function confirmPaidWithMethod(method) {
  if (!state.pendingPaidTable) return;
  const tableId = state.pendingPaidTable;
  const orderId = state.pendingPaidOrderId;
  const pendingItems = state.pendingPaymentItems ? cloneOrderItems(state.pendingPaymentItems) : null;
  const isCounterOrder = state.pendingPaymentIsCounterOrder;
  const discount = readPaymentDiscount();
  const order = orderId ? state.orders.get(orderId) : null;
  const pendingFormValues = !elements.pendingCustomerPanel?.hidden
    ? {
        name: elements.pendingCustomerName?.value || "",
        mobile: elements.pendingCustomerMobile?.value || ""
      }
    : {};
  let customerProfile = null;

  if (method === "pending") {
    try {
      customerProfile = resolveCreditCustomer(order, state.pendingPaymentCustomerProfile, pendingFormValues);
    } catch (error) {
      showToast(error?.message || "Name and mobile required for udhaar");
      return;
    }
  }

  elements.paidCashBtn.disabled = true;
  elements.paidOnlineBtn.disabled = true;
  if (elements.paidSplitBtn) elements.paidSplitBtn.disabled = true;
  if (elements.splitConfirmBtn) elements.splitConfirmBtn.disabled = true;
  if (elements.paidPendingBtn) elements.paidPendingBtn.disabled = true;
  if (elements.pendingCustomerConfirmBtn) elements.pendingCustomerConfirmBtn.disabled = true;

  try {
    if (method === "pending") {
      if (pendingItems?.length) {
        const orderSnap = await placeCounterOrderWithCredit(tableId, pendingItems, customerProfile, discount);
        const data = orderSnap?.data?.() || {};
        await syncPendingOrderRecord({
          orderId: data.orderId || orderSnap?.id,
          tableId,
          customerName: customerProfile.customerName,
          customerMobile: customerProfile.customerMobileNormalized,
          itemsSummary: buildPendingItemsSummary(data.items || pendingItems),
          grossTotal: data.grossTotal ?? state.pendingPaymentGross,
          discountAmount: data.discountAmount ?? 0,
          total: data.total ?? 0
        });
        closePaymentMethodModal();
        showToast(`Udhaar order placed for ${formatTableDisplayName(tableId)}`);
      } else {
        const result = await markOrderCreditPending(orderId, customerProfile, discount);
        await syncPendingOrderRecord({
          orderId: result.orderId,
          tableId: result.tableId,
          customerName: result.customerName,
          customerMobile: result.customerMobile,
          itemsSummary: buildPendingItemsSummary(result.items),
          grossTotal: result.grossTotal,
          discountAmount: result.discountAmount,
          total: result.total
        });
        closePaymentMethodModal();
        showToast(`Order marked udhaar (${formatTableDisplayName(tableId)})`);
      }
      return;
    }

    if (pendingItems?.length) {
      const orderSnap = await placeCounterOrderWithPayment(
        tableId,
        pendingItems,
        method,
        discount,
        state.pendingPaymentCustomerProfile
      );
      closePaymentMethodModal();
      showToast(`Order placed for ${formatTableDisplayName(tableId)}`);
    } else {
      await verifyOrderPayment(orderId, method, discount);
      closePaymentMethodModal();
    }
  } catch (error) {
    showToast(error?.message || (isCounterOrder ? "Order failed. Check connection and refresh." : "Connection error, please refresh"));
  } finally {
    elements.paidCashBtn.disabled = false;
    elements.paidOnlineBtn.disabled = false;
    if (elements.paidSplitBtn) elements.paidSplitBtn.disabled = false;
    updateSplitPaymentValidation();
    if (elements.paidPendingBtn) elements.paidPendingBtn.disabled = false;
    if (elements.pendingCustomerConfirmBtn) elements.pendingCustomerConfirmBtn.disabled = false;
  }
}

function paymentMethodLabel(method) {
  if (method && typeof method === "object") {
    const cash = Number(method.cash ?? method.cashAmount ?? 0);
    const online = Number(method.online ?? method.onlineAmount ?? 0);
    if (cash > 0 && online > 0) {
      return `Split (${formatCurrency(online)} + ${formatCurrency(cash)})`;
    }
    if (online > 0) return "Online Payment";
    return "Cash Payment";
  }
  if (method === "split") return "Split Payment";
  return method === "online" ? "Online Payment" : "Cash Payment";
}

function formatDateTime(value) {
  if (!value?.toDate) return "Time unavailable";
  return value.toDate().toLocaleString([], {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export async function openAdminOrderModal(tableId, options = {}) {
  state.orderModalOptions = {
    deferPayment: Boolean(options.deferPayment),
    sessionId: options.sessionId || null
  };
  state.orderTableId = tableId;
  state.cart.clear();
  state.menuSearchQuery = "";
  if (elements.adminMenuSearch) elements.adminMenuSearch.value = "";
  const displayName = formatTableDisplayName(tableId);
  const hasOrder = getOrdersForTable(tableId).length > 0;
  if (elements.adminOrderTitle) {
    elements.adminOrderTitle.textContent = state.orderModalOptions.deferPayment
      ? `Order Food — ${displayName}`
      : (hasOrder ? "Add Items — Counter" : "Counter Order");
  }
  if (!elements.adminOrderModal) return;
  elements.adminOrderModal.classList.add("modal-front");
  elements.adminOrderModal.hidden = false;
  if (elements.adminOrderCustomerFields) {
    elements.adminOrderCustomerFields.hidden = Boolean(state.orderModalOptions.deferPayment);
  }
  if (elements.adminCustomerName) elements.adminCustomerName.value = "";
  if (elements.adminCustomerMobile) elements.adminCustomerMobile.value = "";
  showAdminOrderScreen("menu");
  updateAdminOrderFooter();

  if (!state.menuLoaded) {
    elements.adminMenuList.innerHTML = "<p class=\"subtle\">Loading menu...</p>";
    try {
      const items = await fetchMenu();
      const menuState = buildMenuState(items);
      state.groupedMenu = menuState.groupedMenu;
      state.categories = menuState.categories;
      state.activeCategory = menuState.activeCategory;
      state.menuLoaded = Boolean(state.activeCategory);
      if (!state.menuLoaded) {
        elements.adminMenuList.innerHTML = "<p class=\"subtle\">Menu unavailable. Check Google Sheet URL.</p>";
        return;
      }
    } catch {
      elements.adminMenuList.innerHTML = "<p class=\"subtle\">Menu unavailable. Check connection or cached menu.</p>";
      return;
    }
  }

  renderAdminCategories();
  renderAdminMenu();
}

function closeAdminOrderModal() {
  const returnSessionId = state.orderModalOptions.deferPayment
    ? state.orderModalOptions.sessionId
    : null;
  state.orderTableId = null;
  state.cart.clear();
  state.menuSearchQuery = "";
  if (elements.adminMenuSearch) elements.adminMenuSearch.value = "";
  state.orderModalOptions = { deferPayment: false, sessionId: null };
  if (elements.adminOrderModal) {
    elements.adminOrderModal.classList.remove("modal-front");
    elements.adminOrderModal.hidden = true;
  }
  if (returnSessionId) {
    window.dispatchEvent(new CustomEvent("ps-food-order-modal-closed", {
      detail: { sessionId: returnSessionId }
    }));
  }
}

function showAdminOrderScreen(name) {
  const isMenu = name === "menu";
  elements.adminOrderMenuScreen.classList.toggle("active", isMenu);
  elements.adminOrderMenuScreen.hidden = !isMenu;
  elements.adminOrderCartScreen.classList.toggle("active", !isMenu);
  elements.adminOrderCartScreen.hidden = isMenu;
  elements.adminViewCartBtn.hidden = !isMenu;
  elements.adminPlaceOrderBtn.textContent = isMenu
    ? (state.orderModalOptions.deferPayment ? "Add to Order" : "Place Order")
    : "Confirm Order";
  updateAdminOrderFooter();
}

function getAllMenuItems() {
  return Object.values(state.groupedMenu).flat();
}

function filterMenuItemsBySearch(items = [], query = "") {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) => String(item.name || "").toLowerCase().includes(needle));
}

function renderAdminCategories() {
  renderCategoryRow(elements.adminCategoryRow, state.categories, state.activeCategory, (category) => {
    state.activeCategory = category;
    renderAdminCategories();
    renderAdminMenu();
  });
}

function renderAdminMenu() {
  const query = state.menuSearchQuery || "";
  const isSearching = Boolean(query.trim());
  if (elements.adminCategoryRow) {
    elements.adminCategoryRow.hidden = isSearching;
  }

  const items = isSearching
    ? filterMenuItemsBySearch(getAllMenuItems(), query)
    : (state.groupedMenu[state.activeCategory] || []);

  renderMenuList(elements.adminMenuList, items, state.cart, (item, delta) => {
    updateCartItem(state.cart, item, delta);
    renderAdminMenu();
    if (!elements.adminOrderCartScreen.hidden) renderAdminCart();
    updateAdminOrderFooter();
  });
}

function renderAdminCart() {
  const { total } = renderCartList(elements.adminCartList, state.cart, (item, delta) => {
    updateCartItem(state.cart, item, delta);
    renderAdminCart();
    renderAdminMenu();
    updateAdminOrderFooter();
  });
  elements.adminGrandTotal.textContent = formatCurrency(total);
}

function updateAdminOrderFooter() {
  const { items, count, total } = getCartTotals(state.cart);
  elements.adminOrderCount.textContent = `${count} item${count === 1 ? "" : "s"}`;
  elements.adminOrderTotal.textContent = formatCurrency(total);
  elements.adminPlaceOrderBtn.disabled = items.length === 0;
  elements.adminViewCartBtn.hidden = items.length === 0 || !elements.adminOrderMenuScreen.classList.contains("active");
}

async function placeAdminOrder() {
  if (!state.orderTableId) return;
  const { items, total } = getCartTotals(state.cart);
  if (!items.length) return;

  const tableId = state.orderTableId;
  const { deferPayment, sessionId } = state.orderModalOptions;
  elements.adminPlaceOrderBtn.disabled = true;

  try {
    if (deferPayment && sessionId) {
      await placePrivateSittingFoodOrder(tableId, sessionId, items);
      closeAdminOrderModal();
      showToast(`Food order sent to kitchen for ${formatTableDisplayName(tableId)}`);
      return;
    }

    const customerProfile = readOrderCustomerProfile();
    closeAdminOrderModal();
    openPaymentMethodModal(tableId, {
      items,
      amount: total,
      isCounterOrder: true,
      customerProfile
    });
  } catch {
    showToast("Could not place order");
  } finally {
    elements.adminPlaceOrderBtn.disabled = false;
  }
}

function getPendingItemKeys(order) {
  const orderId = order?.orderId || order?.id || "";
  return (order?.items || [])
    .filter((item) => item.status !== "served")
    .map((item, index) => `${orderId}|${item.itemId || item.name || "item"}|${item.price || 0}|${index}|${item.qty || 0}`);
}

function markAdminNotice() {
  state.hasNewCounterNotice = true;
  resetHighlightTimer("counter", () => {
    state.hasNewCounterNotice = false;
  });
}

function resetHighlightTimer(key, onExpire) {
  const existing = state.highlightTimers.get(key);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    onExpire();
    state.highlightTimers.delete(key);
    renderCounterOrders();
  }, 9000);
  state.highlightTimers.set(key, timer);
}

function clearHighlightTimer(key) {
  const timer = state.highlightTimers.get(key);
  if (timer) clearTimeout(timer);
  state.highlightTimers.delete(key);
}

function notifyAdminOrder(order, isNewOrder = true) {
  try {
    const customer = order?.customerName || "Customer";
    showRichToast(isNewOrder ? "New Order" : "New Items Added", [
      `Table: ${formatTableDisplayName(order?.tableId) || "-"}`,
      `Customer: ${customer}`,
      isNewOrder ? "Order Received" : "Items Added"
    ]);
  } catch {
    // Toast is helpful, but rendering must never depend on it.
  }
  playAdminBeep();
}

function unlockAdminAudio() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    adminAudioContext = adminAudioContext || new AudioContext();
    if (adminAudioContext.state === "suspended") adminAudioContext.resume();
  } catch {
    // Audio is optional.
  }
}

function playAdminBeep() {
  try {
    unlockAdminAudio();
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const context = adminAudioContext || new AudioContext();
    adminAudioContext = context;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 660;
    gain.gain.value = 0.04;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.12);
  } catch {
    // Browsers may block audio until a user gesture.
  }
}

function notifyNewOrder() {
  playAdminBeep();
}
