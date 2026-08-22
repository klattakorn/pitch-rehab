/**
 * MediaPipe setup. Everything is loaded from public/ rather than a CDN, so the
 * demo works with the wifi switched off — presentation networks fail.
 */
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";

export async function createPoseLandmarker(): Promise<PoseLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
  return PoseLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: "/models/pose_landmarker_full.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}

export interface CameraHandle {
  video: HTMLVideoElement;
  width: number;
  height: number;
  stop: () => void;
}

/**
 * Browsers only hand over a camera on a secure origin. localhost counts as
 * secure; a plain http:// address on the local network does not, which is the
 * usual reason this fails when someone opens the demo on their phone.
 */
export async function startCamera(video: HTMLVideoElement): Promise<CameraHandle> {
  if (!window.isSecureContext) {
    throw new Error(
      "The browser will not share a camera over a plain http:// address. " +
        "Open the demo at http://localhost:5173 on this machine, or serve it over https.",
    );
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  await new Promise<void>((resolve) => {
    if (video.videoWidth) return resolve();
    video.onloadedmetadata = () => resolve();
  });
  return {
    video,
    width: video.videoWidth,
    height: video.videoHeight,
    stop: () => stream.getTracks().forEach((t) => t.stop()),
  };
}
