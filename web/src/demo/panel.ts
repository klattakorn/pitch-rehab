/** The "how to do it" panel: an animated demonstration plus what will be judged. */
import { HEAD_RADIUS, type FigurePose, bones, joints, project } from "./figure";
import { buildDemoSpec, targetLines } from "./spec";
import type { Exercise } from "../pose/rules";

const GREEN = "#7ac943";
const CORAL = "#ff5f52";
const GHOST = "rgba(122, 201, 67, 0.16)";

export interface DemoHandle {
  stop: () => void;
}

export function cameraDiagram(view: "front" | "side" | "any"): string {
  if (view === "any") return "";
  const person = `<circle cx="62" cy="20" r="7"/><line x1="62" y1="27" x2="62" y2="48"/>
     <line x1="62" y1="33" x2="53" y2="42"/><line x1="62" y1="33" x2="71" y2="42"/>
     <line x1="62" y1="48" x2="55" y2="64"/><line x1="62" y1="48" x2="69" y2="64"/>`;
  const phone =
    view === "front"
      ? `<rect x="6" y="26" width="16" height="28" rx="3"/><path d="M24 40 L40 40"
         stroke-dasharray="3 3"/><path d="M36 36 L40 40 L36 44" fill="none"/>`
      : `<rect x="52" y="76" width="20" height="14" rx="3"/><path d="M62 74 L62 68"
         stroke-dasharray="3 3"/><path d="M58 72 L62 68 L66 72" fill="none"/>`;
  return `<svg viewBox="0 0 100 96" class="camdiagram" aria-hidden="true">
      <g stroke="${GREEN}" stroke-width="2" fill="none" stroke-linecap="round">${person}</g>
      <g stroke="${CORAL}" stroke-width="2" fill="none">${phone}</g>
    </svg>`;
}

export function demoPanelHtml(exercise: Exercise): string {
  const rule = exercise.pose_rule!;
  const spec = buildDemoSpec(exercise.key, rule);
  const targets = targetLines(rule)
    .map((line) => `<li>${line}</li>`)
    .join("");
  const where =
    rule.view === "front"
      ? "Put the camera in front of you"
      : "Put the camera to your side";
  const dose =
    rule.mode === "hold"
      ? `Hold for ${rule.hold_target_s ?? 0} seconds`
      : "Repeat with control";

  return `
    <div class="demo">
      <div class="demo-figure">
        ${
          // Where the movement has been filmed, that is what "correct" shows:
          // watching a person is a better instruction than watching a drawing.
          // The figure stays underneath for the mistake, which is the half that
          // cannot be filmed -- nobody should be recorded doing a rep wrong on
          // a knee that is already hurt.
          exercise.demo_url
            ? `<video id="demo-video" src="${exercise.demo_url}" muted loop playsinline
                      autoplay preload="metadata" disablepictureinpicture></video>`
            : ""
        }
        <canvas id="demo-canvas" width="420" height="420"${
          exercise.demo_url ? " hidden" : ""
        }></canvas>
        <div class="demo-toggle">
          <button class="chip on" id="show-right">Correct</button>
          ${spec.hasMistake ? `<button class="chip" id="show-wrong">Common mistake</button>` : ""}
        </div>
      </div>
      <div class="demo-info">
        <p class="cue-line">${exercise.cue_en ?? ""}</p>
        ${exercise.equipment ? `<p class="kit">Equipment: ${exercise.equipment}</p>` : ""}
        <div class="where">
          ${cameraDiagram(rule.view)}
          <div><strong>${where}</strong><span class="en">${dose}</span></div>
        </div>
        <!-- Where the camera goes was the one thing the app never said, and a
             phone flat on the floor with the player standing over it is what
             the first person to try it did. It is not a detail: the angles are
             measured off the picture, so a bad view is bad numbers, and the
             screen has no way to tell the player that after the fact. -->
        <p class="framing">Prop the phone up at about <strong>hip height</strong>,
           two to three steps away, and stand back until your <strong>head and
           feet are both in the picture</strong>. Filming from the floor, or
           standing too close, bends the angles it measures.</p>
        <h4>What gets measured</h4>
        <ul class="targets">${targets}</ul>
      </div>
    </div>`;
}

