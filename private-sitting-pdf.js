import { CONFIG, buildCustomerDisplayName, escapeHtml, formatTableDisplayName, toDate } from "./firebase.js";

let jsPdfModule = null;
let pdfLibModule = null;
let logoDataUrl = null;
let logoLoadPromise = null;

export const MIN_PDF_BASE64_LEN = 500;

export function isValidPdfBase64(base64 = "") {
  if (!base64 || base64.length < MIN_PDF_BASE64_LEN) return false;
  try {
    const head = atob(base64.slice(0, 8));
    return head.startsWith("%PDF");
  } catch {
    return false;
  }
}

const MM_TO_PT = 2.834645669;

/** Check-out value position (mm from top-left) — matches drawSessionRecordPage card layout */
const CHECKOUT_STAMP = { xMm: 132, yMm: 61, widthMm: 54, heightMm: 6 };

export function base64ToUint8Array(base64 = "") {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function uint8ArrayToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function getPdfLib() {
  if (!pdfLibModule) {
    pdfLibModule = await withTimeout(
      import("https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm"),
      15000
    );
  }
  return pdfLibModule;
}

export async function stampCheckoutTimeOnPdf(existingPdfBytes, checkOutLabel) {
  const { PDFDocument, rgb } = await getPdfLib();
  const pdfDoc = await PDFDocument.load(existingPdfBytes);
  const page = pdfDoc.getPages()[0];
  const pageH = page.getHeight();
  const x = CHECKOUT_STAMP.xMm * MM_TO_PT;
  const boxH = CHECKOUT_STAMP.heightMm * MM_TO_PT;
  const yTop = CHECKOUT_STAMP.yMm * MM_TO_PT;
  const w = CHECKOUT_STAMP.widthMm * MM_TO_PT;
  const boxY = pageH - yTop - boxH;

  page.drawRectangle({
    x,
    y: boxY,
    width: w,
    height: boxH,
    color: rgb(1, 1, 1),
    borderWidth: 0
  });
  page.drawText(String(checkOutLabel || ""), {
    x,
    y: boxY + boxH * 0.28,
    size: 8,
    color: rgb(0.11, 0.11, 0.11),
    maxWidth: w
  });

  return pdfDoc.save();
}

const PAGE = { left: 14, right: 196, width: 182, bottom: 272, top: 18 };

const C = {
  brand: [255, 107, 53],
  brandDark: [217, 79, 30],
  white: [255, 255, 255],
  ink: [28, 28, 28],
  muted: [110, 110, 110],
  line: [218, 218, 218],
  rowAlt: [255, 250, 247]
};

export function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve, reject) => {
      setTimeout(() => {
        if (fallback !== undefined) resolve(fallback);
        else reject(new Error("Timed out"));
      }, ms);
    })
  ]);
}

export async function getJsPdf() {
  if (!jsPdfModule) {
    const load = import("https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm").then((mod) => {
      jsPdfModule = mod;
      return mod.jsPDF;
    });
    return withTimeout(load, 15000).catch(() => {
      throw new Error("PDF library unavailable");
    });
  }
  return jsPdfModule.jsPDF;
}

export function preloadJsPdf() {
  getJsPdf().catch(() => {});
  preloadPdfLogo().catch(() => {});
}

async function preloadPdfLogo() {
  if (logoDataUrl) return logoDataUrl;
  if (logoLoadPromise) return logoLoadPromise;
  const work = fetch(CONFIG.RECEIPT_LOGO_SRC)
    .then((response) => {
      if (!response.ok) throw new Error("Logo fetch failed");
      return response.blob();
    })
    .then((blob) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        logoDataUrl = reader.result;
        resolve(logoDataUrl);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    }))
    .catch(() => null);
  logoLoadPromise = withTimeout(work, 5000, null);
  return logoLoadPromise;
}

function stripDataUrl(dataUrl = "") {
  const parts = String(dataUrl).split(",");
  return parts.length > 1 ? parts[1] : parts[0];
}

function formatDobLabel(value = "") {
  if (!value) return "-";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" });
}

function setFill(doc, rgb) {
  doc.setFillColor(rgb[0], rgb[1], rgb[2]);
}

function setDraw(doc, rgb) {
  doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
}

function setText(doc, rgb) {
  doc.setTextColor(rgb[0], rgb[1], rgb[2]);
}

export function formatCheckInLabel(checkInAt, checkInLabel = "") {
  if (checkInLabel) return checkInLabel;
  const date = toDate(checkInAt);
  return date ? date.toLocaleString() : new Date().toLocaleString();
}

