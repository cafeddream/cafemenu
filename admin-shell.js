import { CONFIG } from "./firebase.js";
import { initAdminOrders } from "./admin-orders.js";
import { initPrivateSitting, refreshPrivateSittingView } from "./private-sitting.js";
import { requireStaffAuth } from "./staff-auth.js";

const elements = {
  restaurant: document.querySelector("#adminRestaurant"),
  signOutBtn: document.querySelector("#signOutBtn"),
  menuBtn: document.querySelector("#managerMenuBtn"),
  drawer: document.querySelector("#managerDrawer"),
  drawerBackdrop: document.querySelector("#managerDrawerBackdrop"),
  closeDrawer: document.querySelector("#closeManagerDrawer"),
  drawerReportsBtn: document.querySelector("#drawerReportsBtn"),
  views: document.querySelectorAll("[data-ps-view]"),
  navButtons: document.querySelectorAll("[data-ps-tab]"),
  splash: document.querySelector("#psSplash")
};

let activeTab = "orders";

function setActiveTab(tabId) {
  activeTab = tabId;
  elements.navButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.psTab === tabId);
  });
  elements.views.forEach((view) => {
    view.hidden = view.dataset.psView !== tabId;
  });
  document.body.dataset.activeTab = tabId;
  closeManagerDrawer();

  if (tabId === "dashboard" || tabId === "sittings" || tabId === "reports") {
    refreshPrivateSittingView();
  }
}

function openManagerDrawer() {
  if (!elements.drawer) return;
  elements.drawer.hidden = false;
  elements.drawerBackdrop.hidden = false;
  elements.menuBtn?.setAttribute("aria-expanded", "true");
  document.body.classList.add("ps-drawer-open");
}

function closeManagerDrawer() {
  if (!elements.drawer) return;
  elements.drawer.hidden = true;
  elements.drawerBackdrop.hidden = true;
  elements.menuBtn?.setAttribute("aria-expanded", "false");
  document.body.classList.remove("ps-drawer-open");
}

function bindShellUi() {
  elements.navButtons.forEach((button) => {
    button.addEventListener("click", () => setActiveTab(button.dataset.psTab));
  });

  window.addEventListener("manager-set-tab", (event) => {
    const tab = event.detail?.tab;
    if (tab) setActiveTab(tab);
  });

  elements.menuBtn?.addEventListener("click", openManagerDrawer);
  elements.closeDrawer?.addEventListener("click", closeManagerDrawer);
  elements.drawerBackdrop?.addEventListener("click", closeManagerDrawer);
  elements.drawerReportsBtn?.addEventListener("click", () => setActiveTab("reports"));

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
  setActiveTab("orders");
  initPrivateSitting();
  initAdminOrders();
  hideSplash();
}

function init() {
  requireStaffAuth(startManagerApp);
}

init();
