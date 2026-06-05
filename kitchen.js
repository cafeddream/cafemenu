import {
  CONFIG,
  escapeHtml,
  formatKitchenTimer,
  getKitchenTimerState,
  listenToOrder,
  registerServiceWorker,
  showToast,
  updateOrderStatus
} from "./firebase.js";
import { requireStaffAuth } from "./staff-auth.js";

const state = {
  orders: new Map(),
  visibleIds: new Set(),
  cards: new Map()
};

const elements = {
  clock: document.querySelector("#kitchenClock"),
  pendingCount: document.querySelector("#pendingCount"),
  main: document.querySelector("#kitchenMain")
};

function renderKitchenItemsHtml(items = []) {
  return items.map((item) => `
    <li class="kitchen-item">
      <span class="kitchen-item-qty">${Number(item.qty || 0)}×</span>
      <span class="kitchen-item-name">${escapeHtml(item.name)}</span>
    </li>
  `).join("");
}

// Starts the kitchen display and live order subscriptions.
function init() {
  registerServiceWorker();
  startClock();
  requireStaffAuth(() => {
    subscribeToActiveOrders();
    setInterval(updateKitchenTimers, 1000);
  });
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

      syncKitchenCards();
    }, () => showToast("Connection error, please refresh"));
  });
}

// Returns active orders sorted oldest first.
function getSortedOrders() {
  return [...state.orders.values()].sort((a, b) => {
    const aTime = a.timestamp?.toMillis?.() || 0;
    const bTime = b.timestamp?.toMillis?.() || 0;
    return aTime - bTime;
  });
}