export function buildSittingPdfFileName(sittingId, sessionId) {
  const sitting = formatTableDisplayName(sittingId).replace(/\s+/g, "");
  const now = new Date();
  const hhmmss = now.toTimeString().slice(0, 8).replace(/:/g, "");
  const shortId = String(sessionId || "").slice(0, 8);
  return `${sitting}_${hhmmss}_${shortId}.pdf`;
}

function drawPdfHeader(doc, subtitle) {
  setFill(doc, C.brand);
  doc.rect(PAGE.left, 10, PAGE.width, 22, "F");

  try {
    if (logoDataUrl) {
      doc.addImage(stripDataUrl(logoDataUrl), "PNG", PAGE.left + 4, 12, 16, 16);
    }
  } catch {
    // Logo optional.
  }

  setText(doc, C.white);
  doc.setFontSize(16);
  doc.setFont(undefined, "bold");
  doc.text(CONFIG.RESTAURANT_NAME, PAGE.left + 24, 19);
  doc.setFontSize(9);
  doc.setFont(undefined, "normal");
  doc.text(subtitle, PAGE.left + 24, 26);

  setText(doc, C.ink);
  return 38;
}

function drawSectionTitle(doc, title, y) {
  setFill(doc, C.brandDark);
  doc.rect(PAGE.left, y - 4, PAGE.width, 7, "F");
  setText(doc, C.white);
  doc.setFontSize(10);
  doc.setFont(undefined, "bold");
  const label = String(title || "Guest").trim() || "Guest";
  doc.text(label, PAGE.left + 3, y);
  setText(doc, C.ink);
  return y + 9;
}

function drawMetaLine(doc, label, value, y) {
  doc.setFontSize(9);
  doc.setFont(undefined, "bold");
  setText(doc, C.muted);
  doc.text(`${label}`, PAGE.left + 2, y);
  doc.setFont(undefined, "normal");
  setText(doc, C.ink);
  doc.text(String(value || "-"), PAGE.left + 28, y);
  return y + 5;
}

function addImageFitBox(doc, dataUrl, x, y, boxW, boxH) {
  if (!dataUrl) return;
  try {
    const stripped = stripDataUrl(dataUrl);
    const props = doc.getImageProperties(stripped);
    const imgW = Math.max(props.width, 1);
    const imgH = Math.max(props.height, 1);
    const scale = Math.min(boxW / imgW, boxH / imgH);
    const drawW = imgW * scale;
    const drawH = imgH * scale;
    const drawX = x + (boxW - drawW) / 2;
    const drawY = y + (boxH - drawH) / 2;
    doc.setFillColor(248, 248, 248);
    doc.rect(x, y, boxW, boxH, "F");
    doc.addImage(stripped, "JPEG", drawX, drawY, drawW, drawH);
  } catch {
    doc.setFillColor(248, 248, 248);
    doc.rect(x, y, boxW, boxH, "F");
  }
}

function addPhotoPair(doc, frontUrl, backUrl, y) {
  const PHOTO_GAP = 6;
  const photoW = (PAGE.width - PHOTO_GAP) / 2;
  const photoH = 48;
  const leftX = PAGE.left + 2;
  const rightX = leftX + photoW + PHOTO_GAP;
  const imageY = y + 1.5;
  doc.setFontSize(7);
  setText(doc, C.muted);

  if (frontUrl) {
    doc.text("ID Front", leftX, y);
    addImageFitBox(doc, frontUrl, leftX, imageY, photoW, photoH);
  } else {
    doc.text("ID Front unavailable", leftX, y);
  }

  if (backUrl) {
    doc.text("ID Back", rightX, y);
    addImageFitBox(doc, backUrl, rightX, imageY, photoW, photoH);
  } else {
    doc.text("ID Back unavailable", rightX, y);
  }

  setText(doc, C.ink);
  return y + photoH + 8;
}

function drawPageFooter(doc) {
  setText(doc, C.muted);
  doc.setFontSize(7);
  doc.text(`${CONFIG.RESTAURANT_NAME} · Private Sitting Session Record`, PAGE.left, 287);
}

