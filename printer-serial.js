import { CONFIG } from "./firebase.js";

const BAUD_STORAGE_KEY = "cafe_printer_baud";
const PORT_KEY_STORAGE = "cafe_printer_port_key";
const PORT_INDEX_STORAGE = "cafe_printer_port_index";
const OPEN_WAKE_MS = 300;
const OPEN_TIMEOUT_MS = 5000;
const WRITE_TIMEOUT_MS = 8000;
const WRITE_CHUNK_SIZE = 128;
const WRITE_CHUNK_DELAY_MS = 20;
const WRITE_FINISH_DELAY_MS = 100;
const SPP_UUID = "00001101-0000-1000-8000-00805f9b34fb";
const SIG_BASE_SUFFIX = "-0000-1000-8000-00805f9b34fb";

const DEFAULT_CUSTOM_BLUETOOTH_IDS = [
  "e7810a71-73ae-499d-8c15-faa9aaf9843d",
  "49535343-fe7d-4ae5-8fa9-9fdfcf3e0c83"
];

let activePort = null;
let connected = false;
let lastError = "";
let portInfo = null;

function dispatchStatusChange() {
  window.dispatchEvent(new CustomEvent("printer-status-change"));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Printer operation timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

function isBlockedSigBaseUuid(uuid = "") {
  const normalized = String(uuid).toLowerCase();
  if (normalized === SPP_UUID) return false;
  return normalized.endsWith(SIG_BASE_SUFFIX);
}

function isValidCustomBluetoothUuid(value) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value !== 0x1101;
  }
  const uuid = String(value).trim().toLowerCase();
  if (!uuid) return false;
  if (uuid === "1101" || uuid === "0x1101") return false;
  const fullUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (!fullUuidPattern.test(uuid)) return false;
  return !isBlockedSigBaseUuid(uuid);
}

export function normalizeAllowedBluetoothServiceClassIds(ids = []) {
  const source = ids.length ? ids : DEFAULT_CUSTOM_BLUETOOTH_IDS;
  const normalized = [];
  for (const id of source) {
    if (!isValidCustomBluetoothUuid(id)) continue;
    const value = typeof id === "number" ? id : String(id).trim().toLowerCase();
    if (!normalized.includes(value)) normalized.push(value);
  }
  return normalized;
}

function getAllowedBluetoothServiceClassIds() {
  const configured = CONFIG.PRINTER_CONFIG?.allowedBluetoothServiceClassIds || [];
  return normalizeAllowedBluetoothServiceClassIds(configured);
}

export function getBaudRate() {
  const stored = Number(localStorage.getItem(BAUD_STORAGE_KEY));
  if (stored === 9600 || stored === 19200 || stored === 115200) {
    return stored;
  }
  return CONFIG.PRINTER_CONFIG?.baudRate || 115200;
}

export function setBaudRate(baud) {
  const rate = Number(baud);
  if (rate === 9600 || rate === 19200 || rate === 115200) {
    localStorage.setItem(BAUD_STORAGE_KEY, String(rate));
  }
}

function describePort(port) {
  if (!port) return "";
  const info = port.getInfo?.() || {};
  if (info.bluetoothServiceClassId) {
    return CONFIG.PRINTER_CONFIG?.name || "Bluetooth printer";
  }
  if (info.usbProductId) {
    return `USB device (${info.usbVendorId || "?"}:${info.usbProductId})`;
  }
  return CONFIG.PRINTER_CONFIG?.name || "Serial printer";
}

function formatPortInfo(info = {}) {
  const parts = [];
  if (info.bluetoothServiceClassId) {
    parts.push(`RFCOMM ${info.bluetoothServiceClassId}`);
  }
  if (info.usbProductId) {
    parts.push(`USB ${info.usbVendorId || "?"}:${info.usbProductId}`);
  }
  return parts.join(" · ");
}

async function safeClosePort(port) {
  if (!port) return;
  try {
    if (port.readable) {
      await port.readable.cancel().catch(() => {});
    }
    await port.close();
  } catch {
    // Port may already be closed.
  }
}

async function openPort(port) {
  try {
    await port.open({
      baudRate: getBaudRate(),
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "none"
    });
    await delay(OPEN_WAKE_MS);
  } catch (error) {
    await safeClosePort(port);
    throw error;
  }
}

function buildPortKey(info = {}) {
  if (info.bluetoothServiceClassId) return `bt:${info.bluetoothServiceClassId}`;
  if (info.usbProductId) return `usb:${info.usbVendorId || 0}:${info.usbProductId}`;
  return "";
}

function attachPort(port, grantedPorts = []) {
  activePort = port;
  connected = true;
  lastError = "";
  portInfo = port.getInfo?.() || null;

  const key = buildPortKey(portInfo || {});
  if (key) {
    localStorage.setItem(PORT_KEY_STORAGE, key);
    localStorage.removeItem(PORT_INDEX_STORAGE);
  } else if (grantedPorts.length > 0) {
    const idx = grantedPorts.indexOf(port);
    if (idx >= 0) {
      localStorage.setItem(PORT_INDEX_STORAGE, String(idx));
      localStorage.removeItem(PORT_KEY_STORAGE);
    }
  }

  port.ondisconnect = () => {
    connected = false;
    activePort = null;
    portInfo = null;
    dispatchStatusChange();
  };

  dispatchStatusChange();
}

