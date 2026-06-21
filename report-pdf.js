import { CONFIG, formatTableDisplayName, toDate } from "./firebase.js";
import { getJsPdf } from "./private-sitting-pdf.js";

const PAGE = { left: 14, right: 196, width: 182, bottom: 272, top: 18 };
const ROW_H = 8;
const HEADER_H = 9;
const SECTION_GAP = 10;

const C = {
  brand: [255, 107, 53],
  brandDark: [217, 79, 30],
  white: [255, 255, 255],
  ink: [28, 28, 28],
  muted: [110, 110, 110],
  line: [218, 218, 218],
  rowAlt: [255, 250, 247],
  danger: [180, 50, 50]
};

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

function formatOrderDateTime(order) {
  if (order.paymentStatus === "voided") {
    return formatPaidAt(order.voidedAt);
  }
  if (order.paymentStatus === "credit_pending") {
    return formatPaidAt(order.creditedAt || order.timestamp);
  }
  return formatPaidAt(order.paidAt);
}

function formatCancelDateTime(row) {
  if (row.time) {
    const parsed = toDate(row.time);
    if (parsed) return formatPaidAt(parsed);
  }
  return row.date || "-";
}

function formatOrderPaymentLabel(order) {
  if (order.paymentStatus === "voided") {
    const reason = String(order.voidRemarks || "").trim();
    return reason ? `Void: ${reason}` : "Void";
  }
  if (order.paymentStatus === "credit_pending" || order.paymentMethod === "pending") {
    return "Pending";
  }
  return order.paymentMethod === "online" ? "Online" : "Cash";
}

function formatItemsSummary(items = []) {
  if (!items.length) return "-";
  return items
    .map((item) => `${item.name || "Item"} x${Number(item.qty || 0)}`)
    .join(", ");
}

function orderGrossAmount(order) {
  if (order.paymentStatus === "voided") {
    return Number(order.grossTotal ?? order.voidAmount ?? 0);
  }
  return Number(order.grossTotal ?? order.total ?? 0);
}

function orderNetAmount(order) {
  if (order.paymentStatus === "voided") return 0;
  if (order.paymentStatus === "credit_pending") return Number(order.total || 0);
  return Number(order.total || 0);
}

