import {
  CONFIG,
  STATUS_LABELS,
  cancelOrder,
  clearTable,
  escapeHtml,
  fetchMenu,
  fetchReportForDateRange,
  fetchTableHistory,
  formatCurrency,
  formatTime,
  getTodayKey,
  listenToOrder,
  listenToTodaySummary,
  maskMobile,
  placeCounterOrderWithPayment,
  registerServiceWorker,
  rejectPaymentClaim,
  reportToCsv,
  showToast,
  updateOrderStatus,
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
import { requireStaffAuth, signOutStaff } from "./staff-auth.js";

const state = {
  orders: new Map(),
  knownOccupied: new Set(),
  pendingPaidTable: null,
  pendingPaymentItems: null,
  pendingPaymentIsCounterOrder: false,
  hoverPreview: null,
  orderTableId: null,
  groupedMenu: {},
  categories: [],
  activeCategory: "",
  cart: new Map(),
  menuLoaded: false,
  lastReport: null
};

const elements = {
  restaurant: document.querySelector("#adminRestaurant"),
  clock: document.querySelector("#clock"),
  activeTables: document.querySelector("#activeTables"),
  todayCollection: document.querySelector("#todayCollection"),
  tableGrid: document.querySelector("#tableGrid"),
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
  adminMenuList: document.querySelector("#adminMenuList"),
  adminCartList: document.querySelector("#adminCartList"),
  adminGrandTotal: document.querySelector("#adminGrandTotal"),
  adminBackToMenu: document.querySelector("#adminBackToMenu"),
  adminOrderCount: document.querySelector("#adminOrderCount"),
  adminOrderTotal: document.querySelector("#adminOrderTotal"),
  adminViewCartBtn: document.querySelector("#adminViewCartBtn"),
  adminPlaceOrderBtn: document.querySelector("#adminPlaceOrderBtn")
};

// Starts the counter view after staff authentication.
function init() {
  registerServiceWorker();
  elements.restaurant.textContent = CONFIG.RESTAURANT_NAME;
  populateSalesTableSelect();
  setDefaultReportDates();
  bindUi();
  requireStaffAuth(startAdminApp);
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
  elements.adminViewCartBtn.addEventListener("click", () => {
    renderAdminCart();
    showAdminOrderScreen("cart");
  });
  elements.adminPlaceOrderBtn.addEventListener("click", placeAdminOrder);
  window.addEventListener("scroll", hideAdminHoverPreview, true);
  window.addEventListener("resize", hideAdminHoverPreview);
  elements.signOutBtn.addEventListener("click", async () => {
    await signOutStaff();
    window.location.reload();
  });
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
  elements.tableGrid.innerHTML = CONFIG.TABLES.map((tableId) => tableCardHtml(tableId, null)).join("");
}

function subscribeToTables() {
  CONFIG.TABLES.forEach((tableId) => {
    listenToOrder(tableId, (order) => {
      const wasEmpty = !state.knownOccupied.has(tableId);
      if (order) {
        state.orders.set(tableId, order);
        state.knownOccupied.add(tableId);
        if (wasEmpty) notifyNewOrder();
      } else {
        state.orders.delete(tableId);
        state.knownOccupied.delete(tableId);
      }
      renderTables(tableId);
    }, () => showToast("Connection error, please refresh"));
  });
}

function subscribeToSummary() {
  listenToTodaySummary((summary) => {
    elements.todayCollection.textContent = `Today's Collection: ${formatCurrency(summary.total || 0)}`;
  }, () => showToast("Connection error, please refresh"));
}

function renderTables(flashTableId = null) {
  elements.tableGrid.innerHTML = CONFIG.TABLES.map((tableId) => {
    const order = state.orders.get(tableId) || null;
    return tableCardHtml(tableId, order, tableId === flashTableId && order?.status === "new");
  }).join("");

  elements.activeTables.textContent = `Active Tables: ${state.orders.size}`;
  bindCardActions();
}

function tableCardHtml(tableId, order, flash = false) {
  if (!order) {
    return `
      <article class="table-card table-card-orderable ${flash ? "flash" : ""}" data-table="${escapeHtml(tableId)}" tabindex="0" aria-label="Take order for ${escapeHtml(tableId)}">
        <div class="table-head">
          <span class="table-id">${escapeHtml(tableId)}</span>
          <span class="badge">Empty</span>
        </div>
      </article>
    `;
  }

  const status = order.status || "new";
  const canOrder = status !== "paid";
  const paymentClaimed = order.paymentStatus === "customer_claimed_paid";
  const cashRequested = order.paymentStatus === "cash_at_counter";
  const paymentVerified = order.paymentStatus === "verified_paid";
  const customerLine = order.customerName || order.customerMobileNormalized
    ? `<div class="customer-id-line">${escapeHtml(order.customerName || "Customer")} ${order.customerMobileNormalized ? `<span>${escapeHtml(maskMobile(order.customerMobileNormalized))}</span>` : ""}</div>`
    : "";
  const sourceBadge = order.placedBy === "counter"
    ? "<span class=\"badge source-badge\">Counter</span>"
    : "";
  const lines = renderAdminItemsHtml(order.items || []);

  return `
    <article class="table-card status-${escapeHtml(status)} ${canOrder ? "table-card-orderable" : ""} ${flash ? "flash" : ""}" ${canOrder ? `data-table="${escapeHtml(tableId)}" tabindex="0" aria-label="Add items for ${escapeHtml(tableId)}"` : ""}>
      <div class="table-head">
        <span class="table-id">${escapeHtml(tableId)}</span>
        <span class="badge">${escapeHtml(STATUS_LABELS[status] || status)}</span>
        ${sourceBadge}
      </div>
      ${customerLine}
      ${paymentClaimed ? "<div class=\"payment-alert\">Customer says payment done - verify UPI</div>" : ""}
      ${cashRequested ? "<div class=\"payment-alert cash-alert\">Customer will pay cash at counter</div>" : ""}
      <ul class="order-lines" data-item-detail role="button" tabindex="0" aria-label="View all items for ${escapeHtml(tableId)}">${lines}</ul>
      <div class="card-meta">
        <strong>${formatCurrency(order.total)}</strong>
        <span>${formatTime(order.timestamp)}</span>
      </div>
      <div class="card-actions" data-table="${escapeHtml(tableId)}" data-status="${escapeHtml(status)}">
        ${paymentClaimed ? "<button class=\"ghost-btn\" type=\"button\" data-action=\"reject-pay\">Reject Payment Claim</button>" : ""}
        ${status === "new" || status === "preparing" ? "<button class=\"ghost-btn\" type=\"button\" data-action=\"cancel\">Cancel Order</button>" : ""}
        ${paymentVerified && (status === "new" || status === "preparing") ? "<button class=\"secondary-btn\" type=\"button\" data-action=\"served\">Mark Served</button>" : ""}
        ${status !== "paid" && !paymentVerified ? "<button class=\"primary-btn\" type=\"button\" data-action=\"paid\">Confirm Payment</button>" : ""}
        ${status === "paid" || (paymentVerified && status === "served") ? "<button class=\"danger-btn\" type=\"button\" data-action=\"clear\">Clear Table</button>" : ""}
        <button class="ghost-btn" type="button" data-action="print">Print Bill</button>
      </div>
    </article>
  `;
}

function bindCardActions() {
  elements.tableGrid.querySelectorAll(".table-card-orderable").forEach((card) => {
    const openOrder = () => openAdminOrderModal(card.dataset.table);
    card.addEventListener("click", openOrder);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openOrder();
      }
    });
  });

  elements.tableGrid.querySelectorAll(".card-actions [data-action]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const tableId = button.closest(".card-actions").dataset.table;
      const action = button.dataset.action;
      button.disabled = true;

      try {
        if (action === "preparing") await updateOrderStatus(tableId, "preparing");
        if (action === "served") await updateOrderStatus(tableId, "served");
        if (action === "reject-pay") await rejectPaymentClaim(tableId);
        if (action === "cancel") {
          const currentOrder = state.orders.get(tableId);
          if (currentOrder?.status === "served" || currentOrder?.status === "paid") {
            showToast("Served orders cannot be cancelled.");
            button.disabled = false;
            return;
          }

          if (window.confirm(`Cancel order for ${tableId}?`)) {
            const cancelled = await cancelOrder(tableId);
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
          openPaymentMethodModal(tableId);
          button.disabled = false;
          return;
        }
        if (action === "clear") await clearTable(tableId);
        if (action === "print") printTableBill(tableId);
      } catch {
        showToast("Connection error, please refresh");
        button.disabled = false;
      }
    });
  });

  elements.tableGrid.querySelectorAll(".order-lines[data-item-detail]").forEach((itemArea) => {
    const card = itemArea.closest(".table-card");
    itemArea.addEventListener("mouseenter", () => showAdminHoverPreview(card));
    itemArea.addEventListener("focus", () => showAdminHoverPreview(card));
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

function renderAdminItemsHtml(items = []) {
  const visibleItems = items.slice(0, 3);
  const moreCount = Math.max(0, items.length - visibleItems.length);
  return `${visibleItems.map((item) => `
    <li><span>${escapeHtml(item.name)}</span><strong>x${Number(item.qty || 0)}</strong></li>
  `).join("")}${moreCount ? `
    <li class="order-more-line"><span>+${moreCount} more</span><strong></strong></li>
  ` : ""}`;
}

function renderAdminDetailItemsHtml(items = []) {
  if (!items.length) return "<li class=\"kitchen-detail-item\"><span>No items</span></li>";

  return items.map((item) => `
    <li class="kitchen-detail-item">
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

function showAdminHoverPreview(card) {
  if (!card || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

  const tableId = card.querySelector(".card-actions")?.dataset.table || card.dataset.table;
  const order = state.orders.get(tableId);
  if (!order) return;

  const preview = getAdminHoverPreview();
  const cardRect = card.getBoundingClientRect();
  preview.style.width = `${Math.min(360, Math.max(260, cardRect.width))}px`;
  preview.style.left = "0px";
  preview.style.top = "0px";
  preview.innerHTML = `
    <strong>Order ${escapeHtml(tableId)}</strong>
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

function printTableBill(tableId) {
  const order = state.orders.get(tableId);
  if (!order) return;
  const lines = (order.items || []).map((item) => `
    <tr><td>${escapeHtml(item.name)}</td><td>${item.qty}</td><td>${formatCurrency(item.price * item.qty)}</td></tr>
  `).join("");
  const html = `
    <html><head><title>Bill ${tableId}</title></head><body>
    <h2>${escapeHtml(CONFIG.RESTAURANT_NAME)} — ${escapeHtml(tableId)}</h2>
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
  elements.salesTableSelect.innerHTML = CONFIG.TABLES.map((tableId) => `
    <option value="${escapeHtml(tableId)}">${escapeHtml(tableId)}</option>
  `).join("");
}

function openAdminMenu() {
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
  const order = state.orders.get(tableId);
  const amount = Number(options.amount ?? order?.total ?? 0);
  state.pendingPaidTable = tableId;
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
  state.pendingPaymentItems = null;
  state.pendingPaymentIsCounterOrder = false;
  elements.paymentMethodModal.hidden = true;
}

async function confirmPaidWithMethod(method) {
  if (!state.pendingPaidTable) return;
  const tableId = state.pendingPaidTable;
  const pendingItems = state.pendingPaymentItems ? cloneOrderItems(state.pendingPaymentItems) : null;
  const isCounterOrder = state.pendingPaymentIsCounterOrder;
  elements.paidCashBtn.disabled = true;
  elements.paidOnlineBtn.disabled = true;

  try {
    if (pendingItems?.length) {
      await placeCounterOrderWithPayment(tableId, pendingItems, method);
      showToast(`Order placed for ${tableId}`);
    } else {
      await verifyOrderPayment(tableId, method);
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

async function openAdminOrderModal(tableId) {
  state.orderTableId = tableId;
  state.cart.clear();
  const hasOrder = state.orders.has(tableId);
  elements.adminOrderTitle.textContent = hasOrder ? `Add Items — ${tableId}` : `Take Order — ${tableId}`;
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
  state.orderTableId = null;
  state.cart.clear();
  elements.adminOrderModal.hidden = true;
}

function showAdminOrderScreen(name) {
  const isMenu = name === "menu";
  elements.adminOrderMenuScreen.classList.toggle("active", isMenu);
  elements.adminOrderMenuScreen.hidden = !isMenu;
  elements.adminOrderCartScreen.classList.toggle("active", !isMenu);
  elements.adminOrderCartScreen.hidden = isMenu;
  elements.adminViewCartBtn.hidden = !isMenu;
  elements.adminPlaceOrderBtn.textContent = isMenu ? "Place Order" : "Confirm Order";
  updateAdminOrderFooter();
}

function renderAdminCategories() {
  renderCategoryRow(elements.adminCategoryRow, state.categories, state.activeCategory, (category) => {
    state.activeCategory = category;
    renderAdminCategories();
    renderAdminMenu();
  });
}

function renderAdminMenu() {
  const items = state.groupedMenu[state.activeCategory] || [];
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
  const existingTotal = Number(state.orders.get(tableId)?.total || 0);
  elements.adminPlaceOrderBtn.disabled = true;

  closeAdminOrderModal();
  openPaymentMethodModal(tableId, {
    items,
    amount: existingTotal + total,
    isCounterOrder: true
  });
  elements.adminPlaceOrderBtn.disabled = false;
}

function notifyNewOrder() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContext();
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

init();
