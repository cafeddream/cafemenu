import {
  CONFIG,
  STATUS_LABELS,
  cancelActiveOrder,
  clearTable,
  escapeHtml,
  fetchMenu,
  fetchReportForDateRange,
  fetchTableHistory,
  formatCurrency,
  formatTime,
  getTodayKey,
  listenToActiveOrders,
  listenToTodaySummary,
  maskMobile,
  placeCounterOrderWithPayment,
  placePrivateSittingFoodOrder,
  registerServiceWorker,
  rejectActivePaymentClaim,
  reportToCsv,
  showRichToast,
  showToast,
  updateActiveOrderStatus,
  verifyOrderPayment
} from "./firebase.js";
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
  knownOccupied: new Set(),
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
  hoverPreview: null,
  orderTableId: null,
  groupedMenu: {},
  categories: [],
  activeCategory: "",
  cart: new Map(),
  menuLoaded: false,
  lastReport: null,
  menuSearchQuery: "",
  expandedTableId: null,
  orderModalOptions: { deferPayment: false, sessionId: null }
};

let adminAudioContext = null;

const elements = {
  restaurant: document.querySelector("#adminRestaurant"),
  clock: document.querySelector("#managerClock") || document.querySelector("#clock"),
  activeTables: document.querySelector("#activeTables"),
  todayCollection: document.querySelector("#todayCollection"),
  tableGrid: document.querySelector("#psOrdersGrid"),
  menuButton: document.querySelector("#menuButton"),
  signOutBtn: document.querySelector("#signOutBtn"),
  adminMenuModal: document.querySelector("#adminMenuModal"),
  closeMenu: document.querySelector("#closeMenu"),
  salesTab: document.querySelector("#salesTab"),
  reportTab: document.querySelector("#reportTab"),
  salesPanel: document.querySelector("#salesPanel"),
  reportPanel: document.querySelector("#reportPanel"),
  reportStartDate: document.querySelector("#reportStartDate"),
  reportEndDate: document.querySelector("#reportEndDate"),
  refreshReportBtn: document.querySelector("#refreshReportBtn"),
  exportReportBtn: document.querySelector("#exportReportBtn"),
  reportContent: document.querySelector("#reportContent"),
  salesTableSelect: document.querySelector("#salesTableSelect"),
  historyTitle: document.querySelector("#historyTitle"),
  historyList: document.querySelector("#historyList"),
  paymentMethodModal: document.querySelector("#paymentMethodModal"),
  closePaymentMethod: document.querySelector("#closePaymentMethod"),
  paymentMethodTable: document.querySelector("#paymentMethodTable"),
  paidCashBtn: document.querySelector("#paidCashBtn"),
  paidOnlineBtn: document.querySelector("#paidOnlineBtn"),
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
  adminPlaceOrderBtn: document.querySelector("#adminPlaceOrderBtn")
};

// Starts the food orders counter inside the Orders tab.
export function initAdminOrders() {
  if (!elements.tableGrid) return;
  registerServiceWorker();
  elements.restaurant.textContent = CONFIG.RESTAURANT_NAME;
  populateSalesTableSelect();
  setDefaultReportDates();
  bindUi();
  startAdminApp();
}

function startAdminApp() {
  renderEmptyCards();
  startClock();
  subscribeToTables();
  subscribeToSummary();
  preloadMenu();
}

