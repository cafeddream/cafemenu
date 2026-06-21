import {
  CONFIG,
  escapeHtml,
  formatKitchenTimer,
  getKitchenTimerState,
  subscribeActiveOrders,
  markOrderItemsServed,
  registerServiceWorker,
  showToast,
  updateActiveOrderStatus
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
  closeItemModal: document.querySelector("#closeKitchenItems"),
  servedActions: document.querySelector("#kitchenServedActions"),
  servedConfirmBtn: document.querySelector("#kitchenServedConfirm")
};

let resizeTimer = null;

function renderKitchenItemsHtml(items = []) {
  return items.map((item) => item.more
    ? `<li class="kitchen-item kitchen-more-item"><span class="kitchen-item-name">${escapeHtml(item.name)}</span></li>`
    : `
      <li class="kitchen-item">
        <span class="kitchen-item-qty">${Number(item.qty || 0)}x</span>
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

function getPreviewItems(items = []) {
  const visibleItems = items.slice(0, 3);
  const moreCount = Math.max(0, items.length - visibleItems.length);
  if (!moreCount) return visibleItems;
  return [...visibleItems, { name: `+${moreCount} more`, more: true }];
}

function getPendingItems(items = []) {
  return items.filter((item) => item.status !== "served");
}

function getOrdersForTable(tableId) {
  return [...state.orders.values()]
    .filter((order) => order.tableId === tableId)
    .sort((a, b) => (a.timestamp?.toMillis?.() || 0) - (b.timestamp?.toMillis?.() || 0));
}

function buildTableGroup(tableId) {
  const orders = getOrdersForTable(tableId);
  if (!orders.length) return null;

  const items = orders.flatMap((order) =>
    getPendingItems(order.items || []).map((item) => ({
      ...item,
      orderId: order.orderId || order.id
    }))
  );

  const status = orders.some((order) => order.status === "preparing") ? "preparing" : "new";

  return {
    tableId,
    orders,
    items,
    status,
    timestamp: orders[0].timestamp,
    placedBy: orders.some((order) => order.placedBy === "counter") ? "counter" : "customer",
    orderCount: orders.length
  };
}

function getSortedTableGroups() {
  const tableIds = [...new Set([...state.orders.values()].map((order) => order.tableId))];
  return tableIds
    .map((tableId) => buildTableGroup(tableId))
    .filter(Boolean)
    .sort((a, b) => {
      const aTime = a.timestamp?.toMillis?.() || 0;
      const bTime = b.timestamp?.toMillis?.() || 0;
      return aTime - bTime;
    });
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
      resizeTimer = setTimeout(() => layoutKitchenGrid(getSortedTableGroups().length), 150);
    });
  });
}

// Up to 8 tables on one screen as 4+4 grid on wide displays.
function layoutKitchenGrid(tableCount) {
  const grid = elements.main.querySelector(".kitchen-grid");
  if (!grid || !tableCount) return;

  const wide = window.innerWidth >= 720;
  if (wide && tableCount <= 8) {
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
  elements.itemModal?.querySelector(".kitchen-served-toolbar")?.remove();
  if (elements.servedActions) elements.servedActions.hidden = true;
  if (elements.itemModal) elements.itemModal.hidden = true;
}

function syncServedSelectAllState() {
  const selectAll = elements.itemModal?.querySelector("#kitchenSelectAllServed");
  if (!selectAll) return;
  const checks = [...elements.itemModalList.querySelectorAll('input[type="checkbox"][data-order-id]')];
  selectAll.checked = checks.length > 0 && checks.every((input) => input.checked);
  selectAll.indeterminate = checks.some((input) => input.checked) && !selectAll.checked;
}

function bindServedSelectAll() {
  const selectAll = elements.itemModal?.querySelector("#kitchenSelectAllServed");
  if (!selectAll) return;

  selectAll.onchange = () => {
    elements.itemModalList.querySelectorAll('input[type="checkbox"][data-order-id]').forEach((input) => {
      input.checked = selectAll.checked;
    });
    selectAll.indeterminate = false;
  };

  elements.itemModalList.onchange = (event) => {
    if (event.target.matches('input[type="checkbox"][data-order-id]')) {
      syncServedSelectAllState();
    }
  };
}

function renderServedToolbar() {
  elements.itemModal?.querySelector(".kitchen-served-toolbar")?.remove();
  const toolbar = document.createElement("div");
  toolbar.className = "kitchen-served-toolbar";
  toolbar.innerHTML = `
    <label class="served-select-all">
      <input type="checkbox" id="kitchenSelectAllServed">
      <span>Select All</span>
    </label>
  `;
  elements.itemModalList.before(toolbar);
  bindServedSelectAll();
}

function renderServedItemCheckbox(item, orderId) {
  return `
    <li class="kitchen-detail-item">
      <label class="served-check">
        <input type="checkbox" value="${escapeHtml(item.itemId)}" data-order-id="${escapeHtml(orderId)}">
        <span class="kitchen-detail-qty">${Number(item.qty || 0)}&times;</span>
        <span class="kitchen-detail-name">${escapeHtml(item.name)}</span>
      </label>
    </li>
  `;
}

function openKitchenItemsModal(tableGroup, options = {}) {
  if (!elements.itemModal || !tableGroup) return;

  const servedMode = options.servedMode !== false;
  elements.itemModal?.querySelector(".kitchen-served-toolbar")?.remove();
  const count = tableGroup.items.reduce((sum, item) => sum + Number(item.qty || 0), 0);
  const orderLabel = tableGroup.orderCount > 1
    ? `${tableGroup.orderCount} orders`
    : String(tableGroup.orders[0].orderId || tableGroup.orders[0].id).slice(0, 8);

  elements.itemModalTitle.textContent = servedMode ? "Select Served Items" : "Order Items";
  elements.itemModalMeta.textContent = `${tableGroup.tableId} - ${orderLabel} - ${count} pending`;

  if (servedMode) {
    if (tableGroup.orderCount > 1) {
      elements.itemModalList.innerHTML = tableGroup.orders.map((order) => {
        const orderItems = getPendingItems(order.items || []);
        if (!orderItems.length) return "";
        const orderId = order.orderId || order.id;
        const orderHeader = `
          <li class="kitchen-detail-order-label">${escapeHtml(String(orderId).slice(0, 8))}</li>
        `;
        const itemRows = orderItems.map((item) => renderServedItemCheckbox(item, orderId)).join("");
        return orderHeader + itemRows;
      }).join("");
    } else {
      const orderId = tableGroup.orders[0].orderId || tableGroup.orders[0].id;
      elements.itemModalList.innerHTML = tableGroup.items
        .map((item) => renderServedItemCheckbox(item, orderId))
        .join("");
    }

    renderServedToolbar();
    syncServedSelectAllState();

    if (elements.servedActions) elements.servedActions.hidden = false;
    if (elements.servedConfirmBtn) {
      elements.servedConfirmBtn.disabled = false;
      elements.servedConfirmBtn.onclick = async () => {
        const selected = [...elements.itemModalList.querySelectorAll("input:checked")];
        if (!selected.length) {
          showToast("Select at least one item");
          return;
        }

        const byOrder = new Map();
        selected.forEach((input) => {
          const orderId = input.dataset.orderId;
          if (!byOrder.has(orderId)) byOrder.set(orderId, []);
          byOrder.get(orderId).push(input.value);
        });

        elements.servedConfirmBtn.disabled = true;
        try {
          await Promise.all(
            [...byOrder.entries()].map(([orderId, itemIds]) => markOrderItemsServed(orderId, itemIds))
          );
          closeKitchenItemsModal();
        } catch {
          showToast("Connection error, please refresh");
          elements.servedConfirmBtn.disabled = false;
        }
      };
    }
  } else {
    if (tableGroup.orderCount > 1) {
      elements.itemModalList.innerHTML = tableGroup.orders.map((order) => {
        const orderItems = getPendingItems(order.items || []);
        if (!orderItems.length) return "";
        const orderId = order.orderId || order.id;
        const orderHeader = `
          <li class="kitchen-detail-order-label">${escapeHtml(String(orderId).slice(0, 8))}</li>
        `;
        return orderHeader + renderKitchenDetailItemsHtml(orderItems);
      }).join("");
    } else {
      elements.itemModalList.innerHTML = renderKitchenDetailItemsHtml(tableGroup.items);
    }
    if (elements.servedActions) elements.servedActions.hidden = true;
  }

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

  const tableGroup = buildTableGroup(card.dataset.table);
  if (!tableGroup) return;

  const preview = getKitchenHoverPreview();
  const cardRect = card.getBoundingClientRect();
  preview.style.width = `${Math.min(360, Math.max(260, cardRect.width))}px`;
  preview.style.left = "0px";
  preview.style.top = "0px";
  const orderMeta = tableGroup.orderCount > 1
    ? `<span class="kitchen-hover-orders">${tableGroup.orderCount} orders</span>`
    : "";
  preview.innerHTML = `
    <strong>${escapeHtml(tableGroup.tableId)}</strong>
    ${orderMeta}
    <ul class="kitchen-detail-list">${renderKitchenDetailItemsHtml(tableGroup.items)}</ul>
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

  const openModal = () => openKitchenItemsModal(buildTableGroup(card.dataset.table), { servedMode: false });
  itemArea.onclick = openModal;
  itemArea.onkeydown = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openModal();
    }
  };
  itemArea.onmouseenter = () => showKitchenHoverPreview(card);
  itemArea.onfocus = () => showKitchenHoverPreview(card);
  itemArea.onmouseleave = hideKitchenHoverPreview;
  itemArea.onblur = hideKitchenHoverPreview;
}

