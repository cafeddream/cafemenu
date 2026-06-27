import {
  closeBusinessSession,
  fetchActiveOrdersOnce,
  fetchActivePrivateSessionsOnce,
  getBusinessSessionState
} from "./firebase.js";
import { downloadSalesReportPdf } from "./report-pdf.js";
import { isReportSyncConfigured } from "./report-sync.js";
import { uploadSessionReportForDate } from "./report-scheduler.js";

export const CLOSE_DAY_ERRORS = {
  unserved: "Please orders unserved, cannot close cafe",
  sitting: "Private sitting Checked In, Cannot close the day",
  alreadyClosed: "Day already closed",
  appsScript: "Apps Script URL required to close day"
};

function orderHasUnservedItems(order) {
  if (order.paymentStatus === "voided") return false;
  return (order.items || []).some((item) => item.status !== "served");
}

export async function closeDayForToday() {
  if (!isReportSyncConfigured()) {
    throw new Error(CLOSE_DAY_ERRORS.appsScript);
  }

  const state = await getBusinessSessionState();
  if (state.status !== "open" || !state.businessDateKey) {
    throw new Error(CLOSE_DAY_ERRORS.alreadyClosed);
  }

  const dateKey = state.businessDateKey;

  const [orders, sessions] = await Promise.all([
    fetchActiveOrdersOnce(),
    fetchActivePrivateSessionsOnce()
  ]);

  if (orders.some(orderHasUnservedItems)) {
    throw new Error(CLOSE_DAY_ERRORS.unserved);
  }

  if (sessions.length > 0) {
    throw new Error(CLOSE_DAY_ERRORS.sitting);
  }

  const report = await uploadSessionReportForDate(dateKey);
  await downloadSalesReportPdf(report);
  await closeBusinessSession();
  return { dateKey };
}
