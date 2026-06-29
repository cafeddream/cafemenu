import {
  fetchActiveOrdersOnce,
  fetchActivePrivateSessionsOnce,
  fetchActivePartySessionsOnce,
  fetchDayWiseReport,
  getTodayKey
} from "./firebase.js";
import { attachExpensesToReport } from "./expense-sync.js";
import { downloadSalesReportPdf } from "./report-pdf.js";
import { isReportSyncConfigured } from "./report-sync.js";
import { isReportDayUploaded, uploadReportToDrive } from "./report-scheduler.js";
import { getJsPdf } from "./private-sitting-pdf.js";

export const CLOSE_DAY_ERRORS = {
  unserved: "Please orders unserved, cannot close cafe",
  sitting: "Private sitting Checked In, Cannot close the day",
  party: "Active party in progress, cannot close the day",
  alreadyClosed: "Day already closed",
  appsScript: "Apps Script URL required to close day"
};

function orderHasUnservedItems(order) {
  if (order.paymentStatus === "voided") return false;
  return (order.items || []).some((item) => item.status !== "served");
}

export async function isTodayDayClosed() {
  return isReportDayUploaded(getTodayKey());
}

export async function closeDayForToday() {
  if (!isReportSyncConfigured()) {
    throw new Error(CLOSE_DAY_ERRORS.appsScript);
  }

  const dateKey = getTodayKey();
  if (await isReportDayUploaded(dateKey)) {
    throw new Error(CLOSE_DAY_ERRORS.alreadyClosed);
  }

  const [orders, sessions, parties] = await Promise.all([
    fetchActiveOrdersOnce(),
    fetchActivePrivateSessionsOnce(),
    fetchActivePartySessionsOnce()
  ]);

  if (orders.some(orderHasUnservedItems)) {
    throw new Error(CLOSE_DAY_ERRORS.unserved);
  }

  if (sessions.length > 0) {
    throw new Error(CLOSE_DAY_ERRORS.sitting);
  }

  if (parties.length > 0) {
    throw new Error(CLOSE_DAY_ERRORS.party);
  }

  await getJsPdf();
  const report = await fetchDayWiseReport(dateKey, dateKey);
  await attachExpensesToReport(report, dateKey);
  await uploadReportToDrive(dateKey, report);
  await downloadSalesReportPdf(report);
  return { dateKey };
}
