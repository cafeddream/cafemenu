import { showToast } from "./firebase.js";

export const ID_CARD_ASPECT = 1.586;

const elements = {
  modal: null,
  video: null,
  galleryImage: null,
  crop: null,
  captureBtn: null,
  cancelBtn: null,
  galleryBtn: null,
  galleryInput: null,
  zoomControls: null,
  zoomSlider: null,
  zoomInBtn: null,
  zoomOutBtn: null,
  title: null,
  guide: null,
  viewport: null
};

let activeStream = null;
let pendingResolve = null;
let capturing = false;
let uiBound = false;
let mode = "camera";
const pointers = new Map();
const galleryCrop = {
  image: null,
  scale: 1,
  minScale: 1,
  maxScale: 4,
  offsetX: 0,
  offsetY: 0,
  startOffsetX: 0,
  startOffsetY: 0,
  startX: 0,
  startY: 0,
  pinchStartDistance: 0,
  pinchStartScale: 1
};

function bindElements() {
  elements.modal = document.querySelector("#psCameraModal");
  elements.video = document.querySelector("#psCameraVideo");
  elements.galleryImage = document.querySelector("#psCameraGalleryImage");
  elements.crop = document.querySelector("#psCameraCrop");
  elements.captureBtn = document.querySelector("#psCameraCapture");
  elements.cancelBtn = document.querySelector("#psCameraCancel");
  elements.galleryBtn = document.querySelector("#psCameraGallery");
  elements.galleryInput = document.querySelector("#psCameraGalleryInput");
  elements.zoomControls = document.querySelector("#psCameraZoomControls");
  elements.zoomSlider = document.querySelector("#psCameraZoomSlider");
  elements.zoomInBtn = document.querySelector("#psCameraZoomIn");
  elements.zoomOutBtn = document.querySelector("#psCameraZoomOut");
  elements.title = document.querySelector("#psCameraTitle");
  elements.guide = document.querySelector(".ps-camera-guide");
  elements.viewport = document.querySelector(".ps-camera-viewport");
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

function setCaptureReady(ready) {
  if (!elements.captureBtn) return;
  elements.captureBtn.disabled = !ready;
  elements.captureBtn.textContent = ready
    ? (mode === "gallery" ? "Use Photo" : "Capture")
    : (mode === "gallery" ? "Photo loading..." : "Camera loading...");
}

function resetGalleryCrop() {
  pointers.clear();
  galleryCrop.image = null;
  galleryCrop.scale = 1;
  galleryCrop.minScale = 1;
  galleryCrop.maxScale = 4;
  galleryCrop.offsetX = 0;
  galleryCrop.offsetY = 0;
  if (elements.galleryImage) {
    elements.galleryImage.hidden = true;
    elements.galleryImage.removeAttribute("src");
    elements.galleryImage.style.transform = "";
    elements.galleryImage.style.width = "";
    elements.galleryImage.style.height = "";
  }
}

function setMode(nextMode) {
  mode = nextMode;
  const isGallery = mode === "gallery";
  elements.modal?.classList.toggle("ps-camera-gallery-mode", isGallery);
  if (elements.video) elements.video.hidden = isGallery;
  if (elements.zoomControls) elements.zoomControls.hidden = !isGallery;
  if (elements.title) elements.title.textContent = isGallery ? "Crop ID" : "Capture ID";
  if (elements.guide) {
    elements.guide.textContent = isGallery
      ? "Photo ko drag karo, zoom set karo, ID ko frame me fit karke Use Photo dabao"
      : "ID card ko frame ke andar align karo, phir Capture dabao";
  }
  if (elements.galleryBtn) elements.galleryBtn.textContent = isGallery ? "Retake" : "Use gallery";
  if (elements.cancelBtn) elements.cancelBtn.textContent = "Cancel";
  setCaptureReady(false);
}

function waitForVideoReady(video, timeoutMs = 10000) {
  if (video.videoWidth > 0 && video.videoHeight > 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("Camera not ready"));
    }, timeoutMs);
    const onReady = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        cleanup();
        resolve();
      }
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener("loadedmetadata", onReady);
      video.removeEventListener("playing", onReady);
      video.removeEventListener("resize", onReady);
    };
    video.addEventListener("loadedmetadata", onReady);
    video.addEventListener("playing", onReady);
    video.addEventListener("resize", onReady);
    onReady();
  });
}

