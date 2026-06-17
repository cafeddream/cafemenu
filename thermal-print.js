// 58mm thermal receipt printing for manager/counter.
// ESC/POS via Web Serial when a Bluetooth/USB printer is connected.
// HTML iframe print fallback when no serial printer is connected.

import {
  CONFIG,
  buildReceiptDocumentHtml,
  buildReceiptFromOrder,
  fetchReceipt,
  showToast,
  toDate
} from "./firebase.js";
import { buildReceiptEscPos, buildRawAsciiTest, buildTestPrintEscPos } from "./escpos.js";
import {
  ensurePrinterConnected,
  isPrinterConnected,
  isSerialSupported,
  writeEscPos
} from "./printer-serial.js";

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

function printThermalReceiptHtml(receipt) {
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

async function printEscPosReceipt(receipt) {
  const normalized = normalizeReceiptForPrint(receipt);
  if (!normalized) return false;
  const bytes = buildReceiptEscPos(normalized);
  await writeEscPos(bytes);
  return true;
}

function withTimeout(promise, ms, message = "Print timed out") {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export async function printThermalReceipt(receipt, options = {}) {
  if (!CONFIG.AUTO_PRINT_RECEIPTS) return false;
  const printerKey = options.printer || "customer";
  const printer = PRINTERS[printerKey];
  if (!printer?.enabled) return false;

  if (isSerialSupported()) {
    let ready = isPrinterConnected();
    if (!ready) {
      ready = await ensurePrinterConnected();
    }
    if (ready) {
      try {
        return await withTimeout(printEscPosReceipt(receipt), 10000);
      } catch (error) {
        console.warn("ESC/POS print failed:", error);
        return false;
      }
    }
    console.warn("Thermal printer not connected. Connect in Settings before paying.");
    return false;
  }

  if (options.allowHtmlFallback) {
    return printThermalReceiptHtml(receipt);
  }
  return false;
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

export async function printReceiptFromOrder(order, paymentMethod = "cash") {
  const receipt = buildReceiptFromOrder(order, paymentMethod);
  return printThermalReceipt(receipt);
}

export async function autoPrintAfterPayment(orderId, orderSnapshot, paymentMethod) {
  if (!CONFIG.AUTO_PRINT_RECEIPTS) return;

  try {
    let printed = false;
    if (orderSnapshot?.exists?.()) {
      const order = { ...orderSnapshot.data(), orderId: orderSnapshot.data()?.orderId || orderId };
      printed = await printReceiptFromOrder(order, paymentMethod);
    } else if (orderSnapshot && typeof orderSnapshot === "object") {
      printed = await printReceiptFromOrder(orderSnapshot, paymentMethod);
    } else {
      printed = await printReceiptForOrderId(orderId);
    }
    if (!printed && isSerialSupported()) {
      showToast("Receipt not printed. Connect printer in Settings.");
    }
  } catch (error) {
    console.warn("Receipt print failed:", error);
    if (isSerialSupported()) {
      showToast("Receipt print failed. Check printer connection.");
    }
  }
}

export async function printTestReceipt() {
  await writeEscPos(buildRawAsciiTest());
  const bytes = buildTestPrintEscPos({
    title: CONFIG.RESTAURANT_NAME,
    message: "Printer Connected Successfully",
    timestamp: new Date()
  });
  await writeEscPos(bytes);
  return true;
}
