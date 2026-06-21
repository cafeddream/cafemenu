import {
  fetchDayWiseReport,
  getReportArchiveStatus,
  getTodayKey,
  getYesterdayKey,
  markReportArchived,
  markReportPurged,
  purgeReportDataForDate
} from "./firebase.js";
import { buildSalesReportPdfBase64 } from "./report-pdf.js";
import { isReportSyncConfigured, syncSalesReportToDrive } from "./report-sync.js";
import { attachExpensesToReport } from "./expense-sync.js";
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

function markUploadedLocal(dateKey) {
  const state = loadReportState();
  state.uploaded = state.uploaded || {};
  state.uploaded[dateKey] = true;
  saveReportState(state);
}

function markPurgedLocal(dateKey) {
  const state = loadReportState();
  state.purged = state.purged || {};
  state.purged[dateKey] = true;
  saveReportState(state);
}

async function getArchiveStatus(dateKey) {
  try {
    return await getReportArchiveStatus(dateKey);
  } catch (error) {
    console.warn("[report] Firestore archive check failed for", dateKey, error);
    return null;
  }
}

async function isUploadedAndPurged(dateKey) {
  const archive = await getArchiveStatus(dateKey);
  if (archive?.uploaded && archive?.purged) {
    markUploadedLocal(dateKey);
    markPurgedLocal(dateKey);
    return true;
  }

  const state = loadReportState();
  return Boolean(state.uploaded?.[dateKey] && state.purged?.[dateKey]);
}

async function isAlreadyUploaded(dateKey) {
  const archive = await getArchiveStatus(dateKey);
  if (archive?.uploaded) {
    markUploadedLocal(dateKey);
    if (archive.purged) markPurgedLocal(dateKey);
    return true;
  }

  return Boolean(loadReportState().uploaded?.[dateKey]);
}

async function isAlreadyPurged(dateKey) {
  const archive = await getArchiveStatus(dateKey);
  if (archive?.purged) {
    markPurgedLocal(dateKey);
    return true;
  }

  return Boolean(loadReportState().purged?.[dateKey]);
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

function isReportEmpty(report) {
  const paidOrderCount = report.paidOrderCount ?? report.totalOrders ?? 0;
  const hasSales = paidOrderCount > 0 || Number(report.total || 0) > 0;
  const hasExpenses = Number(report.expenseTotal || 0) > 0;
  return !hasSales && !hasExpenses;
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

async function recordSuccessfulUpload(dateKey, result, summary) {
  await markReportArchived(dateKey, {
    driveFileId: result.pdfFileId || null,
    summary
  });
  markUploadedLocal(dateKey);
}

async function uploadReportToDrive(dateKey, report) {
  const summary = pickSummary(report);
  const pdfBase64 = await buildSalesReportPdfBase64(report);
  const result = await syncSalesReportToDrive({ dateKey, pdfBase64, summary });
  if (!result?.ok) {
    throw new Error(result?.error || "Drive upload failed");
  }
  await recordSuccessfulUpload(dateKey, result, summary);
  if (result.skipped) {
    console.info("[report] Drive already has sales report for", dateKey);
  } else {
    console.info("[report] Uploaded sales report to Drive for", dateKey);
  }
  return result;
}

async function retryPendingPurges() {
  const state = loadReportState();
  const uploaded = state.uploaded || {};
  const todayKey = getTodayKey();

  for (const dateKey of Object.keys(uploaded)) {
    if (dateKey >= todayKey) continue;
    if (await isAlreadyPurged(dateKey)) continue;

    try {
      await purgeReportDataForDate(dateKey);
      await markReportPurged(dateKey);
      markPurgedLocal(dateKey);
      console.info("[report] Purged Firebase data for", dateKey);
    } catch (error) {
      console.warn("[report] Purge retry failed for", dateKey, error);
    }
  }
}

export async function runDailyReportForDate(dateKey) {
  if (!dateKey || dateKey >= getTodayKey()) return;
  if (await isUploadedAndPurged(dateKey)) return;
  if (!isReportSyncConfigured()) return;
  if (runningDateKey === dateKey) return;

  runningDateKey = dateKey;
  try {
    const alreadyUploaded = await isAlreadyUploaded(dateKey);

    if (!alreadyUploaded) {
      preloadJsPdf();
      const report = await fetchDayWiseReport(dateKey, dateKey);
      await attachExpensesToReport(report, dateKey);

      if (isReportEmpty(report)) {
        console.warn("[report] Skipping empty report for", dateKey, "— data may already be archived");
        return;
      }

      await uploadReportToDrive(dateKey, report);
    }

    if (!(await isAlreadyPurged(dateKey))) {
      await purgeReportDataForDate(dateKey);
      await markReportPurged(dateKey);
      markPurgedLocal(dateKey);
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
