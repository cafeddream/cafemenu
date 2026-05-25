import {
  CONFIG,
  STATUS_LABELS,
  clearTable,
  escapeHtml,
  formatCurrency,
  formatTime,
  listenToOrder,
  listenToTodaySummary,
  markOrderPaid,
  registerServiceWorker,
  showToast,
  updateOrderStatus
} from "./firebase.js";

const state = {
  orders: new Map(),
  knownOccupied: new Set()
};

const elements = {
  restaurant: document.querySelector("#adminRestaurant"),
  clock: document.querySelector("#clock"),
  activeTables: document.querySelector("#activeTables"),
  todayCollection: document.querySelector("#todayCollection"),
  tableGrid: document.querySelector("#tableGrid")
};

// Starts the counter view with real-time table subscriptions.
function init() {
  registerServiceWorker();
  elements.restaurant.textContent = CONFIG.RESTAURANT_NAME;
  renderEmptyCards();
  startClock();
  subscribeToTables();
  subscribeToSummary();
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
        if (action === "paid") await markOrderPaid(tableId);
        if (action === "clear") await clearTable(tableId);
      } catch {
        showToast("Connection error, please refresh");
        button.disabled = false;
      }
    });
  });
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
