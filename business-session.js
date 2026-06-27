import {
  getBusinessSessionState,
  getTodayKey,
  openBusinessSession,
  showToast,
  subscribeBusinessSession,
  toDate
} from "./firebase.js";

const elements = {
  status: null,
  modal: null,
  yes: null,
  no: null,
  error: null
};

let pendingPromptResolve = null;
let promptBusy = false;

function formatSessionClock(value) {
  const date = toDate(value);
  if (!date) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function renderSessionStatus(state) {
  if (!elements.status) return;

  if (state.status === "open" && state.businessDateKey) {
    const clockIn = formatSessionClock(state.clockInAt);
    elements.status.textContent = clockIn
      ? `Open · ${state.businessDateKey} · ${clockIn}`
      : `Open · ${state.businessDateKey}`;
    elements.status.dataset.state = "open";
    elements.status.hidden = false;
    return;
  }

  elements.status.textContent = "Day closed";
  elements.status.dataset.state = "closed";
  elements.status.hidden = false;
}

function setPromptError(message = "") {
  if (!elements.error) return;
  if (message) {
    elements.error.textContent = message;
    elements.error.hidden = false;
    return;
  }
  elements.error.textContent = "";
  elements.error.hidden = true;
}

function setPromptBusy(busy) {
  promptBusy = busy;
  if (elements.yes) {
    elements.yes.disabled = busy;
    elements.yes.textContent = busy ? "Please wait..." : "Yes, open session";
  }
  if (elements.no) elements.no.disabled = busy;
}

function closeNewSessionModal() {
  if (promptBusy) return;
  setPromptError();
  if (elements.modal) elements.modal.hidden = true;
}

function finishPrompt(result) {
  const resolve = pendingPromptResolve;
  pendingPromptResolve = null;
  closeNewSessionModal();
  if (resolve) resolve(result);
}

function openNewSessionModal() {
  setPromptError();
  setPromptBusy(false);
  if (elements.modal) elements.modal.hidden = false;
}

async function confirmNewSession() {
  if (promptBusy) return;
  setPromptError();
  setPromptBusy(true);
  try {
    const { businessDateKey } = await openBusinessSession(getTodayKey());
    showToast(`Session opened for ${businessDateKey}`);
    finishPrompt(true);
  } catch (error) {
    console.error("Open session failed:", error);
    const message = error?.message || "Could not open session. Please try again.";
    setPromptError(message);
    showToast(message);
  } finally {
    setPromptBusy(false);
  }
}

function cancelNewSession() {
  if (promptBusy) return;
  finishPrompt(false);
}

export async function ensureOpenSessionOrPrompt() {
  const state = await getBusinessSessionState();
  if (state.status === "open") return true;

  return new Promise((resolve) => {
    pendingPromptResolve = resolve;
    openNewSessionModal();
  });
}

export function initBusinessSession(root = document) {
  elements.status = root.querySelector("#businessSessionStatus");
  elements.modal = root.querySelector("#newSessionModal");
  elements.yes = root.querySelector("#newSessionYes");
  elements.no = root.querySelector("#newSessionNo");
  elements.error = root.querySelector("#newSessionError");

  elements.yes?.addEventListener("click", confirmNewSession);
  elements.no?.addEventListener("click", cancelNewSession);
  elements.modal?.addEventListener("click", (event) => {
    if (event.target === elements.modal) cancelNewSession();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (elements.modal && !elements.modal.hidden) cancelNewSession();
  });

  subscribeBusinessSession(renderSessionStatus, (error) => {
    console.warn("[session] status listener failed", error);
  });
}
