import {
  CONFIG,
  buildReceiptFromOrder,
  buildWhatsAppDirectUrl,
  fetchReceipt,
  normalizeIndianMobile,
  showToast,
  toWhatsAppPhone
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

async function saveReceiptToDevice(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function isIOS() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function isMobile() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

async function copyReceiptImage(blob) {
  if (!window.ClipboardItem) return false;
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/jpeg": blob })]);
    return true;
  } catch {
    return false;
  }
}

function openWhatsAppChat(phone, text = "") {
  const waPhone = toWhatsAppPhone(phone);
  if (!waPhone) return false;

  const webUrl = buildWhatsAppDirectUrl(phone, text);
  const appUrl = `whatsapp://send?phone=${waPhone}${text ? `&text=${encodeURIComponent(text)}` : ""}`;

  if (isMobile()) {
    window.location.href = appUrl;
    window.setTimeout(() => {
      if (webUrl) window.location.href = webUrl;
    }, 700);
    return true;
  }

  if (webUrl) {
    window.location.href = webUrl;
    return true;
  }
  return false;
}

async function shareReceiptJpeg(receipt, mobile) {
  const phone = normalizeIndianMobile(mobile);
  if (!phone) {
    showToast("Enter valid 10-digit mobile number");
    return;
  }

  const blob = await receiptToJpegBlob(receipt);
  const fileName = `Cafe-D-Dream-${receipt.receiptNumber || "receipt"}.jpg`;
  const file = new File([blob], fileName, { type: "image/jpeg" });
  const shareText = "Cafe D Dream Receipt";

  closeShareReceiptModal();

  if (isIOS() && navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: shareText,
        text: shareText
      });
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
      console.warn("Share failed:", error);
    }
  }

  const copied = await copyReceiptImage(blob);
  if (!copied) {
    await saveReceiptToDevice(blob, fileName);
  }

  openWhatsAppChat(phone, copied ? "" : shareText);

  if (copied) {
    showToast("WhatsApp opened. Paste the receipt image and tap Send.");
  } else {
    showToast("WhatsApp opened. Tap attach and pick the receipt image.");
  }
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
