import { showToast } from "./firebase.js";

export const ID_CARD_ASPECT = 1.586;

const elements = {
  modal: null,
  video: null,
  crop: null,
  captureBtn: null,
  cancelBtn: null,
  galleryBtn: null,
  galleryInput: null
};

let activeStream = null;
let pendingResolve = null;
let capturing = false;
let uiBound = false;

function bindElements() {
  elements.modal = document.querySelector("#psCameraModal");
  elements.video = document.querySelector("#psCameraVideo");
  elements.crop = document.querySelector("#psCameraCrop");
  elements.captureBtn = document.querySelector("#psCameraCapture");
  elements.cancelBtn = document.querySelector("#psCameraCancel");
  elements.galleryBtn = document.querySelector("#psCameraGallery");
  elements.galleryInput = document.querySelector("#psCameraGalleryInput");
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
  elements.captureBtn.textContent = ready ? "Capture" : "Camera loading...";
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
  const video = elements.video;
  const crop = elements.crop;
  if (!video || !crop) {
    throw new Error("Camera UI missing");
  }

  const videoRect = video.getBoundingClientRect();
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
  setCaptureReady(true);
  if (elements.modal) {
    elements.modal.hidden = true;
    elements.modal.classList.remove("modal-front");
  }
  // #region agent log
  fetch('http://127.0.0.1:7354/ingest/595e4a5f-c7de-4f63-b7f6-dfbd5f6735ce',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5de831'},body:JSON.stringify({sessionId:'5de831',location:'private-sitting-camera.js:finishCapture',message:'finishCapture called',data:{hasDataUrl:Boolean(dataUrl),hasResolver:Boolean(resolve)},timestamp:Date.now(),hypothesisId:'E'})}).catch(()=>{});
  // #endregion
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
    const dataUrl = captureCroppedFrame();
    finishCapture(dataUrl);
  } catch (error) {
    console.warn("Camera capture failed:", error);
    showToast("Could not capture photo. Try again.");
  } finally {
    capturing = false;
    if (pendingResolve && elements.captureBtn) {
      setCaptureReady(true);
    }
  }
}

function handleGallerySelected() {
  const file = elements.galleryInput?.files?.[0];
  if (!file || !pendingResolve) return;
  const reader = new FileReader();
  reader.onload = async () => {
    const dataUrl = String(reader.result || "");
    const cropped = await cropDataUrlToIdAspect(dataUrl);
    if (!cropped) {
      showToast("Could not read photo. Try again.");
      if (elements.galleryInput) elements.galleryInput.value = "";
      return;
    }
    finishCapture(cropped);
  };
  reader.onerror = () => {
    showToast("Could not read photo. Try again.");
    if (elements.galleryInput) elements.galleryInput.value = "";
  };
  reader.readAsDataURL(file);
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
    elements.galleryInput?.click();
  }
}

export function initIdCropCamera() {
  bindElements();
  if (!elements.modal || uiBound) return;
  uiBound = true;

  elements.modal.addEventListener("click", handleModalClick);
  elements.galleryInput?.addEventListener("change", handleGallerySelected);
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
        const cropped = await cropDataUrlToIdAspect(dataUrl);
        resolve(cropped || null);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    };
    elements.galleryInput.addEventListener("change", onChange);
    elements.galleryInput.click();
  });
}
