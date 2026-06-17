import { CONFIG, formatCurrency, formatTableDisplayName, toDate } from "./firebase.js";
import { getJsPdf } from "./private-sitting-pdf.js";

const PAGE_BOTTOM = 280;
const MARGIN_LEFT = 14;
const LINE_HEIGHT = 6;

function formatPaidAt(value) {
  const date = toDate(value);
  if (!date) return "-";
  return date.toLocaleString([], {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatItemsSummary(items = []) {
  if (!items.length) return "-";
  return items
    .map((item) => `${item.name || "Item"} x${Number(item.qty || 0)}`)
    .slice(0, 3)
    .join(", ");
}

function ensureSpace(doc, y, needed = LINE_HEIGHT) {
  if (y + needed <= PAGE_BOTTOM) return y;
  doc.addPage();
  return 18;
}

function writeLine(doc, text, y, options = {}) {
  const nextY = ensureSpace(doc, y, LINE_HEIGHT);
  doc.setFontSize(options.size || 10);
  if (options.bold) doc.setFont(undefined, "bold");
  else doc.setFont(undefined, "normal");
  doc.text(String(text), MARGIN_LEFT, nextY);
  return nextY + (options.gap || LINE_HEIGHT);
}

function writeSectionTitle(doc, title, y) {
  const nextY = ensureSpace(doc, y, LINE_HEIGHT + 4);
  doc.setFontSize(12);
  doc.setFont(undefined, "bold");
  doc.text(title, MARGIN_LEFT, nextY);
  doc.setFont(undefined, "normal");
  return nextY + 10;
}

export async function buildSalesReportPdf(report) {
  const jsPDF = await getJsPdf();
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const periodLabel = report.startDate === report.endDate
    ? report.startDate
    : `${report.startDate} to ${report.endDate}`;

  let y = 18;
  doc.setFontSize(18);
  doc.setFont(undefined, "bold");
  doc.text(CONFIG.RESTAURANT_NAME, MARGIN_LEFT, y);
  y += 8;
  doc.setFontSize(13);
  doc.text("Sales Report", MARGIN_LEFT, y);
  y += 7;
  doc.setFontSize(10);
  doc.setFont(undefined, "normal");
  doc.text(`Period: ${periodLabel}`, MARGIN_LEFT, y);
  doc.text(`Generated: ${new Date().toLocaleString()}`, MARGIN_LEFT, y + 6);
  y += 16;

  y = writeSectionTitle(doc, "Summary", y);
  const summaryRows = [
    ["Total Sales (Net)", formatCurrency(report.total || 0)],
    ["Gross Sales", formatCurrency(report.grossTotal || 0)],
    ["Discount Given", formatCurrency(report.discountTotal || 0)],
    ["Total Orders", String(report.totalOrders || 0)],
    ["Food Sales", `${formatCurrency(report.foodSaleTotal || 0)} (${report.foodOrders || 0} orders)`],
    ["Private Sitting Sales", `${formatCurrency(report.privateSittingTotal || 0)} (${report.privateSittings || 0} sessions)`],
    ["Cash Collection", formatCurrency(report.cash || 0)],
    ["Online Collection", formatCurrency(report.online || 0)],
    ["Cancelled Without Payment", `${report.cancelledWithoutPaymentCount || 0} orders · ${formatCurrency(report.cancelledWithoutPaymentAmount || 0)}`],
    ["Cancelled After Payment", `${report.cancelledWithPaymentCount || 0} orders · ${formatCurrency(report.cancelledWithPaymentAmount || 0)}`]
  ];

  summaryRows.forEach(([label, value]) => {
    y = ensureSpace(doc, y, LINE_HEIGHT);
    doc.setFontSize(10);
    doc.text(label, MARGIN_LEFT, y);
    doc.text(value, 120, y, { align: "right" });
    y += LINE_HEIGHT;
  });

  y += 4;
  y = writeSectionTitle(doc, "Detailed Food Orders", y);
  const foodOrders = report.foodOrderDetails || [];
  if (!foodOrders.length) {
    y = writeLine(doc, "No food orders in this period.", y);
  } else {
    foodOrders.forEach((order) => {
      const tableLabel = formatTableDisplayName(order.tableId);
      const gross = Number(order.grossTotal ?? order.total ?? 0);
      const discount = Number(order.discountAmount || 0);
      const net = Number(order.total || 0);
      const payment = order.paymentMethod === "online" ? "Online" : "Cash";
      y = writeLine(doc, `${formatPaidAt(order.paidAt)} · ${tableLabel} · ${payment}`, y, { bold: true });
      y = writeLine(doc, `Bill ${String(order.orderId || order.id || "").slice(0, 8)} · ${formatItemsSummary(order.items)}`, y);
      y = writeLine(doc, `Gross ${formatCurrency(gross)} · Discount ${formatCurrency(discount)} · Net ${formatCurrency(net)}`, y);
      y += 2;
    });
  }

  y = writeSectionTitle(doc, "Detailed Private Sittings", y);
  const sittings = report.sittingDetails || [];
  if (!sittings.length) {
    y = writeLine(doc, "No private sittings in this period.", y);
  } else {
    sittings.forEach((session) => {
      const gross = Number(session.grossTotal ?? session.grandTotal ?? session.billedAmount ?? 0);
      const discount = Number(session.discountAmount || 0);
      const net = Number(session.grandTotal ?? session.billedAmount ?? 0);
      const payment = session.paymentMethod === "online" ? "Online" : "Cash";
      y = writeLine(doc, `${formatPaidAt(session.checkOutAt)} · ${session.sittingId || "-"} · ${payment}`, y, { bold: true });
      y = writeLine(doc, `${session.displayName || "Guests"} · ${session.mobile || "-"}`, y);
      y = writeLine(doc, `Sitting ${formatCurrency(session.sittingAmount || 0)} · Food ${formatCurrency(session.foodAmount || 0)}`, y);
      y = writeLine(doc, `Gross ${formatCurrency(gross)} · Discount ${formatCurrency(discount)} · Net ${formatCurrency(net)}`, y);
      y += 2;
    });
  }

  y = writeSectionTitle(doc, "Cancelled Orders", y);
  const cancellations = report.cancellationDetails || [];
  if (!cancellations.length) {
    y = writeLine(doc, "No cancelled orders in this period.", y);
  } else {
    cancellations.forEach((row) => {
      const tableLabel = formatTableDisplayName(row.tableId);
      const status = row.wasPaid ? "After payment" : "Without payment";
      y = writeLine(doc, `${row.time} · ${tableLabel} · ${status}`, y, { bold: true });
      y = writeLine(doc, `Order ${String(row.orderId || "").slice(0, 8)} · ${formatCurrency(row.amount || 0)}`, y);
      y += 2;
    });
  }

  if ((report.items || []).length) {
    y = writeSectionTitle(doc, "Menu Items Sold", y);
    report.items.forEach((item) => {
      y = writeLine(doc, `${item.name} x${item.qty} · ${formatCurrency(item.total)}`, y);
    });
  }

  return doc;
}

export async function downloadSalesReportPdf(report) {
  const doc = await buildSalesReportPdf(report);
  const filename = `sales-report-${report.startDate}${report.endDate !== report.startDate ? `-${report.endDate}` : ""}.pdf`;
  doc.save(filename);
}
