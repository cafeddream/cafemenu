import {
  deleteMenuItem,
  deletePrivateSitting,
  escapeHtml,
  getPinCooldownRemainingMs,
  getPrivateSittings,
  getSecurityConfig,
  importMenuFromSheet,
  isAdminSettingsUnlocked,
  isPinCooldownActive,
  listMenuItems,
  lockAdminSettings,
  setSecurityPin,
  showToast,
  unlockAdminSettings,
  updateMenuPrice,
  updateSittingRate,
  upsertMenuItem,
  upsertPrivateSitting,
  verifySecurityPin
} from "./firebase.js";

const state = {
  menuItems: [],
  securityConfig: null,
  pinModalMode: "unlock",
  activeTab: "menu",
  menuSearch: ""
};

let mountNode = null;
let pinModal = null;

function ensurePinModal() {
  if (pinModal) return pinModal;

  pinModal = document.createElement("div");
  pinModal.className = "modal-backdrop admin-pin-modal";
  pinModal.id = "adminPinModal";
  pinModal.hidden = true;
  pinModal.innerHTML = `
    <section class="admin-pin-panel" role="dialog" aria-modal="true" aria-labelledby="adminPinTitle">
      <div class="admin-pin-head">
        <h2 id="adminPinTitle">Admin Security PIN</h2>
        <button class="admin-pin-close" type="button" id="adminPinClose" aria-label="Close">×</button>
      </div>
      <p class="admin-pin-help" id="adminPinHelp"></p>
      <label class="admin-pin-field" id="adminPinFieldWrap">
        <span id="adminPinLabel">Enter PIN</span>
        <input id="adminPinInput" type="password" inputmode="numeric" maxlength="8" autocomplete="off">
      </label>
      <label class="admin-pin-field hidden" id="adminPinOldWrap">
        <span>Current PIN</span>
        <input id="adminPinOldInput" type="password" inputmode="numeric" maxlength="8" autocomplete="off">
      </label>
      <label class="admin-pin-field hidden" id="adminPinConfirmWrap">
        <span>Confirm PIN</span>
        <input id="adminPinConfirmInput" type="password" inputmode="numeric" maxlength="8" autocomplete="off">
      </label>
      <button class="admin-pin-change-btn hidden" type="button" id="adminPinChangeBtn">Change PIN</button>
      <p class="admin-pin-error hidden" id="adminPinError"></p>
      <div class="admin-pin-actions">
        <button class="primary-btn" type="button" id="adminPinSubmit">Submit</button>
      </div>
    </section>
  `;
  document.body.appendChild(pinModal);

  pinModal.querySelector("#adminPinClose")?.addEventListener("click", closePinModal);
  pinModal.querySelector("#adminPinChangeBtn")?.addEventListener("click", () => {
    state.pinModalMode = "change";
    configurePinModalUi("change");
    pinModal.querySelector("#adminPinOldInput")?.focus();
  });
  pinModal.querySelector("#adminPinSubmit")?.addEventListener("click", submitPinModal);
  pinModal.addEventListener("click", (event) => {
    if (event.target === pinModal) closePinModal();
  });

  return pinModal;
}

function closePinModal() {
  if (!pinModal) return;
  pinModal.hidden = true;
  pinModal.querySelector("#adminPinInput").value = "";
  pinModal.querySelector("#adminPinConfirmInput").value = "";
  pinModal.querySelector("#adminPinOldInput").value = "";
  const error = pinModal.querySelector("#adminPinError");
  if (error) {
    error.textContent = "";
    error.classList.add("hidden");
  }
}

function setPinError(message) {
  const error = pinModal?.querySelector("#adminPinError");
  if (!error) return;
  error.textContent = message;
  error.classList.toggle("hidden", !message);
}

