import {
  CONFIG,
  buildPaymentLinks,
  buildUpiQrUrl,
  claimPaymentDone,
  fetchMenu,
  formatCurrency,
  groupByCategory,
  placeOrAppendOrder,
  registerServiceWorker,
  requestCashAtCounter,
  showToast,
  escapeHtml
} from "./firebase.js";

const state = {
  tableId: null,
  categories: [],
  groupedMenu: {},
  activeCategory: "",
  cart: new Map(),
  lastOrderTotal: 0
};

const elements = {
  restaurantName: document.querySelector("#restaurantName"),
  tableLabel: document.querySelector("#tableLabel"),
  categoryRow: document.querySelector("#categoryRow"),
  menuList: document.querySelector("#menuList"),
  menuScreen: document.querySelector("#menuScreen"),
  cartScreen: document.querySelector("#cartScreen"),
  paymentScreen: document.querySelector("#paymentScreen"),
  errorScreen: document.querySelector("#errorScreen"),
  errorTitle: document.querySelector("#errorTitle"),
  errorMessage: document.querySelector("#errorMessage"),
  retryMenu: document.querySelector("#retryMenu"),
  bottomBar: document.querySelector("#bottomBar"),
  bottomCount: document.querySelector("#bottomCount"),
  bottomTotal: document.querySelector("#bottomTotal"),
  viewCartBtn: document.querySelector("#viewCartBtn"),
  backToMenu: document.querySelector("#backToMenu"),
  cartList: document.querySelector("#cartList"),
  grandTotal: document.querySelector("#grandTotal"),
  placeOrderBtn: document.querySelector("#placeOrderBtn"),
  paymentSummary: document.querySelector("#paymentSummary"),
  upiQr: document.querySelector("#upiQr"),
  upiIdText: document.querySelector("#upiIdText"),
  chooseOnlineBtn: document.querySelector("#chooseOnlineBtn"),
  chooseCashBtn: document.querySelector("#chooseCashBtn"),
  onlinePaymentPanel: document.querySelector("#onlinePaymentPanel"),
  payUpiBtn: document.querySelector("#payUpiBtn"),
  payGpayBtn: document.querySelector("#payGpayBtn"),
  payPaytmBtn: document.querySelector("#payPaytmBtn"),
  paymentDoneBtn: document.querySelector("#paymentDoneBtn"),
  paymentNote: document.querySelector("#paymentNote"),
  addMoreItems: document.querySelector("#addMoreItems"),
  addMoreTop: document.querySelector("#addMoreTop")
};

// Starts the customer menu app after validating the table URL.
async function init() {
  registerServiceWorker();
  elements.restaurantName.textContent = CONFIG.RESTAURANT_NAME;

  const params = new URLSearchParams(window.location.search);
  const tableId = params.get("table");

  if (!tableId || !CONFIG.TABLES.includes(tableId)) {
    showError("Invalid table link", "Invalid table link, please scan the QR code again");
    return;
  }

  state.tableId = tableId;
  elements.tableLabel.textContent = `Table ${tableId}`;
  bindEvents();
  await loadMenu();
}

// Fetches and renders the menu from the configured CSV source.
async function loadMenu() {
  try {
    showScreen("menu");
    elements.menuList.innerHTML = "<p class=\"subtle\">Loading menu...</p>";
    const items = await fetchMenu();
    state.groupedMenu = groupByCategory(items);
    state.categories = Object.keys(state.groupedMenu);
    state.activeCategory = state.categories[0] || "";

    if (!state.activeCategory) {
      showError("Menu unavailable", "Menu unavailable, please ask staff", true);
      return;
    }

    renderCategories();
    renderMenu();
  } catch {
    showError("Menu unavailable", "Menu unavailable, please ask staff", true);
  }
}

// Wires click handlers for navigation and order placement.
function bindEvents() {
  elements.viewCartBtn.addEventListener("click", () => {
    renderCart();
    showScreen("cart");
  });

  elements.backToMenu.addEventListener("click", () => showScreen("menu"));
  elements.addMoreItems.addEventListener("click", () => showScreen("menu"));
  elements.addMoreTop.addEventListener("click", () => showScreen("menu"));
  elements.retryMenu.addEventListener("click", loadMenu);
  elements.placeOrderBtn.addEventListener("click", placeOrder);
  elements.chooseOnlineBtn.addEventListener("click", chooseOnlinePayment);
  elements.chooseCashBtn.addEventListener("click", chooseCashPayment);
  elements.paymentDoneBtn.addEventListener("click", markCustomerPaid);
}

