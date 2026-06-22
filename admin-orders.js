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
  subscribeActiveOrders,
  markOrderCreditPending,
  maskMobile,
  normalizeCreditCustomer,
  placeCounterOrderWithCredit,
  placeCounterOrderWithPayment,
  placePrivateSittingFoodOrder,
  registerServiceWorker,
  rejectActivePaymentClaim,
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

const state = {
  orders: new Map(),
  knownActive: new Set(),
  activeSectionId: CONFIG.ORDER_SECTIONS[0]?.id || "",
  previousOrderIds: new Set(),
  previousPendingItemKeys: new Set(),
  hasReceivedOrdersSnapshot: false,
  highlightedTables: new Set(),
  highlightedSections: new Set(),
  highlightTimers: new Map(),
  pendingPaidTable: null,
  pendingPaidOrderId: null,
  pendingPaymentItems: null,
  pendingPaymentIsCounterOrder: false,
  pendingPaymentGross: 0,
  pendingPaymentCustomerProfile: null,
  canVoidOrder: true,
  canMarkPending: true,
  paymentVoidMode: false,
  hoverPreview: null,
  orderTableId: null,
  groupedMenu: {},
  categories: [],
  activeCategory: "",
  cart: new Map(),
  menuLoaded: false,
  menuSearchQuery: "",
  detailTableId: null,
  orderModalOptions: { deferPayment: false, sessionId: null }
};

let adminAudioContext = null;

const elements = {
  restaurant: document.querySelector("#adminRestaurant"),
  clock: document.querySelector("#managerClock") || document.querySelector("#clock"),
  activeTables: document.querySelector("#activeTables"),
  tableGrid: document.querySelector("#psOrdersGrid"),
  tableDetail: document.querySelector("#psTableDetail"),
  categoryTabs: document.querySelector("#adminCategoryTabs"),
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
  elements.restaurant.textContent = CONFIG.RESTAURANT_NAME;
  bindUi();
  startAdminApp();
}

function startAdminApp() {
  renderEmptyCards();
  startClock();
  subscribeToTables();
  preloadMenu();
  window.addEventListener("menu-updated", () => {
    void preloadMenu();
  });
  window.addEventListener("hashchange", syncDetailFromHash);
  syncDetailFromHash();
}

function bindUi() {
  elements.closePaymentMethod.addEventListener("click", closePaymentMethodModal);
  elements.paymentMethodModal.addEventListener("click", (event) => {
    if (event.target === elements.paymentMethodModal) closePaymentMethodModal();
  });
  elements.paidCashBtn.addEventListener("click", () => confirmPaidWithMethod("cash"));
  elements.paidOnlineBtn.addEventListener("click", () => confirmPaidWithMethod("online"));
  elements.paidPendingBtn?.addEventListener("click", handlePendingPaymentClick);
  elements.pendingCustomerConfirmBtn?.addEventListener("click", confirmPendingCustomerPanel);
  elements.voidOrderBtn?.addEventListener("click", showVoidOrderPanel);
  elements.voidOrderBackBtn?.addEventListener("click", hideVoidOrderPanel);
  elements.voidOrderConfirmBtn?.addEventListener("click", confirmVoidOrder);
  elements.paymentDiscountType?.addEventListener("change", updatePaymentDiscountDisplay);
  elements.paymentDiscountValue?.addEventListener("input", updatePaymentDiscountDisplay);
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
  renderTables();
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
      state.knownActive.add(order.tableId);
      getPendingItemKeys({ ...order, orderId }).forEach((key) => state.previousPendingItemKeys.add(key));
    });
    state.previousOrderIds = new Set(state.orders.keys());
    if (state.hasReceivedOrdersSnapshot) {
      state.orders.forEach((order) => {
        const isNewOrder = !previousOrderIds.has(order.orderId);
        const hasNewItems = getPendingItemKeys(order).some((key) => !previousPendingItemKeys.has(key));
        if (isNewOrder || hasNewItems) {
          markAdminNotice(order.tableId);
          notifications.push({ order, isNewOrder });
        }
      });
    } else {
      state.hasReceivedOrdersSnapshot = true;
    }
    const flashedOrder = notifications[0]?.order || null;
    const flashedTable = flashedOrder?.tableId || null;
    notifications.forEach(({ order, isNewOrder }) => notifyAdminOrder(order, isNewOrder));
    renderTables(flashedTable);
  }, () => showToast("Connection error, please refresh"));
}

const SECTION_TAB_THEMES = {
  "party-hall": "admin-tab-teal",
  "tatoo-studio": "admin-tab-green",
  "hotel": "admin-tab-gold"
};