function configurePinModalUi(mode) {
  const title = pinModal.querySelector("#adminPinTitle");
  const help = pinModal.querySelector("#adminPinHelp");
  const label = pinModal.querySelector("#adminPinLabel");
  const confirmWrap = pinModal.querySelector("#adminPinConfirmWrap");
  const oldWrap = pinModal.querySelector("#adminPinOldWrap");
  const changeBtn = pinModal.querySelector("#adminPinChangeBtn");
  const submit = pinModal.querySelector("#adminPinSubmit");

  confirmWrap.classList.add("hidden");
  oldWrap.classList.add("hidden");
  changeBtn.classList.add("hidden");
  setPinError("");
  pinModal.querySelector("#adminPinInput").value = "";
  pinModal.querySelector("#adminPinConfirmInput").value = "";
  pinModal.querySelector("#adminPinOldInput").value = "";

  if (mode === "set") {
    title.textContent = "Set Security PIN";
    help.textContent = "Choose a 4 to 8 digit PIN. You will need it to manage menu and sittings.";
    label.textContent = "New PIN";
    confirmWrap.classList.remove("hidden");
    submit.textContent = "Submit";
    return;
  }

  if (mode === "change") {
    title.textContent = "Change Security PIN";
    help.textContent = "Enter your current PIN, then choose a new one.";
    label.textContent = "New PIN";
    oldWrap.classList.remove("hidden");
    confirmWrap.classList.remove("hidden");
    submit.textContent = "Submit";
    return;
  }

  title.textContent = "Unlock Admin Configuration";
  help.textContent = isPinCooldownActive()
    ? `Too many wrong attempts. Try again in ${Math.ceil(getPinCooldownRemainingMs() / 1000)} seconds.`
    : "Enter your security PIN to manage menu items and private sittings.";
  label.textContent = "Enter PIN";
  if (state.securityConfig?.pinHash) {
    changeBtn.classList.remove("hidden");
  }
  submit.textContent = "Submit";
}

async function openPinModal(mode = "unlock") {
  ensurePinModal();
  if (!state.securityConfig) {
    try {
      state.securityConfig = await getSecurityConfig();
    } catch (error) {
      console.warn("Security config load failed:", error?.code || error?.message || error);
    }
  }
  if (mode === "unlock" && !state.securityConfig?.pinHash) {
    mode = "set";
  }
  state.pinModalMode = mode;
  configurePinModalUi(mode);
  pinModal.hidden = false;
  const focusTarget = mode === "change"
    ? pinModal.querySelector("#adminPinOldInput")
    : pinModal.querySelector("#adminPinInput");
  focusTarget?.focus();
}

async function submitPinModal() {
  const pin = pinModal.querySelector("#adminPinInput")?.value?.trim() || "";
  const confirmPin = pinModal.querySelector("#adminPinConfirmInput")?.value?.trim() || "";
  const oldPin = pinModal.querySelector("#adminPinOldInput")?.value?.trim() || "";

  if (state.pinModalMode === "unlock") {
    if (isPinCooldownActive()) {
      setPinError(`Try again in ${Math.ceil(getPinCooldownRemainingMs() / 1000)} seconds.`);
      return;
    }
    if (!state.securityConfig?.pinHash) {
      closePinModal();
      await openPinModal("set");
      return;
    }
    const result = await verifySecurityPin(pin);
    if (!result.ok) {
      if (result.reason === "cooldown") {
        setPinError(`Try again in ${Math.ceil(getPinCooldownRemainingMs() / 1000)} seconds.`);
      } else {
        setPinError("Wrong PIN. Try again.");
      }
      return;
    }
    closePinModal();
    showToast("Admin settings unlocked");
    renderAdminSettings(mountNode);
    return;
  }

  if (!/^\d{4,8}$/.test(pin)) {
    setPinError("PIN must be 4 to 8 digits.");
    return;
  }

  if (state.pinModalMode === "set" || state.pinModalMode === "change") {
    if (pin !== confirmPin) {
      setPinError("PIN confirmation does not match.");
      return;
    }
  }

  if (state.pinModalMode === "change") {
    const verifyOld = await verifySecurityPin(oldPin);
    if (!verifyOld.ok) {
      setPinError(verifyOld.reason === "cooldown" ? "Cooldown active. Try later." : "Current PIN is wrong.");
      return;
    }
    lockAdminSettings();
  }

  try {
    await setSecurityPin(pin);
    unlockAdminSettings();
    state.securityConfig = await getSecurityConfig();
    closePinModal();
    showToast(state.pinModalMode === "change" ? "PIN updated" : "Security PIN set");
    renderAdminSettings(mountNode);
  } catch (error) {
    setPinError(error.message || "Could not save PIN");
  }
}

