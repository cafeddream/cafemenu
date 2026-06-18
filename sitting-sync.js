import { CONFIG } from "./firebase.js";

export function isAppsScriptConfigured() {
  const url = CONFIG.APPS_SCRIPT_URL || "";
  return url && !url.includes("PASTE_DEPLOYED_WEB_APP_URL");
}

export async function postAppsScript(payload, timeoutMs = 90000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(CONFIG.APPS_SCRIPT_URL, {
      method: "POST",
      mode: "cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Apps Script failed (${response.status})`);
    }

    return response.json();
  } finally {
    clearTimeout(timer);
  }
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

export async function fetchSessionPhotos(fileIds = []) {
  if (!isAppsScriptConfigured()) {
    return { skipped: true, reason: "Apps Script URL not configured" };
  }
  const ids = (fileIds || []).filter(Boolean);
  if (!ids.length) {
    return { ok: false, error: "No photo file ids" };
  }
  return postAppsScript({ action: "fetchPhotos", fileIds: ids });
}

export async function uploadSittingPhotos(payload) {
  if (!isAppsScriptConfigured()) {
    return { skipped: true, reason: "Apps Script URL not configured" };
  }
  return postAppsScript({ action: "uploadPhotos", ...payload });
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