// Listens to every table and keeps only cooking-relevant orders.
function subscribeToActiveOrders() {
  subscribeActiveOrders((orders) => {
    const previousVisible = new Set(state.visibleIds);
    state.orders.clear();
    state.visibleIds.clear();
    orders.forEach((order) => {
      const orderId = order.orderId || order.id;
      const pendingItems = getPendingItems(order.items || []);
      const isActive = ["new", "preparing"].includes(order.status)
        && (order.paymentStatus === "verified_paid"
          || order.paymentStatus === "credit_pending"
          || order.paymentStatus === "session_hold"
          || order.paymentStatus === "voided")
        && pendingItems.length > 0;
      if (isActive) {
        state.orders.set(orderId, { ...order, orderId, items: pendingItems });
        state.visibleIds.add(orderId);
        if (!previousVisible.has(orderId)) playKitchenBeep();
      }
    });
    syncKitchenCards();
  }, () => showToast("Connection error, please refresh"));
}

// Returns active orders sorted oldest first.
function getSortedOrders() {
  return [...state.orders.values()].sort((a, b) => {
    const aTime = a.timestamp?.toMillis?.() || 0;
    const bTime = b.timestamp?.toMillis?.() || 0;
    return aTime - bTime;
  });
}

function renderKitchenActions(group) {
  const hasNewOrders = group.orders.some((order) => order.status === "new");
  return `
    ${hasNewOrders ? "<button class=\"ghost-btn\" type=\"button\" data-action=\"preparing\">Start Preparing</button>" : ""}
    ${group.status === "new" || group.status === "preparing" ? "<button class=\"primary-btn\" type=\"button\" data-action=\"served\">Mark Served</button>" : ""}
  `;
}

