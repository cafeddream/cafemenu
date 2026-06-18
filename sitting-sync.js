import { CONFIG } from "./firebase.js";

function isAppsScriptConfigured() {
  const url = CONFIG.APPS_SCRIPT_URL || "";
  return url && !url.includes("PASTE_DEPLOYED_WEB_APP_URL");
}

async function postAppsScript(payload) {
  const response = await fetch(CONFIG.APPS_SCRIPT_URL, {
    method: "POST",
    mode: "cors",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Apps Script failed (${response.status})`);
  }

  return response.json();
}

export async function syncSittingCheckIn(payload) {
  if (!isAppsScriptConfigured()) {
    return { skipped: true, reason: "Apps Script URL not configured" };
  }
  return postAppsScript({ action: "checkin", ...payload });
}

export async function fetchSessionPdf(pdfFileId) {
  if (!isAppsScriptConfigured()) {
    return { skipped: true, reason: "Apps Script URL not configured" };
  }
  if (!pdfFileId) {
    return { ok: false, error: "Missing pdfFileId" };
  }
  return postAppsScript({ action: "fetchPdf", pdfFileId });
}

export async function syncSittingCheckout(payload) {
  if (!isAppsScriptConfigured()) {
    return { skipped: true, reason: "Apps Script URL not configured" };
  }
  return postAppsScript({ action: "checkout", ...payload });
}

export function isSittingSyncConfigured() {
  return isAppsScriptConfigured();
}
