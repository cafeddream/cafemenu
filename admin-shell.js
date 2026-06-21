import { CONFIG } from "./firebase.js";
import { initAdminOrders } from "./admin-orders.js";
import { initExpenses } from "./expenses.js";
import { initPrivateSitting, refreshPrivateSittingView } from "./private-sitting.js";
import { startDailyReportScheduler } from "./report-scheduler.js";
import { requireStaffAuth } from "./staff-auth.js";

const elements = {
  restaurant: document.querySelector("#adminRestaurant"),
  signOutBtn: document.querySelector("#signOutBtn"),
  menuBtn: document.querySelector("#managerMenuBtn"),
  menuDropdown: document.querySelector("#managerMenuDropdown"),
  headerMenu: document.querySelector(".ps-header-menu"),
  drawerExpensesBtn: document.querySelector("#drawerExpensesBtn"),
  drawerSettingsBtn: document.querySelector("#drawerSettingsBtn"),
  views: document.querySelectorAll("[data-ps-view]"),
  navButtons: document.querySelectorAll("[data-ps-tab]"),
  splash: document.querySelector("#psSplash")
};

let activeTab = "orders";

export function closeManagerMenu() {
  if (!elements.menuDropdown) return;
  elements.menuDropdown.hidden = true;
  elements.menuBtn?.setAttribute("aria-expanded", "false");
}

function isManagerMenuOpen() {
  return elements.menuDropdown && !elements.menuDropdown.hidden;
}

function toggleManagerMenu() {
  if (!elements.menuDropdown) return;
  const open = isManagerMenuOpen();
  elements.menuDropdown.hidden = open;
  elements.menuBtn?.setAttribute("aria-expanded", open ? "false" : "true");
}

function setActiveTab(tabId) {
  activeTab = tabId;
  elements.navButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.psTab === tabId);
  });
  elements.views.forEach((view) => {
    view.hidden = view.dataset.psView !== tabId;
  });
  document.body.dataset.activeTab = tabId;
  closeManagerMenu();

  if (tabId === "dashboard" || tabId === "sittings" || tabId === "reports" || tabId === "settings") {
    refreshPrivateSittingView();
  }
  if (tabId === "expenses") {
    window.dispatchEvent(new CustomEvent("expenses-tab-opened"));
  }
}

function bindShellUi() {
  elements.navButtons.forEach((button) => {
    button.addEventListener("click", () => setActiveTab(button.dataset.psTab));
  });

  window.addEventListener("manager-set-tab", (event) => {
    const tab = event.detail?.tab;
    if (tab) setActiveTab(tab);
  });

  window.addEventListener("manager-menu-close", closeManagerMenu);

  elements.menuBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleManagerMenu();
  });

  elements.menuDropdown?.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  document.addEventListener("click", (event) => {
    if (!isManagerMenuOpen()) return;
    if (elements.headerMenu?.contains(event.target)) return;
    closeManagerMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isManagerMenuOpen()) {
      closeManagerMenu();
    }
  });

  elements.drawerSettingsBtn?.addEventListener("click", () => setActiveTab("settings"));
  elements.drawerExpensesBtn?.addEventListener("click", () => setActiveTab("expenses"));

  elements.signOutBtn?.addEventListener("click", async () => {
    const { signOutStaff } = await import("./staff-auth.js");
    await signOutStaff();
    window.location.reload();
  });
}

function hideSplash() {
  if (!elements.splash) return;
  elements.splash.classList.add("hide");
  setTimeout(() => elements.splash.remove(), 450);
}

function startManagerApp() {
  try {
    if (elements.restaurant) {
      elements.restaurant.textContent = CONFIG.RESTAURANT_NAME;
    }
    bindShellUi();
    const sittingRoute = /^#\/sitting\/[^/]+$/i.test(location.hash);
    setActiveTab(sittingRoute ? "orders" : "orders");
    initPrivateSitting();
    initAdminOrders();
    initExpenses();
    startDailyReportScheduler();
  } catch (error) {
    console.error("Manager app init failed:", error);
  } finally {
    hideSplash();
  }
}

function init() {
  requireStaffAuth(startManagerApp).catch((error) => {
    console.error("Staff auth failed:", error);
    hideSplash();
  });
}

init();
