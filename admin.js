import {
  CONFIG,
  STATUS_LABELS,
  clearTable,
  escapeHtml,
  fetchTableHistory,
  fetchTodayReport,
  formatCurrency,
  formatTime,
  listenToOrder,
  listenToTodaySummary,
  markOrderPaid,
  onStaffAuthState,
  registerServiceWorker,
  showToast,
  signInStaff,
  signOutStaff,
  updateOrderStatus
} from "./firebase.js";

const state = {
  orders: new Map(),
  knownOccupied: new Set(),
  appStarted: false,
  pendingPaidTable: null
};

const elements = {
  authScreen: document.querySelector("#authScreen"),
  protectedApp: document.querySelector("#protectedApp"),
  loginForm: document.querySelector("#loginForm"),
  loginEmail: document.querySelector("#loginEmail"),
  loginPassword: document.querySelector("#loginPassword"),
  authError: document.querySelector("#authError"),
  restaurant: document.querySelector("#adminRestaurant"),
  clock: document.querySelector("#clock"),
  activeTables: document.querySelector("#activeTables"),
  todayCollection: document.querySelector("#todayCollection"),
  tableGrid: document.querySelector("#tableGrid"),
  menuButton: document.querySelector("#menuButton"),
  logoutButton: document.querySelector("#logoutButton"),
  adminMenuModal: document.querySelector("#adminMenuModal"),
  closeMenu: document.querySelector("#closeMenu"),
  salesTab: document.querySelector("#salesTab"),
  reportTab: document.querySelector("#reportTab"),
  salesPanel: document.querySelector("#salesPanel"),
  reportPanel: document.querySelector("#reportPanel"),
  refreshReportBtn: document.querySelector("#refreshReportBtn"),
  reportContent: document.querySelector("#reportContent"),
  salesTableSelect: document.querySelector("#salesTableSelect"),
  historyTitle: document.querySelector("#historyTitle"),
  historyList: document.querySelector("#historyList"),
  paymentMethodModal: document.querySelector("#paymentMethodModal"),
  closePaymentMethod: document.querySelector("#closePaymentMethod"),
  paymentMethodTable: document.querySelector("#paymentMethodTable"),
  paidCashBtn: document.querySelector("#paidCashBtn"),
  paidOnlineBtn: document.querySelector("#paidOnlineBtn")
};

// Starts the counter view with real-time table subscriptions.
function init() {
  registerServiceWorker();
  bindAuthEvents();
  onStaffAuthState((user) => {
    if (user) {
      elements.authScreen.hidden = true;
      elements.protectedApp.hidden = false;
      startAdminApp();
    } else {
      elements.authScreen.hidden = false;
      elements.protectedApp.hidden = true;
    }
  });
}

// Starts protected admin behavior once after staff login.
function startAdminApp() {
  if (state.appStarted) return;
  state.appStarted = true;
  elements.restaurant.textContent = CONFIG.RESTAURANT_NAME;
  populateSalesTableSelect();
  renderEmptyCards();
  elements.menuButton.addEventListener("click", openAdminMenu);
  elements.closeMenu.addEventListener("click", closeAdminMenu);
  elements.adminMenuModal.addEventListener("click", (event) => {
    if (event.target === elements.adminMenuModal) closeAdminMenu();
  });
  elements.salesTab.addEventListener("click", showSalesPanel);
  elements.reportTab.addEventListener("click", showReportPanel);
  elements.refreshReportBtn.addEventListener("click", loadTodayReport);
  elements.salesTableSelect.addEventListener("change", () => loadSalesForTable(elements.salesTableSelect.value));
  elements.closePaymentMethod.addEventListener("click", closePaymentMethodModal);
  elements.paymentMethodModal.addEventListener("click", (event) => {
    if (event.target === elements.paymentMethodModal) closePaymentMethodModal();
  });
  elements.paidCashBtn.addEventListener("click", () => confirmPaidWithMethod("cash"));
  elements.paidOnlineBtn.addEventListener("click", () => confirmPaidWithMethod("online"));
  startClock();
  subscribeToTables();
  subscribeToSummary();
}

// Handles staff login and logout controls.
function bindAuthEvents() {
  elements.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    elements.authError.textContent = "";
    const button = elements.loginForm.querySelector("button");
    button.disabled = true;

    try {
      await signInStaff(elements.loginEmail.value.trim(), elements.loginPassword.value);
    } catch {
      elements.authError.textContent = "Login failed. Check email and password.";
    } finally {
      button.disabled = false;
    }
  });

  elements.logoutButton.addEventListener("click", async () => {
    await signOutStaff();
    window.location.reload();
  });
}

