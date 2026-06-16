// 58mm thermal receipt printing for manager/counter.
// Silent printing (no dialog) requires Chrome --kiosk-printing and a default thermal printer.
// Future: route PRINTERS.kitchen via QZ Tray / WebUSB ESC/POS bridge.

import {
  CONFIG,
  buildReceiptDocumentHtml,
  buildReceiptFromOrder,
  fetchReceipt,
  toDate
} from "./firebase.js";

export const PRINTERS = {
  customer: { id: "customer", label: "Customer Receipt", enabled: true },
  kitchen: { id: "kitchen", label: "Kitchen Printer", enabled: false }
};

function normalizeReceiptForPrint(receipt) {
  if (!receipt) return null;
  const generatedAt = toDate(receipt.generatedAt) || new Date();
  const subtotal = Number(receipt.subtotal ?? receipt.total ?? 0);
  const tax = Number(receipt.tax || 0);
  const total = Number(receipt.total ?? subtotal + tax);
  return {
    ...receipt,
    generatedAt,
    subtotal,
    tax,
    total
  };
}

export function printThermalReceipt(receipt, options = {}) {
  if (!CONFIG.AUTO_PRINT_RECEIPTS) return false;
  const printerKey = options.printer || "customer";
  const printer = PRINTERS[printerKey];
  if (!printer?.enabled) return false;

  const normalized = normalizeReceiptForPrint(receipt);
  if (!normalized) return false;

  const html = buildReceiptDocumentHtml(normalized);
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(iframe);

  const win = iframe.contentWindow;
  const doc = win?.document;
  if (!doc || !win) {
    iframe.remove();
    return false;
  }

  doc.open();
  doc.write(html);
  doc.close();

  const cleanup = () => {
    if (iframe.parentNode) iframe.remove();
  };

  win.addEventListener("afterprint", cleanup, { once: true });
  setTimeout(cleanup, 12000);

  win.focus();
  win.print();
  return true;
}

export async function printReceiptForOrderId(orderId) {
  if (!orderId || !CONFIG.AUTO_PRINT_RECEIPTS) return false;

  let receipt = await fetchReceipt(orderId);
  if (!receipt) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    receipt = await fetchReceipt(orderId);
  }
  if (!receipt) return false;

  return printThermalReceipt(receipt);
}

export function printReceiptFromOrder(order, paymentMethod = "cash") {
  const receipt = buildReceiptFromOrder(order, paymentMethod);
  return printThermalReceipt(receipt);
}

export async function autoPrintAfterPayment(orderId, orderSnapshot, paymentMethod) {
  if (!CONFIG.AUTO_PRINT_RECEIPTS) return;

  try {
    if (orderSnapshot?.exists?.()) {
      const order = { ...orderSnapshot.data(), orderId: orderSnapshot.data()?.orderId || orderId };
      printReceiptFromOrder(order, paymentMethod);
      return;
    }
    if (orderSnapshot && typeof orderSnapshot === "object") {
      printReceiptFromOrder(orderSnapshot, paymentMethod);
      return;
    }
    await printReceiptForOrderId(orderId);
  } catch (error) {
    console.warn("Receipt print failed:", error);
  }
}
