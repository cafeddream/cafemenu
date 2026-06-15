/**
 * Deploy as Web App (Execute as: Me, Access: Anyone).
 * Paste deployed URL into CONFIG.APPS_SCRIPT_URL in firebase.js.
 */
const ROOT_FOLDER_NAME = "Cafe D Dream";
const SITTING_FOLDER_NAME = "Private Sitting";

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
  "Amount",
  "C1 Front URL",
  "C1 Back URL",
  "C2 Front URL",
  "C2 Back URL",
  "PDF URL",
  "Session ID"
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

    return jsonResponse({ ok: false, error: "Unknown action" });
  } catch (error) {
    return jsonResponse({ ok: false, error: String(error) });
  }
}

function handleCheckIn(payload) {
  const sheet = ensureSheet_();
  const dateKey = payload.dateKey || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  const folder = ensureDayFolder_(dateKey, payload.sittingId, payload.sessionId);

  const customers = payload.customers || [];
  const photoUrls = [];
  (payload.photoFiles || []).forEach((photoFile) => {
    if (!photoFile?.base64) return;
    const fileName = photoFile.name || `photo_${photoUrls.length + 1}.jpg`;
    const blob = Utilities.newBlob(Utilities.base64Decode(photoFile.base64), "image/jpeg", fileName);
    photoUrls.push(folder.createFile(blob).getUrl());
  });

  let pdfUrl = "";
  if (payload.pdfBase64) {
    const pdfBlob = Utilities.newBlob(Utilities.base64Decode(payload.pdfBase64), "application/pdf", "entry.pdf");
    pdfUrl = folder.createFile(pdfBlob).getUrl();
  }

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
    "",
    photoUrls[0] || "",
    photoUrls[1] || "",
    photoUrls[2] || "",
    photoUrls[3] || "",
    pdfUrl,
    payload.sessionId || ""
  ];

  sheet.appendRow(row);
  const rowNumber = sheet.getLastRow();

  return {
    ok: true,
    rowNumber,
    driveFolderUrl: folder.getUrl(),
    photoDriveUrls: photoUrls,
    pdfDriveUrl: pdfUrl
  };
}

function handleCheckout(payload) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const rowNumber = Number(payload.sheetRowNumber || 0);
  if (!rowNumber || rowNumber < 2) {
    return { ok: false, error: "Missing sheet row number" };
  }

  sheet.getRange(rowNumber, 9).setValue(payload.checkOutLabel || "");
  sheet.getRange(rowNumber, 10).setValue(payload.durationMinutes || "");
  sheet.getRange(rowNumber, 11).setValue(payload.billedAmount || "");

  return { ok: true };
}

function ensureSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName("Private Sitting");
  if (!sheet) {
    sheet = spreadsheet.insertSheet("Private Sitting");
    sheet.appendRow(SHEET_HEADERS);
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(SHEET_HEADERS);
  }
  return sheet;
}

function ensureDayFolder_(dateKey, sittingId, sessionId) {
  const root = getOrCreateFolder_(DriveApp.getRootFolder(), ROOT_FOLDER_NAME);
  const sittingRoot = getOrCreateFolder_(root, SITTING_FOLDER_NAME);
  const dayFolder = getOrCreateFolder_(sittingRoot, dateKey);
  const folderName = `${sittingId || "PS"}_${sessionId || Utilities.getUuid()}`;
  const matches = dayFolder.getFoldersByName(folderName);
  return matches.hasNext() ? matches.next() : dayFolder.createFolder(folderName);
}

function getOrCreateFolder_(parent, name) {
  const matches = parent.getFoldersByName(name);
  return matches.hasNext() ? matches.next() : parent.createFolder(name);
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
