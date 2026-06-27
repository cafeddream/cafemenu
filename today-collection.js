import { formatCurrency, getTodayKey, listenToTodaySummary } from "./firebase.js";
import {
  fetchExpensesForDate,
  isExpenseSyncConfigured,
  sumExpenseTotal
} from "./expense-sync.js";

const elements = {
  modal: null,
  date: null,
  cash: null,
  online: null,
  expenses: null,
  netCash: null,
  hint: null,
  closeBtn: null
};

let summaryUnsub = null;
let expenseTotal = 0;
let expenseHint = "";

function renderTodayCollection(summary = {}) {
  const cash = Number(summary.cash || 0);
  const online = Number(summary.online || 0);
  const netCash = Math.max(0, cash - expenseTotal);

  if (elements.cash) elements.cash.textContent = formatCurrency(cash);
  if (elements.online) elements.online.textContent = formatCurrency(online);
  if (elements.expenses) elements.expenses.textContent = formatCurrency(expenseTotal);
  if (elements.netCash) elements.netCash.textContent = formatCurrency(netCash);

  if (elements.hint) {
    if (expenseHint) {
      elements.hint.textContent = expenseHint;
      elements.hint.hidden = false;
    } else {
      elements.hint.textContent = "";
      elements.hint.hidden = true;
    }
  }
}

function stopSummaryListener() {
  if (summaryUnsub) {
    summaryUnsub();
    summaryUnsub = null;
  }
}

async function loadTodayExpenses() {
  expenseTotal = 0;
  expenseHint = "";

  if (!isExpenseSyncConfigured()) {
    expenseHint = "Expenses unavailable — Apps Script URL not configured.";
    return;
  }

  const result = await fetchExpensesForDate(getTodayKey());
  if (!result.ok) {
    expenseHint = result.error || "Could not load today's expenses.";
    return;
  }

  expenseTotal = sumExpenseTotal(result.expenses || []);
}

export function closeTodayCollectionModal() {
  stopSummaryListener();
  if (elements.modal) elements.modal.hidden = true;
}

export async function openTodayCollectionModal() {
  if (!elements.modal) return;

  if (elements.date) elements.date.textContent = getTodayKey();
  renderTodayCollection({ cash: 0, online: 0 });
  elements.modal.hidden = false;

  await loadTodayExpenses();
  renderTodayCollection({ cash: 0, online: 0 });

  stopSummaryListener();
  summaryUnsub = listenToTodaySummary(
    (summary) => renderTodayCollection(summary),
    (error) => console.warn("[collection] Summary listener failed", error)
  );
}

export function initTodayCollection(root = document) {
  elements.modal = root.querySelector("#todayCollectionModal");
  elements.date = root.querySelector("#todayCollectionDate");
  elements.cash = root.querySelector("#todayCollectionCash");
  elements.online = root.querySelector("#todayCollectionOnline");
  elements.expenses = root.querySelector("#todayCollectionExpenses");
  elements.netCash = root.querySelector("#todayCollectionNetCash");
  elements.hint = root.querySelector("#todayCollectionHint");
  elements.closeBtn = root.querySelector("#todayCollectionClose");

  elements.closeBtn?.addEventListener("click", closeTodayCollectionModal);
  elements.modal?.addEventListener("click", (event) => {
    if (event.target === elements.modal) closeTodayCollectionModal();
  });
}

export function isTodayCollectionModalOpen() {
  return elements.modal && !elements.modal.hidden;
}
