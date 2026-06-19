import { showToast } from "./firebase.js";

const PORTRAIT_TOLERANCE = 1.05;

const elements = {
  modal: null,
  video: null,
  captureBtn: null,
  cancelBtn: null,
  galleryBtn: null,
  galleryInput: null
};

let activeStream = null;
let pendingResolve = null;
let portraitRejectHandler = null;

function bindElements() {
  elements.modal = document.querySelector("#psCameraModal");
  elements.video = document.querySelector("#psCameraVideo");
  elements.captureBtn = document.querySelector("#psCameraCapture");
  elements.cancelBtn = document.querySelector("#psCameraCancel");
  elements.galleryBtn = document.querySelector("#psCameraGallery");
  elements.galleryInput = document.querySelector("#psCameraGalleryInput");
}

async function lockLandscapeOrientation() {
  try {
    await screen.orientation?.lock?.("landscape");
  } catch {
    // iOS and some browsers ignore orientation lock.
  }
}

function unlockLandscapeOrientation() {
  try {
    screen.orientation?.unlock?.();
  } catch {
    // Ignore unlock errors.
  }
}

function stopCameraStream() {
  if (activeStream) {
    activeStream.getTracks().forEach((track) => track.stop());
    activeStream = null;
  }
  if (elements.video) {
    elements.video.srcObject = null;
  }
}

function isLandscapeDimensions(width, height) {
  return width > 0 && height > 0 && height <= width * PORTRAIT_TOLERANCE;
}

function isLandscapeDataUrl(dataUrl) {
  return new Promise((resolve) => {
    if (!dataUrl) {
      resolve(false);
      return;
    }
    const img = new Image();
    img.onload = () => resolve(isLandscapeDimensions(img.width, img.height));
    img.onerror = () => resolve(false);
    img.src = dataUrl;
  });
}

async function startCameraStream() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera not supported on this device");
  }
  stopCameraStream();
  activeStream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    },
    audio: false
  });
  elements.video.srcObject = activeStream;
  await elements.video.play();
}

function captureVideoFrame() {
  const video = elements.video;
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) {
    throw new Error("Camera not ready");
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not capture photo");
  }
  ctx.drawImage(video, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.92);
}

function finishCapture(dataUrl) {
  const resolve = pendingResolve;
  pendingResolve = null;
  stopCameraStream();
  unlockLandscapeOrientation();
  if (elements.modal) elements.modal.hidden = true;
  resolve?.(dataUrl);
}

function cancelCapture() {
  finishCapture(null);
}

async function handleCaptureClick() {
  if (!pendingResolve) return;
  try {
    const dataUrl = captureVideoFrame();
    const landscape = await isLandscapeDataUrl(dataUrl);
    if (!landscape) {
      showToast("Landscape mein photo lo (phone sideways)");
      portraitRejectHandler?.();
      return;
    }
    finishCapture(dataUrl);
  } catch (error) {
    console.warn("Camera capture failed:", error);
    showToast("Could not capture photo. Try again.");
  }
}

function handleGallerySelected() {
  const file = elements.galleryInput?.files?.[0];
  if (!file || !pendingResolve) return;
  const reader = new FileReader();
  reader.onload = async () => {
    const dataUrl = String(reader.result || "");
    const landscape = await isLandscapeDataUrl(dataUrl);
    if (!landscape) {
      showToast("Landscape mein photo lo (phone sideways)");
      if (elements.galleryInput) elements.galleryInput.value = "";
      return;
    }
    finishCapture(dataUrl);
  };
  reader.onerror = () => {
    showToast("Could not read photo. Try again.");
    if (elements.galleryInput) elements.galleryInput.value = "";
  };
  reader.readAsDataURL(file);
}

export function initLandscapeIdCamera() {
  bindElements();
  if (!elements.modal) return;

  elements.captureBtn?.addEventListener("click", handleCaptureClick);
  elements.cancelBtn?.addEventListener("click", cancelCapture);
  elements.galleryBtn?.addEventListener("click", () => elements.galleryInput?.click());
  elements.galleryInput?.addEventListener("change", handleGallerySelected);
  elements.modal.addEventListener("click", (event) => {
    if (event.target === elements.modal) cancelCapture();
  });
}

export function openLandscapeIdCamera({ onPortraitReject } = {}) {
  return new Promise(async (resolve, reject) => {
    bindElements();
    if (!elements.modal || !elements.video) {
      reject(new Error("Camera UI missing"));
      return;
    }
    if (pendingResolve) {
      resolve(null);
      return;
    }

    pendingResolve = resolve;
    portraitRejectHandler = onPortraitReject || null;
    if (elements.galleryInput) elements.galleryInput.value = "";
    elements.modal.hidden = false;

    try {
      await lockLandscapeOrientation();
      await startCameraStream();
    } catch (error) {
      pendingResolve = null;
      stopCameraStream();
      unlockLandscapeOrientation();
      elements.modal.hidden = true;
      reject(error);
    }
  });
}

export function openGalleryPhotoPicker() {
  bindElements();
  return new Promise((resolve) => {
    if (!elements.galleryInput) {
      resolve(null);
      return;
    }
    elements.galleryInput.value = "";
    const onChange = async () => {
      elements.galleryInput.removeEventListener("change", onChange);
      const file = elements.galleryInput.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = String(reader.result || "");
        const landscape = await isLandscapeDataUrl(dataUrl);
        if (!landscape) {
          showToast("Landscape mein photo lo (phone sideways)");
          resolve(null);
          return;
        }
        resolve(dataUrl);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    };
    elements.galleryInput.addEventListener("change", onChange);
    elements.galleryInput.click();
  });
}
