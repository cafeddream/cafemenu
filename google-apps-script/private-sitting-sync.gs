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
    if (action === "fetchPhotos") {
      return jsonResponse(handleFetchPhotos(payload));
    }
    if (action === "uploadPhotos") {
      return jsonResponse(handleUploadPhotos(payload));
    }

    return jsonResponse({ ok: false, error: "Unknown action" });
  } catch (error) {
    return jsonResponse({ ok: false, error: String(error) });
  }
}

function uploadSessionPhotos_(sessionFolder, sessionId, photos) {
  const photoFileIds = [];
  const items = photos || [];
  items.forEach(function(photo, index) {
    const prefix = String(photo.prefix || "C" + (index + 1));
    let frontId = "";
    let backId = "";
    const frontBase64 = String(photo.frontBase64 || "");
    if (frontBase64.length > 100) {
      const frontBlob = Utilities.newBlob(
        Utilities.base64Decode(frontBase64),
        "image/jpeg",
        sessionId + "_" + prefix + "_front.jpg"
      );
      frontId = sessionFolder.createFile(frontBlob).getId();
    }
    const backBase64 = String(photo.backBase64 || "");
    if (backBase64.length > 100) {
      const backBlob = Utilities.newBlob(
        Utilities.base64Decode(backBase64),
        "image/jpeg",
        sessionId + "_" + prefix + "_back.jpg"
      );
      backId = sessionFolder.createFile(backBlob).getId();
    }
    photoFileIds.push({ frontId: frontId, backId: backId });
  });
  return photoFileIds;
}

function trashDriveFiles_(fileIds) {
  const ids = fileIds || [];
  ids.forEach(function(id) {
    const fileId = String(id || "");
    if (!fileId) return;
    try {
      DriveApp.getFileById(fileId).setTrashed(true);
    } catch (trashError) {
      // File may already be removed.
    }
  });
}

function handleCheckIn(payload) {
  const sheet = ensureSheet_();
  const dateKey = payload.dateKey || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  const dayFolder = ensureDayFolder_(dateKey);
  const sessionId = String(payload.sessionId || Utilities.getUuid());
  const photos = payload.photos || [];

  let photoFileIds = [];
  if (photos.length) {
    const sessionFolder = getOrCreateFolder_(dayFolder, sessionId);
    photoFileIds = uploadSessionPhotos_(sessionFolder, sessionId, photos);
  }

  let pdfUrl = "";
  let pdfFileId = "";
  if (payload.pdfBase64) {
    const fileName = payload.pdfFileName || "session_" + sessionId + ".pdf";
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
    photoFileIds: photoFileIds,
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
  let pdfFileId = "";
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
          pdfFileId = existing.getId();
        } catch (replaceError) {
          const dateKey = payload.dateKey || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
          const dayFolder = ensureDayFolder_(dateKey);
          const pdfFile = dayFolder.createFile(pdfBlob);
          pdfUrl = pdfFile.getUrl();
          pdfFileId = pdfFile.getId();
          sheet.getRange(rowNumber, 11).setValue(pdfUrl);
        }
      } else {
        const dateKey = payload.dateKey || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
        const dayFolder = ensureDayFolder_(dateKey);
        const pdfFile = dayFolder.createFile(pdfBlob);
        pdfUrl = pdfFile.getUrl();
        pdfFileId = pdfFile.getId();
        sheet.getRange(rowNumber, 11).setValue(pdfUrl);
      }
    }
  }

  trashDriveFiles_(payload.photoFileIdsToDelete || []);

  return {
    ok: true,
    pdfDriveUrl: pdfUrl,
    pdfFileId: pdfFileId
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

function handleUploadPhotos(payload) {
  const dateKey = payload.dateKey || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  const dayFolder = ensureDayFolder_(dateKey);
  const sessionId = String(payload.sessionId || Utilities.getUuid());
  const photos = payload.photos || [];

  if (!photos.length) {
    return { ok: false, error: "No photos provided" };
  }

  const sessionFolder = getOrCreateFolder_(dayFolder, sessionId);
  const photoFileIds = uploadSessionPhotos_(sessionFolder, sessionId, photos);

  return {
    ok: true,
    photoFileIds: photoFileIds
  };
}

function handleFetchPhotos(payload) {
  const ids = payload.fileIds || [];
  const photos = {};
  ids.forEach(function(id) {
    const fileId = String(id || "");
    if (!fileId) return;
    try {
      const file = DriveApp.getFileById(fileId);
      const bytes = file.getBlob().getBytes();
      if (bytes && bytes.length > 100) {
        photos[fileId] = Utilities.base64Encode(bytes);
      }
    } catch (fetchError) {
      // Skip missing or inaccessible files.
    }
  });

  return {
    ok: true,
    photos: photos
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