// Switches between customer screens and keeps the bottom bar state correct.
function showScreen(name) {
  const screens = {
    menu: elements.menuScreen,
    cart: elements.cartScreen,
    payment: elements.paymentScreen,
    error: elements.errorScreen
  };

  Object.values(screens).forEach((screen) => screen.classList.remove("active"));
  screens[name].classList.add("active");
  elements.addMoreTop.hidden = name !== "payment";
  updateBottomBar(name);
}

// Shows a friendly customer error with an optional retry action.
function showError(title, message, canRetry = false) {
  elements.errorTitle.textContent = title;
  elements.errorMessage.textContent = message;
  elements.retryMenu.hidden = !canRetry;
  showScreen("error");
}

// Renders the horizontal category pills.
function renderCategories() {
  elements.categoryRow.innerHTML = state.categories.map((category) => `
    <button class="pill ${category === state.activeCategory ? "active" : ""}" type="button" data-category="${escapeHtml(category)}">
      ${escapeHtml(category)}
    </button>
  `).join("");

  elements.categoryRow.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeCategory = button.dataset.category;
      renderCategories();
      renderMenu();
    });
  });
}

// Renders menu item cards for the active category.
function renderMenu() {
  const items = state.groupedMenu[state.activeCategory] || [];
  elements.menuList.innerHTML = items.map((item) => {
    const key = makeItemKey(item);
    const qty = state.cart.get(key)?.qty || 0;
    return `
      <article class="item-card">
        <div>
          <h3 class="item-name">${escapeHtml(item.name)}</h3>
          <div class="item-price">${formatCurrency(item.price)}</div>
        </div>
        <div class="qty-control" data-key="${escapeHtml(key)}">
          <button class="qty-btn" type="button" data-action="minus" aria-label="Remove ${escapeHtml(item.name)}">-</button>
          <span class="qty-value">${qty}</span>
          <button class="qty-btn" type="button" data-action="plus" aria-label="Add ${escapeHtml(item.name)}">+</button>
        </div>
      </article>
    `;
  }).join("");

  elements.menuList.querySelectorAll(".qty-control").forEach((control) => {
    const item = items.find((candidate) => makeItemKey(candidate) === control.dataset.key);
    control.addEventListener("click", (event) => {
      const action = event.target.dataset.action;
      if (!action) return;
      updateCartItem(item, action === "plus" ? 1 : -1);
    });
  });
}

// Creates a stable key for menu/cart items.
function makeItemKey(item) {
  return `${item.name}|${item.price}`;
}

// Adds or removes one quantity of an item.
function updateCartItem(item, delta) {
  const key = makeItemKey(item);
  const existing = state.cart.get(key) || { name: item.name, price: Number(item.price), qty: 0 };
  existing.qty += delta;

  if (existing.qty <= 0) {
    state.cart.delete(key);
  } else {
    state.cart.set(key, existing);
  }

  renderMenu();
  if (elements.cartScreen.classList.contains("active")) renderCart();
  updateBottomBar();
}

// Returns cart totals for count and amount.
function getCartTotals() {
  const items = [...state.cart.values()];
  return {
    items,
    count: items.reduce((sum, item) => sum + item.qty, 0),
    total: items.reduce((sum, item) => sum + item.qty * item.price, 0)
  };
}

// Keeps the sticky cart bar visible only when useful.
function updateBottomBar(screenName = null) {
  const { count, total } = getCartTotals();
  const isCartOrPayment = screenName === "cart" || screenName === "payment" || elements.cartScreen.classList.contains("active") || elements.paymentScreen.classList.contains("active");
  elements.bottomBar.classList.toggle("visible", count > 0 && !isCartOrPayment);
  elements.bottomCount.textContent = `${count} item${count === 1 ? "" : "s"}`;
  elements.bottomTotal.textContent = formatCurrency(total);
}

