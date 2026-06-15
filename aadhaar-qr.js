export function parseAadhaarQrPayload(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;

  const readAttr = (key) => {
    const match = text.match(new RegExp(`${key}="([^"]+)"`, "i"));
    return match?.[1]?.trim() || "";
  };

  const name = readAttr("name");
  const dob = readAttr("dob") || readAttr("yob");
  const gender = readAttr("gender");
  const idNumber = readAttr("uid") || readAttr("last4") || "";

  if (!name && !dob && !idNumber) return null;

  return { name, dob, gender, idNumber };
}

export async function scanAadhaarQr(onResult, onError) {
  let Html5Qrcode;
  try {
    ({ Html5Qrcode } = await import("https://esm.sh/html5-qrcode@2.3.8"));
  } catch (error) {
    onError?.(error);
    return null;
  }

  const scannerId = "aadhaarQrScanner";
  let host = document.querySelector(`#${scannerId}`);
  if (!host) {
    host = document.createElement("div");
    host.id = scannerId;
    host.className = "aadhaar-qr-scanner";
    document.body.append(host);
  }

  const scanner = new Html5Qrcode(scannerId);
  const cameras = await Html5Qrcode.getCameras();
  const cameraId = cameras.at(-1)?.id || cameras[0]?.id;
  if (!cameraId) throw new Error("No camera found");

  await scanner.start(
    cameraId,
    { fps: 10, qrbox: { width: 240, height: 240 } },
    (decoded) => {
      const parsed = parseAadhaarQrPayload(decoded);
      if (parsed) {
        scanner.stop().catch(() => {});
        host.remove();
        onResult(parsed);
      }
    },
    () => {}
  );

  return async () => {
    try {
      await scanner.stop();
    } catch {
      // Scanner may already be stopped.
    }
    host.remove();
  };
}
