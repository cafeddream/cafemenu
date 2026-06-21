import { isAppsScriptConfigured, postAppsScript } from "./sitting-sync.js";

export function isReportSyncConfigured() {
  return isAppsScriptConfigured();
}

export async function syncSalesReportToDrive({ dateKey, pdfBase64, summary }) {
  if (!isReportSyncConfigured()) {
    return { ok: false, error: "Apps Script URL not configured" };
  }
  return postAppsScript({
    action: "saveSalesReport",
    dateKey,
    pdfBase64,
    summary
  }, 120000);
}

export async function syncPendingOrderToSheet({
  orderId,
  tableId,
  customerName,
  customerMobile,
  itemsSummary,
  grossTotal,
  discountAmount,
  total
}) {
  if (!isReportSyncConfigured()) {
    return { ok: false, error: "Apps Script URL not configured" };
  }
  const now = new Date();
  const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const timeLabel = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  return postAppsScript({
    action: "savePendingOrder",
    orderId,
    tableId,
    customerName,
    customerMobile,
    itemsSummary,
    grossTotal,
    discountAmount,
    total,
    dateKey,
    timeLabel
  }, 60000);
}