function lockedCardHtml() {
  const cooldown = isPinCooldownActive();
  return `
    <section class="ps-settings-card admin-settings-card admin-locked" id="adminSettingsMount">
      <div class="admin-settings-head">
        <h3>Admin Configuration</h3>
        <span class="admin-lock-badge">Locked</span>
      </div>
      <p>Enter security PIN to manage menu items and private sitting rates.</p>
      <button class="primary-btn" type="button" data-admin-action="unlock" ${cooldown ? "disabled" : ""}>
        ${cooldown ? "PIN Cooldown Active" : "Unlock Admin Settings"}
      </button>
    </section>
  `;
}

function errorCardHtml() {
  return `
    <section class="ps-settings-card admin-settings-card admin-locked" id="adminSettingsMount">
      <div class="admin-settings-head">
        <h3>Admin Configuration</h3>
        <span class="admin-lock-badge">Error</span>
      </div>
      <p>Could not connect to Firestore. Deploy updated firestore.rules and hard-refresh admin.</p>
    </section>
  `;
}

function getFilteredMenuItems() {
  const query = state.menuSearch.trim().toLowerCase();
  if (!query) return state.menuItems;
  return state.menuItems.filter((item) => (
    String(item.name).toLowerCase().includes(query)
    || String(item.category).toLowerCase().includes(query)
  ));
}

function groupMenuByCategory(items = []) {
  const groups = new Map();
  items.forEach((item) => {
    const category = String(item.category || "Other");
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(item);
  });
  return [...groups.entries()].sort((left, right) => left[0].localeCompare(right[0]));
}

function compactMenuRowHtml(item) {
  return `
    <div class="admin-compact-row" data-menu-id="${escapeHtml(item.itemId)}">
      <span class="admin-compact-label" title="${escapeHtml(item.category)}">${escapeHtml(item.name)}</span>
      <input class="admin-compact-price" type="number" min="0" step="1" value="${Number(item.price)}" data-menu-price="${escapeHtml(item.itemId)}" aria-label="Price for ${escapeHtml(item.name)}">
      <button class="admin-icon-btn" type="button" data-menu-save="${escapeHtml(item.itemId)}" title="Save price">✓</button>
      <button class="admin-icon-btn admin-icon-danger" type="button" data-menu-delete="${escapeHtml(item.itemId)}" title="Delete">×</button>
    </div>
  `;
}

function menuCategoryGroupHtml(category, items) {
  return `
    <details class="admin-category-group" open>
      <summary class="admin-category-head">${escapeHtml(category)} <span>${items.length}</span></summary>
      <div class="admin-compact-table">
        ${items.map(compactMenuRowHtml).join("")}
      </div>
    </details>
  `;
}

function menuTabHtml() {
  const filtered = getFilteredMenuItems();
  const groups = groupMenuByCategory(filtered);
  const showImportBanner = state.menuItems.length < 5;

  return `
    <div class="admin-tab-panel" data-admin-panel="menu">
      <p class="admin-help-note">Customer menu = Google Sheet + your Firestore price edits</p>
      ${showImportBanner ? `
        <div class="admin-import-banner">
          <span>Purana menu restore karo — sheet se saare items Firestore mein lao.</span>
          <button class="secondary-btn" type="button" data-admin-action="import-menu">Import Full Menu</button>
        </div>
      ` : ""}
      <div class="admin-toolbar">
        <input type="search" class="admin-search" placeholder="Search item or category" value="${escapeHtml(state.menuSearch)}" data-admin-search>
        <button class="secondary-btn" type="button" data-admin-action="import-menu">Import Full Menu</button>
      </div>
      <div class="admin-menu-groups">
        ${groups.length
    ? groups.map(([category, items]) => menuCategoryGroupHtml(category, items)).join("")
    : "<p class=\"admin-empty-note\">No Firestore items yet. Import full menu or add below.</p>"}
      </div>
      <form class="admin-inline-add" id="adminAddMenuForm">
        <input type="text" name="category" placeholder="Category" required maxlength="40">
        <input type="text" name="name" placeholder="Item" required maxlength="80">
        <input type="number" name="price" placeholder="₹" min="0" step="1" required>
        <button class="primary-btn" type="submit">Add</button>
      </form>
    </div>
  `;
}

