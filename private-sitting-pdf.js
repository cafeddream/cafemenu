import { CONFIG, escapeHtml } from "./firebase.js";

let jsPdfModule = null;

async function getJsPdf() {
  if (!jsPdfModule) {
    jsPdfModule = await import("https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm");
  }
  return jsPdfModule.jsPDF;
}

function stripDataUrl(dataUrl = "") {
  const parts = String(dataUrl).split(",");
  return parts.length > 1 ? parts[1] : parts[0];
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
    doc.text(`ID: ${customer.idNumber || "-"}`, 14, y);
    y += 5;
    doc.text(`DOB: ${customer.dob || "-"}`, 14, y);
    y += 5;
    doc.text(`Gender: ${customer.gender || "-"}`, 14, y);
    y += 8;

    if (customer.photoDataUrl) {
      try {
        doc.addImage(stripDataUrl(customer.photoDataUrl), "JPEG", 14, y, 80, 50);
        y += 56;
      } catch {
        doc.text("ID photo unavailable", 14, y);
        y += 8;
      }
    }
    y += 4;
  });

  return doc.output("datauristring");
}

export function buildSittingEntryHtmlPreview(data) {
  const customers = (data.customers || []).map((customer, index) => `
    <section class="ps-pdf-customer">
      <strong>Customer ${index + 1}</strong>
      <div>${escapeHtml(customer.name || "-")}</div>
      <div>ID: ${escapeHtml(customer.idNumber || "-")}</div>
      <div>DOB: ${escapeHtml(customer.dob || "-")}</div>
      ${customer.photoDataUrl ? `<img src="${customer.photoDataUrl}" alt="Customer ${index + 1} ID">` : ""}
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
