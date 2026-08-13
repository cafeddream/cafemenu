/**
 * Deploy as Web App (Execute as: Me, Access: Anyone).
 * Paste deployed URL into CONFIG.APPS_SCRIPT_URL in firebase.js.
 *
 * Sheet migration: rename old "Private Sitting" tab to "Private Sitting (old)".
 * Script creates a fresh "Private Sitting" tab with 11 columns if missing.
 */
const ROOT_FOLDER_NAME = "Cafe D Dream";
const SITTING_FOLDER_NAME = "Private Sitting";
const CUSTOMER_PROFILE_FOLDER_NAME = "Private Customer Profiles";
const REPORTS_FOLDER_NAME = "Sales Reports";
const SHEET_NAME = "Private Sitting";
const CUSTOMER_PROFILE_SHEET_NAME = "Private Customer Profiles";
const SALES_SHEET_NAME = "Sales Reports";
const PENDING_SHEET_NAME = "Pending Orders";
const EXPENSES_FOLDER_NAME = "Expenses";
const EXPENSES_SHEET_NAME = "Expenses";

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

const PENDING_SHEET_HEADERS = [
  "Date",
  "Time",
  "Name",
  "Mobile",
  "Table",
  "Items",
  "Gross",
  "Discount",
  "Net",
  "Order ID"
];

const EXPENSES_SHEET_HEADERS = [
  "Date",
  "Time",
  "Description",
  "Amount",
  "Receipt Link",
  "Notes",
  "Added By"
];

const CUSTOMER_PROFILE_HEADERS = [
  "Mobile",
  "C1 Name",
  "C1 DOB",
  "C1 Front ID",
  "C1 Back ID",
  "C2 Name",
  "C2 DOB",
  "C2 Front ID",
  "C2 Back ID",
  "Updated At",
  "Last Session ID",
  "Last Sitting ID"
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
    if (action === "fetchCustomerProfile") {
      return jsonResponse(handleFetchCustomerProfile(payload));
    }
    if (action === "saveCustomerProfile") {
      return jsonResponse(handleSaveCustomerProfile(payload));
    }
    if (action === "saveSalesReport") {
      return jsonResponse(handleSaveSalesReport(payload));
    }
    if (action === "savePendingOrder") {
      return jsonResponse(handleSavePendingOrder(payload));
    }
    if (action === "saveExpense") {
      return jsonResponse(handleSaveExpense(payload));
    }
    if (action === "fetchExpensesForDate") {
      return jsonResponse(handleFetchExpensesForDate(payload));
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

function normalizeMobile_(value) {
  const digits = String(value || "").replace(/\D/g, "");
  const withoutCountry = digits.length > 10 && digits.indexOf("91") === 0
    ? digits.slice(2)
    : digits;
  const mobile = withoutCountry.slice(-10);
  return /^[6-9]\d{9}$/.test(mobile) ? mobile : "";
}

function stripDataUrl_(value) {
  const text = String(value || "");
  const comma = text.indexOf(",");
  return comma >= 0 ? text.slice(comma + 1) : text;
}

function findCustomerProfileRow_(sheet, mobile) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const rows = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < rows.length; i += 1) {
    if (normalizeMobile_(rows[i][0]) === mobile) {
      return i + 2;
    }
  }
  return 0;
}

function ensureCustomerProfileSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(CUSTOMER_PROFILE_SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(CUSTOMER_PROFILE_SHEET_NAME);
    sheet.appendRow(CUSTOMER_PROFILE_HEADERS);
    return sheet;
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(CUSTOMER_PROFILE_HEADERS);
    return sheet;
  }
  const header = sheet.getRange(1, 1, 1, CUSTOMER_PROFILE_HEADERS.length).getValues()[0];
  const matches = CUSTOMER_PROFILE_HEADERS.every(function(value, index) {
    return String(header[index] || "") === value;
  });
  if (!matches) {
    sheet.getRange(1, 1, 1, CUSTOMER_PROFILE_HEADERS.length).setValues([CUSTOMER_PROFILE_HEADERS]);
  }
  return sheet;
}

function ensureCustomerProfileFolder_(mobile) {
  const root = getOrCreateFolder_(DriveApp.getRootFolder(), ROOT_FOLDER_NAME);
  const profileRoot = getOrCreateFolder_(root, CUSTOMER_PROFILE_FOLDER_NAME);
  return getOrCreateFolder_(profileRoot, mobile);
}

function trashFolderFilesByName_(folder, fileName) {
  const files = folder.getFilesByName(fileName);
  while (files.hasNext()) {
    try {
      files.next().setTrashed(true);
    } catch (trashError) {
      // File may already be removed.
    }
  }
}

