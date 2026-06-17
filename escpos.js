import {
  CONFIG,
  formatReceiptTableLine,
  toDate
} from "./firebase.js";

const ESC = 0x1b;
const GS = 0x1d;

function bytes(...values) {
  return Uint8Array.from(values);
}

function encodeText(text = "") {
  return new TextEncoder().encode(String(text));
}

function concatChunks(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function line(text = "") {
  return concatChunks([encodeText(text), bytes(0x0d, 0x0a)]);
}

function init() {
  return bytes(ESC, 0x40);
}

function align(mode = "left") {
  const n = mode === "center" ? 1 : mode === "right" ? 2 : 0;
  return bytes(ESC, 0x61, n);
}

function bold(on = true) {
  return bytes(ESC, 0x45, on ? 1 : 0);
}

function feedAndCut(lines = 4) {
  return bytes(GS, 0x56, 0x42, Math.max(0, Math.min(255, lines)));
}

function formatEscPosCurrency(amount) {
  const value = Number(amount || 0).toLocaleString("en-IN");
  return `Rs ${value}`;
}

export function buildRawAsciiTest() {
  return encodeText("TEST\r\n\r\n\r\n");
}

export function buildTestPrintEscPos(options = {}) {
  const title = options.title || CONFIG.RESTAURANT_NAME;
  const message = options.message || "Printer Connected Successfully";
  const when = options.timestamp instanceof Date ? options.timestamp : new Date();
  const timestamp = when.toLocaleString();

  return concatChunks([
    init(),
    align("center"),
    bold(true),
    line(title),
    bold(false),
    line(message),
    line(timestamp),
    feedAndCut(4)
  ]);
}

export function buildReceiptEscPos(receipt) {
  if (!receipt) return init();

  const generated = toDate(receipt.generatedAt) || new Date();
  const tableLine = formatReceiptTableLine(receipt.tableId);
  const orderShort = String(receipt.orderId || "").slice(0, 8).toUpperCase();
  const discountAmount = Number(receipt.discountAmount || 0);
  const subtotal = Number(receipt.subtotal ?? receipt.grossTotal ?? receipt.total ?? 0);
  const tax = Number(receipt.tax || 0);
  const grandTotal = Number(receipt.total ?? subtotal + tax - discountAmount);
  const cafeName = receipt.cafeName || CONFIG.RESTAURANT_NAME;

  const chunks = [
    init(),
    align("center"),
    bold(true),
    line(cafeName),
    bold(false),
    align("left"),
    line(`Order: ${orderShort}`),
    line(`Receipt: ${receipt.receiptNumber || ""}`),
    line(generated.toLocaleString()),
    line(tableLine),
    line("--------------------------------")
  ];

  for (const item of receipt.items || []) {
    const qty = Number(item.qty || 0);
    const price = Number(item.price || 0);
    const lineTotal = price * qty;
    const name = String(item.name || "Item").slice(0, 20);
    chunks.push(line(name));
    chunks.push(
      line(
        `  ${qty} x ${formatEscPosCurrency(price)}  ${formatEscPosCurrency(lineTotal)}`
      )
    );
  }

  chunks.push(line("--------------------------------"));
  chunks.push(line(`Subtotal    ${formatEscPosCurrency(subtotal)}`));
  if (discountAmount > 0) {
    chunks.push(line(`Discount   -${formatEscPosCurrency(discountAmount)}`));
  }
  if (tax > 0) {
    chunks.push(line(`Tax         ${formatEscPosCurrency(tax)}`));
  }
  chunks.push(bold(true));
  chunks.push(line(`GRAND TOTAL ${formatEscPosCurrency(grandTotal)}`));
  chunks.push(bold(false));
  chunks.push(line(`Payment: ${receipt.paymentMethod || ""}`));
  chunks.push(line(`Status: ${receipt.paymentStatus || "Verified"}`));
  chunks.push(line("--------------------------------"));
  chunks.push(align("center"));
  chunks.push(bold(true));
  chunks.push(line("Thank You"));
  chunks.push(line("Visit Again"));
  chunks.push(bold(false));
  chunks.push(feedAndCut(4));

  return concatChunks(chunks);
}
