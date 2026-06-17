import {
  CONFIG,
  buildReceiptFromOrder,
  buildWhatsAppDirectUrl,
  fetchReceipt,
  normalizeIndianMobile,
  showToast
} from "./firebase.js";
import { receiptToJpegBlob, receiptToJpegDataUrl } from "./receipt-image.js";

const elements = {
  modal: document.querySelector("#shareReceiptModal"),
  preview: document.querySelector("#shareReceiptPreview"),
  mobile: document.querySelector("#shareReceiptMobile"),
  confirm: document.querySelector("#shareReceiptConfirm"),
  close: document.querySelector("#shareReceiptClose")
};

let pendingReceipt = null;

async function updatePreview(receipt) {
  if (!elements.preview) return;
  try {
    elements.preview.src = await receiptToJpegDataUrl(receipt);
    elements.preview.hidden = false;
  } catch {
    elements.preview.hidden = true;
  }
}

export function openShareReceiptModal(receipt, options = {}) {
  if (!receipt || !elements.modal) return;
  pendingReceipt = receipt;
  if (elements.mobile) {
    elements.mobile.value = normalizeIndianMobile(options.defaultMobile || "") || "";
  }
  updatePreview(receipt);
  elements.modal.hidden = false;
}

function closeShareReceiptModal() {
  if (elements.modal) elements.modal.hidden = true;
  pendingReceipt = null;
  if (elements.preview) {
    elements.preview.removeAttribute("src");
    elements.preview.hidden = true;
  }
}

async function downloadReceiptJpeg(blob, receipt) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `Cafe-D-Dream-${receipt.receiptNumber || "receipt"}.jpg`;
  link.click();
  URL.revokeObjectURL(url);
}

async function shareReceiptJpeg(receipt, mobile) {
  const phone = normalizeIndianMobile(mobile);
  if (!phone) {
    showToast("Enter valid 10-digit mobile number");
    return;
  }

  const blob = await receiptToJpegBlob(receipt);
  const file = new File([blob], "Cafe-D-Dream-Receipt.jpg", { type: "image/jpeg" });
  const waUrl = buildWhatsAppDirectUrl(phone, "Cafe D Dream Receipt");

  let shared = false;
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: "Cafe D Dream Receipt",
        text: "Cafe D Dream Receipt"
      });
      shared = true;
    } catch (error) {
      if (error?.name === "AbortError") return;
      console.warn("Share failed:", error);
    }
  }

  if (!shared) {
    try {
      if (window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({ "image/jpeg": blob })]);
        showToast("Receipt copied. Paste in WhatsApp chat.");
      } else {
        await downloadReceiptJpeg(blob, receipt);
        showToast("Receipt saved. Attach in WhatsApp chat.");
      }
    } catch {
      await downloadReceiptJpeg(blob, receipt);
      showToast("Receipt downloaded. Attach in WhatsApp.");
    }
  }

  if (waUrl) {
    window.open(waUrl, "_blank", "noopener,noreferrer");
  }

  closeShareReceiptModal();
}

export async function shareReceiptForOrder(order, paymentMethod = "cash") {
  const receipt = buildReceiptFromOrder(order, paymentMethod);
  openShareReceiptModal(receipt, {
    defaultMobile: order?.customerMobile || order?.customerMobileNormalized || ""
  });
}

export async function shareReceiptForOrderId(orderId, defaultMobile = "") {
  let receipt = await fetchReceipt(orderId);
  if (!receipt) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    receipt = await fetchReceipt(orderId);
  }
  if (!receipt) {
    showToast("Receipt not available yet");
    return;
  }
  openShareReceiptModal(receipt, { defaultMobile });
}

export async function shareReceiptAfterPayment(orderId, orderSnapshot, paymentMethod) {
  if (!CONFIG.AUTO_SHARE_RECEIPTS) return;

  try {
    if (orderSnapshot?.exists?.()) {
      const order = { ...orderSnapshot.data(), orderId: orderSnapshot.data()?.orderId || orderId };
      await shareReceiptForOrder(order, paymentMethod);
      return;
    }
    if (orderSnapshot && typeof orderSnapshot === "object") {
      await shareReceiptForOrder(orderSnapshot, paymentMethod);
      return;
    }
    await shareReceiptForOrderId(orderId);
  } catch (error) {
    console.warn("Share receipt failed:", error);
    showToast("Could not open share receipt");
  }
}

function bindShareReceiptUi() {
  elements.confirm?.addEventListener("click", async () => {
    if (!pendingReceipt) return;
    elements.confirm.disabled = true;
    try {
      await shareReceiptJpeg(pendingReceipt, elements.mobile?.value || "");
    } catch (error) {
      showToast(error?.message || "Could not share receipt");
    } finally {
      elements.confirm.disabled = false;
    }
  });

  elements.close?.addEventListener("click", closeShareReceiptModal);
  elements.modal?.addEventListener("click", (event) => {
    if (event.target === elements.modal) closeShareReceiptModal();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bindShareReceiptUi);
} else {
  bindShareReceiptUi();
}