// Renders the cart screen rows and totals.
function renderCart() {
  const { items, total } = getCartTotals();
  elements.cartList.innerHTML = items.map((item) => `
    <article class="cart-row">
      <div>
        <h3 class="item-name">${escapeHtml(item.name)}</h3>
        <div class="row-subtotal">${formatCurrency(item.price)} x ${item.qty} = ${formatCurrency(item.price * item.qty)}</div>
      </div>
      <div class="qty-control" data-key="${escapeHtml(makeItemKey(item))}">
        <button class="qty-btn" type="button" data-action="minus">-</button>
        <span class="qty-value">${item.qty}</span>
        <button class="qty-btn" type="button" data-action="plus">+</button>
      </div>
    </article>
  `).join("");

  elements.grandTotal.textContent = formatCurrency(total);
  elements.placeOrderBtn.disabled = items.length === 0;

  elements.cartList.querySelectorAll(".qty-control").forEach((control) => {
    const item = items.find((candidate) => makeItemKey(candidate) === control.dataset.key);
    control.addEventListener("click", (event) => {
      const action = event.target.dataset.action;
      if (!action) return;
      updateCartItem(item, action === "plus" ? 1 : -1);
    });
  });
}

// Saves the cart to Firestore and moves the customer to the payment screen.
async function placeOrder() {
  const { items, total } = getCartTotals();
  if (!items.length) return;

  try {
    elements.placeOrderBtn.disabled = true;
    await placeOrAppendOrder(state.tableId, items);
    state.lastOrderTotal = total;
    state.cart.clear();
    renderMenu();
    renderPayment(total);
    showToast("Order Placed!");
    showScreen("payment");
  } catch (error) {
    console.error("Order placement failed. Check Firebase config, Firestore database status, and Firestore security rules.", error);
    showError("Connection error", "Connection error, please refresh");
  } finally {
    elements.placeOrderBtn.disabled = false;
  }
}

// Renders UPI payment information for the last placed order.
function renderPayment(total) {
  const paymentLinks = buildPaymentLinks(state.tableId, total);
  elements.paymentSummary.innerHTML = `
    <p><strong>Table ${escapeHtml(state.tableId)}</strong></p>
    <p><strong>${formatCurrency(total)}</strong></p>
  `;
  elements.upiQr.src = buildUpiQrUrl(state.tableId, total);
  elements.payUpiBtn.href = paymentLinks.upi;
  elements.payGpayBtn.href = paymentLinks.googlePay;
  elements.payPaytmBtn.href = paymentLinks.paytm;
  elements.upiIdText.textContent = CONFIG.UPI_ID;
  elements.paymentDoneBtn.disabled = false;
  elements.paymentDoneBtn.textContent = "I have paid online";
  elements.onlinePaymentPanel.hidden = true;
  elements.upiIdText.hidden = true;
  elements.chooseOnlineBtn.disabled = false;
  elements.chooseCashBtn.disabled = false;
  elements.paymentNote.textContent = "Choose how you want to pay for this order.";
}

// Shows online payment QR and app buttons.
function chooseOnlinePayment() {
  elements.onlinePaymentPanel.hidden = false;
  elements.upiIdText.hidden = false;
  elements.paymentDoneBtn.disabled = false;
  elements.paymentDoneBtn.textContent = "I have paid online";
  elements.paymentNote.textContent = "Complete UPI payment, then tap “I have paid online” so counter can verify it.";
}

// Lets the customer tell staff they will pay cash at the counter.
async function chooseCashPayment() {
  try {
    elements.chooseCashBtn.disabled = true;
    await requestCashAtCounter(state.tableId);
    elements.onlinePaymentPanel.hidden = true;
    elements.upiIdText.hidden = true;
    elements.paymentNote.textContent = "Counter has been notified that you will pay cash.";
    showToast("Cash payment selected");
  } catch (error) {
    console.error("Cash payment request failed.", error);
    elements.chooseCashBtn.disabled = false;
    showError("Connection error", "Connection error, please refresh");
  }
}

// Lets the customer notify staff that they have completed payment.
async function markCustomerPaid() {
  try {
    elements.paymentDoneBtn.disabled = true;
    await claimPaymentDone(state.tableId);
    elements.paymentDoneBtn.textContent = "Payment sent for verification";
    elements.paymentNote.textContent = "Counter has been notified. Staff will verify and mark the bill paid.";
    showToast("Counter notified");
  } catch (error) {
    console.error("Payment claim failed.", error);
    elements.paymentDoneBtn.disabled = false;
    showError("Connection error", "Connection error, please refresh");
  }
}

init();
