import { CONFIG, showToast } from "./firebase.js";
import { initAdminOrders } from "./admin-orders.js";
import { initExpenses } from "./expenses.js";
import { initPrivateSitting, refreshPrivateSittingView } from "./private-sitting.js";
import { startDailyReportScheduler } from "./report-scheduler.js";
import { requireStaffAuth } from "./staff-auth.js";
import { closeDayForToday } from "./close-day.js";

const elements = {
  restaurant: document.querySelector("#adminRestaurant"),
  closeDayBtn: document.querySelector("#closeDayBtn"),
  closeDayModal: document.querySelector("#closeDayModal"),
  closeDayNo: document.querySelector("#closeDayNo"),
  closeDayYes: document.querySelector("#closeDayYes"),
  closeDayError: document.querySelector("#closeDayError"),
  menuBtn: document.querySelector("#managerMenuBtn"),
  menuDropdown: document.querySelector("#managerMenuDropdown"),
  headerMenu: document.querySelector(".ps-header-menu"),
  views: document.querySelectorAll("[data-ps-view]"),
  navButtons: document.querySelectorAll("[data-ps-tab]"),
  splash: document.querySelector("#psSplash")
};

let activeTab = "orders";
let closeDayRunning = false;

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

  if (tabId === "sittings" || tabId === "settings") {
    refreshPrivateSittingView(tabId);
  }
}

function setCloseDayError(message = "") {
  if (!elements.closeDayError) return;
  if (message) {
    elements.closeDayError.textContent = message;
    elements.closeDayError.hidden = false;
    return;
  }
  elements.closeDayError.textContent = "";
  elements.closeDayError.hidden = true;
}

function setCloseDayBusy(busy) {
  closeDayRunning = busy;
  if (elements.closeDayYes) {
    elements.closeDayYes.disabled = busy;
    elements.closeDayYes.textContent = busy ? "Please wait..." : "Yes";
  }
  if (elements.closeDayNo) elements.closeDayNo.disabled = busy;
}

function openCloseDayModal() {
  setCloseDayError();
  setCloseDayBusy(false);
  if (elements.closeDayModal) elements.closeDayModal.hidden = false;
}

function closeCloseDayModal() {
  if (closeDayRunning) return;
  setCloseDayError();
  if (elements.closeDayModal) elements.closeDayModal.hidden = true;
}

async function confirmCloseDay() {
  if (closeDayRunning) return;
  setCloseDayError();
  setCloseDayBusy(true);
  try {
    await closeDayForToday();
    closeCloseDayModal();
    closeManagerMenu();
    showToast("Day closed. Report saved to Drive and downloaded.");
  } catch (error) {
    console.error("Close day failed:", error);
    const message = error?.message || "Close day failed. Please try again.";
    setCloseDayError(message);
    showToast(message);
  } finally {
    setCloseDayBusy(false);
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
    if (event.key === "Escape") {
      if (elements.closeDayModal && !elements.closeDayModal.hidden) {
        closeCloseDayModal();
        return;
      }
      if (isManagerMenuOpen()) closeManagerMenu();
    }
  });

  elements.closeDayBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    closeManagerMenu();
    openCloseDayModal();
  });
  elements.closeDayNo?.addEventListener("click", closeCloseDayModal);
  elements.closeDayYes?.addEventListener("click", confirmCloseDay);
  elements.closeDayModal?.addEventListener("click", (event) => {
    if (event.target === elements.closeDayModal) closeCloseDayModal();
  });
}

function hideSplash() {
  if (!elements.splash) return;
  elements.splash.classList.add("hide");
  setTimeout(() => elements.splash.remove(), 450);
}

function setRestaurantBrandName(element, name) {
  if (!element) return;
  const textEl = element.querySelector(".ps-brand-text");
  if (textEl) textEl.textContent = name;
  else element.textContent = name;
}

function startManagerApp() {
  try {
    setRestaurantBrandName(elements.restaurant, CONFIG.RESTAURANT_NAME);
    bindShellUi();
    const sittingRoute = /^#\/sitting\/[^/]+$/i.test(location.hash);
    setActiveTab(sittingRoute ? "sittings" : "orders");
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
