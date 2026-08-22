/** Drawing the skeleton and the on-screen readout. */
import { Frame } from "./pose/geometry";
import { LM, SKELETON } from "./pose/landmarks";
import type { FrameResult } from "./pose/live";

const GREEN = "#3ddc84";
const CORAL = "#ff7a5c";

/** Plain-English names, because "knee_flexion" means nothing to a player. */
export const FRIENDLY: Record<string, { en: string; th: string }> = {
  knee_flexion: { en: "knee bend", th: "งอเข่า" },
  hip_flexion: { en: "hip bend", th: "งอสะโพก" },
  trunk_lean: { en: "lean", th: "เอนตัว" },
  knee_valgus: { en: "knee in", th: "เข่าเข้าใน" },
  pelvic_drop: { en: "hip drop", th: "สะโพกตก" },
  ankle_dorsiflexion: { en: "ankle", th: "ข้อเท้า" },
  heel_raise_ratio: { en: "heel", th: "ส้นเท้า" },
};

/** Which readings to surface, given what this exercise actually checks. */
export function metricsToShow(targetMetrics: readonly string[]): string[] {
  const wanted = targetMetrics.filter((m) => m in FRIENDLY);
  return wanted.length ? [...new Set(wanted)] : ["knee_flexion", "trunk_lean"];
}

export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  ok: boolean,
  mirrored = true,
): void {
  const { width: w, height: h } = ctx.canvas;
  const x = (i: number) => (mirrored ? 1 - frame.screenX(i) : frame.screenX(i)) * w;
  const y = (i: number) => frame.screenY(i) * h;
  const colour = ok ? GREEN : CORAL;

  ctx.lineWidth = Math.max(2, w / 320);
  ctx.strokeStyle = colour;
  ctx.globalAlpha = ok ? 0.95 : 0.5;
  for (const [a, b] of SKELETON) {
    if (Math.min(frame.confidence(a), frame.confidence(b)) < 0.3) continue;
    ctx.beginPath();
    ctx.moveTo(x(a), y(a));
    ctx.lineTo(x(b), y(b));
    ctx.stroke();
  }

  ctx.fillStyle = "#ffffff";
  const r = Math.max(2.5, w / 380);
  for (let i = 0; i < 33; i++) {
    if (frame.confidence(i) < 0.3) continue;
    ctx.beginPath();
    ctx.arc(x(i), y(i), r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Ring the knees — that is where most of the coaching happens.
  ctx.globalAlpha = 1;
  ctx.strokeStyle = colour;
  ctx.lineWidth = Math.max(2, w / 400);
  for (const knee of [LM.LEFT_KNEE, LM.RIGHT_KNEE]) {
    if (frame.confidence(knee) < 0.3) continue;
    ctx.beginPath();
    ctx.arc(x(knee), y(knee), r * 3.2, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

export function renderReadout(el: HTMLElement, result: FrameResult, keys: string[]): void {
  if (!result.metrics) {
    el.innerHTML = `<span style="color:${CORAL}">— no reading —</span>`;
    return;
  }
  const rows = keys
    .filter((k) => result.metrics![k] !== undefined)
    .map((k) => {
      const name = FRIENDLY[k]?.th ?? k;
      const value = result.metrics![k]!;
      const unit = k.endsWith("_ratio") ? "" : "°";
      return `${name} <b>${value.toFixed(0)}${unit}</b>`;
    });
  el.innerHTML = rows.join("<br>");
}
