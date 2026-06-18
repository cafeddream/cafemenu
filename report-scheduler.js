import {
  fetchDayWiseReport,
  getTodayKey,
  getYesterdayKey,
  purgeReportDataForDate
} from "./firebase.js";
import { buildSalesReportPdfBase64 } from "./report-pdf.js";
import { isReportSyncConfigured, syncSalesReportToDrive } from "./report-sync.js";
import { preloadJsPdf } from "./private-sitting-pdf.js";

const REPORT_STATE_KEY = "cafe_sales_report_state";
let midnightTimer = null;
let runningDateKey = null;

function loadReportState() {
  try {
    return JSON.parse(localStorage.getItem(REPORT_STATE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveReportState(state) {
  localStorage.setItem(REPORT_STATE_KEY, JSON.stringify(state));
}

function isUploadedAndPurged(dateKey) {
  const state = loadReportState();
  return Boolean(state.uploaded?.[dateKey] && state.purged?.[dateKey]);
}

function markUploaded(dateKey) {
  const state = loadReportState();
  state.uploaded = state.uploaded || {};
  state.uploaded[dateKey] = true;
  saveReportState(state);
}

function markPurged(dateKey) {
  const state = loadReportState();
  state.purged = state.purged || {};
  state.purged[dateKey] = true;
  saveReportState(state);
}

function pickSummary(report) {
  return {
    total: report.total || 0,
    grossTotal: report.grossTotal || 0,
    paidOrderCount: report.paidOrderCount ?? report.totalOrders ?? 0,
    voidOrderCount: report.voidOrderCount || 0,
    voidOrderGross: report.voidOrderGross ?? report.voidOrderAmount ?? 0
  };
}

function msUntilNextMidnight() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return Math.max(next.getTime() - now.getTime(), 1000);
}

function scheduleNextMidnight(callback) {
  if (midnightTimer) clearTimeout(midnightTimer);
  midnightTimer = setTimeout(() => {
    callback().finally(() => scheduleNextMidnight(callback));
  }, msUntilNextMidnight());
}

async function retryPendingPurges() {
  const state = loadReportState();
  const uploaded = state.uploaded || {};
  const purged = state.purged || {};
  const todayKey = getTodayKey();

  for (const dateKey of Object.keys(uploaded)) {
    if (purged[dateKey] || dateKey >= todayKey) continue;
    try {
      await purgeReportDataForDate(dateKey);
      markPurged(dateKey);
      console.info("[report] Purged Firebase data for", dateKey);
    } catch (error) {
      console.warn("[report] Purge retry failed for", dateKey, error);
    }
  }
}

export async function runDailyReportForDate(dateKey) {
  if (!dateKey || dateKey >= getTodayKey()) return;
  if (isUploadedAndPurged(dateKey)) return;
  if (!isReportSyncConfigured()) return;
  if (runningDateKey === dateKey) return;

  runningDateKey = dateKey;
  try {
    const state = loadReportState();
    const alreadyUploaded = Boolean(state.uploaded?.[dateKey]);

    if (!alreadyUploaded) {
      preloadJsPdf();
      const report = await fetchDayWiseReport(dateKey, dateKey);
      const pdfBase64 = await buildSalesReportPdfBase64(report);
      const result = await syncSalesReportToDrive({
        dateKey,
        pdfBase64,
        summary: pickSummary(report)
      });
      if (!result?.ok) {
        throw new Error(result?.error || "Drive upload failed");
      }
      markUploaded(dateKey);
      console.info("[report] Uploaded sales report to Drive for", dateKey);
    }

    if (!loadReportState().purged?.[dateKey]) {
      await purgeReportDataForDate(dateKey);
      markPurged(dateKey);
      console.info("[report] Purged Firebase data for", dateKey);
    }
  } finally {
    runningDateKey = null;
  }
}

export function runYesterdayReportIfNeeded() {
  return runDailyReportForDate(getYesterdayKey());
}

export function startDailyReportScheduler() {
  retryPendingPurges().catch((error) => console.warn("[report] Pending purge check failed", error));
  runYesterdayReportIfNeeded().catch((error) => console.warn("[report] Daily report failed", error));
  scheduleNextMidnight(() => runYesterdayReportIfNeeded());
}