function saveProfilePhoto_(folder, fileName, base64, oldFileId) {
  const cleanBase64 = stripDataUrl_(base64);
  if (!cleanBase64 || cleanBase64.length <= 100) {
    return String(oldFileId || "");
  }
  if (oldFileId) {
    trashDriveFiles_([oldFileId]);
  }
  trashFolderFilesByName_(folder, fileName);
  const blob = Utilities.newBlob(
    Utilities.base64Decode(cleanBase64),
    "image/jpeg",
    fileName
  );
  return folder.createFile(blob).getId();
}

function fetchPhotoBase64_(fileId) {
  const id = String(fileId || "");
  if (!id) return "";
  try {
    const file = DriveApp.getFileById(id);
    const bytes = file.getBlob().getBytes();
    return bytes && bytes.length > 100 ? Utilities.base64Encode(bytes) : "";
  } catch (error) {
    return "";
  }
}

function profilePhotoDataUrl_(fileId) {
  const base64 = fetchPhotoBase64_(fileId);
  return base64 ? "data:image/jpeg;base64," + base64 : "";
}

function formatProfileDob_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  const text = String(value || "").trim();
  const match = /^\d{4}-\d{2}-\d{2}/.exec(text);
  return match ? match[0] : text;
}

function rowToCustomerProfile_(row) {
  return {
    mobile: normalizeMobile_(row[0]) || String(row[0] || ""),
    customers: [
      {
        name: String(row[1] || ""),
        dob: formatProfileDob_(row[2]),
        photoFrontDataUrl: profilePhotoDataUrl_(row[3]),
        photoBackDataUrl: profilePhotoDataUrl_(row[4])
      },
      {
        name: String(row[5] || ""),
        dob: formatProfileDob_(row[6]),
        photoFrontDataUrl: profilePhotoDataUrl_(row[7]),
        photoBackDataUrl: profilePhotoDataUrl_(row[8])
      }
    ],
    updatedAt: String(row[9] || ""),
    lastSessionId: String(row[10] || ""),
    lastSittingId: String(row[11] || "")
  };
}

function handleFetchCustomerProfile(payload) {
  const mobile = normalizeMobile_(payload.mobile);
  if (!mobile) {
    return { ok: false, error: "Valid mobile required" };
  }
  const sheet = ensureCustomerProfileSheet_();
  const rowNumber = findCustomerProfileRow_(sheet, mobile);
  if (!rowNumber) {
    return { ok: true, found: false, mobile: mobile };
  }
  const row = sheet.getRange(rowNumber, 1, 1, CUSTOMER_PROFILE_HEADERS.length).getValues()[0];
  return {
    ok: true,
    found: true,
    profile: rowToCustomerProfile_(row)
  };
}

