import {
  CONFIG,
  STATUS_LABELS,
  buildPaymentLinks,
  buildUpiQrUrl,
  claimPaymentDone,
  fetchMenu,
  formatCurrency,
  getFirebaseErrorMessage,
  listenToOrder,
  placeOrAppendOrder,
  registerServiceWorker,
  requestCashAtCounter,
  showToast,
  escapeHtml
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
  tableId: null,
  groupedMenu: {},
  categories: [],
  activeCategory: "",
  cart: new Map(),
  lastOrderTotal: 0,
  orderUnsubscribe: null
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
  orderStatusLive: document.querySelector("#orderStatusLive"),
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

async function loadMenu() {
  try {
    showScreen("menu");
    elements.menuList.innerHTML = "<p class=\"subtle\">Loading menu...</p>";
    const items = await fetchMenu();
    const menuState = buildMenuState(items);
    state.groupedMenu = menuState.groupedMenu;
    state.categories = menuState.categories;
    state.activeCategory = menuState.activeCategory;

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

  if (name === "payment") subscribeOrderStatus();
  else unsubscribeOrderStatus();
}

function showError(title, message, canRetry = false) {
  elements.errorTitle.textContent = title;
  elements.errorMessage.textContent = message;
  elements.retryMenu.hidden = !canRetry;
  showScreen("error");
}

function renderCategories() {
  renderCategoryRow(elements.categoryRow, state.categories, state.activeCategory, (category) => {
    state.activeCategory = category;
    renderCategories();
    renderMenu();
  });
}

function renderMenu() {
  const items = state.groupedMenu[state.activeCategory] || [];
  renderMenuList(elements.menuList, items, state.cart, (item, delta) => {
    updateCartItem(state.cart, item, delta);
    renderMenu();
    if (elements.cartScreen.classList.contains("active")) renderCart();
    updateBottomBar();
  });
}

function updateBottomBar(screenName = null) {
  const { count, total } = getCartTotals(state.cart);
  const isCartOrPayment = screenName === "cart" || screenName === "payment"
    || elements.cartScreen.classList.contains("active")
    || elements.paymentScreen.classList.contains("active");
  elements.bottomBar.classList.toggle("visible", count > 0 && !isCartOrPayment);
  elements.bottomCount.textContent = `${count} item${count === 1 ? "" : "s"}`;
  elements.bottomTotal.textContent = formatCurrency(total);
}

function renderCart() {
  const { items, total } = renderCartList(elements.cartList, state.cart, (item, delta) => {
    updateCartItem(state.cart, item, delta);
    renderCart();
    renderMenu();
    updateBottomBar();
  });
  elements.grandTotal.textContent = formatCurrency(total);
  elements.placeOrderBtn.disabled = items.length === 0;
}

async function placeOrder() {
  const { items, total } = getCartTotals(state.cart);
  if (!items.length) return;

  try {
    elements.placeOrderBtn.disabled = true;
    await placeOrAppendOrder(state.tableId, items, "customer");
    state.lastOrderTotal = total;
    state.cart.clear();
    renderMenu();
    renderPayment(total);
    showToast("Order Placed!");
    showScreen("payment");
  } catch (error) {
    console.error("Order placement failed.", error);
    const detail = getFirebaseErrorMessage(error);
    showError("Order failed", detail);
    showToast(detail);
  } finally {
    elements.placeOrderBtn.disabled = false;
  }
}

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
  updateOrderStatusBanner(null);
}

function subscribeOrderStatus() {
  unsubscribeOrderStatus();
  state.orderUnsubscribe = listenToOrder(state.tableId, (order) => {
    updateOrderStatusBanner(order);
  });
}

function unsubscribeOrderStatus() {
  if (state.orderUnsubscribe) {
    state.orderUnsubscribe();
    state.orderUnsubscribe = null;
  }
}

function updateOrderStatusBanner(order) {
  if (!elements.orderStatusLive) return;
  if (!order) {
    elements.orderStatusLive.textContent = "Waiting for kitchen update...";
    elements.orderStatusLive.className = "order-status-live";
    return;
  }

  const label = STATUS_LABELS[order.status] || order.status;
  elements.orderStatusLive.textContent = `Order status: ${label}`;
  elements.orderStatusLive.className = `order-status-live status-${order.status || "new"}`;

  if (order.paymentStatus === "cash_at_counter") {
    elements.paymentNote.textContent = "Counter has been notified that you will pay cash.";
  } else if (order.paymentStatus === "customer_claimed_paid") {
    elements.paymentNote.textContent = "Payment sent for verification. Staff will confirm shortly.";
  }
}

function chooseOnlinePayment() {
  elements.onlinePaymentPanel.hidden = false;
  elements.upiIdText.hidden = false;
  elements.paymentDoneBtn.disabled = false;
  elements.paymentDoneBtn.textContent = "I have paid online";
  elements.paymentNote.textContent = "Complete UPI payment, then tap “I have paid online” so counter can verify it.";
}

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
