/**
 * Deploy as Web App (Execute as: Me, Access: Anyone).
 * Paste deployed URL into CONFIG.APPS_SCRIPT_URL in firebase.js.
 *
 * Sheet migration: rename old "Private Sitting" tab to "Private Sitting (old)".
 * Script creates a fresh "Private Sitting" tab with 11 columns if missing.
 */
const ROOT_FOLDER_NAME = "Cafe D Dream";
const SITTING_FOLDER_NAME = "Private Sitting";
const REPORTS_FOLDER_NAME = "Sales Reports";
const SHEET_NAME = "Private Sitting";
const SALES_SHEET_NAME = "Sales Reports";

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

const SALES_SHEET_HEADERS = [
  "Date",
  "Net",
  "Gross",
  "Paid Orders",
  "Void Count",
  "Void Gross",
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
    if (action === "saveSalesReport") {
      return jsonResponse(handleSaveSalesReport(payload));
    }

    return jsonResponse({ ok: false, error: "Unknown action" });
  } catch (error) {
    return jsonResponse({ ok: false, error: String(error) });
  }
}

function isValidPdfBytes_(bytes) {
  return bytes
    && bytes.length > 500
    && bytes[0] === 0x25
    && bytes[1] === 0x50
    && bytes[2] === 0x44
    && bytes[3] === 0x46;
}

function buildPdfBlob_(bytes, fileName) {
  const name = String(fileName || "session.pdf");
  const safeName = name.toLowerCase().endsWith(".pdf") ? name : name + ".pdf";
  return Utilities.newBlob(bytes, "application/pdf", safeName);
}

