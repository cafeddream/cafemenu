import { auth, showToast } from "./firebase.js";
import { ensureOpenSessionOrPrompt } from "./business-session.js";
import { isExpenseSyncConfigured, saveExpense } from "./expense-sync.js";

const SUBMIT_LABEL = "Submit Expense";

const elements = {
  form: document.querySelector("#expenseForm"),
  description: document.querySelector("#expenseDescription"),
  amount: document.querySelector("#expenseAmount"),
  receipt: document.querySelector("#expenseReceipt"),
  notes: document.querySelector("#expenseNotes"),
  submitBtn: document.querySelector("#expenseSubmitBtn"),
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

function setSubmitBusy(busy) {
  if (!elements.submitBtn) return;
  if (busy) {
    elements.submitBtn.disabled = true;
    elements.submitBtn.textContent = "Saving...";
    return;
  }
  elements.submitBtn.disabled = false;
  elements.submitBtn.textContent = SUBMIT_LABEL;
}

function allowUiPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

async function handleExpenseSubmit(event) {
  event.preventDefault();
  if (!elements.form) return;
  if (!(await ensureOpenSessionOrPrompt())) return;

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

  setSubmitBusy(true);
  await allowUiPaint();

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
    }

    const result = await saveExpense({
      description,
      amount,
      notes,
      receiptBase64,
      receiptFileName: file ? (file.name || "receipt.jpg") : "",
      receiptMimeType: file ? (file.type || "application/octet-stream") : "",
      addedBy: auth.currentUser?.email || "staff"
    });

    if (!result?.ok) {
      throw new Error(result?.error || "Could not save expense");
    }

    elements.form.reset();
    showToast("Expense saved");
    elements.description?.focus();
  } catch (error) {
    showToast(error?.message || "Could not save expense");
  } finally {
    setSubmitBusy(false);
  }
}

function bindExpenseUi() {
  elements.form?.addEventListener("submit", handleExpenseSubmit);
}

export function initExpenses() {
  if (!elements.form) return;
  if (elements.syncHint) {
    elements.syncHint.hidden = isExpenseSyncConfigured();
  }
  bindExpenseUi();
}