// jsPDF built-in fonts cannot render the ₹ Unicode glyph; use Rs. for PDF output.
function fmtMoney(amount) {
  const value = Number(amount || 0).toLocaleString("en-IN");
  return `Rs. ${value}`;
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

function truncateToWidth(doc, text, maxWidth) {
  let value = String(text || "");
  if (!value) return "-";
  while (doc.getTextWidth(value) > maxWidth && value.length > 3) {
    value = `${value.slice(0, -4)}...`;
  }
  return value;
}

function newPageIfNeeded(doc, y, needed = ROW_H + 4) {
  if (y + needed <= PAGE.bottom) return y;
  drawPageFooter(doc, doc.internal.getNumberOfPages());
  doc.addPage();
  return PAGE.top;
}

function drawPageFooter(doc, pageNo) {
  setText(doc, C.muted);
  doc.setFontSize(8);
  doc.setFont(undefined, "normal");
  doc.text(`${CONFIG.RESTAURANT_NAME} · Sales Report`, PAGE.left, 287);
  doc.text(`Page ${pageNo}`, PAGE.right, 287, { align: "right" });
}

function drawReportHeader(doc, periodLabel) {
  setFill(doc, C.brand);
  doc.rect(PAGE.left, 10, PAGE.width, 28, "F");

  setText(doc, C.white);
  doc.setFontSize(20);
  doc.setFont(undefined, "bold");
  doc.text(CONFIG.RESTAURANT_NAME, PAGE.left + 4, 22);

  doc.setFontSize(11);
  doc.setFont(undefined, "normal");
  doc.text("Sales Report", PAGE.left + 4, 30);
  doc.text(`Period: ${periodLabel}`, PAGE.right - 4, 22, { align: "right" });
  doc.text(`Generated: ${new Date().toLocaleString()}`, PAGE.right - 4, 30, { align: "right" });

  setText(doc, C.ink);
  return 46;
}

function drawSectionTitle(doc, title, y) {
  y = newPageIfNeeded(doc, y, 14);
  setFill(doc, C.brandDark);
  doc.rect(PAGE.left, y - 5, PAGE.width, 8, "F");
  setText(doc, C.white);
  doc.setFontSize(10);
  doc.setFont(undefined, "bold");
  doc.text(title, PAGE.left + 3, y);
  setText(doc, C.ink);
  return y + 8;
}

function drawTableHeader(doc, columns, y) {
  y = newPageIfNeeded(doc, y, HEADER_H + 2);
  let x = PAGE.left;
  setFill(doc, C.brand);
  setDraw(doc, C.brand);
  doc.rect(PAGE.left, y, PAGE.width, HEADER_H, "FD");

  setText(doc, C.white);
  doc.setFontSize(8);
  doc.setFont(undefined, "bold");
  columns.forEach((col) => {
    const textX = col.align === "right" ? x + col.w - 2 : x + 2;
    doc.text(col.label, textX, y + 6, { align: col.align || "left" });
    x += col.w;
  });

  setText(doc, C.ink);
  doc.setFont(undefined, "normal");
  return y + HEADER_H;
}

function drawTableRow(doc, columns, cells, y, rowIndex, options = {}) {
  const rowH = options.rowH || ROW_H;
  y = newPageIfNeeded(doc, y, rowH + 1);
  let x = PAGE.left;
  const bg = rowIndex % 2 === 1 ? C.rowAlt : C.white;
  const ink = options.ink || C.ink;

  setFill(doc, bg);
  setDraw(doc, C.line);
  doc.rect(PAGE.left, y, PAGE.width, rowH, "FD");

  doc.setFontSize(8);
  doc.setFont(undefined, "normal");
  columns.forEach((col, index) => {
    const raw = cells[index] ?? "-";
    const shouldTruncate = !options.noTruncateIndices?.includes(index);
    const text = shouldTruncate ? truncateToWidth(doc, raw, col.w - 4) : String(raw || "-");
    const textX = col.align === "right" ? x + col.w - 2 : x + 2;
    if (col.muted) setText(doc, C.muted);
    else setText(doc, ink);
    doc.text(text, textX, y + 5.5, { align: col.align || "left" });
    x += col.w;
  });

  setText(doc, C.ink);
  return y + rowH;
}

function drawFoodOrderRow(doc, columns, cells, y, rowIndex, options = {}) {
  const itemsColIndex = 2;
  const itemsCol = columns[itemsColIndex];
  const itemsText = String(cells[itemsColIndex] || "-");
  const lineHeight = 4;
  const lines = doc.splitTextToSize(itemsText, itemsCol.w - 4);
  const rowH = Math.max(ROW_H, lines.length * lineHeight + 3);
  y = newPageIfNeeded(doc, y, rowH + 1);

  let x = PAGE.left;
  const bg = rowIndex % 2 === 1 ? C.rowAlt : C.white;
  const ink = options.ink || C.ink;

  setFill(doc, bg);
  setDraw(doc, C.line);
  doc.rect(PAGE.left, y, PAGE.width, rowH, "FD");

  doc.setFontSize(8);
  doc.setFont(undefined, "normal");
  columns.forEach((col, index) => {
    const textX = col.align === "right" ? x + col.w - 2 : x + 2;
    if (col.muted) setText(doc, C.muted);
    else setText(doc, ink);

    if (index === itemsColIndex) {
      const startY = y + (rowH - lines.length * lineHeight) / 2 + 3.5;
      lines.forEach((line, lineIndex) => {
        doc.text(line, textX, startY + lineIndex * lineHeight, { align: col.align || "left" });
      });
    } else {
      const raw = cells[index] ?? "-";
      const noTruncate = index === 1;
      const text = noTruncate ? String(raw || "-") : truncateToWidth(doc, raw, col.w - 4);
      doc.text(text, textX, y + 5.5, { align: col.align || "left" });
    }
    x += col.w;
  });

  setText(doc, C.ink);
  return y + rowH;
}

function drawKeyValueTable(doc, rows, y) {
  const cols = [
    { label: "Metric", w: 118 },
    { label: "Value", w: 64, align: "right" }
  ];
  y = drawTableHeader(doc, cols, y);
  rows.forEach(([label, value], index) => {
    y = drawTableRow(doc, cols, [label, value], y, index);
  });
  return y + SECTION_GAP;
}

const FOOD_COLS = [
  { label: "Date / Time", w: 28 },
  { label: "Table", w: 20 },
  { label: "Items", w: 54 },
  { label: "Pay", w: 22 },
  { label: "Gross", w: 20, align: "right" },
  { label: "Disc.", w: 18, align: "right" },
  { label: "Net", w: 20, align: "right" }
];

const SITTING_COLS = [
  { label: "Date / Time", w: 28 },
  { label: "Room", w: 14 },
  { label: "Guest", w: 40 },
  { label: "Sitting", w: 20, align: "right" },
  { label: "Food", w: 20, align: "right" },
  { label: "Gross", w: 20, align: "right" },
  { label: "Disc.", w: 18, align: "right" },
  { label: "Net", w: 22, align: "right" }
];

const CANCEL_COLS = [
  { label: "Date / Time", w: 30 },
  { label: "Table", w: 20 },
  { label: "Order", w: 24 },
  { label: "Status", w: 40 },
  { label: "Amount", w: 28, align: "right" }
];

const MENU_COLS = [
  { label: "Item", w: 108 },
  { label: "Qty", w: 28, align: "right" },
  { label: "Total", w: 46, align: "right" }
];

const PENDING_COLS = [
  { label: "Date / Time", w: 26 },
  { label: "Table", w: 16 },
  { label: "Name", w: 28 },
  { label: "Mobile", w: 22 },
  { label: "Items", w: 44 },
  { label: "Gross", w: 18, align: "right" },
  { label: "Disc.", w: 16, align: "right" },
  { label: "Net", w: 18, align: "right" }
];

function drawEmptyRow(doc, columns, message, y) {
  const cells = columns.map((_, index) => (index === 0 ? message : ""));
  return drawTableRow(doc, columns, cells, y, 0);
}

export async function buildSalesReportPdf(report) {
  const jsPDF = await getJsPdf();
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const periodLabel = report.startDate === report.endDate
    ? report.startDate
    : `${report.startDate} to ${report.endDate}`;

  let y = drawReportHeader(doc, periodLabel);

  y = drawSectionTitle(doc, "Summary", y);
  y = drawKeyValueTable(doc, [
    ["Net Collection (paid)", fmtMoney(report.total || 0)],
    ["Gross Sales (incl. void + cancelled paid)", fmtMoney(report.grossTotal || 0)],
    ["Discount Given", fmtMoney(report.discountTotal || 0)],
    ["Paid Orders + Sittings", String(report.paidOrderCount ?? report.totalOrders ?? 0)],
    ["Food Sales (paid)", `${fmtMoney(report.foodSaleTotal || 0)}  (${report.foodOrders || 0} orders)`],
    ["Private Sitting Sales", `${fmtMoney(report.privateSittingTotal || 0)}  (${report.privateSittings || 0} sessions)`],
    ["Cash Collection", fmtMoney(report.cash || 0)],
    ["Online Collection", fmtMoney(report.online || 0)],
    ["Cancelled Without Payment", `${report.cancelledWithoutPaymentCount || 0} orders  ·  ${fmtMoney(report.cancelledWithoutPaymentAmount || 0)}`],
    ["Cancelled After Payment", `${report.cancelledWithPaymentCount || 0} orders  ·  ${fmtMoney(report.cancelledWithPaymentAmount || 0)}`],
    ["Void Orders (not collected)", `${report.voidOrderCount || 0} orders  ·  ${fmtMoney(report.voidOrderGross ?? report.voidOrderAmount ?? 0)}`],
    ["Pending / Udhaar (not collected)", `${report.pendingOrderCount || 0} orders  ·  ${fmtMoney(report.pendingOrderGross ?? report.pendingOrderTotal ?? 0)}`]
  ], y);

  y = drawSectionTitle(doc, "Daily Expenses", y);
  const expenseRows = report.expenseDetails || [];
  if (!expenseRows.length) {
    y = drawKeyValueTable(doc, [["Total Expenses", fmtMoney(0)]], y);
  } else {
    y = drawKeyValueTable(doc, expenseRows.map((row) => [
      String(row.description || "Expense"),
      fmtMoney(row.amount || 0)
    ]), y);
    y = drawKeyValueTable(doc, [["Total Expenses", fmtMoney(report.expenseTotal || 0)]], y);
  }

  y = drawSectionTitle(doc, "Net Collection", y);
  y = drawKeyValueTable(doc, [
    ["Sales (paid)", fmtMoney(report.total || 0)],
    ["Expenses", fmtMoney(report.expenseTotal || 0)],
    ["Net Collection", fmtMoney(report.netAfterExpenses ?? ((report.total || 0) - (report.expenseTotal || 0)))]
  ], y);

  y = drawSectionTitle(doc, "Food Orders (All Tables)", y);
  y = drawTableHeader(doc, FOOD_COLS, y);
  const foodOrders = report.foodOrderDetails || [];
  if (!foodOrders.length) {
    y = drawEmptyRow(doc, FOOD_COLS, "No food orders in this period.", y);
  } else {
    foodOrders.forEach((order, index) => {
      const isVoid = order.paymentStatus === "voided";
      const isCredit = order.paymentStatus === "credit_pending";
      const gross = orderGrossAmount(order);
      const discount = Number(order.discountAmount || 0);
      const net = isVoid ? 0 : orderNetAmount(order);
      y = drawFoodOrderRow(doc, FOOD_COLS, [
        formatOrderDateTime(order),
        formatTableDisplayName(order.tableId),
        formatItemsSummary(order.items),
        formatOrderPaymentLabel(order),
        fmtMoney(gross),
        discount > 0 ? `-Rs. ${Number(discount).toLocaleString("en-IN")}` : "Rs. 0",
        fmtMoney(net)
      ], y, index, isVoid ? { ink: C.danger } : (isCredit ? { ink: [180, 120, 20] } : {}));
    });
  }
  y += SECTION_GAP;

  y = drawSectionTitle(doc, "Pending Orders (Udhaar)", y);
  y = drawTableHeader(doc, PENDING_COLS, y);
  const pendingOrders = report.pendingOrderDetails || [];
  if (!pendingOrders.length) {
    y = drawEmptyRow(doc, PENDING_COLS, "No pending (udhaar) orders in this period.", y);
  } else {
    pendingOrders.forEach((order, index) => {
      const gross = orderGrossAmount(order);
      const discount = Number(order.discountAmount || 0);
      const net = orderNetAmount(order);
      y = drawTableRow(doc, PENDING_COLS, [
        formatOrderDateTime(order),
        formatTableDisplayName(order.tableId),
        order.customerName || "-",
        order.customerMobileNormalized || order.customerMobile || "-",
        formatItemsSummary(order.items),
        fmtMoney(gross),
        discount > 0 ? `-Rs. ${Number(discount).toLocaleString("en-IN")}` : "Rs. 0",
        fmtMoney(net)
      ], y, index, { noTruncateIndices: [2, 4] });
    });
  }
  y += SECTION_GAP;

  y = drawSectionTitle(doc, "Private Sittings", y);
  y = drawTableHeader(doc, SITTING_COLS, y);
  const sittings = report.sittingDetails || [];
  if (!sittings.length) {
    y = drawEmptyRow(doc, SITTING_COLS, "No private sittings in this period.", y);
  } else {
    sittings.forEach((session, index) => {
      const gross = Number(session.grossTotal ?? session.grandTotal ?? session.billedAmount ?? 0);
      const discount = Number(session.discountAmount || 0);
      const net = Number(session.grandTotal ?? session.billedAmount ?? 0);
      y = drawTableRow(doc, SITTING_COLS, [
        formatPaidAt(session.checkOutAt),
        session.sittingId || "-",
        `${session.displayName || "Guests"}`,
        fmtMoney(session.sittingAmount || 0),
        fmtMoney(session.foodAmount || 0),
        fmtMoney(gross),
        discount > 0 ? `-Rs. ${Number(discount).toLocaleString("en-IN")}` : "Rs. 0",
        fmtMoney(net)
      ], y, index, { noTruncateIndices: [2] });
    });
  }
  y += SECTION_GAP;

  y = drawSectionTitle(doc, "Cancelled Orders", y);
  y = drawTableHeader(doc, CANCEL_COLS, y);
  const cancellations = report.cancellationDetails || [];
  if (!cancellations.length) {
    y = drawEmptyRow(doc, CANCEL_COLS, "No cancelled orders in this period.", y);
  } else {
    cancellations.forEach((row, index) => {
      y = drawTableRow(doc, CANCEL_COLS, [
        formatCancelDateTime(row),
        formatTableDisplayName(row.tableId),
        String(row.orderId || "").slice(0, 8) || "-",
        row.wasPaid ? "After payment" : "Without payment",
        fmtMoney(row.amount || 0)
      ], y, index, { noTruncateIndices: [1] });
    });
  }
  y += SECTION_GAP;

  if ((report.items || []).length) {
    y = drawSectionTitle(doc, "Menu Items Sold", y);
    y = drawTableHeader(doc, MENU_COLS, y);
    report.items.forEach((item, index) => {
      y = drawTableRow(doc, MENU_COLS, [
        item.name,
        String(item.qty || 0),
        fmtMoney(item.total || 0)
      ], y, index);
    });
  }

  drawPageFooter(doc, doc.internal.getNumberOfPages());
  return doc;
}

export async function downloadSalesReportPdf(report) {
  const doc = await buildSalesReportPdf(report);
  const filename = `sales-report-${report.startDate}${report.endDate !== report.startDate ? `-${report.endDate}` : ""}.pdf`;
  doc.save(filename);
}

export async function buildSalesReportPdfBase64(report) {
  const doc = await buildSalesReportPdf(report);
  return doc.output("datauristring").split(",")[1];
}