const SECTION_TAB_ICONS = {
  "party-hall": "<svg class=\"admin-tab-icon\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path fill=\"currentColor\" d=\"M5 3v18l7-3 7 3V3H5zm2 2h10v11.5l-5-2.1-5 2.1V5z\"/></svg>",
  "tatoo-studio": "<svg class=\"admin-tab-icon\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path fill=\"currentColor\" d=\"M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z\"/></svg>",
  "hotel": "<svg class=\"admin-tab-icon\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path fill=\"currentColor\" d=\"M4 10V19H9V13H15V19H20V10L12 4L4 10Z\"/></svg>"
};

const PEOPLE_ICON = "<svg class=\"table-people-icon\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path fill=\"currentColor\" d=\"M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S7.66 5 6 5C4.34 5 3 6.34 3 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-4.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-4.5c0-2.33-4.67-3.5-7-3.5z\"/></svg>";

const BACK_ICON = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path fill=\"currentColor\" d=\"M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z\"/></svg>";

function getSectionTabTheme(sectionId) {
  return SECTION_TAB_THEMES[sectionId] || "admin-tab-teal";
}

function getSectionTabIcon(sectionId) {
  return SECTION_TAB_ICONS[sectionId] || "";
}

function tableIdFromDisplayName(displayName) {
  const key = String(displayName || "").trim();
  return CONFIG.TABLES.find((id) => formatTableDisplayName(id) === key) || null;
}

function tableHashForTableId(tableId) {
  return `#/sitting/${encodeURIComponent(formatTableDisplayName(tableId))}`;
}

function setTableDetailHash(tableId) {
  const hash = tableHashForTableId(tableId);
  if (location.hash !== hash) {
    history.replaceState(null, "", hash);
  }
}

function clearTableDetailHash() {
  if (/^#\/sitting\//i.test(location.hash)) {
    history.replaceState(null, "", `${location.pathname}${location.search}`);
  }
}

function syncDetailFromHash() {
  const match = location.hash.match(/^#\/sitting\/([^/]+)$/i);
  if (!match) {
    if (state.detailTableId) {
      state.detailTableId = null;
      renderTables();
    }
    return;
  }
  const tableId = tableIdFromDisplayName(decodeURIComponent(match[1]));
  if (tableId && state.detailTableId === tableId) return;
  if (tableId) {
    openTableDetail(tableId, { skipHash: true });
  }
}

function openTableDetail(tableId, opts = {}) {
  const section = getSectionForTable(tableId);
  if (section) state.activeSectionId = section.id;
  state.detailTableId = tableId;
  window.dispatchEvent(new CustomEvent("manager-set-tab", { detail: { tab: "orders" } }));
  if (!opts.skipHash) setTableDetailHash(tableId);
  renderTables();
}

function getTableItemCount(orders = []) {
  return orders.reduce((sum, order) => (
    sum + (order.items || []).reduce((itemSum, item) => itemSum + Number(item.qty || 0), 0)
  ), 0);
}

function setOrdersViewMode(mode) {
  const isDetail = mode === "detail";
  if (elements.ordersView) {
    elements.ordersView.classList.toggle("ps-orders-detail-mode", isDetail);
  }
  if (elements.categoryTabs) elements.categoryTabs.hidden = isDetail;
  if (elements.tableGrid) elements.tableGrid.hidden = isDetail;
  if (elements.tableDetail) elements.tableDetail.hidden = !isDetail;
}

function renderCategoryTabs() {
  if (!elements.categoryTabs) return;
  elements.categoryTabs.innerHTML = CONFIG.ORDER_SECTIONS.map(sectionButtonHtml).join("");
  bindSectionActions();
}

function getRunningOrderCount(orders = []) {
  return orders.filter((order) => {
    const status = order.status || "new";
    return status === "new" || status === "preparing" || hasPendingItems(order);
  }).length;
}

function renderTables(flashTableId = null) {
  if (!elements.tableGrid) return;

  if (state.detailTableId) {
    setOrdersViewMode("detail");
    renderTableDetail(state.detailTableId);
    if (elements.activeTables) {
      elements.activeTables.textContent = String(state.knownActive.size);
    }
    return;
  }

  setOrdersViewMode("grid");
  renderCategoryTabs();

  const activeSection = getActiveSection();
  elements.tableGrid.className = "admin-dashboard admin-dashboard-pos";
  elements.tableGrid.innerHTML = `
    <section class="admin-section-panel admin-section-panel-pos" aria-live="polite">
      <div class="section-table-row section-table-row-pos">
        ${activeSection.tables.map((tableId) => {
    const orders = getOrdersForTable(tableId);
    const shouldFlash = state.highlightedTables.has(tableId)
      || (tableId === flashTableId && orders.some((order) => order.status === "new"));
    return tableCardHtml(tableId, orders, shouldFlash);
  }).join("")}
      </div>
    </section>
  `;

  if (elements.activeTables) {
    elements.activeTables.textContent = String(state.knownActive.size);
  }
  bindGridCardActions();
}

function getActiveSection() {
  return CONFIG.ORDER_SECTIONS.find((section) => section.id === state.activeSectionId) || CONFIG.ORDER_SECTIONS[0];
}

function getSectionForTable(tableId) {
  return CONFIG.ORDER_SECTIONS.find((section) => section.tables.includes(tableId));
}

function getSectionAlertCount(section) {
  if (section.id === state.activeSectionId) return 0;
  return [...state.orders.values()].filter((order) => (
    section.tables.includes(order.tableId)
    && (order.status === "new" || order.paymentStatus === "customer_claimed_paid")
  )).length;
}

function sectionButtonHtml(section) {
  const alertCount = getSectionAlertCount(section);
  const isActive = section.id === state.activeSectionId;
  const isFlashing = state.highlightedSections.has(section.id);
  const theme = getSectionTabTheme(section.id);
  const icon = getSectionTabIcon(section.id);
  return `
    <button class="admin-top-tab ${theme} ${isActive ? "active" : ""} ${isFlashing ? "flash" : ""}" type="button" data-section="${escapeHtml(section.id)}">
      ${icon}
      <span>${escapeHtml(section.name)}</span>
      ${alertCount ? `<strong>${alertCount}</strong>` : ""}
    </button>
  `;
}

function bindSectionActions() {
  const root = elements.categoryTabs || elements.tableGrid;
  if (!root) return;
  root.querySelectorAll("[data-section]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeSectionId = button.dataset.section;
      state.detailTableId = null;
      clearTableDetailHash();
      acknowledgeSectionNotice(state.activeSectionId);
      renderTables();
    });
  });
}