// Rebuilds card layout only when table membership or content changes.
function syncKitchenCards() {
  const orders = getSortedOrders();
  const tableGroups = getSortedTableGroups();
  elements.pendingCount.textContent = `${orders.length} Order${orders.length === 1 ? "" : "s"} Pending`;

  if (!tableGroups.length) {
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

  const activeTableIds = new Set(tableGroups.map((group) => group.tableId));
  state.cards.forEach((card, tableId) => {
    if (!activeTableIds.has(tableId)) {
      card.remove();
      state.cards.delete(tableId);
    }
  });

  tableGroups.forEach((group) => {
    const { tableId } = group;
    let card = state.cards.get(tableId);
    if (!card) {
      grid.insertAdjacentHTML("beforeend", kitchenCardHtml(group));
      card = grid.lastElementChild;
      state.cards.set(tableId, card);
      bindKitchenCardActions(card);
    } else if (!card.querySelector(".kitchen-item")) {
      card.outerHTML = kitchenCardHtml(group);
      card = grid.querySelector(`[data-table="${CSS.escape(tableId)}"]`);
      state.cards.set(tableId, card);
      bindKitchenCardActions(card);
    } else {
      updateKitchenCardBody(card, group);
    }
    applyTimerToCard(card, group.timestamp);
  });

  layoutKitchenGrid(tableGroups.length);
}

// Updates item list, alerts, and action buttons without rebuilding the timer.
function updateKitchenCardBody(card, group) {
  const statusClass = group.status === "preparing" ? "preparing" : "";
  card.classList.toggle("preparing", statusClass === "preparing");

  let alert = card.querySelector(".kitchen-payment-alert");
  if (!alert) {
    card.querySelector(".kitchen-table").insertAdjacentHTML(
      "afterend",
      "<div class=\"kitchen-payment-alert\">Payment verified</div>"
    );
  }

  const itemsHtml = renderKitchenItemsHtml(getPreviewItems(group.items));
  card.querySelector(".kitchen-items").innerHTML = itemsHtml;
  const itemArea = card.querySelector("[data-item-detail]");
  if (itemArea) itemArea.setAttribute("aria-label", `View all items for ${group.tableId}`);

  const orderBadge = card.querySelector(".kitchen-order-badge");
  if (group.orderCount > 1) {
    const badgeText = `${group.orderCount} orders`;
    if (orderBadge) {
      orderBadge.textContent = badgeText;
    } else {
      card.querySelector(".kitchen-table-label")?.insertAdjacentHTML(
        "beforeend",
        `<span class="kitchen-order-badge">${escapeHtml(badgeText)}</span>`
      );
    }
  } else if (orderBadge) {
    orderBadge.remove();
  }

  const placedBy = card.querySelector(".kitchen-source");
  if (group.placedBy === "counter") {
    if (!placedBy) {
      card.querySelector(".kitchen-table-label")?.insertAdjacentHTML(
        "beforeend",
        "<span class=\"kitchen-source\">Counter</span>"
      );
    }
  } else if (placedBy) {
    placedBy.remove();
  }

  const actions = card.querySelector(".kitchen-actions");
  actions.dataset.table = group.tableId;
  actions.dataset.status = group.status;
  actions.innerHTML = renderKitchenActions(group);
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
    const group = buildTableGroup(tableId);
    if (group) applyTimerToCard(card, group.timestamp);
  });
}

