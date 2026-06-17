import { CONFIG, escapeHtml, formatTableDisplayName, toDate } from "./firebase.js";

let jsPdfModule = null;
let logoDataUrl = null;
let logoLoadPromise = null;

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

export async function getJsPdf() {
  if (!jsPdfModule) {
    jsPdfModule = await import("https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm");
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
  logoLoadPromise = fetch(CONFIG.RECEIPT_LOGO_SRC)
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

function fmtMoney(amount) {
  return `Rs. ${Number(amount || 0).toLocaleString("en-IN")}`;
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

function formatCheckInLabel(checkInAt, checkInLabel = "") {
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
  doc.rect(PAGE.left, 10, PAGE.width, 24, "F");

  try {
    if (logoDataUrl) {
      doc.addImage(stripDataUrl(logoDataUrl), "PNG", PAGE.left + 4, 12, 18, 18);
    }
  } catch {
    // Logo optional in PDF.
  }

  setText(doc, C.white);
  doc.setFontSize(18);
  doc.setFont(undefined, "bold");
  doc.text(CONFIG.RESTAURANT_NAME, PAGE.left + 26, 20);
  doc.setFontSize(10);
  doc.setFont(undefined, "normal");
  doc.text(subtitle, PAGE.left + 26, 28);
  doc.text(new Date().toLocaleString(), PAGE.right - 4, 20, { align: "right" });

  setText(doc, C.ink);
  return 42;
}

function drawSectionTitle(doc, title, y) {
  setFill(doc, C.brandDark);
  doc.rect(PAGE.left, y - 4, PAGE.width, 7, "F");
  setText(doc, C.white);
  doc.setFontSize(10);
  doc.setFont(undefined, "bold");
  doc.text(title, PAGE.left + 3, y);
  setText(doc, C.ink);
  return y + 10;
}

function drawMetaLine(doc, label, value, y) {
  doc.setFontSize(10);
  doc.setFont(undefined, "bold");
  doc.text(`${label}:`, PAGE.left, y);
  doc.setFont(undefined, "normal");
  doc.text(String(value || "-"), PAGE.left + 32, y);
  return y + 6;
}

function addPhotoPair(doc, frontUrl, backUrl, y) {
  const photoW = 84;
  const photoH = 48;
  doc.setFontSize(8);
  setText(doc, C.muted);

  try {
    if (frontUrl) {
      doc.text("ID Front", PAGE.left, y);
      doc.addImage(stripDataUrl(frontUrl), "JPEG", PAGE.left, y + 2, photoW, photoH);
    } else {
      doc.text("ID Front unavailable", PAGE.left, y);
    }
  } catch {
    doc.text("ID Front unavailable", PAGE.left, y);
  }

  try {
    if (backUrl) {
      doc.text("ID Back", PAGE.left + photoW + 8, y);
      doc.addImage(stripDataUrl(backUrl), "JPEG", PAGE.left + photoW + 8, y + 2, photoW, photoH);
    } else {
      doc.text("ID Back unavailable", PAGE.left + photoW + 8, y);
    }
  } catch {
    doc.text("ID Back unavailable", PAGE.left + photoW + 8, y);
  }

  setText(doc, C.ink);
  return y + photoH + 10;
}

function drawKeyValueRows(doc, rows, y) {
  rows.forEach(([label, value], index) => {
    const bg = index % 2 === 1 ? C.rowAlt : C.white;
    setFill(doc, bg);
    setDraw(doc, C.line);
    doc.rect(PAGE.left, y - 4, PAGE.width, 8, "FD");
    doc.setFontSize(9);
    doc.setFont(undefined, "bold");
    setText(doc, C.ink);
    doc.text(label, PAGE.left + 2, y);
    doc.setFont(undefined, "normal");
    doc.text(String(value), PAGE.right - 2, y, { align: "right" });
    y += 8;
  });
  return y + 4;
}

function drawPageFooter(doc, label) {
  setText(doc, C.muted);
  doc.setFontSize(8);
  doc.text(`${CONFIG.RESTAURANT_NAME} · ${label}`, PAGE.left, 287);
}

function drawEntryPage(doc, data) {
  let y = drawPdfHeader(doc, "Private Sitting Record");

  y = drawSectionTitle(doc, "Session Details", y);
  y = drawMetaLine(doc, "Sitting", formatTableDisplayName(data.sittingId), y);
  y = drawMetaLine(doc, "Mobile", data.mobile, y);
  y = drawMetaLine(doc, "Check-in", formatCheckInLabel(data.checkInAt, data.checkInLabel), y);
  if (data.sessionId) {
    y = drawMetaLine(doc, "Ref", String(data.sessionId).slice(0, 8).toUpperCase(), y);
  }
  y += 4;

  (data.customers || []).forEach((customer, index) => {
    y = drawSectionTitle(doc, `Customer ${index + 1}`, y);
    y = drawMetaLine(doc, "Name", customer.name, y);
    y = drawMetaLine(doc, "DOB", formatDobLabel(customer.dob), y);
    y = addPhotoPair(
      doc,
      customer.photoFrontDataUrl,
      customer.photoBackDataUrl,
      y
    );
    y += 2;
  });

  drawPageFooter(doc, "Private Sitting Entry Record");
}

function drawCheckoutPage(doc, checkout) {
  doc.addPage();
  let y = drawPdfHeader(doc, "Checkout Summary");

  y = drawSectionTitle(doc, "Timing", y);
  y = drawMetaLine(doc, "Check-out", checkout.checkOutLabel || "-", y);
  y = drawMetaLine(doc, "Duration", `${checkout.durationMinutes || 0} min`, y);
  y += 4;

  y = drawSectionTitle(doc, "Billing", y);
  const discount = Number(checkout.discountAmount || 0);
  const rows = [
    ["Sitting Charge", fmtMoney(checkout.sittingAmount)],
    ["Food Total", fmtMoney(checkout.foodAmount)],
    ["Gross Total", fmtMoney(checkout.grossTotal)]
  ];
  if (discount > 0) {
    rows.push(["Discount", `-${fmtMoney(discount)}`]);
  }
  rows.push(
    ["Grand Total", fmtMoney(checkout.grandTotal)],
    ["Payment", checkout.paymentMethod === "online" ? "Online" : "Cash"]
  );
  y = drawKeyValueRows(doc, rows, y);

  drawPageFooter(doc, "Private Sitting Checkout");
}

export async function buildSittingRecordPdf({
  phase = "checkin",
  sittingId,
  mobile,
  sessionId,
  customers = [],
  checkInAt,
  checkInLabel,
  checkout = null
}) {
  await preloadPdfLogo();
  const jsPDF = await getJsPdf();
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  drawEntryPage(doc, {
    sittingId,
    mobile,
    sessionId,
    customers,
    checkInAt,
    checkInLabel
  });

  if (phase === "full" && checkout) {
    drawCheckoutPage(doc, checkout);
  }

  return doc.output("datauristring");
}

export async function buildSittingEntryPdf(data) {
  return buildSittingRecordPdf({ ...data, phase: "checkin" });
}

export function compressPhotoDataUrl(dataUrl, maxWidth = 520, quality = 0.62) {
  return new Promise((resolve) => {
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
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
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
  const customers = (data.customers || []).map((customer, index) => `
    <section class="ps-pdf-customer">
      <strong>Customer ${index + 1}</strong>
      <div>${escapeHtml(customer.name || "-")}</div>
      <div>DOB: ${escapeHtml(formatDobLabel(customer.dob))}</div>
      <div class="ps-photo-grid">
        ${customer.photoFrontDataUrl ? `<img src="${customer.photoFrontDataUrl}" alt="Customer ${index + 1} ID front">` : ""}
        ${customer.photoBackDataUrl ? `<img src="${customer.photoBackDataUrl}" alt="Customer ${index + 1} ID back">` : ""}
      </div>
    </section>
  `).join("");

  return `
    <div class="ps-pdf-preview">
      <strong>${escapeHtml(CONFIG.RESTAURANT_NAME)}</strong>
      <div>Sitting: ${escapeHtml(data.sittingId || "-")}</div>
      <div>Mobile: ${escapeHtml(data.mobile || "-")}</div>
      ${customers}
    </div>
  `;
}
