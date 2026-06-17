import { CONFIG, formatReceiptTableLine, toDate } from "./firebase.js";

const RECEIPT_WIDTH = 400;
const PADDING = 20;
const JPEG_QUALITY = 0.92;

let logoImage = null;
let logoLoadPromise = null;

function formatReceiptAmount(amount) {
  return `Rs. ${Number(amount || 0).toLocaleString("en-IN")}`;
}

function wrapText(ctx, text, maxWidth) {
  const words = String(text).split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

export function preloadReceiptLogo() {
  if (logoImage?.complete && logoImage.naturalWidth) return Promise.resolve(logoImage);
  if (logoLoadPromise) return logoLoadPromise;
  logoLoadPromise = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      logoImage = img;
      resolve(img);
    };
    img.onerror = () => reject(new Error("Could not load receipt logo"));
    img.src = CONFIG.RECEIPT_LOGO_SRC;
  });
  return logoLoadPromise;
}

function measureReceiptHeight(receipt, ctx) {
  let y = PADDING;
  const contentWidth = RECEIPT_WIDTH - PADDING * 2;

  if (logoImage?.naturalWidth) {
    const logoW = Math.min(160, contentWidth);
    const logoH = (logoImage.naturalHeight / logoImage.naturalWidth) * logoW;
    y += logoH + 12;
  }
  y += 26 + (4 * 16) + 20 + 18;
  for (const item of receipt.items || []) {
    const nameLines = wrapText(ctx, item.name, contentWidth - 100);
    y += nameLines.length * 14 + 18;
  }
  y += 20 + 80 + 50;
  return y + PADDING;
}

export async function renderReceiptToCanvas(receipt) {
  await preloadReceiptLogo();

  const measureCanvas = document.createElement("canvas");
  measureCanvas.width = RECEIPT_WIDTH;
  const measureCtx = measureCanvas.getContext("2d");
  measureCtx.font = "12px monospace";
  const height = measureReceiptHeight(receipt, measureCtx);

  const canvas = document.createElement("canvas");
  canvas.width = RECEIPT_WIDTH;
  canvas.height = Math.max(height, 240);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000000";
  ctx.textBaseline = "top";

  let y = PADDING;
  const contentWidth = RECEIPT_WIDTH - PADDING * 2;
  const centerX = RECEIPT_WIDTH / 2;

  if (logoImage?.naturalWidth) {
    const logoW = Math.min(160, contentWidth);
    const logoH = (logoImage.naturalHeight / logoImage.naturalWidth) * logoW;
    ctx.drawImage(logoImage, centerX - logoW / 2, y, logoW, logoH);
    y += logoH + 12;
  }

  const cafeName = receipt.cafeName || CONFIG.RESTAURANT_NAME;
  ctx.font = "bold 18px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(cafeName, centerX, y);
  y += 26;

  ctx.font = "13px monospace";
  ctx.textAlign = "left";
  const generated = toDate(receipt.generatedAt) || new Date();
  const orderShort = String(receipt.orderId || "").slice(0, 8).toUpperCase();
  const metaLines = [
    `Order: ${orderShort}`,
    `Receipt: ${receipt.receiptNumber || ""}`,
    generated.toLocaleString(),
    formatReceiptTableLine(receipt.tableId)
  ];
  metaLines.forEach((line) => {
    ctx.fillText(line, PADDING, y);
    y += 16;
  });

  y += 8;
  ctx.strokeStyle = "#000";
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(PADDING, y);
  ctx.lineTo(RECEIPT_WIDTH - PADDING, y);
  ctx.stroke();
  ctx.setLineDash([]);
  y += 12;

  ctx.font = "bold 12px monospace";
  ctx.fillText("Item", PADDING, y);
  ctx.textAlign = "right";
  ctx.fillText("Total", RECEIPT_WIDTH - PADDING, y);
  ctx.textAlign = "left";
  y += 18;

  ctx.font = "12px monospace";
  for (const item of receipt.items || []) {
    const qty = Number(item.qty || 0);
    const price = Number(item.price || 0);
    const lineTotal = price * qty;
    const nameLines = wrapText(ctx, item.name, contentWidth - 100);
    nameLines.forEach((nameLine, index) => {
      ctx.fillText(nameLine, PADDING, y + index * 14);
    });
    const nameHeight = nameLines.length * 14;
    ctx.textAlign = "right";
    ctx.fillText(`${qty} x ${formatReceiptAmount(price)}`, RECEIPT_WIDTH - PADDING, y);
    ctx.fillText(formatReceiptAmount(lineTotal), RECEIPT_WIDTH - PADDING, y + nameHeight + 2);
    ctx.textAlign = "left";
    y += nameHeight + 18;
  }

  y += 4;
  ctx.beginPath();
  ctx.moveTo(PADDING, y);
  ctx.lineTo(RECEIPT_WIDTH - PADDING, y);
  ctx.stroke();
  y += 12;

  const subtotal = Number(receipt.subtotal ?? receipt.grossTotal ?? receipt.total ?? 0);
  const discountAmount = Number(receipt.discountAmount || 0);
  const tax = Number(receipt.tax || 0);
  const grandTotal = Number(receipt.total ?? subtotal + tax - discountAmount);
  const totalRows = [
    ["Subtotal", formatReceiptAmount(subtotal)],
    ...(discountAmount > 0 ? [["Discount", `-${formatReceiptAmount(discountAmount)}`]] : []),
    ...(tax > 0 ? [["Tax", formatReceiptAmount(tax)]] : []),
    ["Grand Total", formatReceiptAmount(grandTotal)]
  ];

  for (const [label, value] of totalRows) {
    const isGrand = label === "Grand Total";
    ctx.font = isGrand ? "bold 14px monospace" : "13px monospace";
    ctx.fillText(label, PADDING, y);
    ctx.textAlign = "right";
    ctx.fillText(value, RECEIPT_WIDTH - PADDING, y);
    ctx.textAlign = "left";
    y += isGrand ? 20 : 16;
  }

  y += 4;
  ctx.font = "12px monospace";
  ctx.fillText(`Payment: ${receipt.paymentMethod || ""}`, PADDING, y);
  y += 16;
  ctx.fillText(`Status: ${receipt.paymentStatus || "Verified"}`, PADDING, y);
  y += 20;

  ctx.beginPath();
  ctx.moveTo(PADDING, y);
  ctx.lineTo(RECEIPT_WIDTH - PADDING, y);
  ctx.stroke();
  y += 14;

  ctx.font = "bold 14px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Thank You", centerX, y);
  y += 18;
  ctx.fillText("Visit Again", centerX, y);

  return canvas;
}

export async function receiptToJpegBlob(receipt, quality = JPEG_QUALITY) {
  const canvas = await renderReceiptToCanvas(receipt);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not create receipt image"));
    }, "image/jpeg", quality);
  });
}

export async function receiptToJpegDataUrl(receipt, quality = JPEG_QUALITY) {
  const canvas = await renderReceiptToCanvas(receipt);
  return canvas.toDataURL("image/jpeg", quality);
}