function getVideoCoverMapping(video) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const dw = video.clientWidth;
  const dh = video.clientHeight;
  if (!vw || !vh || !dw || !dh) {
    throw new Error("Camera not ready");
  }

  const videoAspect = vw / vh;
  const displayAspect = dw / dh;
  let sx;
  let sy;
  let sw;
  let sh;

  if (videoAspect > displayAspect) {
    sh = vh;
    sw = vh * displayAspect;
    sx = (vw - sw) / 2;
    sy = 0;
  } else {
    sw = vw;
    sh = vw / displayAspect;
    sx = 0;
    sy = (vh - sh) / 2;
  }

  return { sx, sy, sw, sh, dw, dh };
}

function getCropRectOnScreen() {
  const viewport = elements.viewport || elements.video;
  const crop = elements.crop;
  if (!viewport || !crop) {
    throw new Error("Camera UI missing");
  }

  const videoRect = viewport.getBoundingClientRect();
  const cropRect = crop.getBoundingClientRect();
  return {
    x: cropRect.left - videoRect.left,
    y: cropRect.top - videoRect.top,
    width: cropRect.width,
    height: cropRect.height
  };
}

function captureCroppedFrame() {
  const video = elements.video;
  const { sx, sy, sw, sh, dw, dh } = getVideoCoverMapping(video);
  const crop = getCropRectOnScreen();

  const sourceX = sx + (crop.x / dw) * sw;
  const sourceY = sy + (crop.y / dh) * sh;
  const sourceW = (crop.width / dw) * sw;
  const sourceH = (crop.height / dh) * sh;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceW));
  canvas.height = Math.max(1, Math.round(sourceH));
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not capture photo");
  }

  ctx.drawImage(
    video,
    sourceX,
    sourceY,
    sourceW,
    sourceH,
    0,
    0,
    canvas.width,
    canvas.height
  );

  return canvas.toDataURL("image/jpeg", 0.92);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getPointerDistance() {
  const points = [...pointers.values()];
  if (points.length < 2) return 0;
  return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
}

function constrainGalleryCrop() {
  if (!galleryCrop.image || !elements.viewport || !elements.crop) return;
  const viewportRect = elements.viewport.getBoundingClientRect();
  const crop = getCropRectOnScreen();
  const scaledW = galleryCrop.image.naturalWidth * galleryCrop.scale;
  const scaledH = galleryCrop.image.naturalHeight * galleryCrop.scale;
  const centerX = viewportRect.width / 2 + galleryCrop.offsetX;
  const centerY = viewportRect.height / 2 + galleryCrop.offsetY;

  const minOffsetX = crop.x + crop.width - viewportRect.width / 2 - scaledW / 2;
  const maxOffsetX = crop.x - viewportRect.width / 2 + scaledW / 2;
  const minOffsetY = crop.y + crop.height - viewportRect.height / 2 - scaledH / 2;
  const maxOffsetY = crop.y - viewportRect.height / 2 + scaledH / 2;

  galleryCrop.offsetX = scaledW <= crop.width
    ? crop.x + crop.width / 2 - viewportRect.width / 2
    : clamp(centerX - viewportRect.width / 2, minOffsetX, maxOffsetX);
  galleryCrop.offsetY = scaledH <= crop.height
    ? crop.y + crop.height / 2 - viewportRect.height / 2
    : clamp(centerY - viewportRect.height / 2, minOffsetY, maxOffsetY);
}

function renderGalleryCrop() {
  if (!elements.galleryImage || !galleryCrop.image) return;
  constrainGalleryCrop();
  elements.galleryImage.style.width = `${galleryCrop.image.naturalWidth * galleryCrop.scale}px`;
  elements.galleryImage.style.height = `${galleryCrop.image.naturalHeight * galleryCrop.scale}px`;
  elements.galleryImage.style.transform = `translate(calc(-50% + ${galleryCrop.offsetX}px), calc(-50% + ${galleryCrop.offsetY}px))`;
  elements.galleryImage.style.left = "50%";
  elements.galleryImage.style.top = "50%";
  if (elements.zoomSlider) elements.zoomSlider.value = String(galleryCrop.scale);
}