function getOrdersForTable(tableId) {
  return [...state.orders.values()]
    .filter((order) => order.tableId === tableId)
    .sort((a, b) => (a.timestamp?.toMillis?.() || 0) - (b.timestamp?.toMillis?.() || 0));
}

function hasPendingItems(order) {
  return (order.items || []).some((item) => item.status !== "served");
}

function getTableOrdersTotal(orders = []) {
  return orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
}

function tableCardHtml(tableId, orders, flash = false) {
  const displayName = formatTableDisplayName(tableId);

  if (!orders.length) {
    return `
      <article class="table-card table-card-orderable table-card-mobile table-card-empty ${flash ? "flash" : ""}" data-table="${escapeHtml(tableId)}">
        <button class="table-card-toggle table-card-face" type="button" aria-label="Take order for ${escapeHtml(displayName)}">
          <span class="table-status-badge table-status-empty">Empty</span>
          <span class="table-display-name">${escapeHtml(displayName)}</span>
        </button>
      </article>
    `;
  }

  return `
    <article class="table-card table-card-orderable table-card-mobile table-card-has-orders ${flash ? "flash" : ""}" data-table="${escapeHtml(tableId)}">
      <button class="table-card-toggle table-card-face" type="button" aria-label="View orders for ${escapeHtml(displayName)}">
        <span class="table-status-badge table-status-active">Active</span>
        ${PEOPLE_ICON}
        <span class="table-display-name">${escapeHtml(displayName)}</span>
      </button>
    </article>
  `;
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

function mobileOrderCardHtml(order) {
  const status = order.status || "new";
  const paymentClaimed = order.paymentStatus === "customer_claimed_paid";
  const cashRequested = order.paymentStatus === "cash_at_counter";
  const paymentVerified = order.paymentStatus === "verified_paid";
  const paymentVoided = order.paymentStatus === "voided";
  const paymentCredit = order.paymentStatus === "credit_pending";
  const isSessionHold = order.paymentStatus === "session_hold" || Boolean(order.privateSessionId);
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
  const clearOrderEnabled = !hasPendingItems(order) && !isSessionHold;

  return `
    <article class="ps-order-card status-${escapeHtml(status)}" data-order="${escapeHtml(order.orderId || order.id)}">
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
      ${paymentClaimed ? "<div class=\"payment-alert\">Customer says payment done - verify UPI</div>" : ""}
      ${cashRequested ? "<div class=\"payment-alert cash-alert\">Customer will pay cash at counter</div>" : ""}
      <ul class="ps-order-lines">${itemLines || "<li class=\"ps-order-line\"><span>No items</span></li>"}</ul>
      <div class="ps-order-card-foot">
        <span>${formatTime(order.timestamp)}</span>
        <strong>${formatCurrency(order.total)}</strong>
      </div>
      <div class="card-actions" data-table="${escapeHtml(order.tableId)}" data-order="${escapeHtml(order.orderId || order.id)}" data-status="${escapeHtml(status)}">
        ${paymentClaimed ? "<button class=\"ghost-btn\" type=\"button\" data-action=\"reject-pay\">Reject Payment Claim</button>" : ""}
        ${status === "new" || status === "preparing" ? "<button class=\"ghost-btn\" type=\"button\" data-action=\"cancel\">Cancel Order</button>" : ""}
        ${status !== "paid" && !paymentVerified && !isSessionHold && !paymentVoided && !paymentCredit ? "<button class=\"primary-btn\" type=\"button\" data-action=\"paid\">Confirm Payment</button>" : ""}
        <button class="ghost-btn" type="button" data-action="share">Share Receipt</button>
        <button class="danger-btn order-clear-btn" type="button" data-action="clear-order" ${clearOrderEnabled ? "" : "disabled"} title="${clearOrderEnabled ? "Clear this order from the table" : "Serve all items before clearing"}">Clear Order</button>
      </div>
    </article>
  `;
}

function closeTableDetail() {
  state.detailTableId = null;
  clearTableDetailHash();
  renderTables();
}

function renderTableDetail(tableId) {
  if (!elements.tableDetail) return;
  const orders = getOrdersForTable(tableId);
  const displayName = formatTableDisplayName(tableId);
  const isEmpty = !orders.length;
  const runningCount = getRunningOrderCount(orders);
  const tableTotal = getTableOrdersTotal(orders);
  const statusBadgeClass = isEmpty ? "table-status-empty" : "table-status-active";
  const statusLabel = isEmpty ? "Empty" : "Active";
  const heroClass = isEmpty ? "ps-table-hero ps-table-hero-empty" : "ps-table-hero";
  const heroStatusClass = isEmpty ? "ps-hero-status-empty" : "ps-hero-status-active";

  elements.tableDetail.innerHTML = `
    <header class="ps-table-detail-header">
      <button class="ps-table-back-btn" type="button" aria-label="Back to tables">${BACK_ICON}</button>
      <h2 class="ps-table-detail-title">${escapeHtml(displayName)}</h2>
      <span class="table-status-badge ${statusBadgeClass}">${statusLabel}</span>
    </header>
    <div class="ps-table-detail-body">
      <div class="${heroClass}">
        <span class="ps-table-hero-icon">${PEOPLE_ICON}</span>
        <div class="ps-table-hero-text">
          <strong>${escapeHtml(displayName)}</strong>
          <span class="${heroStatusClass}">${statusLabel}</span>
        </div>
      </div>
      <button class="ps-add-order-btn primary-btn" type="button" data-table="${escapeHtml(tableId)}">+ Add New Order</button>
      <h3 class="ps-current-orders-title">Current Orders</h3>
      <div class="ps-order-list">
        ${orders.length ? orders.map(mobileOrderCardHtml).join("") : "<p class=\"subtle ps-order-empty\">No orders yet. Tap Add New Order to start.</p>"}
      </div>
      <div class="ps-order-summary">
        <div class="ps-order-summary-grid">
          <article class="ps-summary-stat">
            <span>Total Orders</span>
            <strong>${orders.length}</strong>
          </article>
          <article class="ps-summary-stat">
            <span>Running Orders</span>
            <strong>${runningCount}</strong>
          </article>
          <article class="ps-summary-stat ps-summary-stat-total">
            <span>Total Bill Amount</span>
            <strong class="ps-summary-total">${formatCurrency(tableTotal)}</strong>
          </article>
        </div>
      </div>
    </div>
  `;
  bindDetailActions();
}

function bindGridCardActions() {
  elements.tableGrid.querySelectorAll(".table-card-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      const card = button.closest(".table-card");
      const tableId = card?.dataset.table;
      if (!tableId) return;
      acknowledgeTableNotice(tableId);
      openTableDetail(tableId);
    });
  });
}

