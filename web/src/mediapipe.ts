/**
 * MediaPipe setup, and the camera.
 *
 * Everything is loaded from public/ rather than a CDN, so the demo works with
 * the wifi switched off — presentation networks fail.
 *
 * Most of what follows exists because a phone is not a small laptop: it has two
 * cameras pointing opposite ways, it turns its screen off while you are three
 * metres away doing a squat, and it will not run the big model at any useful
 * frame rate.
 */
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";

/** Rough "is this a phone or tablet" check, used only to pick defaults. */
export function isHandheld(): boolean {
  if (typeof navigator === "undefined") return false;
  // Coarse pointer catches phones and tablets including iPads, which report a
  // desktop user agent. `maxTouchPoints` is the fallback for older browsers.
  const coarse =
    typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  return coarse || navigator.maxTouchPoints > 1;
}

/**
 * Which pose model to load.
 *
 * `full` is the reference — the cross-check fixtures were generated from it and
 * the thresholds were tuned against it. `lite` trades some accuracy for roughly
 * three times the frame rate, which on a phone is the difference between live
 * coaching and a slideshow. Bad advice delivered smoothly is still bad advice,
 * so this only ever downgrades on a device that cannot run the full model well.
 */
export function preferredModel(): "full" | "lite" {
  return isHandheld() ? "lite" : "full";
}

export async function createPoseLandmarker(
  variant: "full" | "lite" = preferredModel(),
): Promise<PoseLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
  try {
    return await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: `/models/pose_landmarker_${variant}.task`,
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  } catch (error) {
    // The lite model is optional -- `vendor-assets.mjs` warns rather than fails
    // when it is missing. Falling back keeps the demo alive on a phone whose
    // copy never got vendored.
    if (variant === "lite") return createPoseLandmarker("full");
    throw error;
  }
}

export type Facing = "user" | "environment";

export interface CameraHandle {
  video: HTMLVideoElement;
  width: number;
  height: number;
  facing: Facing;
  /** True when the preview is flipped, which is what a front camera wants. */
  mirrored: boolean;
  stop: () => void;
}

/** Whether this device has more than one camera worth offering a switch for. */
export async function hasMultipleCameras(): Promise<boolean> {
  if (!navigator.mediaDevices?.enumerateDevices) return false;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === "videoinput").length > 1;
  } catch {
    return false;
  }
}

/**
 * Browsers only hand over a camera on a secure origin. localhost counts as
 * secure; a plain http:// address on the local network does not, which is the
 * usual reason this fails when someone opens the demo on their phone.
 */
export async function startCamera(
  video: HTMLVideoElement,
  facing: Facing = "user",
): Promise<CameraHandle> {
  if (!window.isSecureContext) {
    throw new Error(
      "The browser will not share a camera over a plain http:// address. " +
        "Run start.bat, which serves the app over https and prints the address " +
        "to open on your phone — or use http://localhost:5173 on this machine.",
    );
  }

  // A phone camera will happily hand over 1080p and then drop the pose model to
  // a crawl. The engine works in normalised coordinates, so a smaller frame
  // costs nothing but noise; 960x720 keeps the whole body legible at 3 m.
  const size = isHandheld()
    ? { width: { ideal: 960 }, height: { ideal: 720 } }
    : { width: { ideal: 1280 }, height: { ideal: 720 } };

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facing }, ...size },
      audio: false,
    });
  } catch (error) {
    // A laptop with one webcam rejects an "environment" request outright.
    if (facing === "environment") return startCamera(video, "user");
    throw error;
  }

  video.srcObject = stream;
  // iOS refuses to play an inline video without both of these, and shows a
  // full-screen player instead of the preview.
  video.setAttribute("playsinline", "");
  video.muted = true;
  await video.play();
  await new Promise<void>((resolve) => {
    if (video.videoWidth) return resolve();
    video.onloadedmetadata = () => resolve();
  });

  // Ask the track what it actually gave us rather than trusting the request.
  const settings = stream.getVideoTracks()[0]?.getSettings();
  const actual: Facing = settings?.facingMode === "environment" ? "environment" : facing;

  return {
    video,
    width: video.videoWidth,
    height: video.videoHeight,
    facing: actual,
    // A front camera is mirrored so the player sees themselves the way a mirror
    // would; a rear camera is already the right way round, and flipping it
    // would put their left leg on the right of the screen.
    mirrored: actual !== "environment",
    stop: () => stream.getTracks().forEach((t) => t.stop()),
  };
}

/**
 * Keep the screen on while the camera is running.
 *
 * A player props the phone up and walks three metres away. Without this the
 * screen sleeps mid-set, the video track stalls, and the rep count stops --
 * which looks exactly like the pose engine failing.
 *
 * Unsupported on some browsers and revoked whenever the tab is hidden, so it
 * re-acquires on return and never throws.
 */
export function keepScreenAwake(): () => void {
  interface WakeLockSentinel {
    release: () => Promise<void>;
  }
  const wakeLock = (
    navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinel> };
    }
  ).wakeLock;
  if (!wakeLock) return () => {};

  let sentinel: WakeLockSentinel | null = null;
  let released = false;

  const acquire = async (): Promise<void> => {
    if (released || document.hidden) return;
    try {
      sentinel = await wakeLock.request("screen");
    } catch {
      // Denied, or the tab lost focus mid-request. Not worth surfacing.
    }
  };

  const onVisible = (): void => {
    if (!document.hidden) void acquire();
  };
  document.addEventListener("visibilitychange", onVisible);
  void acquire();

  return () => {
    released = true;
    document.removeEventListener("visibilitychange", onVisible);
    void sentinel?.release().catch(() => {});
    sentinel = null;
  };
}