function bindUi() {
  elements.menuButton.addEventListener("click", openAdminMenu);
  elements.closeMenu.addEventListener("click", closeAdminMenu);
  elements.adminMenuModal.addEventListener("click", (event) => {
    if (event.target === elements.adminMenuModal) closeAdminMenu();
  });
  elements.salesTab.addEventListener("click", showSalesPanel);
  elements.reportTab.addEventListener("click", showReportPanel);
  elements.refreshReportBtn.addEventListener("click", loadReport);
  elements.exportReportBtn.addEventListener("click", exportReportCsv);
  elements.salesTableSelect.addEventListener("change", () => loadSalesForTable(elements.salesTableSelect.value));
  elements.closePaymentMethod.addEventListener("click", closePaymentMethodModal);
  elements.paymentMethodModal.addEventListener("click", (event) => {
    if (event.target === elements.paymentMethodModal) closePaymentMethodModal();
  });
  elements.paidCashBtn.addEventListener("click", () => confirmPaidWithMethod("cash"));
  elements.paidOnlineBtn.addEventListener("click", () => confirmPaidWithMethod("online"));
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

function setDefaultReportDates() {
  const today = getTodayKey();
  elements.reportStartDate.value = today;
  elements.reportEndDate.value = today;
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
  listenToActiveOrders((orders) => {
    const previousOrderIds = new Set(state.previousOrderIds);
    const previousPendingItemKeys = new Set(state.previousPendingItemKeys);
    const notifications = [];
    state.orders.clear();
    state.knownOccupied.clear();
    state.previousPendingItemKeys.clear();
    orders.forEach((order) => {
      const orderId = order.orderId || order.id;
      state.orders.set(orderId, { ...order, orderId });
      state.knownOccupied.add(order.tableId);
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

function subscribeToSummary() {
  listenToTodaySummary((summary) => {
    elements.todayCollection.textContent = `Today's Collection: ${formatCurrency(summary.total || 0)}`;
  }, () => showToast("Connection error, please refresh"));
}

const SECTION_TAB_THEMES = {
  "party-hall": "admin-tab-teal",
  "tatoo-studio": "admin-tab-green",
  "hotel": "admin-tab-gold"
};

function getSectionTabTheme(sectionId) {
  return SECTION_TAB_THEMES[sectionId] || "admin-tab-teal";
}

function getTableFaceNumber(tableId) {
  const parts = String(tableId || "").trim().split(/\s+/);
  return parts[parts.length - 1] || tableId;
}

function getTableItemCount(orders = []) {
  return orders.reduce((sum, order) => (
    sum + (order.items || []).reduce((itemSum, item) => itemSum + Number(item.qty || 0), 0)
  ), 0);
}

function getLatestOrderTime(orders = []) {
  const latest = orders[orders.length - 1];
  if (!latest?.timestamp?.toDate) return "";
  return latest.timestamp.toDate().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function renderTables(flashTableId = null) {
  if (!elements.tableGrid) return;
  const activeSection = getActiveSection();
  elements.tableGrid.className = "admin-dashboard admin-dashboard-pos";
  elements.tableGrid.innerHTML = `
    <nav class="admin-top-tabs" aria-label="Table sections">
      ${CONFIG.ORDER_SECTIONS.map(sectionButtonHtml).join("")}
    </nav>
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
    elements.activeTables.textContent = String(state.knownOccupied.size);
  }
  bindSectionActions();
  bindCardActions();
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
  return `
    <button class="admin-top-tab ${theme} ${isActive ? "active" : ""} ${isFlashing ? "flash" : ""}" type="button" data-section="${escapeHtml(section.id)}">
      <span>${escapeHtml(section.name)}</span>
      ${alertCount ? `<strong>${alertCount}</strong>` : ""}
    </button>
  `;
}

function bindSectionActions() {
  elements.tableGrid.querySelectorAll("[data-section]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeSectionId = button.dataset.section;
      state.expandedTableId = null;
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
  const isExpanded = state.expandedTableId === tableId;
  const activeClass = isExpanded ? "table-card-active" : "";
  const faceNumber = getTableFaceNumber(tableId);

  if (!orders.length) {
    return `
      <article class="table-card table-card-orderable table-card-pos table-card-empty table-card-compact ${flash ? "flash" : ""}" data-table="${escapeHtml(tableId)}">
        <button class="table-card-toggle table-card-face" type="button" aria-label="Take order for ${escapeHtml(tableId)}">
          <span class="table-face-corner table-face-tl">Empty</span>
          <span class="table-face-number">${escapeHtml(faceNumber)}</span>
          <span class="table-face-label">${escapeHtml(tableId)}</span>
        </button>
      </article>
    `;
  }

  const clearEnabled = orders.every((order) => !hasPendingItems(order));
  const orderBlocks = orders.map(orderBlockHtml).join("");
  const tableTotal = getTableOrdersTotal(orders);
  const itemCount = getTableItemCount(orders);
  const latestTime = getLatestOrderTime(orders);

  return `
    <article class="table-card table-card-orderable table-card-pos table-card-occupied table-card-compact ${activeClass} ${flash ? "flash" : ""}" data-table="${escapeHtml(tableId)}">
      <button class="table-card-toggle table-card-face" type="button" aria-expanded="${isExpanded ? "true" : "false"}" aria-label="View orders for ${escapeHtml(tableId)}">
        <span class="table-face-corner table-face-tl">${orders.length} ord</span>
        <span class="table-face-number">${escapeHtml(faceNumber)}</span>
        <span class="table-face-corner table-face-tr">${itemCount}</span>
        <span class="table-face-corner table-face-bl">${escapeHtml(latestTime)}</span>
        <span class="table-face-corner table-face-br">${formatCurrency(tableTotal)}</span>
        <span class="table-face-label">${escapeHtml(tableId)}</span>
      </button>
      <div class="table-card-details" ${isExpanded ? "" : "hidden"}>
        <div class="table-order-group">${orderBlocks}</div>
        <footer class="table-card-footer">
          <button class="secondary-btn table-add-order-btn" type="button" data-table="${escapeHtml(tableId)}">Add Items</button>
          <div class="card-actions table-clear-actions" data-table="${escapeHtml(tableId)}">
            <button class="table-clear-btn danger-btn" type="button" data-action="clear" ${clearEnabled ? "" : "disabled"} title="${clearEnabled ? "Clear this table" : "Serve all items before clearing"}">Clear Table</button>
          </div>
        </footer>
      </div>
    </article>
  `;
}

function orderBlockHtml(order) {
  const status = order.status || "new";
  const paymentClaimed = order.paymentStatus === "customer_claimed_paid";
  const cashRequested = order.paymentStatus === "cash_at_counter";
  const paymentVerified = order.paymentStatus === "verified_paid";
  const customerLine = order.customerName || order.customerMobileNormalized
    ? `<div class="customer-id-line">${escapeHtml(order.customerName || "Customer")} ${order.customerMobileNormalized ? `<span>${escapeHtml(maskMobile(order.customerMobileNormalized))}</span>` : ""}</div>`
    : "";
  const sourceBadge = order.placedBy === "counter"
    ? "<span class=\"badge source-badge\">Counter</span>"
    : "";
  const lines = renderAdminFullItemsHtml(order.items || []);

  const statusLabel = paymentVerified && status === "served"
    ? "Served"
    : paymentVerified
      ? "Payment Verified"
      : STATUS_LABELS[status] || status;
  return `
    <section class="admin-order-block status-${escapeHtml(status)}" data-order="${escapeHtml(order.orderId || order.id)}">
      <div class="admin-order-head">
        <span class="admin-order-id">${escapeHtml(String(order.orderId || order.id).slice(0, 8))}</span>
        <span class="badge">${escapeHtml(statusLabel)}</span>
        ${sourceBadge}
      </div>
      ${customerLine}
      ${paymentClaimed ? "<div class=\"payment-alert\">Customer says payment done - verify UPI</div>" : ""}
      ${cashRequested ? "<div class=\"payment-alert cash-alert\">Customer will pay cash at counter</div>" : ""}
      <ul class="order-lines order-lines-full" data-item-detail role="button" tabindex="0" aria-label="View all items for ${escapeHtml(order.orderId || order.id)}">${lines}</ul>
      <div class="card-meta">
        <strong>${formatCurrency(order.total)}</strong>
        <span>${formatTime(order.timestamp)}</span>
      </div>
      <div class="card-actions" data-table="${escapeHtml(order.tableId)}" data-order="${escapeHtml(order.orderId || order.id)}" data-status="${escapeHtml(status)}">
        ${paymentClaimed ? "<button class=\"ghost-btn\" type=\"button\" data-action=\"reject-pay\">Reject Payment Claim</button>" : ""}
        ${status === "new" || status === "preparing" ? "<button class=\"ghost-btn\" type=\"button\" data-action=\"cancel\">Cancel Order</button>" : ""}
        ${status !== "paid" && !paymentVerified ? "<button class=\"primary-btn\" type=\"button\" data-action=\"paid\">Confirm Payment</button>" : ""}
        <button class="ghost-btn" type="button" data-action="print">Print Bill</button>
      </div>
    </section>
  `;
}

function bindCardActions() {
  elements.tableGrid.querySelectorAll(".table-card-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      const card = button.closest(".table-card");
      const tableId = card?.dataset.table;
      if (!tableId) return;

      if (card.classList.contains("table-card-empty")) {
        acknowledgeTableNotice(tableId);
        openAdminOrderModal(tableId);
        return;
      }

      acknowledgeTableNotice(tableId);
      state.expandedTableId = state.expandedTableId === tableId ? null : tableId;
      renderTables();
    });
  });

  elements.tableGrid.querySelectorAll(".table-add-order-btn").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openAdminOrderModal(button.dataset.table);
    });
  });

  elements.tableGrid.querySelectorAll(".table-card-footer, .card-actions").forEach((actions) => {
    actions.addEventListener("click", (event) => event.stopPropagation());
  });

  elements.tableGrid.querySelectorAll(".card-actions [data-action]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
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

          if (window.confirm(`Cancel order ${String(orderId).slice(0, 8)} for ${tableId}?`)) {
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
        if (action === "clear") await clearTable(tableId);
        if (action === "print") printTableBill(tableId, orderId);
      } catch {
        showToast("Connection error, please refresh");
        button.disabled = false;
      }
    });
  });

  elements.tableGrid.querySelectorAll(".order-lines[data-item-detail]").forEach((itemArea) => {
    const orderBlock = itemArea.closest(".admin-order-block");
    itemArea.addEventListener("mouseenter", () => showAdminHoverPreview(orderBlock));
    itemArea.addEventListener("focus", () => showAdminHoverPreview(orderBlock));
    itemArea.addEventListener("mouseleave", hideAdminHoverPreview);
    itemArea.addEventListener("blur", hideAdminHoverPreview);
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

function printTableBill(tableId, orderId) {
  const order = state.orders.get(orderId);
  if (!order) return;
  const lines = (order.items || []).map((item) => `
    <tr><td>${escapeHtml(item.name)}</td><td>${item.qty}</td><td>${formatCurrency(item.price * item.qty)}</td></tr>
  `).join("");
  const html = `
    <html><head><title>Bill ${tableId}</title></head><body>
    <h2>${escapeHtml(CONFIG.RESTAURANT_NAME)} — ${escapeHtml(tableId)}</h2>
    <p>Order: ${escapeHtml(order.orderId || orderId)}</p>
    ${order.customerName || order.customerMobileNormalized ? `<p>Customer: ${escapeHtml(order.customerName || "Customer")} ${escapeHtml(maskMobile(order.customerMobileNormalized || order.customerMobile))}</p>` : ""}
    <table border="1" cellpadding="8"><tr><th>Item</th><th>Qty</th><th>Amount</th></tr>${lines}</table>
    <p><strong>Total: ${formatCurrency(order.total)}</strong></p>
    </body></html>
  `;
  const win = window.open("", "_blank");
  win.document.write(html);
  win.document.close();
  win.print();
}

function populateSalesTableSelect() {
  const orderTables = CONFIG.ORDER_SECTIONS.flatMap((section) => section.tables);
  elements.salesTableSelect.innerHTML = orderTables.map((tableId) => `
    <option value="${escapeHtml(tableId)}">${escapeHtml(tableId)}</option>
  `).join("");
}

function openAdminMenu() {
  const drawerBackdrop = document.querySelector("#managerDrawerBackdrop");
  if (drawerBackdrop && !drawerBackdrop.hidden) drawerBackdrop.click();
  elements.adminMenuModal.hidden = false;
  showSalesPanel();
  loadSalesForTable(elements.salesTableSelect.value || CONFIG.TABLES[0]);
}

function showSalesPanel() {
  elements.salesPanel.hidden = false;
  elements.reportPanel.hidden = true;
  elements.salesTab.className = "primary-btn";
  elements.reportTab.className = "ghost-btn";
}

function showReportPanel() {
  elements.salesPanel.hidden = true;
  elements.reportPanel.hidden = false;
  elements.salesTab.className = "ghost-btn";
  elements.reportTab.className = "primary-btn";
  loadReport();
}

async function loadSalesForTable(tableId) {
  elements.historyTitle.textContent = `${tableId} Sales History`;
  elements.historyList.innerHTML = "<p class=\"subtle\">Loading history...</p>";

  try {
    const rows = await fetchTableHistory(tableId);
    if (!rows.length) {
      elements.historyList.innerHTML = "<p class=\"subtle\">No paid history yet for this table.</p>";
      return;
    }
    elements.historyList.innerHTML = rows.map(historyRowHtml).join("");
  } catch {
    elements.historyList.innerHTML = "<p class=\"subtle\">History unavailable, please refresh.</p>";
  }
}

function historyRowHtml(order) {
  const items = (order.items || []).map((item) => `
    <li><span>${escapeHtml(item.name)}</span><strong>x${Number(item.qty || 0)}</strong></li>
  `).join("");

  return `
    <article class="history-row">
      <div class="history-row-head">
        <div>
          <strong>${formatCurrency(order.total)}</strong>
          <div class="subtle">${escapeHtml(paymentMethodLabel(order.paymentMethod))} · ${escapeHtml(order.placedBy || "customer")}</div>
          ${order.customerName || order.customerMobileNormalized ? `<div class="subtle">${escapeHtml(order.customerName || "Customer")} - ${escapeHtml(maskMobile(order.customerMobileNormalized || order.customerMobile))}</div>` : ""}
          <div class="subtle">Bill ${escapeHtml(String(order.orderId || order.id || "").slice(0, 8))}</div>
        </div>
        <div class="history-times">
          <span>Paid: ${formatDateTime(order.paidAt)}</span>
          <span>Order: ${formatDateTime(order.orderedAt)}</span>
        </div>
      </div>
      <ul class="order-lines">${items}</ul>
    </article>
  `;
}

async function loadReport() {
  const startKey = elements.reportStartDate.value || getTodayKey();
  const endKey = elements.reportEndDate.value || startKey;
  elements.reportContent.innerHTML = "<p class=\"subtle\">Loading report...</p>";

  try {
    const report = await fetchReportForDateRange(startKey, endKey);
    state.lastReport = report;
    elements.reportContent.innerHTML = reportHtml(report);
  } catch {
    elements.reportContent.innerHTML = "<p class=\"subtle\">Report unavailable, please refresh.</p>";
  }
}

function reportHtml(report) {
  const itemRows = report.items.length
    ? report.items.map((item) => `
      <li>
        <span>${escapeHtml(item.name)} <small>x${Number(item.qty || 0)}</small></span>
        <strong>${formatCurrency(item.total)}</strong>
      </li>
    `).join("")
    : "<li><span>No items sold in range.</span><strong>Rs 0</strong></li>";

  return `
    <div class="report-grid">
      <article><span>Total</span><strong>${formatCurrency(report.total)}</strong></article>
      <article><span>Cash</span><strong>${formatCurrency(report.cash)}</strong></article>
      <article><span>Online</span><strong>${formatCurrency(report.online)}</strong></article>
      <article><span>Bills</span><strong>${Number(report.orders || 0)}</strong></article>
      <article><span>Counter</span><strong>${Number(report.counter || 0)}</strong></article>
      <article><span>Customer</span><strong>${Number(report.customer || 0)}</strong></article>
    </div>
    <h4>Menu Items Sold (${escapeHtml(report.startDate)} – ${escapeHtml(report.endDate)})</h4>
    <ul class="report-item-list">${itemRows}</ul>
  `;
}

function exportReportCsv() {
  if (!state.lastReport) {
    showToast("Load a report first");
    return;
  }
  const blob = new Blob([reportToCsv(state.lastReport)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `sales-${state.lastReport.startDate}-${state.lastReport.endDate}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function openPaymentMethodModal(tableId, options = {}) {
  const order = options.orderId ? state.orders.get(options.orderId) : null;
  const amount = Number(options.amount ?? order?.total ?? 0);
  state.pendingPaidTable = tableId;
  state.pendingPaidOrderId = options.orderId || null;
  state.pendingPaymentItems = options.items ? cloneOrderItems(options.items) : null;
  state.pendingPaymentIsCounterOrder = Boolean(options.isCounterOrder);
  elements.paymentMethodTable.innerHTML = `
    <span>Mark ${escapeHtml(tableId)} paid by:</span>
    <strong>Amount: ${formatCurrency(amount)}</strong>
  `;
  elements.paymentMethodModal.hidden = false;
}

function closePaymentMethodModal() {
  state.pendingPaidTable = null;
  state.pendingPaidOrderId = null;
  state.pendingPaymentItems = null;
  state.pendingPaymentIsCounterOrder = false;
  elements.paymentMethodModal.hidden = true;
}

async function confirmPaidWithMethod(method) {
  if (!state.pendingPaidTable) return;
  const tableId = state.pendingPaidTable;
  const orderId = state.pendingPaidOrderId;
  const pendingItems = state.pendingPaymentItems ? cloneOrderItems(state.pendingPaymentItems) : null;
  const isCounterOrder = state.pendingPaymentIsCounterOrder;
  elements.paidCashBtn.disabled = true;
  elements.paidOnlineBtn.disabled = true;

  try {
    if (pendingItems?.length) {
      await placeCounterOrderWithPayment(tableId, pendingItems, method);
      showToast(`Order placed for ${tableId}`);
    } else {
      await verifyOrderPayment(orderId, method);
    }
    closePaymentMethodModal();
  } catch {
    showToast(isCounterOrder ? "Order failed. Check connection and refresh." : "Connection error, please refresh");
  } finally {
    elements.paidCashBtn.disabled = false;
    elements.paidOnlineBtn.disabled = false;
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

function closeAdminMenu() {
  elements.adminMenuModal.hidden = true;
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
  const hasOrder = getOrdersForTable(tableId).length > 0;
  if (elements.adminOrderTitle) {
    elements.adminOrderTitle.textContent = state.orderModalOptions.deferPayment
      ? `Order Food — ${tableId}`
      : (hasOrder ? `Add Items — ${tableId}` : `Take Order — ${tableId}`);
  }
  if (!elements.adminOrderModal) return;
  elements.adminOrderModal.classList.add("modal-front");
  elements.adminOrderModal.hidden = false;
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
      showToast(`Food order sent to kitchen for ${tableId}`);
      return;
    }

    closeAdminOrderModal();
    openPaymentMethodModal(tableId, {
      items,
      amount: total,
      isCounterOrder: true
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
      `Table: ${order?.tableId || "-"}`,
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
