/**
 * Copy MediaPipe's wasm and the pose models into public/ so the demo runs with
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

/**
 * Two pose models. `full` is what a laptop runs, and what the cross-check
 * fixtures were generated from. `lite` is a little over half the size and
 * several times faster, which on a mid-range phone is the difference between
 * usable and a slideshow. `mediapipe.ts` chooses between them at run time.
 */
const MODELS = [
  { file: "pose_landmarker_full.task", variant: "full", required: true },
  { file: "pose_landmarker_lite.task", variant: "lite", required: false },
];

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function missingMessage(path, variant, file) {
  const url =
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/" +
    `pose_landmarker_${variant}/float16/1/${file}`;
  return [
    "",
    `Pose model missing: ${path}`,
    "Download it once, from Google's official MediaPipe host:",
    `  ${url}`,
    "and save it to models/ in the repo root.",
  ].join("\n");
}

async function main() {
  if (!(await exists(WASM_FROM))) {
    console.error("MediaPipe wasm not found — run `npm install` first.");
    process.exit(1);
  }
  await mkdir(dirname(WASM_TO), { recursive: true });
  await cp(WASM_FROM, WASM_TO, { recursive: true });
  console.log(`wasm    -> ${WASM_TO}`);

  for (const { file, variant, required } of MODELS) {
    const from = join(repo, "models", file);
    const to = join(web, "public", "models", file);

    if (!(await exists(from))) {
      const message = missingMessage(from, variant, file);
      if (required) {
        console.error(message);
        process.exit(1);
      }
      // The lite model only makes phones faster. Without it they fall back to
      // the full one, which works -- it is just slower.
      console.warn(`${message}\n(optional — phones will fall back to the full model)`);
      continue;
    }

    await mkdir(dirname(to), { recursive: true });
    await cp(from, to);
    console.log(`${variant.padEnd(7)} -> ${to}`);
  }

  console.log("\nDemo assets are local. It will run offline.");
}

await main();