/** Start the animation. Call the returned stop() when leaving the screen. */
export function runDemoAnimation(exercise: Exercise): DemoHandle {
  const canvas = document.querySelector<HTMLCanvasElement>("#demo-canvas");
  if (!canvas) return { stop: () => {} };
  const ctx = canvas.getContext("2d")!;
  const rule = exercise.pose_rule!;
  const spec = buildDemoSpec(exercise.key, rule);

  let wrong = false;
  let running = true;
  const started = performance.now();
  const CYCLE = rule.mode === "hold" ? 4200 : 3000;

  const rightBtn = document.querySelector<HTMLButtonElement>("#show-right");
  const wrongBtn = document.querySelector<HTMLButtonElement>("#show-wrong");
  const video = document.querySelector<HTMLVideoElement>("#demo-video");

  /** Swap between the filmed version and the drawn one, where both exist. */
  const show = (showWrong: boolean): void => {
    wrong = showWrong;
    if (!video) return;
    video.hidden = showWrong;
    canvas.hidden = !showWrong;
    // Paused rather than left running behind the figure: a phone that is
    // decoding video nobody can see is spending battery for nothing.
    if (showWrong) video.pause();
    else void video.play().catch(() => {});
  };

  if (rightBtn && wrongBtn) {
    rightBtn.onclick = () => {
      show(false);
      rightBtn.classList.add("on");
      wrongBtn.classList.remove("on");
    };
    wrongBtn.onclick = () => {
      show(true);
      wrongBtn.classList.add("on");
      rightBtn.classList.remove("on");
    };
  }

  // A clip that will not load leaves the drawing rather than a black rectangle.
  if (video) {
    video.onerror = () => {
      video.hidden = true;
      canvas.hidden = false;
    };
  }

  /**
   * Work out one scale and origin that fit every phase of the movement, so the
   * figure never clips and never floats. Sampling the whole movement rather than
   * a single pose means the frame does not jump about as it animates, and it
   * adapts to standing, lying and everything between without hand-tuning.
   */
  const fit = (() => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const w of [false, true]) {
      for (let i = 0; i <= 8; i++) {
        const pose = spec.figure(i / 8, w);
        const points = [pose.head, ...joints(pose), ...pose.toes, ...pose.heels];
        for (const p of points) {
          const [x, y] = project(p, spec.camera.yaw, spec.camera.pitch, 1, 0, 0);
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    }
    const pad = 0.86;
    const scale = Math.min(
      (canvas!.width * pad) / Math.max(maxX - minX, 0.1),
      (canvas!.height * pad) / Math.max(maxY - minY, 0.1),
    );
    return {
      scale,
      originX: canvas!.width / 2 - ((minX + maxX) / 2) * scale,
      originY: canvas!.height / 2 - ((minY + maxY) / 2) * scale,
      groundY: canvas!.height / 2 + ((maxY - minY) / 2) * scale,
    };
  })();

  function drawFigure(pose: FigurePose, colour: string, alpha: number): void {
    const { scale, originX, originY } = fit;
    const to = (p: [number, number, number]) =>
      project(p, spec.camera.yaw, spec.camera.pitch, scale, originX, originY);

    ctx.globalAlpha = alpha;
    ctx.strokeStyle = colour;
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const [a, b] of bones(pose)) {
      const [x1, y1] = to(a);
      const [x2, y2] = to(b);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    const [hx, hy] = to(pose.head);
    ctx.beginPath();
    ctx.arc(hx, hy, scale * HEAD_RADIUS, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = colour;
    for (const j of joints(pose)) {
      const [x, y] = to(j);
      ctx.beginPath();
      ctx.arc(x, y, 3.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function frame(): void {
    if (!running) return;
    // How a hold settles versus how a rep travels is decided in the spec, so it
    // stays the same everywhere; here it is just elapsed time.
    const phase = ((performance.now() - started) % CYCLE) / CYCLE;

    ctx.clearRect(0, 0, canvas!.width, canvas!.height);
    // A faint ghost of the finished position, so the target is always visible.
    drawFigure(spec.figure(0.5, wrong), wrong ? CORAL : GREEN, 0.18);
    drawFigure(spec.figure(phase, wrong), wrong ? CORAL : GREEN, 1);

    // Floor line at the figure's lowest point, so it does not look like it is
    // floating. Drawn first would be cleaner, but it is faint enough not to matter.
    ctx.strokeStyle = GHOST;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(canvas!.width * 0.06, fit.groundY + 2);
    ctx.lineTo(canvas!.width * 0.94, fit.groundY + 2);
    ctx.stroke();

    requestAnimationFrame(frame);
  }
  frame();

  return {
    stop: () => {
      running = false;
    },
  };
}