function writePdfToDrive_(bytes, options) {
  const fileName = options.fileName || "session.pdf";
  const pdfBlob = buildPdfBlob_(bytes, fileName);
  const dayFolder = options.dayFolder;
  const existingFileId = String(options.existingFileId || "");
  const sheet = options.sheet;
  const rowNumber = Number(options.rowNumber || 0);

  let pdfUrl = "";
  let pdfFileId = "";

  if (existingFileId) {
    try {
      const existing = DriveApp.getFileById(existingFileId);
      const parents = existing.getParents();
      const parentFolder = parents.hasNext() ? parents.next() : dayFolder;
      existing.setTrashed(true);
      const pdfFile = parentFolder.createFile(pdfBlob);
      pdfUrl = pdfFile.getUrl();
      pdfFileId = pdfFile.getId();
    } catch (replaceError) {
      const pdfFile = dayFolder.createFile(pdfBlob);
      pdfUrl = pdfFile.getUrl();
      pdfFileId = pdfFile.getId();
    }
  } else {
    const pdfFile = dayFolder.createFile(pdfBlob);
    pdfUrl = pdfFile.getUrl();
    pdfFileId = pdfFile.getId();
  }

  if (sheet && rowNumber >= 2 && pdfUrl) {
    sheet.getRange(rowNumber, 11).setValue(pdfUrl);
  }

  return {
    pdfUrl: pdfUrl,
    pdfFileId: pdfFileId,
    pdfBytes: bytes.length
  };
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

function trashSessionPhotoFolder_(dateKey, sessionId) {
  const folderName = String(sessionId || "");
  if (!folderName) return;
  try {
    const dayFolder = ensureDayFolder_(dateKey);
    const folders = dayFolder.getFoldersByName(folderName);
    while (folders.hasNext()) {
      folders.next().setTrashed(true);
    }
  } catch (folderError) {
    // Folder may already be removed.
  }
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
  let pdfError = "";
  const pdfBase64 = String(payload.pdfBase64 || "");
  if (pdfBase64.length > 500) {
    const bytes = Utilities.base64Decode(pdfBase64);
    if (isValidPdfBytes_(bytes)) {
      const fileName = payload.pdfFileName || "session_" + sessionId + ".pdf";
      const saved = writePdfToDrive_(bytes, {
        dayFolder: dayFolder,
        fileName: fileName,
        existingFileId: "",
        sheet: null,
        rowNumber: 0
      });
      pdfUrl = saved.pdfUrl;
      pdfFileId = saved.pdfFileId;
    } else {
      pdfError = "Invalid PDF";
    }
  }

  const customers = payload.customers || [];
  const existingRow = Number(payload.sheetRowNumber || 0);
  let rowNumber = existingRow;

  if (existingRow >= 2) {
    if (pdfUrl) {
      sheet.getRange(existingRow, 11).setValue(pdfUrl);
    }
  } else {
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
    rowNumber = sheet.getLastRow();
  }

  return {
    ok: true,
    rowNumber: rowNumber,
    photoFileIds: photoFileIds,
    pdfDriveUrl: pdfUrl,
    pdfFileId: pdfFileId,
    pdfError: pdfError
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

  const dateKey = payload.dateKey || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  const sessionId = String(payload.sessionId || "");

  const pdfBase64 = String(payload.pdfBase64 || "");
  if (!pdfBase64 || pdfBase64.length <= 500) {
    trashSessionPhotoFolder_(dateKey, sessionId);
    return {
      ok: true,
      sheetUpdated: true,
      pdfUploaded: false,
      pdfError: "Missing checkout PDF"
    };
  }

  const bytes = Utilities.base64Decode(pdfBase64);
  if (!isValidPdfBytes_(bytes)) {
    trashSessionPhotoFolder_(dateKey, sessionId);
    return {
      ok: true,
      sheetUpdated: true,
      pdfUploaded: false,
      pdfError: "Invalid PDF"
    };
  }

  const dayFolder = ensureDayFolder_(dateKey);
  const fileName = payload.pdfFileName || "session_checkout.pdf";
  const saved = writePdfToDrive_(bytes, {
    dayFolder: dayFolder,
    fileName: fileName,
    existingFileId: payload.pdfFileId || "",
    sheet: sheet,
    rowNumber: rowNumber
  });

  if (!saved.pdfFileId) {
    trashSessionPhotoFolder_(dateKey, sessionId);
    return {
      ok: true,
      sheetUpdated: true,
      pdfUploaded: false,
      pdfError: "PDF upload failed"
    };
  }

  trashDriveFiles_(payload.photoFileIdsToDelete || []);
  trashSessionPhotoFolder_(dateKey, sessionId);

  return {
    ok: true,
    sheetUpdated: true,
    pdfUploaded: true,
    pdfDriveUrl: saved.pdfUrl,
    pdfFileId: saved.pdfFileId,
    pdfBytes: saved.pdfBytes
  };
}

function handleFetchPdf(payload) {
  const fileId = String(payload.pdfFileId || "");
  if (!fileId) {
    return { ok: false, error: "Missing pdfFileId" };
  }

  const file = DriveApp.getFileById(fileId);
  const bytes = file.getBlob().getBytes();
  if (!isValidPdfBytes_(bytes)) {
    return { ok: false, error: "PDF file too small or invalid" };
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

function handleSaveSalesReport(payload) {
  const dateKey = String(payload.dateKey || "");
  const pdfBase64 = String(payload.pdfBase64 || "");
  if (!dateKey) {
    return { ok: false, error: "Missing dateKey" };
  }
  if (!pdfBase64 || pdfBase64.length <= 500) {
    return { ok: false, error: "Missing PDF" };
  }

  const bytes = Utilities.base64Decode(pdfBase64);
  if (!isValidPdfBytes_(bytes)) {
    return { ok: false, error: "Invalid PDF" };
  }

  const root = getOrCreateFolder_(DriveApp.getRootFolder(), ROOT_FOLDER_NAME);
  const reportsRoot = getOrCreateFolder_(root, REPORTS_FOLDER_NAME);
  const dayFolder = getOrCreateFolder_(reportsRoot, dateKey);
  const fileName = "sales-report-" + dateKey + ".pdf";
  const existing = dayFolder.getFilesByName(fileName);
  if (existing.hasNext()) {
    const pdfFile = existing.next();
    return {
      ok: true,
      skipped: true,
      pdfUrl: pdfFile.getUrl(),
      pdfFileId: pdfFile.getId()
    };
  }

  const pdfFile = dayFolder.createFile(buildPdfBlob_(bytes, fileName));
  const pdfUrl = pdfFile.getUrl();
  const pdfFileId = pdfFile.getId();
  const summary = payload.summary || {};
  const sheet = ensureSalesSheet_();
  sheet.appendRow([
    dateKey,
    Number(summary.total || 0),
    Number(summary.grossTotal || 0),
    Number(summary.paidOrderCount || 0),
    Number(summary.voidOrderCount || 0),
    Number(summary.voidOrderGross || 0),
    pdfUrl
  ]);

  return {
    ok: true,
    pdfUrl: pdfUrl,
    pdfFileId: pdfFileId,
    pdfBytes: bytes.length
  };
}

function ensureSalesSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(SALES_SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(SALES_SHEET_NAME);
    sheet.appendRow(SALES_SHEET_HEADERS);
    return sheet;
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(SALES_SHEET_HEADERS);
  }

  return sheet;
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
