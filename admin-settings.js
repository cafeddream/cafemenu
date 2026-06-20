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

const SITTING_THEMES = ["ps-green", "ps-gold", "ps-purple", "ps-pink", "ps-ruby"];

const state = {
  menuItems: [],
  securityConfig: null,
  pinModalMode: "unlock"
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
      <h2 id="adminPinTitle">Admin Security PIN</h2>
      <p class="admin-pin-help" id="adminPinHelp"></p>
      <label class="admin-pin-field">
        <span id="adminPinLabel">PIN</span>
        <input id="adminPinInput" type="password" inputmode="numeric" maxlength="8" autocomplete="off">
      </label>
      <label class="admin-pin-field" id="adminPinConfirmWrap" hidden>
        <span>Confirm PIN</span>
        <input id="adminPinConfirmInput" type="password" inputmode="numeric" maxlength="8" autocomplete="off">
      </label>
      <label class="admin-pin-field" id="adminPinOldWrap" hidden>
        <span>Current PIN</span>
        <input id="adminPinOldInput" type="password" inputmode="numeric" maxlength="8" autocomplete="off">
      </label>
      <p class="admin-pin-error" id="adminPinError" hidden></p>
      <div class="admin-pin-actions">
        <button class="ghost-btn" type="button" id="adminPinCancel">Cancel</button>
        <button class="primary-btn" type="button" id="adminPinSubmit">Continue</button>
      </div>
    </section>
  `;
  document.body.appendChild(pinModal);

  pinModal.querySelector("#adminPinCancel")?.addEventListener("click", closePinModal);
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
  if (error) error.hidden = true;
}

function setPinError(message) {
  const error = pinModal?.querySelector("#adminPinError");
  if (!error) return;
  error.textContent = message;
  error.hidden = !message;
}

function openPinModal(mode = "unlock") {
  ensurePinModal();
  state.pinModalMode = mode;
  const title = pinModal.querySelector("#adminPinTitle");
  const help = pinModal.querySelector("#adminPinHelp");
  const label = pinModal.querySelector("#adminPinLabel");
  const confirmWrap = pinModal.querySelector("#adminPinConfirmWrap");
  const oldWrap = pinModal.querySelector("#adminPinOldWrap");
  const submit = pinModal.querySelector("#adminPinSubmit");

  confirmWrap.hidden = mode !== "set" && mode !== "change";
  oldWrap.hidden = mode !== "change";
  setPinError("");

  if (mode === "set") {
    title.textContent = "Set Security PIN";
    help.textContent = "Choose a 4 to 8 digit PIN. You will need it to manage menu and sittings.";
    label.textContent = "New PIN";
    submit.textContent = "Save PIN";
  } else if (mode === "change") {
    title.textContent = "Change Security PIN";
    help.textContent = "Enter your current PIN, then choose a new one.";
    label.textContent = "New PIN";
    submit.textContent = "Update PIN";
  } else {
    title.textContent = "Unlock Admin Configuration";
    help.textContent = isPinCooldownActive()
      ? `Too many wrong attempts. Try again in ${Math.ceil(getPinCooldownRemainingMs() / 1000)} seconds.`
      : "Enter your security PIN to manage menu items and private sittings.";
    label.textContent = "PIN";
    submit.textContent = "Unlock";
  }

  pinModal.hidden = false;
  pinModal.querySelector("#adminPinInput")?.focus();
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
      openPinModal("set");
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

function menuRowHtml(item) {
  return `
    <div class="admin-edit-row" data-menu-id="${escapeHtml(item.itemId)}">
      <div class="admin-edit-meta">
        <strong>${escapeHtml(item.name)}</strong>
        <span>${escapeHtml(item.category)}</span>
      </div>
      <div class="admin-edit-controls">
        <input type="number" min="0" step="1" value="${Number(item.price)}" data-menu-price="${escapeHtml(item.itemId)}">
        <button class="secondary-btn" type="button" data-menu-save="${escapeHtml(item.itemId)}">Save</button>
        <button class="danger-btn admin-danger-btn" type="button" data-menu-delete="${escapeHtml(item.itemId)}">Delete</button>
      </div>
    </div>
  `;
}

function sittingRowHtml(sitting) {
  return `
    <div class="admin-edit-row" data-sitting-id="${escapeHtml(sitting.id)}">
      <div class="admin-edit-meta">
        <strong>${escapeHtml(sitting.id)}</strong>
        <span>${escapeHtml(sitting.theme || "ps-green")}${sitting.wide ? " · wide" : ""}</span>
      </div>
      <div class="admin-edit-controls">
        <input type="number" min="0" step="10" value="${Number(sitting.ratePerHour)}" data-sitting-rate="${escapeHtml(sitting.id)}">
        <button class="secondary-btn" type="button" data-sitting-save="${escapeHtml(sitting.id)}">Save</button>
        <button class="danger-btn admin-danger-btn" type="button" data-sitting-delete="${escapeHtml(sitting.id)}">Delete</button>
      </div>
    </div>
  `;
}

function unlockedCardHtml() {
  return `
    <section class="ps-settings-card admin-settings-card" id="adminSettingsMount">
      <div class="admin-settings-head">
        <h3>Admin Configuration</h3>
        <div class="admin-settings-actions">
          <button class="ghost-btn" type="button" data-admin-action="change-pin">Change PIN</button>
          <button class="secondary-btn" type="button" data-admin-action="lock">Lock</button>
        </div>
      </div>

      <div class="admin-section">
        <div class="admin-section-head">
          <h4>Menu Management</h4>
          <button class="secondary-btn" type="button" data-admin-action="import-menu">Import from Google Sheet</button>
        </div>
        <div class="admin-edit-list">
          ${state.menuItems.length
    ? state.menuItems.map(menuRowHtml).join("")
    : "<p class=\"admin-empty-note\">No Firestore menu items yet. Import from sheet or add one below.</p>"}
        </div>
        <form class="admin-add-form" id="adminAddMenuForm">
          <input type="text" name="category" placeholder="Category" required maxlength="40">
          <input type="text" name="name" placeholder="Item name" required maxlength="80">
          <input type="number" name="price" placeholder="Price" min="0" step="1" required>
          <button class="primary-btn" type="submit">Add Item</button>
        </form>
      </div>

      <div class="admin-section">
        <h4>Private Sitting Management</h4>
        <div class="admin-edit-list">
          ${getPrivateSittings().map(sittingRowHtml).join("")}
        </div>
        <form class="admin-add-form" id="adminAddSittingForm">
          <input type="text" name="id" placeholder="Sitting ID (e.g. PS 11)" required maxlength="12">
          <input type="number" name="ratePerHour" placeholder="Rate/hr" min="0" step="10" required>
          <select name="theme">
            ${SITTING_THEMES.map((theme) => `<option value="${theme}">${theme}</option>`).join("")}
          </select>
          <label class="admin-checkbox">
            <input type="checkbox" name="wide">
            <span>Wide card</span>
          </label>
          <button class="primary-btn" type="submit">Add Sitting</button>
        </form>
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
    const target = event.target.closest("[data-admin-action],[data-menu-save],[data-menu-delete],[data-sitting-save],[data-sitting-delete]");
    if (!target) return;

    const action = target.dataset.adminAction;
    if (action === "unlock") {
      if (!state.securityConfig?.pinHash) openPinModal("set");
      else openPinModal("unlock");
      return;
    }
    if (action === "change-pin") {
      openPinModal("change");
      return;
    }
    if (action === "lock") {
      lockAdminSettings();
      showToast("Admin settings locked");
      renderAdminSettings(container);
      return;
    }
    if (action === "import-menu") {
      if (!window.confirm("Import menu from Google Sheet into Firestore? This overwrites Firestore menu items.")) return;
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
          ratePerHour: form.ratePerHour.value,
          theme: form.theme.value,
          wide: form.wide.checked
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
