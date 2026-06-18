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
