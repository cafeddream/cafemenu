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
  cards: new Map(),
  hoverPreview: null
};

const elements = {
  clock: document.querySelector("#kitchenClock"),
  pendingCount: document.querySelector("#pendingCount"),
  main: document.querySelector("#kitchenMain"),
  itemModal: document.querySelector("#kitchenItemsModal"),
  itemModalTitle: document.querySelector("#kitchenItemsModalTitle"),
  itemModalMeta: document.querySelector("#kitchenItemsModalMeta"),
  itemModalList: document.querySelector("#kitchenItemsModalList"),
  closeItemModal: document.querySelector("#closeKitchenItems")
};

let resizeTimer = null;

function renderKitchenItemsHtml(items = []) {
  return items.map((item) => `
    <li class="kitchen-item">
      <span class="kitchen-item-qty">${Number(item.qty || 0)}×</span>
      <span class="kitchen-item-name">${escapeHtml(item.name)}</span>
    </li>
  `).join("");
}

function renderKitchenDetailItemsHtml(items = []) {
  if (!items.length) {
    return "<li class=\"kitchen-detail-item\"><span>No items</span></li>";
  }

  return items.map((item) => `
    <li class="kitchen-detail-item">
      <span class="kitchen-detail-qty">${Number(item.qty || 0)}&times;</span>
      <span class="kitchen-detail-name">${escapeHtml(item.name)}</span>
    </li>
  `).join("");
}

// Starts the kitchen display and live order subscriptions.
function init() {
  registerServiceWorker();
  startClock();
  bindKitchenItemModal();
  requireStaffAuth(() => {
    subscribeToActiveOrders();
    setInterval(updateKitchenTimers, 1000);
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => layoutKitchenGrid(getSortedOrders().length), 150);
    });
  });
}

// Up to 8 orders on one screen as 4+4 grid on wide displays.
function layoutKitchenGrid(orderCount) {
  const grid = elements.main.querySelector(".kitchen-grid");
  if (!grid || !orderCount) return;

  const wide = window.innerWidth >= 720;
  if (wide && orderCount <= 8) {
    const rows = 2;
    grid.classList.add("kitchen-grid-fit");
    grid.style.setProperty("--kitchen-rows", String(rows));
    grid.style.gridTemplateColumns = "repeat(4, minmax(0, 1fr))";
    grid.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
    elements.main.style.overflowY = "hidden";
  } else {
    grid.classList.remove("kitchen-grid-fit");
    grid.style.removeProperty("--kitchen-rows");
    grid.style.gridTemplateColumns = "";
    grid.style.gridTemplateRows = "";
    elements.main.style.overflowY = "auto";
  }
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

function bindKitchenItemModal() {
  if (!elements.itemModal) return;

  elements.closeItemModal.addEventListener("click", closeKitchenItemsModal);
  elements.itemModal.addEventListener("click", (event) => {
    if (event.target === elements.itemModal) closeKitchenItemsModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.itemModal.hidden) closeKitchenItemsModal();
  });
  window.addEventListener("scroll", hideKitchenHoverPreview, true);
  window.addEventListener("resize", hideKitchenHoverPreview);
}

function closeKitchenItemsModal() {
  if (elements.itemModal) elements.itemModal.hidden = true;
}

function openKitchenItemsModal(order) {
  if (!elements.itemModal || !order) return;

  const items = order.items || [];
  const count = items.reduce((sum, item) => sum + Number(item.qty || 0), 0);
  const source = order.placedBy === "counter" ? "Counter" : "Customer";

  elements.itemModalTitle.textContent = `Order ${order.tableId}`;
  elements.itemModalMeta.textContent = `${source} - ${count} item${count === 1 ? "" : "s"}`;
  elements.itemModalList.innerHTML = renderKitchenDetailItemsHtml(items);
  elements.itemModal.hidden = false;
  hideKitchenHoverPreview();
  elements.closeItemModal.focus();
}

function getKitchenHoverPreview() {
  if (state.hoverPreview) return state.hoverPreview;

  const preview = document.createElement("div");
  preview.className = "kitchen-hover-preview";
  preview.hidden = true;
  preview.setAttribute("aria-hidden", "true");
  document.body.append(preview);
  state.hoverPreview = preview;
  return preview;
}

function showKitchenHoverPreview(card) {
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

  const order = state.orders.get(card.dataset.table);
  if (!order) return;

  const preview = getKitchenHoverPreview();
  const cardRect = card.getBoundingClientRect();
  preview.style.width = `${Math.min(360, Math.max(260, cardRect.width))}px`;
  preview.style.left = "0px";
  preview.style.top = "0px";
  preview.innerHTML = `
    <strong>Order ${escapeHtml(order.tableId)}</strong>
    <ul class="kitchen-detail-list">${renderKitchenDetailItemsHtml(order.items || [])}</ul>
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

function hideKitchenHoverPreview() {
  if (state.hoverPreview) state.hoverPreview.hidden = true;
}

function bindKitchenItemDetails(card) {
  const itemArea = card.querySelector("[data-item-detail]");
  if (!itemArea) return;

  itemArea.onclick = () => openKitchenItemsModal(state.orders.get(card.dataset.table));
  itemArea.onkeydown = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openKitchenItemsModal(state.orders.get(card.dataset.table));
    }
  };
  itemArea.onmouseenter = () => showKitchenHoverPreview(card);
  itemArea.onfocus = () => showKitchenHoverPreview(card);
  itemArea.onmouseleave = hideKitchenHoverPreview;
  itemArea.onblur = hideKitchenHoverPreview;
}

// Listens to every table and keeps only cooking-relevant orders.
function subscribeToActiveOrders() {
  CONFIG.TABLES.forEach((tableId) => {
    listenToOrder(tableId, (order) => {
      const isActive = order
        && ["new", "preparing"].includes(order.status)
        && order.paymentStatus === "verified_paid";
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

  layoutKitchenGrid(orders.length);
}

// Updates item list, alerts, and action buttons without rebuilding the timer.
function updateKitchenCardBody(card, order) {
  const statusClass = order.status === "preparing" ? "preparing" : "";
  card.classList.toggle("preparing", statusClass === "preparing");

  const paymentVerified = order.paymentStatus === "verified_paid";
  let alert = card.querySelector(".kitchen-payment-alert");
  if (paymentVerified) {
    if (!alert) {
      card.querySelector(".kitchen-table").insertAdjacentHTML(
        "afterend",
        "<div class=\"kitchen-payment-alert\">Payment verified</div>"
      );
    }
  } else if (alert) {
    alert.remove();
  }

  const itemsHtml = renderKitchenItemsHtml(order.items);
  card.querySelector(".kitchen-items").innerHTML = itemsHtml;
  const itemArea = card.querySelector("[data-item-detail]");
  if (itemArea) itemArea.setAttribute("aria-label", `View all items for ${order.tableId}`);

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
  const paymentVerified = order.paymentStatus === "verified_paid";
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
      ${paymentVerified ? "<div class=\"kitchen-payment-alert\">Payment verified</div>" : ""}
      <div class="kitchen-items-wrap" data-item-detail role="button" tabindex="0" aria-label="View all items for ${escapeHtml(order.tableId)}">
        <ul class="kitchen-items">${items}</ul>
      </div>
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
  bindKitchenItemDetails(card);
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