function drawSessionRecordPage(doc, data) {
  let y = drawPdfHeader(doc, "Private Sitting Record");

  const displayName = String(data.displayName || "").trim() || buildCustomerDisplayName(data.customers || []);
  doc.setFontSize(17);
  doc.setFont(undefined, "bold");
  setText(doc, C.ink);
  doc.text(displayName, PAGE.left + 2, y + 2);
  y += 10;

  setFill(doc, C.rowAlt);
  setDraw(doc, C.line);
  const cardTop = y;
  const cardH = 26;
  doc.rect(PAGE.left, cardTop, PAGE.width, cardH, "FD");

  doc.setFontSize(9);
  doc.setFont(undefined, "bold");
  setText(doc, C.ink);
  doc.text("Private Sitting", PAGE.left + 4, cardTop + 7);
  doc.setFont(undefined, "normal");
  doc.text(formatTableDisplayName(data.sittingId), PAGE.left + 4, cardTop + 13);

  doc.setFont(undefined, "bold");
  doc.text("Check-in", PAGE.left + 58, cardTop + 7);
  doc.setFont(undefined, "normal");
  const checkInText = formatCheckInLabel(data.checkInAt, data.checkInLabel);
  doc.text(checkInText, PAGE.left + 58, cardTop + 13, { maxWidth: 52 });

  doc.setFont(undefined, "bold");
  doc.text("Check-out", PAGE.left + 118, cardTop + 7);
  doc.setFont(undefined, "normal");
  doc.text(data.checkOutLabel || "—", PAGE.left + 118, cardTop + 13, { maxWidth: 52 });

  doc.setFont(undefined, "bold");
  doc.text("Mobile", PAGE.left + 4, cardTop + 21);
  doc.setFont(undefined, "normal");
  doc.text(String(data.mobile || "-"), PAGE.left + 28, cardTop + 21);

  y = cardTop + cardH + 6;

  (data.customers || []).forEach((customer) => {
    const sectionTitle = String(customer.name || "").trim() || "Guest";
    y = drawSectionTitle(doc, sectionTitle, y);
    y = drawMetaLine(doc, "Date of Birth", formatDobLabel(customer.dob), y);
    y = addPhotoPair(doc, customer.photoFrontDataUrl, customer.photoBackDataUrl, y);
    y += 2;
  });

  drawPageFooter(doc);
}

export async function buildSittingSessionPdf(data) {
  await preloadPdfLogo();
  const jsPDF = await getJsPdf();
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  drawSessionRecordPage(doc, data);
  return doc.output("datauristring");
}

/** @deprecated Use buildSittingSessionPdf */
export async function buildSittingRecordPdf(data) {
  return buildSittingSessionPdf(data);
}

export function compressPhotoDataUrl(dataUrl, maxWidth = 520, quality = 0.62) {
  const work = new Promise((resolve) => {
    if (!dataUrl) {
      resolve("");
      return;
    }
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxWidth / Math.max(img.width, 1));
      const width = Math.max(1, Math.round(img.width * scale));
      const height = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      try {
        resolve(canvas.toDataURL("image/jpeg", quality));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve("");
    img.src = dataUrl;
  });
  return withTimeout(work, 8000, "");
}

export async function buildCompressedCustomerPhotos(customers = []) {
  return Promise.all(
    customers.map(async (customer) => ({
      photoFrontDataUrl: await compressPhotoDataUrl(customer.photoFrontDataUrl),
      photoBackDataUrl: await compressPhotoDataUrl(customer.photoBackDataUrl)
    }))
  );
}

export function mergeCustomersWithPhotos(customers = [], customerPhotos = []) {
  return customers.map((customer, index) => ({
    ...customer,
    photoFrontDataUrl: customerPhotos[index]?.photoFrontDataUrl || customer.photoFrontDataUrl || "",
    photoBackDataUrl: customerPhotos[index]?.photoBackDataUrl || customer.photoBackDataUrl || ""
  }));
}

export function buildSittingEntryHtmlPreview(data) {
  const displayName = data.displayName || buildCustomerDisplayName(data.customers || []);
  const customers = (data.customers || []).map((customer) => `
    <section class="ps-pdf-customer">
      <strong>${escapeHtml(customer.name || "Guest")}</strong>
      <div>DOB: ${escapeHtml(formatDobLabel(customer.dob))}</div>
      <div class="ps-photo-grid">
        ${customer.photoFrontDataUrl ? `<img src="${customer.photoFrontDataUrl}" alt="ID front">` : ""}
        ${customer.photoBackDataUrl ? `<img src="${customer.photoBackDataUrl}" alt="ID back">` : ""}
      </div>
    </section>
  `).join("");

  return `
    <div class="ps-pdf-preview">
      <strong>${escapeHtml(CONFIG.RESTAURANT_NAME)}</strong>
      <div class="ps-pdf-couple-name">${escapeHtml(displayName)}</div>
      <div>Private Sitting: ${escapeHtml(formatTableDisplayName(data.sittingId || "-"))}</div>
      <div>Mobile: ${escapeHtml(data.mobile || "-")}</div>
      ${customers}
    </div>
  `;
}
