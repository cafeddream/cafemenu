import { getTodayKey } from "./firebase.js";
import { isAppsScriptConfigured, postAppsScript } from "./sitting-sync.js";

export function isExpenseSyncConfigured() {
  return isAppsScriptConfigured();
}

export async function saveExpense({
  description,
  amount,
  notes = "",
  receiptBase64 = "",
  receiptFileName = "",
  receiptMimeType = "",
  addedBy = "staff"
}) {
  if (!isExpenseSyncConfigured()) {
    return { ok: false, error: "Apps Script URL not configured" };
  }
  const now = new Date();
  const dateKey = getTodayKey(now);
  const timeLabel = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  return postAppsScript({
    action: "saveExpense",
    description,
    amount: Number(amount || 0),
    notes,
    receiptBase64,
    receiptFileName,
    receiptMimeType,
    addedBy,
    dateKey,
    timeLabel
  }, 120000);
}

export async function fetchExpensesForDate(dateKey) {
  if (!isExpenseSyncConfigured()) {
    return { ok: false, error: "Apps Script URL not configured", expenses: [] };
  }
  try {
    const result = await postAppsScript({
      action: "fetchExpensesForDate",
      dateKey
    }, 60000);
    if (!result?.ok) {
      return { ok: false, error: result?.error || "Fetch failed", expenses: [] };
    }
    return { ok: true, expenses: result.expenses || [] };
  } catch (error) {
    return { ok: false, error: error?.message || "Fetch failed", expenses: [] };
  }
}

export function sumExpenseTotal(expenses = []) {
  return expenses.reduce((sum, row) => sum + Number(row.amount || 0), 0);
}

export async function attachExpensesToReport(report, dateKey) {
  const result = await fetchExpensesForDate(dateKey);
  if (!result.ok) {
    console.warn("[report] Expense fetch failed for", dateKey, result.error);
  }
  const expenseDetails = result.expenses || [];
  const expenseTotal = sumExpenseTotal(expenseDetails);
  report.expenseDetails = expenseDetails;
  report.expenseTotal = expenseTotal;
  report.netAfterExpenses = Number(report.total || 0) - expenseTotal;
  return report;
}
