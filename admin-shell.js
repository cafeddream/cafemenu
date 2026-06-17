import { CONFIG } from "./firebase.js";
import { initAdminOrders } from "./admin-orders.js";
import { initPrivateSitting, refreshPrivateSittingView } from "./private-sitting.js";
import { ensurePrinterConnected } from "./printer-serial.js";
import { requireStaffAuth } from "./staff-auth.js";

const elements = {
  restaurant: document.querySelector("#adminRestaurant"),
  signOutBtn: document.querySelector("#signOutBtn"),
  menuBtn: document.querySelector("#managerMenuBtn"),
  menuDropdown: document.querySelector("#managerMenuDropdown"),
  headerMenu: document.querySelector(".ps-header-menu"),
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
  if (elements.restaurant) {
    elements.restaurant.textContent = CONFIG.RESTAURANT_NAME;
  }
  bindShellUi();
  const sittingRoute = /^#\/sitting\/[^/]+$/i.test(location.hash);
  setActiveTab(sittingRoute ? "orders" : "orders");
  initPrivateSitting();
  initAdminOrders();
  ensurePrinterConnected().then((ready) => {
    if (ready) window.dispatchEvent(new CustomEvent("printer-status-change"));
  }).catch(() => {});
  hideSplash();
}

function init() {
  requireStaffAuth(startManagerApp);
}

init();