// Rebuilds card layout only when order membership or content changes.
function syncKitchenCards() {
  const orders = getSortedOrders();
  elements.pendingCount.textContent = `${orders.length} Order${orders.length === 1 ? "" : "s"} Pending`;

  if (!orders.length) {
    state.cards.clear();
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

  let grid = elements.main.querySelector(".kitchen-grid");
  if (!grid) {
    elements.main.innerHTML = `<div class="kitchen-grid"></div>`;
    grid = elements.main.querySelector(".kitchen-grid");
  }

  const activeIds = new Set(orders.map((order) => order.tableId));
  state.cards.forEach((card, tableId) => {
    if (!activeIds.has(tableId)) {
      card.remove();
      state.cards.delete(tableId);
    }
  });

  orders.forEach((order) => {
    let card = state.cards.get(order.tableId);
    if (!card) {
      grid.insertAdjacentHTML("beforeend", kitchenCardHtml(order));
      card = grid.lastElementChild;
      state.cards.set(order.tableId, card);
      bindKitchenCardActions(card);
    } else if (!card.querySelector(".kitchen-item")) {
      card.outerHTML = kitchenCardHtml(order);
      card = grid.querySelector(`[data-table="${order.tableId}"]`);
      state.cards.set(order.tableId, card);
      bindKitchenCardActions(card);
    } else {
      updateKitchenCardBody(card, order);
    }
    applyTimerToCard(card, order.timestamp);
  });
}

// Updates item list, alerts, and action buttons without rebuilding the timer.
function updateKitchenCardBody(card, order) {
  const statusClass = order.status === "preparing" ? "preparing" : "";
  card.classList.toggle("preparing", statusClass === "preparing");

  const paymentClaimed = order.paymentStatus === "customer_claimed_paid";
  let alert = card.querySelector(".kitchen-payment-alert");
  if (paymentClaimed) {
    if (!alert) {
      card.querySelector(".kitchen-table").insertAdjacentHTML(
        "afterend",
        "<div class=\"kitchen-payment-alert\">Payment claimed by customer</div>"
      );
    }
  } else if (alert) {
    alert.remove();
  }

  const itemsHtml = renderKitchenItemsHtml(order.items);
  card.querySelector(".kitchen-items").innerHTML = itemsHtml;

  const actions = card.querySelector(".kitchen-actions");
  actions.dataset.table = order.tableId;
  actions.dataset.status = order.status;
  actions.innerHTML = `
    ${order.status === "new" ? "<button class=\"ghost-btn\" type=\"button\" data-action=\"preparing\">Start Preparing</button>" : ""}
    ${order.status === "new" || order.status === "preparing" ? "<button class=\"primary-btn\" type=\"button\" data-action=\"served\">Mark Served</button>" : ""}
  `;
  bindKitchenCardActions(card);
}

// Applies countdown ring and text for one card.
function applyTimerToCard(card, timestamp) {
  const timer = getKitchenTimerState(timestamp);
  const ringDash = Math.max(0, timer.remainingFraction * 100);
  const timerLabel = timer.expired
    ? `Over ${CONFIG.KITCHEN_TIMER_MINUTES} min`
    : "Time left";
  const timerValue = timer.expired ? formatKitchenTimer(0) : formatKitchenTimer(timer.remainingSec);
  const timerClass = timer.expired ? "timer-expired" : timer.urgent ? "timer-urgent" : "timer-active";

  card.classList.remove("timer-active", "timer-urgent", "timer-expired");
  card.classList.add(timerClass);
  card.style.setProperty("--timer-color", timer.color);
  card.style.setProperty("--timer-progress", String(timer.remainingFraction));

  const ring = card.querySelector(".kitchen-timer-ring");
  if (ring) ring.style.strokeDasharray = `${ringDash} 100`;

  const labelEl = card.querySelector(".kitchen-timer-text span");
  const valueEl = card.querySelector(".kitchen-timer-text strong");
  if (labelEl) labelEl.textContent = timerLabel;
  if (valueEl) valueEl.textContent = timerValue;

  const timerWrap = card.querySelector(".kitchen-timer");
  if (timerWrap) timerWrap.setAttribute("aria-label", `${timerLabel} ${timerValue}`);
}

// Updates timers on existing cards every second without a full re-render.
function updateKitchenTimers() {
  state.cards.forEach((card, tableId) => {
    const order = state.orders.get(tableId);
    if (order) applyTimerToCard(card, order.timestamp);
  });
}

// Builds one high-contrast kitchen order card.
function kitchenCardHtml(order) {
  const timer = getKitchenTimerState(order.timestamp);
  const ringDash = Math.max(0, timer.remainingFraction * 100);
  const statusClass = order.status === "preparing" ? "preparing" : "";
  const timerClass = timer.expired ? "timer-expired" : timer.urgent ? "timer-urgent" : "timer-active";
  const paymentClaimed = order.paymentStatus === "customer_claimed_paid";
  const timerLabel = timer.expired
    ? `Over ${CONFIG.KITCHEN_TIMER_MINUTES} min`
    : "Time left";
  const timerValue = timer.expired ? formatKitchenTimer(0) : formatKitchenTimer(timer.remainingSec);
  const placedBy = order.placedBy === "counter" ? "<span class=\"kitchen-source\">Counter</span>" : "";
  const items = renderKitchenItemsHtml(order.items);

  return `
    <article
      class="kitchen-card ${statusClass} ${timerClass}"
      data-table="${escapeHtml(order.tableId)}"
      style="--timer-color: ${timer.color}; --timer-progress: ${timer.remainingFraction}"
    >
      <div class="kitchen-table">
        <strong>${escapeHtml(order.tableId)}</strong>
        ${placedBy}
        <div class="kitchen-timer" aria-label="${escapeHtml(timerLabel)} ${escapeHtml(timerValue)}">
          <svg class="kitchen-timer-svg" viewBox="0 0 36 36" aria-hidden="true">
            <circle class="kitchen-timer-track" cx="18" cy="18" r="15.9"></circle>
            <circle
              class="kitchen-timer-ring"
              cx="18"
              cy="18"
              r="15.9"
              style="stroke-dasharray: ${ringDash} 100"
            ></circle>
          </svg>
          <div class="kitchen-timer-text">
            <span>${escapeHtml(timerLabel)}</span>
            <strong>${escapeHtml(timerValue)}</strong>
          </div>
        </div>
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

// Handles kitchen status button clicks for one card.
function bindKitchenCardActions(card) {
  card.querySelectorAll("[data-action]").forEach((button) => {
    button.onclick = async () => {
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
    };
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