// Builds one high-contrast kitchen table card.
function kitchenCardHtml(group) {
  const timer = getKitchenTimerState(group.timestamp);
  const ringDash = Math.max(0, timer.remainingFraction * 100);
  const statusClass = group.status === "preparing" ? "preparing" : "";
  const timerClass = timer.expired ? "timer-expired" : timer.urgent ? "timer-urgent" : "timer-active";
  const timerLabel = timer.expired
    ? `Over ${CONFIG.KITCHEN_TIMER_MINUTES} min`
    : "Time left";
  const timerValue = timer.expired ? formatKitchenTimer(0) : formatKitchenTimer(timer.remainingSec);
  const placedBy = group.placedBy === "counter" ? "<span class=\"kitchen-source\">Counter</span>" : "";
  const orderBadge = group.orderCount > 1
    ? `<span class="kitchen-order-badge">${group.orderCount} orders</span>`
    : "";
  const items = renderKitchenItemsHtml(getPreviewItems(group.items));

  return `
    <article
      class="kitchen-card ${statusClass} ${timerClass}"
      data-table="${escapeHtml(group.tableId)}"
      style="--timer-color: ${timer.color}; --timer-progress: ${timer.remainingFraction}"
    >
      <div class="kitchen-table">
        <div class="kitchen-table-label">
          <strong>${escapeHtml(group.tableId)}</strong>
          ${orderBadge}
          ${placedBy}
        </div>
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
      <div class="kitchen-payment-alert">Payment verified</div>
      <div class="kitchen-items-wrap" data-item-detail role="button" tabindex="0" aria-label="View all items for ${escapeHtml(group.tableId)}">
        <ul class="kitchen-items">${items}</ul>
      </div>
      <div class="kitchen-actions" data-table="${escapeHtml(group.tableId)}" data-status="${escapeHtml(group.status)}">
        ${renderKitchenActions(group)}
      </div>
    </article>
  `;
}

// Handles kitchen status button clicks for one table card.
function bindKitchenCardActions(card) {
  card.querySelectorAll("[data-action]").forEach((button) => {
    button.onclick = async () => {
      const tableId = button.closest(".kitchen-actions").dataset.table;
      const action = button.dataset.action;
      const tableGroup = buildTableGroup(tableId);
      if (!tableGroup) return;

      button.disabled = true;

      try {
        if (action === "preparing") {
          await Promise.all(
            tableGroup.orders
              .filter((order) => order.status === "new")
              .map((order) => updateActiveOrderStatus(order.orderId || order.id, "preparing"))
          );
        }
        if (action === "served") {
          openKitchenItemsModal(tableGroup, { servedMode: true });
          button.disabled = false;
        }
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
