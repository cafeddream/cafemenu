import { CONFIG } from "./firebase.js";

const BAUD_STORAGE_KEY = "cafe_printer_baud";
const OPEN_WAKE_MS = 300;
const WRITE_CHUNK_SIZE = 128;
const WRITE_CHUNK_DELAY_MS = 20;
const WRITE_FINISH_DELAY_MS = 100;

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

function getAllowedBluetoothServiceClassIds() {
  const ids = CONFIG.PRINTER_CONFIG?.allowedBluetoothServiceClassIds;
  if (ids?.length) return ids;
  return [
    "00001101-0000-1000-8000-00805f9b34fb",
    "1101",
    "00001100-0000-1000-8000-00805f9b34fb",
    "e7810a71-73ae-499d-8c15-faa9aaf9843d",
    "49535343-fe7d-4ae5-8fa9-9fdfcf3e0c83"
  ];
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

async function openPort(port) {
  await port.open({
    baudRate: getBaudRate(),
    dataBits: 8,
    stopBits: 1,
    parity: "none",
    flowControl: "none",
    bufferSize: 4096
  });
  await delay(OPEN_WAKE_MS);
}

function attachPort(port) {
  activePort = port;
  connected = true;
  lastError = "";
  portInfo = port.getInfo?.() || null;

  port.ondisconnect = () => {
    connected = false;
    activePort = null;
    portInfo = null;
    dispatchStatusChange();
  };

  dispatchStatusChange();
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
  const requestOptions = {
    allowedBluetoothServiceClassIds: getAllowedBluetoothServiceClassIds()
  };
  return navigator.serial.requestPort(requestOptions);
}

export async function connectPrinter(options = {}) {
  if (!navigator.serial) {
    throw new Error("Web Serial is not supported. Use Chrome on Android.");
  }

  if (options.useSavedPort) {
    return reconnectSavedPrinter();
  }

  const grantedPorts = await navigator.serial.getPorts();
  let port = null;

  if (grantedPorts.length === 1) {
    port = grantedPorts[0];
  } else {
    port = await pickPortFromPicker();
  }

  await openPort(port);
  attachPort(port);
  return getPrinterStatus();
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

  const port = grantedPorts[0];
  await openPort(port);
  attachPort(port);
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
    if (activePort.readable) {
      await activePort.readable.cancel().catch(() => {});
    }
    await activePort.close();
  } catch (error) {
    lastError = error?.message || String(error);
  }

  activePort = null;
  connected = false;
  portInfo = null;
  dispatchStatusChange();
}

export async function writeEscPos(bytes) {
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

window.addEventListener("beforeunload", () => {
  disconnectPrinter();
});