function findPreferredGrantedPort(grantedPorts = []) {
  if (!grantedPorts.length) return null;

  const savedKey = localStorage.getItem(PORT_KEY_STORAGE);
  if (savedKey) {
    for (const port of grantedPorts) {
      const key = buildPortKey(port.getInfo?.() || {});
      if (key && key === savedKey) return port;
    }
  }

  const savedIndex = localStorage.getItem(PORT_INDEX_STORAGE);
  if (savedIndex !== null) {
    const idx = Number(savedIndex);
    if (Number.isInteger(idx) && idx >= 0 && idx < grantedPorts.length) {
      return grantedPorts[idx];
    }
  }

  return null;
}

export function isSerialSupported() {
  return Boolean(navigator.serial);
}

export function isPrinterConnected() {
  return connected && activePort;
}

export function getPrinterStatus() {
  return {
    supported: isSerialSupported(),
    connected: isPrinterConnected(),
    deviceName: isPrinterConnected() ? describePort(activePort) : "",
    portInfoLabel: isPrinterConnected() ? formatPortInfo(portInfo || {}) : "",
    baudRate: getBaudRate(),
    lastError
  };
}

async function pickPortFromPicker() {
  try {
    return await navigator.serial.requestPort();
  } catch (error) {
    if (error?.name !== "NotFoundError") throw error;
  }

  const customIds = getAllowedBluetoothServiceClassIds();
  if (!customIds.length) {
    throw new DOMException("No compatible serial device found.", "NotFoundError");
  }

  return navigator.serial.requestPort({
    allowedBluetoothServiceClassIds: customIds
  });
}

export async function connectPrinter(options = {}) {
  if (!navigator.serial) {
    throw new Error("Web Serial is not supported. Use Chrome on Android.");
  }

  if (options.useSavedPort) {
    return reconnectSavedPrinter();
  }

  let port = null;
  let grantedPorts = [];
  if (options.prompt) {
    port = await pickPortFromPicker();
  } else {
    grantedPorts = await navigator.serial.getPorts();
    if (grantedPorts.length === 1) {
      port = grantedPorts[0];
    } else {
      port = await pickPortFromPicker();
    }
  }

  if (isPrinterConnected()) {
    await disconnectPrinter();
  }

  // Refresh granted ports list so index-based preference can be stored correctly.
  if (!grantedPorts.length) {
    grantedPorts = await navigator.serial.getPorts();
  }

  await openPort(port);
  attachPort(port, grantedPorts);
  return getPrinterStatus();
}

export async function ensurePrinterConnected() {
  if (isPrinterConnected()) return true;
  if (!navigator.serial) return false;

  const grantedPorts = await navigator.serial.getPorts();
  if (!grantedPorts.length) return false;

  const port = findPreferredGrantedPort(grantedPorts);
  if (!port) return false;

  try {
    if (isPrinterConnected()) {
      await disconnectPrinter();
    }
    await withTimeout(openPort(port), OPEN_TIMEOUT_MS);
    attachPort(port, grantedPorts);
    return isPrinterConnected();
  } catch (error) {
    lastError = error?.message || String(error);
    connected = false;
    activePort = null;
    portInfo = null;
    await safeClosePort(port);
    return false;
  }
}

export async function hasSavedPrinterPort() {
  if (!navigator.serial) return false;
  const grantedPorts = await navigator.serial.getPorts();
  return grantedPorts.length > 0;
}

export async function reconnectSavedPrinter() {
  if (!navigator.serial) {
    throw new Error("Web Serial is not supported. Use Chrome on Android.");
  }

  const grantedPorts = await navigator.serial.getPorts();
  if (!grantedPorts.length) {
    throw new Error("No saved printer. Tap Connect Printer and pick MPT-II.");
  }

  if (isPrinterConnected()) {
    await disconnectPrinter();
  }

  const port = findPreferredGrantedPort(grantedPorts) || grantedPorts[0];
  await openPort(port);
  attachPort(port, grantedPorts);
  return getPrinterStatus();
}

export async function disconnectPrinter() {
  if (!activePort) {
    connected = false;
    portInfo = null;
    dispatchStatusChange();
    return;
  }

  try {
    await safeClosePort(activePort);
  } catch (error) {
    lastError = error?.message || String(error);
  }

  activePort = null;
  connected = false;
  portInfo = null;
  dispatchStatusChange();
}

async function writeEscPosRaw(bytes) {
  if (!isPrinterConnected() || !activePort?.writable) {
    throw new Error("Printer not connected.");
  }

  const writer = activePort.writable.getWriter();
  try {
    for (let offset = 0; offset < bytes.length; offset += WRITE_CHUNK_SIZE) {
      const chunk = bytes.subarray(offset, offset + WRITE_CHUNK_SIZE);
      await writer.write(chunk);
      if (offset + WRITE_CHUNK_SIZE < bytes.length) {
        await delay(WRITE_CHUNK_DELAY_MS);
      }
    }
    await delay(WRITE_FINISH_DELAY_MS);
  } finally {
    writer.releaseLock();
  }
}

export async function writeEscPos(bytes) {
  return withTimeout(writeEscPosRaw(bytes), WRITE_TIMEOUT_MS);
}

window.addEventListener("beforeunload", () => {
  disconnectPrinter();
});
