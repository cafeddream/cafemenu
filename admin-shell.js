import { CONFIG } from "./firebase.js";
import { initAdminOrders } from "./admin-orders.js";
import { initPrivateSitting, refreshPrivateSittingView } from "./private-sitting.js";
import { requireStaffAuth } from "./staff-auth.js";

const elements = {
  restaurant: document.querySelector("#adminRestaurant"),
  managerDate: document.querySelector("#managerDate"),
  managerClock: document.querySelector("#managerClock"),
  signOutBtn: document.querySelector("#signOutBtn"),
  views: document.querySelectorAll("[data-ps-view]"),
  navButtons: document.querySelectorAll("[data-ps-tab]"),
  splash: document.querySelector("#psSplash")
};

let activeTab = "dashboard";

function formatManagerDate(date = new Date()) {
  return date.toLocaleDateString([], {
    day: "numeric",
    month: "long",
    year: "numeric",
    weekday: "long"
  });
}

function startSharedClock() {
  const tick = () => {
    const now = new Date();
    if (elements.managerClock) {
      elements.managerClock.textContent = now.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      });
    }
    if (elements.managerDate) {
      elements.managerDate.textContent = formatManagerDate(now);
    }
  };
  tick();
  setInterval(tick, 1000);
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

  if (tabId === "dashboard" || tabId === "sittings") {
    refreshPrivateSittingView();
  }
}

function bindShellUi() {
  elements.navButtons.forEach((button) => {
    button.addEventListener("click", () => setActiveTab(button.dataset.psTab));
  });

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
    elements.restaurant.textContent = `${CONFIG.RESTAURANT_NAME} MANAGER`;
  }
  startSharedClock();
  bindShellUi();
  setActiveTab("dashboard");
  initPrivateSitting();
  initAdminOrders();
  hideSplash();
}

function init() {
  requireStaffAuth(startManagerApp);
}

init();