function setGalleryScale(nextScale) {
  galleryCrop.scale = clamp(nextScale, galleryCrop.minScale, galleryCrop.maxScale);
  renderGalleryCrop();
}

function setupGalleryCropImage(img) {
  const crop = getCropRectOnScreen();
  galleryCrop.image = img;
  galleryCrop.minScale = Math.max(
    crop.width / img.naturalWidth,
    crop.height / img.naturalHeight
  );
  galleryCrop.maxScale = galleryCrop.minScale * 4;
  galleryCrop.scale = galleryCrop.minScale;
  galleryCrop.offsetX = 0;
  galleryCrop.offsetY = 0;
  if (elements.zoomSlider) {
    elements.zoomSlider.min = String(galleryCrop.minScale);
    elements.zoomSlider.max = String(galleryCrop.maxScale);
    elements.zoomSlider.step = String((galleryCrop.maxScale - galleryCrop.minScale) / 100 || 0.01);
  }
  renderGalleryCrop();
}

function captureGalleryCropFrame() {
  if (!galleryCrop.image || !elements.viewport) {
    throw new Error("Gallery photo missing");
  }
  const viewportRect = elements.viewport.getBoundingClientRect();
  const crop = getCropRectOnScreen();
  const scaledW = galleryCrop.image.naturalWidth * galleryCrop.scale;
  const scaledH = galleryCrop.image.naturalHeight * galleryCrop.scale;
  const imageLeft = viewportRect.width / 2 + galleryCrop.offsetX - scaledW / 2;
  const imageTop = viewportRect.height / 2 + galleryCrop.offsetY - scaledH / 2;
  const sourceX = (crop.x - imageLeft) / galleryCrop.scale;
  const sourceY = (crop.y - imageTop) / galleryCrop.scale;
  const sourceW = crop.width / galleryCrop.scale;
  const sourceH = crop.height / galleryCrop.scale;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceW));
  canvas.height = Math.max(1, Math.round(sourceH));
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not crop photo");
  }
  ctx.drawImage(galleryCrop.image, sourceX, sourceY, sourceW, sourceH, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.92);
}

export function cropDataUrlToIdAspect(dataUrl, aspect = ID_CARD_ASPECT) {
  return new Promise((resolve) => {
    if (!dataUrl) {
      resolve("");
      return;
    }
    const img = new Image();
    img.onload = () => {
      const imgW = img.width;
      const imgH = img.height;
      if (!imgW || !imgH) {
        resolve("");
        return;
      }

      const imageAspect = imgW / imgH;
      let sourceX = 0;
      let sourceY = 0;
      let sourceW = imgW;
      let sourceH = imgH;

      if (imageAspect > aspect) {
        sourceW = imgH * aspect;
        sourceX = (imgW - sourceW) / 2;
      } else if (imageAspect < aspect) {
        sourceH = imgW / aspect;
        sourceY = (imgH - sourceH) / 2;
      }

      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(sourceW));
      canvas.height = Math.max(1, Math.round(sourceH));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(dataUrl);
        return;
      }

      ctx.drawImage(img, sourceX, sourceY, sourceW, sourceH, 0, 0, canvas.width, canvas.height);
      try {
        resolve(canvas.toDataURL("image/jpeg", 0.92));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve("");
    img.src = dataUrl;
  });
}

async function startCameraStream() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera not supported on this device");
  }
  stopCameraStream();
  setCaptureReady(false);
  activeStream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    },
    audio: false
  });
  elements.video.srcObject = activeStream;
  elements.video.setAttribute("playsinline", "");
  elements.video.setAttribute("webkit-playsinline", "");
  await elements.video.play();
  await waitForVideoReady(elements.video);
  setCaptureReady(true);
}