// Updates the live clock every second.
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

// Renders initial empty cards so the layout appears immediately.
function renderEmptyCards() {
  elements.tableGrid.innerHTML = CONFIG.TABLES.map((tableId) => tableCardHtml(tableId, null)).join("");
}

// Listens to every configured table's current order.
function subscribeToTables() {
  CONFIG.TABLES.forEach((tableId) => {
    listenToOrder(tableId, (order) => {
      const wasEmpty = !state.knownOccupied.has(tableId);
      if (order) {
        state.orders.set(tableId, order);
        state.knownOccupied.add(tableId);
        if (wasEmpty) notifyNewOrder(tableId);
      } else {
        state.orders.delete(tableId);
        state.knownOccupied.delete(tableId);
      }
      renderTables(tableId);
    }, () => showToast("Connection error, please refresh"));
  });
}

// Subscribes to today's collection total.
function subscribeToSummary() {
  listenToTodaySummary((summary) => {
    elements.todayCollection.textContent = `Today's Collection: ${formatCurrency(summary.total || 0)}`;
  }, () => showToast("Connection error, please refresh"));
}

// Re-renders all table cards and optionally flashes a changed one.
function renderTables(flashTableId = null) {
  elements.tableGrid.innerHTML = CONFIG.TABLES.map((tableId) => {
    const order = state.orders.get(tableId) || null;
    return tableCardHtml(tableId, order, tableId === flashTableId && order?.status === "new");
  }).join("");

  elements.activeTables.textContent = `Active Tables: ${state.orders.size}`;
  bindCardActions();
}

// Builds one table card with status-specific controls.
function tableCardHtml(tableId, order, flash = false) {
  if (!order) {
    return `
      <article class="table-card ${flash ? "flash" : ""}">
        <div class="table-head">
          <span class="table-id">${escapeHtml(tableId)}</span>
          <span class="badge">Empty</span>
        </div>
      </article>
    `;
  }

  const status = order.status || "new";
  const paymentClaimed = order.paymentStatus === "customer_claimed_paid";
  const cashRequested = order.paymentStatus === "cash_at_counter";
  const lines = (order.items || []).map((item) => `
    <li><span>${escapeHtml(item.name)}</span><strong>x${Number(item.qty || 0)}</strong></li>
  `).join("");

  return `
    <article class="table-card status-${escapeHtml(status)} ${flash ? "flash" : ""}">
      <div class="table-head">
        <span class="table-id">${escapeHtml(tableId)}</span>
        <span class="badge">${escapeHtml(STATUS_LABELS[status] || status)}</span>
      </div>
      ${paymentClaimed ? "<div class=\"payment-alert\">Customer says payment done - verify UPI</div>" : ""}
      ${cashRequested ? "<div class=\"payment-alert cash-alert\">Customer will pay cash at counter</div>" : ""}
      <ul class="order-lines">${lines}</ul>
      <div class="card-meta">
        <strong>${formatCurrency(order.total)}</strong>
        <span>${formatTime(order.timestamp)}</span>
      </div>
      <div class="card-actions" data-table="${escapeHtml(tableId)}" data-status="${escapeHtml(status)}">
        ${status === "new" ? "<button class=\"secondary-btn\" type=\"button\" data-action=\"preparing\">Mark Preparing</button>" : ""}
        ${status === "new" || status === "preparing" ? "<button class=\"secondary-btn\" type=\"button\" data-action=\"served\">Mark Served</button>" : ""}
        ${status === "served" || status === "preparing" ? "<button class=\"primary-btn\" type=\"button\" data-action=\"paid\">Mark Paid</button>" : ""}
        ${status === "paid" ? "<button class=\"danger-btn\" type=\"button\" data-action=\"clear\">Clear Table</button>" : ""}
      </div>
    </article>
  `;
}

// Adds click handlers to all visible card action buttons.
function bindCardActions() {
  elements.tableGrid.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const tableId = button.closest(".card-actions").dataset.table;
      const action = button.dataset.action;
      button.disabled = true;

      try {
        if (action === "preparing") await updateOrderStatus(tableId, "preparing");
        if (action === "served") await updateOrderStatus(tableId, "served");
        if (action === "paid") {
          openPaymentMethodModal(tableId);
          button.disabled = false;
          return;
        }
        if (action === "clear") await clearTable(tableId);
      } catch {
        showToast("Connection error, please refresh");
        button.disabled = false;
      }
    });
  });
}

