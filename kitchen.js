import {
  CONFIG,
  escapeHtml,
  listenToOrder,
  minutesSince,
  registerServiceWorker,
  showToast,
  updateOrderStatus
} from "./firebase.js";

const state = {
  orders: new Map(),
  visibleIds: new Set()
};

const elements = {
  clock: document.querySelector("#kitchenClock"),
  pendingCount: document.querySelector("#pendingCount"),
  main: document.querySelector("#kitchenMain")
};

// Starts the kitchen display and live order subscriptions.
function init() {
  registerServiceWorker();
  startClock();
  renderKitchen();
  subscribeToActiveOrders();
  setInterval(renderKitchen, 60000);
}

// Updates the kitchen clock every second.
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

// Listens to every table and keeps only cooking-relevant orders.
function subscribeToActiveOrders() {
  CONFIG.TABLES.forEach((tableId) => {
    listenToOrder(tableId, (order) => {
      const isActive = order && ["new", "preparing"].includes(order.status);
      const wasVisible = state.visibleIds.has(tableId);

      if (isActive) {
        state.orders.set(tableId, order);
        state.visibleIds.add(tableId);
        if (!wasVisible) playKitchenBeep();
      } else {
        state.orders.delete(tableId);
        state.visibleIds.delete(tableId);
      }

      renderKitchen();
    }, () => showToast("Connection error, please refresh"));
  });
}

// Renders active kitchen cards or the all-clear empty state.
function renderKitchen() {
  const orders = [...state.orders.values()].sort((a, b) => {
    const aTime = a.timestamp?.toMillis?.() || 0;
    const bTime = b.timestamp?.toMillis?.() || 0;
    return aTime - bTime;
  });

  elements.pendingCount.textContent = `${orders.length} Order${orders.length === 1 ? "" : "s"} Pending`;

  if (!orders.length) {
    elements.main.innerHTML = `
      <div class="empty-state">
        <div>
          <strong>✓</strong>
          <h2>All Clear! No Pending Orders</h2>
        </div>
      </div>
    `;
    return;
  }

  elements.main.innerHTML = `
    <div class="kitchen-grid">
      ${orders.map(kitchenCardHtml).join("")}
    </div>
  `;
  bindKitchenActions();
}

// Builds one high-contrast kitchen order card.
function kitchenCardHtml(order) {
  const elapsed = minutesSince(order.timestamp);
  const overdue = elapsed >= 15;
  const statusClass = order.status === "preparing" ? "preparing" : "";
  const paymentClaimed = order.paymentStatus === "customer_claimed_paid";
  const items = (order.items || []).map((item) => `
    <li>${Number(item.qty || 0)} x ${escapeHtml(item.name)}</li>
  `).join("");

  return `
    <article class="kitchen-card ${statusClass} ${overdue ? "overdue" : ""}">
      <div class="kitchen-table">
        <strong>${escapeHtml(order.tableId)}</strong>
        <span class="elapsed">${elapsed || 1} min ago</span>
      </div>
      ${paymentClaimed ? "<div class=\"kitchen-payment-alert\">Payment claimed by customer</div>" : ""}
      <ul class="kitchen-items">${items}</ul>
      <div class="kitchen-actions" data-table="${escapeHtml(order.tableId)}" data-status="${escapeHtml(order.status)}">
        ${order.status === "new" ? "<button class=\"ghost-btn\" type=\"button\" data-action=\"preparing\">Start Preparing</button>" : ""}
        ${order.status === "new" || order.status === "preparing" ? "<button class=\"primary-btn\" type=\"button\" data-action=\"served\">Mark Served</button>" : ""}
      </div>
    </article>
  `;
}

// Handles kitchen status button clicks.
function bindKitchenActions() {
  elements.main.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const tableId = button.closest(".kitchen-actions").dataset.table;
      const action = button.dataset.action;
      button.disabled = true;

      try {
        if (action === "preparing") await updateOrderStatus(tableId, "preparing");
        if (action === "served") await updateOrderStatus(tableId, "served");
      } catch {
        showToast("Connection error, please refresh");
        button.disabled = false;
      }
    });
  });
}

// Uses Web Audio API for a distinct short kitchen beep.
function playKitchenBeep() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "square";
    oscillator.frequency.value = 880;
    gain.gain.value = 0.05;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.18);
  } catch {
    // Audio may be blocked before interaction; visual cards still update in real time.
  }
}

init();
