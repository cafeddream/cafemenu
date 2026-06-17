import { CONFIG, escapeHtml } from "./firebase.js";

let jsPdfModule = null;

async function getJsPdf() {
  if (!jsPdfModule) {
    jsPdfModule = await import("https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm");
  }
  return jsPdfModule.jsPDF;
}

// Warms the jsPDF CDN module so check-in submit doesn't wait on the download.
export function preloadJsPdf() {
  getJsPdf().catch(() => {
    // Preload is best-effort; submit will retry the import if needed.
  });
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

function addPhotoToPdf(doc, dataUrl, x, y, label) {
  if (!dataUrl) return y;
  try {
    doc.setFontSize(9);
    doc.text(label, x, y);
    doc.addImage(stripDataUrl(dataUrl), "JPEG", x, y + 2, 84, 48);
    return y + 54;
  } catch {
    doc.text(`${label} unavailable`, x, y);
    return y + 8;
  }
}

export async function buildSittingEntryPdf({
  sittingId,
  mobile,
  customers = [],
  checkInLabel = new Date().toLocaleString()
}) {
  const jsPDF = await getJsPdf();
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  doc.setFontSize(18);
  doc.text(CONFIG.RESTAURANT_NAME, 14, 18);
  doc.setFontSize(13);
  doc.text("Private Sitting Entry", 14, 26);
  doc.setFontSize(11);
  doc.text(`Sitting: ${sittingId}`, 14, 34);
  doc.text(`Mobile: ${mobile}`, 14, 40);
  doc.text(`Check-in: ${checkInLabel}`, 14, 46);

  let y = 56;
  customers.forEach((customer, index) => {
    doc.setFontSize(12);
    doc.text(`Customer ${index + 1}`, 14, y);
    y += 6;
    doc.setFontSize(10);
    doc.text(`Name: ${customer.name || "-"}`, 14, y);
    y += 5;
    doc.text(`DOB: ${formatDobLabel(customer.dob)}`, 14, y);
    y += 8;
    y = addPhotoToPdf(doc, customer.photoFrontDataUrl, 14, y, "ID Front");
    y = addPhotoToPdf(doc, customer.photoBackDataUrl, 14, y, "ID Back");
    y += 4;
  });

  return doc.output("datauristring");
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
