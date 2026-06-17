import { CONFIG } from "./firebase.js";

let activePort = null;
let connected = false;
let lastError = "";

function dispatchStatusChange() {
  window.dispatchEvent(new CustomEvent("printer-status-change"));
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
    lastError
  };
}

export async function connectPrinter() {
  if (!navigator.serial) {
    throw new Error("Web Serial is not supported. Use Chrome on Android.");
  }

  const requestOptions = {};
  const allowedIds = CONFIG.PRINTER_CONFIG?.allowedBluetoothServiceClassIds;
  if (allowedIds?.length) {
    requestOptions.allowedBluetoothServiceClassIds = allowedIds;
  }

  const port = await navigator.serial.requestPort(requestOptions);
  await port.open({ baudRate: CONFIG.PRINTER_CONFIG?.baudRate || 9600 });

  activePort = port;
  connected = true;
  lastError = "";

  port.ondisconnect = () => {
    connected = false;
    activePort = null;
    dispatchStatusChange();
  };

  dispatchStatusChange();
  return getPrinterStatus();
}

export async function disconnectPrinter() {
  if (!activePort) {
    connected = false;
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
  dispatchStatusChange();
}

export async function writeEscPos(bytes) {
  if (!isPrinterConnected() || !activePort?.writable) {
    throw new Error("Printer not connected.");
  }

  const writer = activePort.writable.getWriter();
  try {
    await writer.write(bytes);
  } finally {
    writer.releaseLock();
  }
}

window.addEventListener("beforeunload", () => {
  disconnectPrinter();
});