function finishCapture(dataUrl) {
  const resolve = pendingResolve;
  pendingResolve = null;
  capturing = false;
  stopCameraStream();
  resetGalleryCrop();
  setCaptureReady(true);
  if (elements.modal) {
    elements.modal.hidden = true;
    elements.modal.classList.remove("modal-front");
    elements.modal.classList.remove("ps-camera-gallery-mode");
  }
  resolve?.(dataUrl);
}

function cancelCapture() {
  finishCapture(null);
}

async function handleCaptureClick(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  if (!pendingResolve || capturing) return;
  if (elements.captureBtn?.disabled) {
    showToast("Camera abhi load ho raha hai — thodi der ruko");
    return;
  }

  capturing = true;
  if (elements.captureBtn) {
    elements.captureBtn.disabled = true;
    elements.captureBtn.textContent = "Capturing...";
  }

  try {
    const dataUrl = mode === "gallery" ? captureGalleryCropFrame() : captureCroppedFrame();
    finishCapture(dataUrl);
  } catch (error) {
    console.warn("Camera capture failed:", error);
    showToast(mode === "gallery" ? "Could not crop photo. Try again." : "Could not capture photo. Try again.");
  } finally {
    capturing = false;
    if (pendingResolve && elements.captureBtn) {
      setCaptureReady(true);
    }
  }
}

