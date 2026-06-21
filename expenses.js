import { auth, escapeHtml, formatCurrency, getTodayKey, showToast } from "./firebase.js";
import { fetchExpensesForDate, isExpenseSyncConfigured, saveExpense } from "./expense-sync.js";

const elements = {
  form: document.querySelector("#expenseForm"),
  description: document.querySelector("#expenseDescription"),
  amount: document.querySelector("#expenseAmount"),
  receipt: document.querySelector("#expenseReceipt"),
  notes: document.querySelector("#expenseNotes"),
  submitBtn: document.querySelector("#expenseSubmitBtn"),
  list: document.querySelector("#expenseList"),
  syncHint: document.querySelector("#expenseSyncHint")
};

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Could not read receipt file"));
    reader.readAsDataURL(file);
  });
}

function renderExpenseList(expenses = []) {
  if (!elements.list) return;
  if (!expenses.length) {
    elements.list.innerHTML = `<p class="expense-empty">No expenses recorded today.</p>`;
    return;
  }

  elements.list.innerHTML = expenses.map((row) => {
    const receiptLink = row.receiptUrl
      ? `<a class="expense-receipt-link" href="${escapeHtml(row.receiptUrl)}" target="_blank" rel="noopener noreferrer">View Receipt</a>`
      : "";
    return `
      <article class="expense-row">
        <div class="expense-row-main">
          <strong>${escapeHtml(row.description || "Expense")}</strong>
          <span class="expense-row-amount">${formatCurrency(row.amount || 0)}</span>
        </div>
        <div class="expense-row-meta">
          <span>${escapeHtml(row.time || "")}</span>
          ${row.addedBy ? `<span>${escapeHtml(row.addedBy)}</span>` : ""}
          ${receiptLink}
        </div>
        ${row.notes ? `<p class="expense-row-notes">${escapeHtml(row.notes)}</p>` : ""}
      </article>
    `;
  }).join("");
}

export async function loadTodayExpenses() {
  if (!elements.list) return;
  if (!isExpenseSyncConfigured()) {
    elements.list.innerHTML = `<p class="expense-empty">Configure Apps Script URL to sync expenses.</p>`;
    return;
  }

  elements.list.innerHTML = `<p class="expense-empty">Loading today&apos;s expenses...</p>`;
  const result = await fetchExpensesForDate(getTodayKey());
  if (!result.ok) {
    elements.list.innerHTML = `<p class="expense-empty">Could not load expenses.</p>`;
    return;
  }
  renderExpenseList(result.expenses || []);
}

async function handleExpenseSubmit(event) {
  event.preventDefault();
  if (!elements.form) return;

  const description = elements.description?.value?.trim() || "";
  const amount = Number(elements.amount?.value || 0);
  const notes = elements.notes?.value?.trim() || "";

  if (description.length < 2) {
    showToast("Enter expense description");
    elements.description?.focus();
    return;
  }
  if (!amount || amount <= 0) {
    showToast("Enter a valid amount");
    elements.amount?.focus();
    return;
  }
  if (!isExpenseSyncConfigured()) {
    showToast("Apps Script URL not configured");
    return;
  }

  if (elements.submitBtn) elements.submitBtn.disabled = true;

  try {
    let receiptBase64 = "";
    let receiptFileName = "";
    let receiptMimeType = "";
    const file = elements.receipt?.files?.[0];
    if (file) {
      if (file.size > 8 * 1024 * 1024) {
        throw new Error("Receipt must be under 8 MB");
      }
      receiptBase64 = await readFileAsBase64(file);
      receiptFileName = file.name || "receipt.jpg";
      receiptMimeType = file.type || "application/octet-stream";
    }

    const result = await saveExpense({
      description,
      amount,
      notes,
      receiptBase64,
      receiptFileName,
      receiptMimeType,
      addedBy: auth.currentUser?.email || "staff"
    });

    if (!result?.ok) {
      throw new Error(result?.error || "Could not save expense");
    }

    elements.form.reset();
    showToast("Expense saved");
    await loadTodayExpenses();
  } catch (error) {
    showToast(error?.message || "Could not save expense");
  } finally {
    if (elements.submitBtn) elements.submitBtn.disabled = false;
  }
}

function bindExpenseUi() {
  elements.form?.addEventListener("submit", handleExpenseSubmit);
  window.addEventListener("expenses-tab-opened", () => {
    void loadTodayExpenses();
  });
}

export function initExpenses() {
  if (!elements.form) return;
  if (elements.syncHint) {
    elements.syncHint.hidden = isExpenseSyncConfigured();
  }
  bindExpenseUi();
}