function compactSittingRowHtml(sitting) {
  return `
    <div class="admin-compact-row" data-sitting-id="${escapeHtml(sitting.id)}">
      <span class="admin-compact-label">${escapeHtml(sitting.id)}</span>
      <input class="admin-compact-price" type="number" min="0" step="10" value="${Number(sitting.ratePerHour)}" data-sitting-rate="${escapeHtml(sitting.id)}" aria-label="Rate for ${escapeHtml(sitting.id)}">
      <button class="admin-icon-btn" type="button" data-sitting-save="${escapeHtml(sitting.id)}" title="Save rate">✓</button>
      <button class="admin-icon-btn admin-icon-danger" type="button" data-sitting-delete="${escapeHtml(sitting.id)}" title="Delete">×</button>
    </div>
  `;
}

function sittingsTabHtml() {
  return `
    <div class="admin-tab-panel" data-admin-panel="sittings">
      <div class="admin-compact-table">
        ${getPrivateSittings().map(compactSittingRowHtml).join("")}
      </div>
      <form class="admin-inline-add" id="adminAddSittingForm">
        <input type="text" name="id" placeholder="Top Hut" required maxlength="12">
        <input type="number" name="ratePerHour" placeholder="₹/hr" min="0" step="10" required>
        <button class="primary-btn" type="submit">Add</button>
      </form>
    </div>
  `;
}

function unlockedCardHtml() {
  return `
    <section class="ps-settings-card admin-settings-card admin-compact" id="adminSettingsMount">
      <div class="admin-settings-head">
        <h3>Admin Configuration</h3>
        <div class="admin-settings-actions">
          <button class="secondary-btn" type="button" data-admin-action="lock">Lock</button>
        </div>
      </div>

      <div class="admin-tabs" role="tablist">
        <button class="admin-tab ${state.activeTab === "menu" ? "active" : ""}" type="button" data-admin-tab="menu" role="tab">Menu</button>
        <button class="admin-tab ${state.activeTab === "sittings" ? "active" : ""}" type="button" data-admin-tab="sittings" role="tab">Sittings</button>
      </div>

      <div class="${state.activeTab === "menu" ? "" : "hidden"}" data-admin-panel-wrap="menu">
        ${menuTabHtml()}
      </div>
      <div class="${state.activeTab === "sittings" ? "" : "hidden"}" data-admin-panel-wrap="sittings">
        ${sittingsTabHtml()}
      </div>
    </section>
  `;
}

async function refreshAdminData() {
  state.securityConfig = await getSecurityConfig();
  if (isAdminSettingsUnlocked()) {
    try {
      state.menuItems = await listMenuItems();
    } catch (error) {
      console.warn("Menu items load failed:", error?.code || error?.message || error);
      state.menuItems = [];
    }
  }
}

function resolveSettingsPanel(container) {
  if (!container) return document.querySelector("#psSettingsPanel");
  if (container.id === "psSettingsPanel") return container;
  return container.closest("#psSettingsPanel") || document.querySelector("#psSettingsPanel");
}

export async function renderAdminSettings(container) {
  const panel = resolveSettingsPanel(container);
  if (!panel) return;
  mountNode = panel;

  const mount = panel.querySelector("#adminSettingsMount");
  if (!mount) return;

  try {
    await refreshAdminData();
    mount.outerHTML = isAdminSettingsUnlocked() ? unlockedCardHtml() : lockedCardHtml();
  } catch (error) {
    console.warn("Admin settings render failed:", error?.code || error?.message || error);
    mount.outerHTML = errorCardHtml();
  }
}