function readGalleryFile(file) {
  return new Promise((resolve) => {
    if (!file) {
      resolve("");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => resolve("");
    reader.readAsDataURL(file);
  });
}

function pickGalleryFile() {
  bindElements();
  return new Promise((resolve) => {
    if (!elements.galleryInput) {
      resolve(null);
      return;
    }
    elements.galleryInput.value = "";
    let settled = false;
    const finish = (file) => {
      if (settled) return;
      settled = true;
      elements.galleryInput.removeEventListener("change", onChange);
      window.removeEventListener("focus", onFocus);
      resolve(file || null);
    };
    const onChange = () => {
      finish(elements.galleryInput.files?.[0] || null);
    };
    const onFocus = () => {
      window.setTimeout(() => {
        if (!elements.galleryInput?.files?.length) finish(null);
      }, 400);
    };
    elements.galleryInput.addEventListener("change", onChange);
    window.addEventListener("focus", onFocus);
    elements.galleryInput.click();
  });
}

function loadGalleryImage(dataUrl) {
  return new Promise((resolve) => {
    if (!dataUrl || !elements.galleryImage) {
      resolve(null);
      return;
    }
    const img = elements.galleryImage;
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = dataUrl;
    img.hidden = false;
  });
}

async function openGalleryCropFromFile(file) {
  if (!file || !pendingResolve) return false;
  const dataUrl = await readGalleryFile(file);
  if (!dataUrl) {
    showToast("Could not read photo. Try again.");
    return false;
  }
  stopCameraStream();
  resetGalleryCrop();
  setMode("gallery");
  const img = await loadGalleryImage(dataUrl);
  if (!img?.naturalWidth || !img?.naturalHeight) {
    showToast("Could not read photo. Try again.");
    resetGalleryCrop();
    return false;
  }
  setupGalleryCropImage(img);
  setCaptureReady(true);
  return true;
}

async function handleGalleryPick() {
  const file = await pickGalleryFile();
  if (!file) return;
  await openGalleryCropFromFile(file);
}

function handleViewportPointerDown(event) {
  if (mode !== "gallery" || !galleryCrop.image || !elements.viewport) return;
  event.preventDefault();
  elements.viewport.setPointerCapture?.(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  galleryCrop.startOffsetX = galleryCrop.offsetX;
  galleryCrop.startOffsetY = galleryCrop.offsetY;
  galleryCrop.startX = event.clientX;
  galleryCrop.startY = event.clientY;
  if (pointers.size === 2) {
    galleryCrop.pinchStartDistance = getPointerDistance();
    galleryCrop.pinchStartScale = galleryCrop.scale;
  }
}

function handleViewportPointerMove(event) {
  if (mode !== "gallery" || !pointers.has(event.pointerId)) return;
  event.preventDefault();
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size >= 2 && galleryCrop.pinchStartDistance > 0) {
    const distance = getPointerDistance();
    setGalleryScale(galleryCrop.pinchStartScale * (distance / galleryCrop.pinchStartDistance));
    return;
  }
  galleryCrop.offsetX = galleryCrop.startOffsetX + event.clientX - galleryCrop.startX;
  galleryCrop.offsetY = galleryCrop.startOffsetY + event.clientY - galleryCrop.startY;
  renderGalleryCrop();
}

function handleViewportPointerEnd(event) {
  if (!pointers.has(event.pointerId)) return;
  pointers.delete(event.pointerId);
  if (pointers.size === 1) {
    const point = [...pointers.values()][0];
    galleryCrop.startOffsetX = galleryCrop.offsetX;
    galleryCrop.startOffsetY = galleryCrop.offsetY;
    galleryCrop.startX = point.x;
    galleryCrop.startY = point.y;
  }
  galleryCrop.pinchStartDistance = 0;
}

function handleModalClick(event) {
  const target = event.target;
  if (target === elements.modal) {
    cancelCapture();
    return;
  }
  if (target.closest("#psCameraCapture")) {
    void handleCaptureClick(event);
    return;
  }
  if (target.closest("#psCameraCancel")) {
    event.preventDefault();
    event.stopPropagation();
    cancelCapture();
    return;
  }
  if (target.closest("#psCameraGallery")) {
    event.preventDefault();
    event.stopPropagation();
    void handleGalleryPick();
  }
}

export function initIdCropCamera() {
  bindElements();
  if (!elements.modal || uiBound) return;
  uiBound = true;

  elements.modal.addEventListener("click", handleModalClick);
  elements.viewport?.addEventListener("pointerdown", handleViewportPointerDown);
  elements.viewport?.addEventListener("pointermove", handleViewportPointerMove);
  elements.viewport?.addEventListener("pointerup", handleViewportPointerEnd);
  elements.viewport?.addEventListener("pointercancel", handleViewportPointerEnd);
  elements.zoomSlider?.addEventListener("input", () => setGalleryScale(Number(elements.zoomSlider.value)));
  elements.zoomInBtn?.addEventListener("click", () => setGalleryScale(galleryCrop.scale + (galleryCrop.maxScale - galleryCrop.minScale) / 12));
  elements.zoomOutBtn?.addEventListener("click", () => setGalleryScale(galleryCrop.scale - (galleryCrop.maxScale - galleryCrop.minScale) / 12));
  window.addEventListener("resize", () => {
    if (mode === "gallery" && galleryCrop.image) setupGalleryCropImage(galleryCrop.image);
  });
}

export const initLandscapeIdCamera = initIdCropCamera;

export function openIdCropCamera() {
  return new Promise((resolve, reject) => {
    bindElements();
    if (!elements.modal || !elements.video || !elements.crop) {
      reject(new Error("Camera UI missing"));
      return;
    }
    if (pendingResolve) {
      resolve(null);
      return;
    }

    pendingResolve = resolve;
    capturing = false;
    resetGalleryCrop();
    setMode("camera");
    if (elements.galleryInput) elements.galleryInput.value = "";
    elements.modal.hidden = false;
    elements.modal.classList.add("modal-front");
    setCaptureReady(false);

    void (async () => {
      try {
        await startCameraStream();
      } catch (error) {
        pendingResolve = null;
        capturing = false;
        stopCameraStream();
        resetGalleryCrop();
        setCaptureReady(true);
        elements.modal.hidden = true;
        elements.modal.classList.remove("modal-front");
        reject(error);
      }
    })();
  });
}

export const openLandscapeIdCamera = openIdCropCamera;

export function openGalleryPhotoPicker() {
  bindElements();
  return new Promise((resolve) => {
    if (!elements.modal || !elements.galleryInput || !elements.galleryImage || !elements.crop) {
      resolve(null);
      return;
    }
    if (pendingResolve) {
      resolve(null);
      return;
    }
    pendingResolve = resolve;
    capturing = false;
    resetGalleryCrop();
    elements.modal.hidden = false;
    elements.modal.classList.add("modal-front");
    setMode("gallery");
    void (async () => {
      const file = await pickGalleryFile();
      if (!file) {
        finishCapture(null);
        return;
      }
      const opened = await openGalleryCropFromFile(file);
      if (!opened) finishCapture(null);
    })();
  });
}
