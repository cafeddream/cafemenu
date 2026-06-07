import {
  CONFIG,
  STATUS_LABELS,
  buildPaymentLinks,
  buildReceiptDocumentHtml,
  buildUpiQrUrl,
  claimActiveOrderPaymentDone,
  downloadReceiptHtml,
  fetchReceipt,
  fetchMenu,
  findActiveOrdersByMobile,
  formatCurrency,
  getFirebaseErrorMessage,
  listenToActiveOrder,
  maskMobile,
  normalizeIndianMobile,
  placeOrAppendOrder,
  registerServiceWorker,
  showToast,
  escapeHtml
} from "./firebase.js";
import {
  buildMenuState,
  getCartTotals,
  makeItemKey,
  renderCartList,
  renderCategorySidebar,
  renderMenuGrid,
  updateCartItem
} from "./menu-cart.js";

const state = {
  tableId: null,
  groupedMenu: {},
  categories: [],
  activeCategory: "",
  cart: new Map(),
  lastOrderTotal: 0,
  orderUnsubscribe: null,
  customerProfile: null,
  trackedTableId: null,
  trackedOrderId: null,
  trackedOrder: null,
  lastOrderItems: []
};

const CUSTOMER_PROFILE_KEY = "cafe_customer_profile_v1";
const TRACKING_STEPS = ["new", "preparing", "served", "paid"];
const TRACKING_LABELS = {
  new: "Order Received",
  preparing: "Preparing",
  served: "Served",
  paid: "Paid"
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
  paymentBackBtn: document.querySelector("#paymentBackBtn"),
  paymentCloseBtn: document.querySelector("#paymentCloseBtn"),
  upiQr: document.querySelector("#upiQr"),
  upiIdText: document.querySelector("#upiIdText"),
  paymentChoiceGrid: document.querySelector(".payment-choice-grid"),
  chooseOnlineBtn: document.querySelector("#chooseOnlineBtn"),
  onlinePaymentPanel: document.querySelector("#onlinePaymentPanel"),
  payGpayBtn: document.querySelector("#payGpayBtn"),
  payPaytmBtn: document.querySelector("#payPaytmBtn"),
  payPhonePeBtn: document.querySelector("#payPhonePeBtn"),
  showQrBtn: document.querySelector("#showQrBtn"),
  paymentDoneBtn: document.querySelector("#paymentDoneBtn"),
  paymentNote: document.querySelector("#paymentNote"),
  receiptActions: document.querySelector("#receiptActions"),
  viewReceiptBtn: document.querySelector("#viewReceiptBtn"),
  downloadReceiptBtn: document.querySelector("#downloadReceiptBtn"),
  addMoreItems: document.querySelector("#addMoreItems"),
  addMoreTop: document.querySelector("#addMoreTop"),
  trackTop: document.querySelector("#trackTop"),
  trackerSteps: document.querySelector("#trackerSteps"),
  lookupResults: document.querySelector("#lookupResults"),
  customerModal: document.querySelector("#customerModal"),
  customerModalTitle: document.querySelector("#customerModalTitle"),
  customerModalText: document.querySelector("#customerModalText"),
  customerForm: document.querySelector("#customerForm"),
  customerName: document.querySelector("#customerName"),
  customerMobile: document.querySelector("#customerMobile"),
  customerError: document.querySelector("#customerError"),
  startOrderBtn: document.querySelector("#startOrderBtn"),
  trackFromModal: document.querySelector("#trackFromModal"),
  backToStart: document.querySelector("#backToStart")
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
  state.customerProfile = readCustomerProfile();
  if (state.customerProfile) {
    fillCustomerForm(state.customerProfile);
    autoResumeTracking();
    hideCustomerModal();
  } else {
    showCustomerStart();
  }
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
  if (elements.chooseOnlineBtn) elements.chooseOnlineBtn.addEventListener("click", chooseOnlinePayment);
  elements.paymentBackBtn.addEventListener("click", openEditableCartFromPayment);
  elements.paymentCloseBtn.addEventListener("click", closePaymentToMenu);
  [elements.payGpayBtn, elements.payPaytmBtn, elements.payPhonePeBtn].forEach((link) => {
    link.addEventListener("click", handlePaymentAppClick);
  });
  elements.showQrBtn.addEventListener("click", showPaymentQr);
  elements.paymentDoneBtn.addEventListener("click", markCustomerPaid);
  elements.viewReceiptBtn.addEventListener("click", viewCurrentReceipt);
  elements.downloadReceiptBtn.addEventListener("click", downloadCurrentReceipt);
  elements.trackTop.addEventListener("click", showCustomerTrack);
  elements.trackFromModal.addEventListener("click", showCustomerTrack);
  elements.backToStart.addEventListener("click", showCustomerStart);
  elements.customerForm.addEventListener("submit", handleCustomerSubmit);
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

function readCustomerProfile() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CUSTOMER_PROFILE_KEY) || "null");
    const mobile = normalizeIndianMobile(parsed?.mobile);
    const name = String(parsed?.name || "").trim();
    if (!name || !mobile) return null;
    return { name, mobile };
  } catch {
    return null;
  }
}