function bindDetailActions() {
  if (!elements.tableDetail) return;

  elements.tableDetail.querySelector(".ps-table-back-btn")?.addEventListener("click", closeTableDetail);
  elements.tableDetail.querySelector(".ps-add-order-btn")?.addEventListener("click", (event) => {
    openAdminOrderModal(event.currentTarget.dataset.table);
  });

  bindOrderActionButtons(elements.tableDetail);
}

async function handleOrderAction(button) {
  const tableId = button.closest(".card-actions").dataset.table;
  const orderId = button.closest(".card-actions").dataset.order;
  const action = button.dataset.action;
  button.disabled = true;

  try {
    if (action === "preparing") await updateActiveOrderStatus(orderId, "preparing");
    if (action === "reject-pay") await rejectActivePaymentClaim(orderId);
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
  if (elements.paymentMethodActions) elements.paymentMethodActions.hidden = state.paymentVoidMode;
}

function showPendingCustomerPanel(order, cartProfile) {
  if (elements.pendingCustomerName) {
    elements.pendingCustomerName.value = cartProfile?.name || order?.customerName || "";
  }
  if (elements.pendingCustomerMobile) {
    elements.pendingCustomerMobile.value = cartProfile?.mobile || order?.customerMobile || order?.customerMobileNormalized || "";
  }
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
  const isPrivateSittingOrder = Boolean(
    order?.paymentStatus === "session_hold" || order?.privateSessionId
  );
  state.pendingPaidTable = tableId;
  state.pendingPaidOrderId = options.orderId || null;
  state.pendingPaymentItems = options.items ? cloneOrderItems(options.items) : null;
  state.pendingPaymentIsCounterOrder = Boolean(options.isCounterOrder);
  state.pendingPaymentGross = amount;
  state.pendingPaymentCustomerProfile = options.customerProfile || null;
  state.canVoidOrder = !isPrivateSittingOrder;
  state.canMarkPending = !isPrivateSittingOrder;
  hideVoidOrderPanel();
  hidePendingCustomerPanel();
  elements.paymentMethodTable.innerHTML = `
    <span>${options.isCounterOrder ? "Choose payment for" : "Mark"} ${escapeHtml(formatTableDisplayName(tableId))}${options.isCounterOrder ? "" : " paid by"}:</span>
    <strong>Bill Total: ${formatCurrency(amount)}</strong>
  `;
  if (elements.paymentDiscountType) elements.paymentDiscountType.value = "amount";
  if (elements.paymentDiscountValue) elements.paymentDiscountValue.value = "";
  if (elements.voidOrderBtn) elements.voidOrderBtn.hidden = !state.canVoidOrder;
  if (elements.paidPendingBtn) elements.paidPendingBtn.hidden = !state.canMarkPending;
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
  state.canVoidOrder = true;
  state.canMarkPending = true;
  hideVoidOrderPanel();
  hidePendingCustomerPanel();
  if (elements.paymentDiscountValue) elements.paymentDiscountValue.value = "";
  elements.paymentMethodModal.hidden = true;
}

function handlePendingPaymentClick() {
  if (!state.canMarkPending) {
    showToast("Private sitting orders cannot be marked pending");
    return;
  }
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
  if (!state.canVoidOrder) {
    showToast("Private sitting orders cannot be voided");
    return;
  }

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
    if (elements.paidPendingBtn) elements.paidPendingBtn.disabled = false;
    if (elements.pendingCustomerConfirmBtn) elements.pendingCustomerConfirmBtn.disabled = false;
  }
}

function paymentMethodLabel(method) {
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
      : (hasOrder ? `Add Items — ${displayName}` : `Take Order — ${displayName}`);
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

function markAdminNotice(tableId) {
  if (!tableId) return;
  const section = getSectionForTable(tableId);
  state.highlightedTables.add(tableId);
  if (section) state.highlightedSections.add(section.id);
  resetHighlightTimer(`table:${tableId}`, () => state.highlightedTables.delete(tableId));
  if (section) resetHighlightTimer(`section:${section.id}`, () => state.highlightedSections.delete(section.id));
}

function resetHighlightTimer(key, onExpire) {
  const existing = state.highlightTimers.get(key);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    onExpire();
    state.highlightTimers.delete(key);
    renderTables();
  }, 9000);
  state.highlightTimers.set(key, timer);
}

function acknowledgeSectionNotice(sectionId) {
  if (!sectionId) return;
  state.highlightedSections.delete(sectionId);
  clearHighlightTimer(`section:${sectionId}`);
}

function acknowledgeTableNotice(tableId) {
  if (!tableId) return;
  state.highlightedTables.delete(tableId);
  clearHighlightTimer(`table:${tableId}`);
  const section = getSectionForTable(tableId);
  if (section) acknowledgeSectionNotice(section.id);
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
