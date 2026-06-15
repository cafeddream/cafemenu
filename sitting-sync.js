import { CONFIG } from "./firebase.js";

function isAppsScriptConfigured() {
  const url = CONFIG.APPS_SCRIPT_URL || "";
  return url && !url.includes("PASTE_DEPLOYED_WEB_APP_URL");
}

export async function syncSittingCheckIn(payload) {
  if (!isAppsScriptConfigured()) {
    return { skipped: true, reason: "Apps Script URL not configured" };
  }

  const response = await fetch(CONFIG.APPS_SCRIPT_URL, {
    method: "POST",
    mode: "cors",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "checkin", ...payload })
  });

  if (!response.ok) {
    throw new Error(`Apps Script failed (${response.status})`);
  }

  return response.json();
}

export async function syncSittingCheckout(payload) {
  if (!isAppsScriptConfigured()) {
    return { skipped: true, reason: "Apps Script URL not configured" };
  }

  const response = await fetch(CONFIG.APPS_SCRIPT_URL, {
    method: "POST",
    mode: "cors",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "checkout", ...payload })
  });

  if (!response.ok) {
    throw new Error(`Apps Script failed (${response.status})`);
  }

  return response.json();
}

export function isSittingSyncConfigured() {
  return isAppsScriptConfigured();
}
