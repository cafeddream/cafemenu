/**
 * Deploy as Web App (Execute as: Me, Access: Anyone).
 * Paste deployed URL into CONFIG.APPS_SCRIPT_URL in firebase.js.
 *
 * Sheet migration: rename old "Private Sitting" tab to "Private Sitting (old)".
 * Script creates a fresh "Private Sitting" tab with 11 columns if missing.
 */
const ROOT_FOLDER_NAME = "Cafe D Dream";
const SITTING_FOLDER_NAME = "Private Sitting";
const SHEET_NAME = "Private Sitting";

const SHEET_HEADERS = [
  "Date",
  "Sitting",
  "Mobile",
  "C1 Name",
  "C1 DOB",
  "C2 Name",
  "C2 DOB",
  "Check-in",
  "Check-out",
  "Duration (min)",
  "PDF URL"
];

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents || "{}");
    const action = payload.action;

    if (action === "checkin") {
      return jsonResponse(handleCheckIn(payload));
    }
    if (action === "checkout") {
      return jsonResponse(handleCheckout(payload));
    }
    if (action === "fetchPdf") {
      return jsonResponse(handleFetchPdf(payload));
    }

    return jsonResponse({ ok: false, error: "Unknown action" });
  } catch (error) {
    return jsonResponse({ ok: false, error: String(error) });
  }
}

function handleCheckIn(payload) {
  const sheet = ensureSheet_();
  const dateKey = payload.dateKey || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  const dayFolder = ensureDayFolder_(dateKey);

  let pdfUrl = "";
  let pdfFileId = "";
  if (payload.pdfBase64) {
    const fileName = payload.pdfFileName || `session_${payload.sessionId || Utilities.getUuid()}.pdf`;
    const pdfBlob = Utilities.newBlob(
      Utilities.base64Decode(payload.pdfBase64),
      "application/pdf",
      fileName
    );
    const pdfFile = dayFolder.createFile(pdfBlob);
    pdfUrl = pdfFile.getUrl();
    pdfFileId = pdfFile.getId();
  }

  const customers = payload.customers || [];
  const row = [
    dateKey,
    payload.sittingId || "",
    payload.mobile || "",
    customers[0]?.name || "",
    customers[0]?.dob || "",
    customers[1]?.name || "",
    customers[1]?.dob || "",
    payload.checkInLabel || "",
    "",
    "",
    pdfUrl
  ];

  sheet.appendRow(row);
  const rowNumber = sheet.getLastRow();

  return {
    ok: true,
    rowNumber: rowNumber,
    pdfDriveUrl: pdfUrl,
    pdfFileId: pdfFileId
  };
}

function handleCheckout(payload) {
  const sheet = ensureSheet_();
  const rowNumber = Number(payload.sheetRowNumber || 0);
  if (!rowNumber || rowNumber < 2) {
    return { ok: false, error: "Missing sheet row number" };
  }

  sheet.getRange(rowNumber, 9).setValue(payload.checkOutLabel || "");
  sheet.getRange(rowNumber, 10).setValue(payload.durationMinutes || "");

  let pdfUrl = "";
  const pdfBase64 = String(payload.pdfBase64 || "");
  if (pdfBase64.length > 500) {
    const bytes = Utilities.base64Decode(pdfBase64);
    if (bytes && bytes.length > 500) {
      const fileName = payload.pdfFileName || "session_checkout.pdf";
      const pdfBlob = Utilities.newBlob(bytes, "application/pdf", fileName);

      if (payload.pdfFileId) {
        try {
          const existing = DriveApp.getFileById(payload.pdfFileId);
          existing.setContent(pdfBlob);
          pdfUrl = existing.getUrl();
        } catch (replaceError) {
          const dateKey = payload.dateKey || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
          const dayFolder = ensureDayFolder_(dateKey);
          const pdfFile = dayFolder.createFile(pdfBlob);
          pdfUrl = pdfFile.getUrl();
          sheet.getRange(rowNumber, 11).setValue(pdfUrl);
        }
      } else {
        const dateKey = payload.dateKey || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
        const dayFolder = ensureDayFolder_(dateKey);
        const pdfFile = dayFolder.createFile(pdfBlob);
        pdfUrl = pdfFile.getUrl();
        sheet.getRange(rowNumber, 11).setValue(pdfUrl);
      }
    }
  }

  return {
    ok: true,
    pdfDriveUrl: pdfUrl
  };
}

function handleFetchPdf(payload) {
  const fileId = String(payload.pdfFileId || "");
  if (!fileId) {
    return { ok: false, error: "Missing pdfFileId" };
  }

  const file = DriveApp.getFileById(fileId);
  const bytes = file.getBlob().getBytes();
  if (!bytes || bytes.length < 500) {
    return { ok: false, error: "PDF file too small or empty" };
  }

  return {
    ok: true,
    pdfBase64: Utilities.base64Encode(bytes)
  };
}

function ensureSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
    sheet.appendRow(SHEET_HEADERS);
    return sheet;
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(SHEET_HEADERS);
    return sheet;
  }

  const header = sheet.getRange(1, 1, 1, SHEET_HEADERS.length).getValues()[0];
  const matches = header.every(function(value, index) {
    return String(value || "") === SHEET_HEADERS[index];
  });

  if (!matches) {
    const altName = SHEET_NAME + " " + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
    sheet = spreadsheet.insertSheet(altName);
    sheet.appendRow(SHEET_HEADERS);
  }

  return sheet;
}

function ensureDayFolder_(dateKey) {
  const root = getOrCreateFolder_(DriveApp.getRootFolder(), ROOT_FOLDER_NAME);
  const sittingRoot = getOrCreateFolder_(root, SITTING_FOLDER_NAME);
  return getOrCreateFolder_(sittingRoot, dateKey);
}

function getOrCreateFolder_(parent, name) {
  const matches = parent.getFoldersByName(name);
  return matches.hasNext() ? matches.next() : parent.createFolder(name);
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