function saveCustomerProfile(profile) {
  localStorage.setItem(CUSTOMER_PROFILE_KEY, JSON.stringify(profile));
}

function clearCustomerProfile() {
  try {
    localStorage.removeItem(CUSTOMER_PROFILE_KEY);
  } catch {
    // Storage may be unavailable in private mode.
  }
  state.customerProfile = null;
}

function fillCustomerForm(profile) {
  elements.customerName.value = profile?.name || "";
  elements.customerMobile.value = profile?.mobile || "";
}

function hideCustomerModal() {
  elements.customerModal.hidden = true;
}

function showCustomerStart() {
  elements.customerModal.hidden = false;
  elements.customerModalTitle.textContent = "Start Your Order";
  elements.customerModalText.textContent = "Enter your details once for order updates and counter billing.";
  elements.customerForm.hidden = false;
  elements.startOrderBtn.textContent = "Start Order";
  elements.trackFromModal.hidden = false;
  elements.backToStart.hidden = true;
  elements.customerError.textContent = "";
  fillCustomerForm(state.customerProfile);
  setTimeout(() => elements.customerName.focus(), 0);
}

function showCustomerTrack() {
  elements.customerModal.hidden = false;
  elements.customerModalTitle.textContent = "Track Order";
  elements.customerModalText.textContent = "Enter your mobile number to find active orders.";
  elements.customerForm.hidden = false;
  elements.startOrderBtn.textContent = "Track Order";
  elements.trackFromModal.hidden = true;
  elements.backToStart.hidden = !state.customerProfile;
  elements.customerError.textContent = "";
  fillCustomerForm(state.customerProfile);
  setTimeout(() => elements.customerMobile.focus(), 0);
}

async function handleCustomerSubmit(event) {
  event.preventDefault();
  const name = elements.customerName.value.trim();
  const mobile = normalizeIndianMobile(elements.customerMobile.value);
  const isTracking = elements.startOrderBtn.textContent === "Track Order";

  if (!isTracking && !name) {
    elements.customerError.textContent = "Please enter your name.";
    return;
  }
  if (!mobile) {
    elements.customerError.textContent = "Enter a valid 10-digit Indian mobile number.";
    return;
  }

  const profile = { name: name || state.customerProfile?.name || "Guest", mobile };
  state.customerProfile = profile;
  saveCustomerProfile(profile);
  fillCustomerForm(profile);
  elements.customerError.textContent = "";

  if (isTracking) {
    await lookupOrdersByMobile(mobile);
  } else {
    hideCustomerModal();
    showToast("Ready to order");
  }
}

async function autoResumeTracking() {
  const orders = await findActiveOrdersByMobile(state.customerProfile.mobile).catch(() => []);
  if (orders.length === 1) startTrackingOrder(orders[0].orderId || orders[0].id);
  if (orders.length > 1) {
    renderLookupResults(orders);
    showScreen("payment");
  }
}

function showError(title, message, canRetry = false) {
  elements.errorTitle.textContent = title;
  elements.errorMessage.textContent = message;
  elements.retryMenu.hidden = !canRetry;
  showScreen("error");
}

function renderCategories() {
  renderCategorySidebar(elements.categoryRow, state.categories, state.activeCategory, (category) => {
    state.activeCategory = category;
    renderCategories();
    renderMenu();
  });
}