function handleSaveCustomerProfile(payload) {
  const mobile = normalizeMobile_(payload.mobile);
  if (!mobile) {
    return { ok: false, error: "Valid mobile required" };
  }
  const customers = payload.customers || [];
  const sheet = ensureCustomerProfileSheet_();
  const existingRow = findCustomerProfileRow_(sheet, mobile);
  const existing = existingRow
    ? sheet.getRange(existingRow, 1, 1, CUSTOMER_PROFILE_HEADERS.length).getValues()[0]
    : [];
  const folder = ensureCustomerProfileFolder_(mobile);
  const c1 = customers[0] || {};
  const c2 = customers[1] || {};
  const c1FrontId = saveProfilePhoto_(folder, "C1_front.jpg", c1.photoFrontDataUrl, existing[3]);
  const c1BackId = saveProfilePhoto_(folder, "C1_back.jpg", c1.photoBackDataUrl, existing[4]);
  const c2FrontId = saveProfilePhoto_(folder, "C2_front.jpg", c2.photoFrontDataUrl, existing[7]);
  const c2BackId = saveProfilePhoto_(folder, "C2_back.jpg", c2.photoBackDataUrl, existing[8]);
  const updatedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  const row = [
    mobile,
    String(c1.name || ""),
    String(c1.dob || ""),
    c1FrontId,
    c1BackId,
    String(c2.name || ""),
    String(c2.dob || ""),
    c2FrontId,
    c2BackId,
    updatedAt,
    String(payload.sessionId || ""),
    String(payload.sittingId || "")
  ];

  if (existingRow) {
    sheet.getRange(existingRow, 1, 1, CUSTOMER_PROFILE_HEADERS.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }

  return {
    ok: true,
    mobile: mobile,
    updatedAt: updatedAt
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

function handleSavePendingOrder(payload) {
  const orderId = String(payload.orderId || "");
  if (!orderId) {
    return { ok: false, error: "Missing orderId" };
  }

  const sheet = ensurePendingSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const existingIds = sheet.getRange(2, 10, lastRow, 10).getValues();
    for (var i = 0; i < existingIds.length; i += 1) {
      if (String(existingIds[i][0] || "") === orderId) {
        return { ok: true, skipped: true, orderId: orderId };
      }
    }
  }

  const now = new Date();
  const dateKey = String(payload.dateKey || Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd"));
  const timeLabel = String(payload.timeLabel || Utilities.formatDate(now, Session.getScriptTimeZone(), "HH:mm:ss"));
  sheet.appendRow([
    dateKey,
    timeLabel,
    String(payload.customerName || ""),
    String(payload.customerMobile || ""),
    String(payload.tableId || ""),
    String(payload.itemsSummary || ""),
    Number(payload.grossTotal || 0),
    Number(payload.discountAmount || 0),
    Number(payload.total || 0),
    orderId
  ]);

  return { ok: true, orderId: orderId };
}

function ensurePendingSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(PENDING_SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(PENDING_SHEET_NAME);
    sheet.appendRow(PENDING_SHEET_HEADERS);
    return sheet;
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(PENDING_SHEET_HEADERS);
  }

  return sheet;
}

function ensureExpensesSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(EXPENSES_SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(EXPENSES_SHEET_NAME);
    sheet.appendRow(EXPENSES_SHEET_HEADERS);
    return sheet;
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(EXPENSES_SHEET_HEADERS);
  }

  return sheet;
}

function ensureExpenseDayFolder_(dateKey) {
  const root = getOrCreateFolder_(DriveApp.getRootFolder(), ROOT_FOLDER_NAME);
  const expensesRoot = getOrCreateFolder_(root, EXPENSES_FOLDER_NAME);
  return getOrCreateFolder_(expensesRoot, dateKey);
}

function buildReceiptBlob_(bytes, fileName, mimeType) {
  const name = String(fileName || "receipt.jpg");
  const mime = String(mimeType || "image/jpeg");
  return Utilities.newBlob(bytes, mime, name);
}

function handleSaveExpense(payload) {
  const description = String(payload.description || "").trim();
  const amount = Number(payload.amount || 0);
  const notes = String(payload.notes || "").trim();
  const addedBy = String(payload.addedBy || "staff").trim();
  if (description.length < 2) {
    return { ok: false, error: "Description required" };
  }
  if (!amount || amount <= 0) {
    return { ok: false, error: "Valid amount required" };
  }

  const now = new Date();
  const tz = Session.getScriptTimeZone();
  const dateKey = String(payload.dateKey || Utilities.formatDate(now, tz, "yyyy-MM-dd"));
  const timeLabel = String(payload.timeLabel || Utilities.formatDate(now, tz, "HH:mm:ss"));
  let receiptUrl = "";

  const receiptBase64 = String(payload.receiptBase64 || "");
  if (receiptBase64 && receiptBase64.length > 100) {
    const bytes = Utilities.base64Decode(receiptBase64);
    const dayFolder = ensureExpenseDayFolder_(dateKey);
    const safeName = String(payload.receiptFileName || ("expense-" + timeLabel.replace(/:/g, "") + ".jpg"))
      .replace(/[\\/:*?"<>|]+/g, "-");
    const receiptFile = dayFolder.createFile(buildReceiptBlob_(bytes, safeName, payload.receiptMimeType));
    receiptUrl = receiptFile.getUrl();
  }

  const sheet = ensureExpensesSheet_();
  sheet.appendRow([
    "'" + dateKey,
    timeLabel,
    description,
    amount,
    receiptUrl,
    notes,
    addedBy
  ]);

  return {
    ok: true,
    dateKey: dateKey,
    timeLabel: timeLabel,
    receiptUrl: receiptUrl
  };
}

function normalizeSheetDateKey_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  const text = String(value || "").trim().replace(/^'/, "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }
  const parsed = new Date(text);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  return text;
}

function handleFetchExpensesForDate(payload) {
  const dateKey = String(payload.dateKey || "");
  if (!dateKey) {
    return { ok: false, error: "Missing dateKey" };
  }

  const sheet = ensureExpensesSheet_();
  const lastRow = sheet.getLastRow();
  const expenses = [];
  if (lastRow < 2) {
    return { ok: true, expenses: expenses };
  }

  const rows = sheet.getRange(2, 1, lastRow, EXPENSES_SHEET_HEADERS.length).getValues();
  rows.forEach(function(row) {
    if (normalizeSheetDateKey_(row[0]) !== dateKey) return;
    expenses.push({
      date: String(row[0] || ""),
      time: String(row[1] || ""),
      description: String(row[2] || ""),
      amount: Number(row[3] || 0),
      receiptUrl: String(row[4] || ""),
      notes: String(row[5] || ""),
      addedBy: String(row[6] || "")
    });
  });

  return { ok: true, expenses: expenses };
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
