/**
 * Copy MediaPipe's wasm and the pose model into public/ so the demo runs with
 * the wifi switched off. Presentation networks fail; this removes the risk.
 *
 *   node scripts/vendor-assets.mjs
 */
import { cp, mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..");
const repo = join(web, "..");

const WASM_FROM = join(web, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const WASM_TO = join(web, "public", "mediapipe", "wasm");
const MODEL_FROM = join(repo, "models", "pose_landmarker_full.task");
const MODEL_TO = join(web, "public", "models", "pose_landmarker_full.task");

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await exists(WASM_FROM))) {
    console.error("MediaPipe wasm not found — run `npm install` first.");
    process.exit(1);
  }
  await mkdir(dirname(WASM_TO), { recursive: true });
  await cp(WASM_FROM, WASM_TO, { recursive: true });
  console.log(`wasm    -> ${WASM_TO}`);

  if (!(await exists(MODEL_FROM))) {
    console.error(
      `\nPose model missing: ${MODEL_FROM}\n` +
        "Download it once (about 9 MB, from Google's official MediaPipe host):\n" +
        "  https://storage.googleapis.com/mediapipe-models/pose_landmarker/" +
        "pose_landmarker_full/float16/1/pose_landmarker_full.task\n" +
        "and save it to models/ in the repo root.",
    );
    process.exit(1);
  }
  await mkdir(dirname(MODEL_TO), { recursive: true });
  await cp(MODEL_FROM, MODEL_TO);
  console.log(`model   -> ${MODEL_TO}`);
  console.log("\nDemo assets are local. It will run offline.");
}

await main();