function bindAdminSettingsEvents(container) {
  if (!container || container.dataset.adminBound === "true") return;
  container.dataset.adminBound = "true";

  container.addEventListener("click", async (event) => {
    const tabBtn = event.target.closest("[data-admin-tab]");
    if (tabBtn) {
      state.activeTab = tabBtn.dataset.adminTab || "menu";
      await renderAdminSettings(container);
      return;
    }

    const target = event.target.closest("[data-admin-action],[data-menu-save],[data-menu-delete],[data-sitting-save],[data-sitting-delete]");
    if (!target) return;

    const action = target.dataset.adminAction;
    if (action === "unlock") {
      await refreshAdminData();
      if (!state.securityConfig?.pinHash) await openPinModal("set");
      else await openPinModal("unlock");
      return;
    }
    if (action === "lock") {
      lockAdminSettings();
      showToast("Admin settings locked");
      renderAdminSettings(container);
      return;
    }
    if (action === "import-menu") {
      if (!window.confirm("Import full menu from Google Sheet into Firestore? Existing Firestore items with same name will be updated.")) return;
      try {
        const count = await importMenuFromSheet();
        showToast(`Imported ${count} menu items`);
        await renderAdminSettings(container);
      } catch (error) {
        showToast(error.message || "Import failed");
      }
      return;
    }

    const menuId = target.dataset.menuSave || target.dataset.menuDelete;
    if (menuId) {
      const row = container.querySelector(`[data-menu-id="${menuId}"]`);
      const priceInput = row?.querySelector(`[data-menu-price="${menuId}"]`);
      try {
        if (target.dataset.menuDelete) {
          if (!window.confirm("Delete this menu item?")) return;
          await deleteMenuItem(menuId);
          showToast("Menu item deleted");
        } else {
          await updateMenuPrice(menuId, priceInput?.value);
          showToast("Price updated");
        }
        await renderAdminSettings(container);
      } catch (error) {
        showToast(error.message || "Menu update failed");
      }
      return;
    }

    const sittingId = target.dataset.sittingSave || target.dataset.sittingDelete;
    if (sittingId) {
      const row = container.querySelector(`[data-sitting-id="${sittingId}"]`);
      const rateInput = row?.querySelector(`[data-sitting-rate="${sittingId}"]`);
      try {
        if (target.dataset.sittingDelete) {
          if (!window.confirm(`Delete ${sittingId}?`)) return;
          await deletePrivateSitting(sittingId);
          showToast("Sitting deleted");
        } else {
          await updateSittingRate(sittingId, rateInput?.value);
          showToast("Sitting rate updated");
        }
        await renderAdminSettings(container);
        window.dispatchEvent(new CustomEvent("runtime-config-updated"));
      } catch (error) {
        showToast(error.message || "Sitting update failed");
      }
    }
  });

  container.addEventListener("input", (event) => {
    if (!event.target.matches("[data-admin-search]")) return;
    state.menuSearch = event.target.value || "";
    void renderAdminSettings(container);
  });

  container.addEventListener("submit", async (event) => {
    if (event.target.id === "adminAddMenuForm") {
      event.preventDefault();
      const form = event.target;
      try {
        await upsertMenuItem({
          category: form.category.value,
          name: form.name.value,
          price: form.price.value,
          sortOrder: state.menuItems.length
        });
        showToast("Menu item added");
        form.reset();
        await renderAdminSettings(container);
      } catch (error) {
        showToast(error.message || "Could not add menu item");
      }
      return;
    }

    if (event.target.id === "adminAddSittingForm") {
      event.preventDefault();
      const form = event.target;
      try {
        await upsertPrivateSitting({
          id: form.id.value,
          ratePerHour: form.ratePerHour.value
        });
        showToast("Sitting saved");
        form.reset();
        await renderAdminSettings(container);
        window.dispatchEvent(new CustomEvent("runtime-config-updated"));
      } catch (error) {
        showToast(error.message || "Could not add sitting");
      }
    }
  });
}

export function initAdminSettings() {
  const panel = document.querySelector("#psSettingsPanel");
  if (panel) bindAdminSettingsEvents(panel);
}

initAdminSettings();