// Populates the sales table dropdown from the shared table config.
function populateSalesTableSelect() {
  elements.salesTableSelect.innerHTML = CONFIG.TABLES.map((tableId) => `
    <option value="${escapeHtml(tableId)}">${escapeHtml(tableId)}</option>
  `).join("");
}

// Opens the admin menu and loads sales for the selected table.
function openAdminMenu() {
  elements.adminMenuModal.hidden = false;
  showSalesPanel();
  loadSalesForTable(elements.salesTableSelect.value || CONFIG.TABLES[0]);
}

// Shows the table-wise sales history tab.
function showSalesPanel() {
  elements.salesPanel.hidden = false;
  elements.reportPanel.hidden = true;
  elements.salesTab.className = "primary-btn";
  elements.reportTab.className = "ghost-btn";
}

// Shows today's combined report tab.
function showReportPanel() {
  elements.salesPanel.hidden = true;
  elements.reportPanel.hidden = false;
  elements.salesTab.className = "ghost-btn";
  elements.reportTab.className = "primary-btn";
  loadTodayReport();
}

// Loads and displays recent paid bills for the selected table.
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

// Builds one paid history row for the modal.
function historyRowHtml(order) {
  const items = (order.items || []).map((item) => `
    <li><span>${escapeHtml(item.name)}</span><strong>x${Number(item.qty || 0)}</strong></li>
  `).join("");

  return `
    <article class="history-row">
      <div class="history-row-head">
        <div>
          <strong>${formatCurrency(order.total)}</strong>
          <div class="subtle">${escapeHtml(paymentMethodLabel(order.paymentMethod))}</div>
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

// Loads today's combined collection and item-wise report.
async function loadTodayReport() {
  elements.reportContent.innerHTML = "<p class=\"subtle\">Loading report...</p>";

  try {
    const report = await fetchTodayReport();
    elements.reportContent.innerHTML = reportHtml(report);
  } catch {
    elements.reportContent.innerHTML = "<p class=\"subtle\">Report unavailable, please refresh.</p>";
  }
}

// Builds the combined daily report markup.
function reportHtml(report) {
  const itemRows = report.items.length
    ? report.items.map((item) => `
      <li>
        <span>${escapeHtml(item.name)} <small>x${Number(item.qty || 0)}</small></span>
        <strong>${formatCurrency(item.total)}</strong>
      </li>
    `).join("")
    : "<li><span>No items sold today.</span><strong>Rs 0</strong></li>";

  return `
    <div class="report-grid">
      <article><span>Total</span><strong>${formatCurrency(report.total)}</strong></article>
      <article><span>Cash</span><strong>${formatCurrency(report.cash)}</strong></article>
      <article><span>Online</span><strong>${formatCurrency(report.online)}</strong></article>
      <article><span>Bills</span><strong>${Number(report.orders || 0)}</strong></article>
    </div>
    <h4>Menu Items Sold</h4>
    <ul class="report-item-list">${itemRows}</ul>
  `;
}

// Opens the payment method chooser for Mark Paid.
function openPaymentMethodModal(tableId) {
  state.pendingPaidTable = tableId;
  elements.paymentMethodTable.textContent = `Mark ${tableId} paid by:`;
  elements.paymentMethodModal.hidden = false;
}

// Closes the payment method chooser.
function closePaymentMethodModal() {
  state.pendingPaidTable = null;
  elements.paymentMethodModal.hidden = true;
}

// Confirms payment with a cash or online method.
async function confirmPaidWithMethod(method) {
  if (!state.pendingPaidTable) return;
  const tableId = state.pendingPaidTable;
  elements.paidCashBtn.disabled = true;
  elements.paidOnlineBtn.disabled = true;

  try {
    await markOrderPaid(tableId, method);
    closePaymentMethodModal();
  } catch {
    showToast("Connection error, please refresh");
  } finally {
    elements.paidCashBtn.disabled = false;
    elements.paidOnlineBtn.disabled = false;
  }
}

// Labels payment methods for history/report display.
function paymentMethodLabel(method) {
  return method === "online" ? "Online Payment" : "Cash Payment";
}

// Formats history timestamps with date and time.
function formatDateTime(value) {
  if (!value?.toDate) return "Paid time unavailable";
  return value.toDate().toLocaleString([], {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

// Closes the admin menu.
function closeAdminMenu() {
  elements.adminMenuModal.hidden = true;
}

// Plays a short Web Audio beep and leaves a visual flash on new orders.
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
    // Browsers may block audio until a user gesture; the visual flash still appears.
  }
}

init();