function renderMenu() {
  const items = state.groupedMenu[state.activeCategory] || [];
  renderMenuGrid(elements.menuList, items, state.cart, (item, delta) => {
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
  elements.placeOrderBtn.textContent = hasActiveOrderForThisTable() ? "Add Items" : "Place Order";
}

async function placeOrder() {
  const { items, total } = getCartTotals(state.cart);
  if (!items.length) return;
  if (!state.customerProfile) {
    showCustomerStart();
    return;
  }

  const appendingToActiveOrder = hasActiveOrderForThisTable();
  const orderItems = cloneOrderItems(items);

  try {
    elements.placeOrderBtn.disabled = true;
    const snapshot = await placeOrAppendOrder(state.tableId, items, "customer", state.customerProfile);
    state.trackedTableId = state.tableId;
    state.lastOrderItems = orderItems;
    state.cart.clear();
    renderMenu();
    if (snapshot?.exists()) {
      renderPaymentFromOrder({ id: snapshot.id, ...snapshot.data() });
    } else {
      state.lastOrderTotal = total;
      renderPayment(total, null);
    }
    showToast(appendingToActiveOrder ? "Items Added!" : "Order Placed!");
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

function renderPayment(total, order = null) {
  const tableId = state.trackedTableId || state.tableId;
  const orderId = order?.orderId || order?.id || state.trackedOrderId || tableId;
  const isPaid = order?.paymentStatus === "verified_paid" || order?.status === "paid";
  const isClaimedPaid = order?.paymentStatus === "customer_claimed_paid";
  const amountDue = order ? getOrderAmountDue(order) : total;
  const paymentLinks = buildPaymentLinks(tableId, amountDue, orderId);
  elements.paymentSummary.innerHTML = `
    <p><strong>Table ${escapeHtml(tableId)}</strong></p>
    ${order ? `<p class="subtle">Order ${escapeHtml(String(orderId).slice(0, 8))}</p>` : ""}
    <p><strong>${formatCurrency(amountDue)}</strong></p>
    ${state.customerProfile ? `<p class="subtle">${escapeHtml(state.customerProfile.name)} - ${escapeHtml(maskMobile(state.customerProfile.mobile))}</p>` : ""}
  `;
  elements.upiQr.src = buildUpiQrUrl(tableId, amountDue, orderId);
  elements.payGpayBtn.href = paymentLinks.googlePay;
  elements.payPaytmBtn.href = paymentLinks.paytm;
  elements.payPhonePeBtn.href = paymentLinks.phonePe;
  elements.upiIdText.textContent = CONFIG.UPI_ID;
  elements.paymentDoneBtn.textContent = isClaimedPaid ? "Payment sent for verification" : "I have paid online";
  elements.paymentDoneBtn.disabled = isPaid || isClaimedPaid;
  if (elements.chooseOnlineBtn) elements.chooseOnlineBtn.disabled = isPaid;
  elements.onlinePaymentPanel.hidden = isPaid;
  elements.upiQr.hidden = true;
  elements.showQrBtn.innerHTML = "<span>QR</span><strong>Show Payment QR</strong>";
  elements.upiIdText.hidden = true;
  if (elements.paymentChoiceGrid) elements.paymentChoiceGrid.hidden = true;
  elements.paymentBackBtn.hidden = Boolean(order) || isPaid || tableId !== state.tableId || Number(order?.paidTotal || 0) > 0 || order?.paymentStatus === "verified_paid";
  elements.paymentNote.textContent = isPaid
    ? "Payment completed. Thank you."
    : "Tap a UPI app or show the payment QR to complete payment.";
  elements.addMoreItems.hidden = isPaid || tableId !== state.tableId;
  elements.receiptActions.hidden = !isPaid || !order?.receiptNumber;
  updateOrderStatusBanner(order);
  renderTrackerSteps(order?.status || "new");
}

function subscribeOrderStatus() {
  unsubscribeOrderStatus();
  const orderId = state.trackedOrderId;
  if (!orderId) return;
  state.orderUnsubscribe = listenToActiveOrder(orderId, (order) => {
    state.trackedOrder = order;
    if (order) renderPaymentFromOrder(order);
    else resetCustomerSessionAfterTableClear();
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
  renderTrackerSteps(order.status || "new");

  if (order.status === "paid") {
    elements.paymentNote.textContent = "Payment completed. Thank you.";
  } else if (order.paymentStatus === "customer_claimed_paid") {
    elements.paymentDoneBtn.textContent = "Payment Submitted";
    elements.paymentDoneBtn.disabled = true;
    elements.paymentNote.textContent = "Waiting for verification...";
  } else if (order.paymentStatus === "verified_paid") {
    elements.paymentNote.textContent = "Payment confirmed. Kitchen will start preparing your order.";
  } else if (order.paymentStatus === "pending_addon") {
    elements.paymentNote.textContent = "Complete payment for the new items only.";
  }
}

function resetCustomerSessionAfterTableClear() {
  clearCustomerProfile();
  state.trackedTableId = null;
  state.trackedOrderId = null;
  state.trackedOrder = null;
  state.lastOrderTotal = 0;
  state.lastOrderItems = [];
  state.cart.clear();
  elements.lookupResults.hidden = true;
  elements.paymentSummary.innerHTML = "";
  elements.onlinePaymentPanel.hidden = true;
  elements.upiIdText.hidden = true;
  if (elements.paymentChoiceGrid) elements.paymentChoiceGrid.hidden = false;
  renderMenu();
  updateBottomBar("menu");
  showScreen("menu");
  showCustomerStart();
  showToast("Table cleared. Please enter details for a new order.");
}

function renderTrackerSteps(status) {
  const activeIndex = Math.max(0, TRACKING_STEPS.indexOf(status || "new"));
  elements.trackerSteps.innerHTML = TRACKING_STEPS.map((step, index) => `
    <div class="tracker-step ${index <= activeIndex ? "active" : ""}">
      <span>${index + 1}</span>
      <strong>${escapeHtml(TRACKING_LABELS[step])}</strong>
    </div>
  `).join("");
}

function renderPaymentFromOrder(order) {
  const orderId = order.orderId || order.id;
  state.trackedOrderId = orderId;
  state.trackedTableId = order.tableId || state.tableId;
  state.trackedOrder = order;
  state.lastOrderTotal = Number(order.total || 0);
  state.lastOrderItems = cloneOrderItems(order.items || []);
  state.customerProfile = state.customerProfile || {
    name: order.customerName || "Guest",
    mobile: order.customerMobileNormalized || order.customerMobile || ""
  };
  renderPayment(state.lastOrderTotal, order);
}

async function lookupOrdersByMobile(mobile) {
  elements.startOrderBtn.disabled = true;
  elements.customerError.textContent = "Checking active orders...";
  try {
    const orders = await findActiveOrdersByMobile(mobile);
    if (!orders.length) {
      elements.customerError.textContent = "No active order found for this mobile.";
      return;
    }
    hideCustomerModal();
    if (orders.length === 1) {
      startTrackingOrder(orders[0].tableId);
    } else {
      renderLookupResults(orders);
      showScreen("payment");
    }
  } catch {
    elements.customerError.textContent = "Unable to check orders. Please try again.";
  } finally {
    elements.startOrderBtn.disabled = false;
  }
}

function renderLookupResults(orders) {
  elements.lookupResults.hidden = false;
  elements.lookupResults.innerHTML = `
    <strong>Select your active order</strong>
    ${orders.map((order) => `
      <button class="ghost-btn" type="button" data-track-order="${escapeHtml(order.orderId || order.id)}">
        Table ${escapeHtml(order.tableId)} - Order ${escapeHtml(String(order.orderId || order.id).slice(0, 8))} - ${formatCurrency(order.total)} - ${escapeHtml(STATUS_LABELS[order.status] || order.status || "New")}
      </button>
    `).join("")}
  `;
  elements.lookupResults.querySelectorAll("[data-track-order]").forEach((button) => {
    button.addEventListener("click", () => startTrackingOrder(button.dataset.trackOrder));
  });
}

function startTrackingOrder(orderId) {
  state.trackedOrderId = orderId;
  elements.lookupResults.hidden = true;
  renderPayment(0, null);
  showScreen("payment");
}

function chooseOnlinePayment() {
  elements.onlinePaymentPanel.hidden = false;
  elements.upiIdText.hidden = false;
  elements.paymentDoneBtn.disabled = false;
  elements.paymentDoneBtn.textContent = "I have paid online";
  elements.paymentNote.textContent = "After successful payment, please click I Have Paid Online so the counter can verify your payment and start preparing your order.";
}

function showPaymentQr() {
  elements.upiQr.hidden = false;
  elements.upiIdText.hidden = false;
  elements.showQrBtn.innerHTML = "<span>QR</span><strong>Payment QR shown</strong>";
  elements.paymentNote.textContent = "After successful payment, please click I Have Paid Online so the counter can verify your payment and start preparing your order.";
}

function hasActiveOrderForThisTable() {
  return state.trackedTableId === state.tableId
    && state.lastOrderTotal > 0
    && state.trackedOrder?.status !== "paid";
}

function getOrderAmountDue(order) {
  const pendingAddOnTotal = Number(order?.pendingAddOnTotal || 0);
  if (pendingAddOnTotal > 0) return pendingAddOnTotal;
  if (order?.paymentStatus === "verified_paid") return 0;
  return Number(order?.total || 0);
}

function cloneOrderItems(items = []) {
  return items.map((item) => ({
    name: item.name,
    price: Number(item.price || 0),
    qty: Number(item.qty || 0)
  })).filter((item) => item.name && item.qty > 0);
}

function rebuildCartFromItems(items = []) {
  state.cart.clear();
  cloneOrderItems(items).forEach((item) => {
    state.cart.set(makeItemKey(item), item);
  });
}

function openEditableCartFromPayment() {
  const tableId = state.trackedTableId || state.tableId;
  if (tableId !== state.tableId) {
    showToast("Scan this table QR to edit the cart.");
    return;
  }

  if (!state.cart.size) {
    rebuildCartFromItems(state.trackedOrder?.items?.length ? state.trackedOrder.items : state.lastOrderItems);
  }
  renderCart();
  renderMenu();
  showScreen("cart");
}

function closePaymentToMenu() {
  showScreen("menu");
}

async function handlePaymentAppClick(event) {
  event.preventDefault();
  const link = event.currentTarget;
  const href = link.getAttribute("href");
  if (!href || href === "#") return;

  const appName = link.dataset.paymentApp || "UPI app";
  try {
    if (!state.trackedOrderId) return;
    setPaymentAppLinksBusy(true);
    await claimActiveOrderPaymentDone(state.trackedOrderId);
    elements.paymentDoneBtn.disabled = true;
    elements.paymentDoneBtn.textContent = "Payment sent for verification";
    elements.paymentNote.textContent = `Opening ${appName}. Staff will verify after payment.`;
    showToast("Counter notified");
    window.location.href = href;
  } catch (error) {
    console.error("Payment app launch failed.", error);
    elements.paymentNote.textContent = "Unable to notify counter. Please try again.";
    showToast("Connection error, please refresh");
  } finally {
    setPaymentAppLinksBusy(false);
  }
}

function setPaymentAppLinksBusy(isBusy) {
  [elements.payGpayBtn, elements.payPaytmBtn, elements.payPhonePeBtn].forEach((link) => {
    link.classList.toggle("is-loading", isBusy);
    link.setAttribute("aria-disabled", String(isBusy));
  });
}

async function markCustomerPaid() {
  try {
    if (!state.trackedOrderId) return;
    elements.paymentDoneBtn.disabled = true;
    await claimActiveOrderPaymentDone(state.trackedOrderId);
    elements.paymentDoneBtn.textContent = "Payment Submitted";
    elements.paymentNote.textContent = "Waiting for verification...";
    showToast("Counter notified");
  } catch (error) {
    console.error("Payment claim failed.", error);
    elements.paymentDoneBtn.disabled = false;
    showError("Connection error", "Connection error, please refresh");
  }
}

async function getCurrentReceipt() {
  if (!state.trackedOrderId) return null;
  const receipt = await fetchReceipt(state.trackedOrderId);
  if (!receipt) showToast("Receipt not available yet");
  return receipt;
}

async function viewCurrentReceipt() {
  const receipt = await getCurrentReceipt();
  if (!receipt) return;
  const win = window.open("", "_blank");
  win.document.write(buildReceiptDocumentHtml(receipt));
  win.document.close();
}

async function downloadCurrentReceipt() {
  const receipt = await getCurrentReceipt();
  if (receipt) downloadReceiptHtml(receipt);
}

init();
