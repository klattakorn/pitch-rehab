/**
 * Pose Lab: a bench for tuning the pose detection.
 *
 * Pick an exercise, feed it the live camera or a video file, and change the
 * thresholds while you watch. Every frame MediaPipe returns is kept, so a change
 * re-scores the whole recording instantly -- record once, tune many times,
 * rather than redoing the reps for every number you try.
 *
 * After a file is analysed, or the camera is stopped, the clip stays on screen
 * as a video you can scrub. Pause on rest, pause on a full rep, and the lab sets
 * the thresholds from those two positions -- no numbers needed.
 *
 * Nothing here is saved to the app. "Copy settings" gives you the numbers to
 * paste into app/data/exercises.py, which stays the one place rules are set.
 */
import type { PoseLandmarker } from "@mediapipe/tasks-vision";

import {
  createPoseLandmarker,
  startCamera,
  type CameraHandle,
} from "./mediapipe";
import { Frame, computeMetrics, type RawLandmark } from "./pose/geometry";
import type { Side } from "./pose/landmarks";
import { LiveSession, type SetResult } from "./pose/live";
import type { Exercise, ExerciseRule } from "./pose/rules";
import { drawSkeleton } from "./render";

interface Recorded {
  t: number;
  landmarks: RawLandmark[];
}

/** About a minute at 30fps. Enough for a set; stops memory creeping on a phone. */
const MAX_FRAMES = 1800;

const esc = (s: string): string =>
  s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );
/** Ratios like heel_raise_ratio live between 0 and 1, so small numbers get more places. */
const fmt = (n: number | null | undefined, d?: number): string =>
  n === null || n === undefined || Number.isNaN(n)
    ? "—"
    : n.toFixed(d ?? (Math.abs(n) < 5 ? 2 : 1));

/**
 * Drawn icons. The toolbar used text symbols (⏮ ▶ ↶) before, which every phone
 * draws in its own font -- some as emoji, some not at all. One stroke weight,
 * one size, so they read as a set.
 */
const svg = (d: string, fill = false): string =>
  `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" ${
    fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'
  }>${d}</svg>`;
const ICON = {
  undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  redo: svg('<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'),
  back: svg('<path d="M18 6 10 12l8 6V6Z"/><path d="M6 6v12"/>', true),
  fwd: svg('<path d="m6 6 8 6-8 6V6Z"/><path d="M18 6v12"/>', true),
  play: svg('<path d="M7 5v14l12-7L7 5Z"/>', true),
  pause: svg('<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>', true),
};

export function mountLab(root: HTMLElement, exercises: Exercise[]): () => void {
  const scored = exercises.filter((e) => e.pose_rule);
  if (!scored.length) {
    root.innerHTML = `<div class="notice">No exercises with camera rules were found.</div>`;
    return () => {};
  }

  root.innerHTML = `
    <div class="lab">
      <div class="lab-toolbar">
        <select id="lab-ex" aria-label="Exercise">${scored
          .map((e) => `<option value="${e.key}">${esc(e.name_en)}</option>`)
          .join("")}</select>
        <select id="lab-side" aria-label="Side">
          <option value="bilateral">Both sides</option>
          <option value="left">Left</option>
          <option value="right">Right</option>
        </select>
        <span class="lab-sep"></span>
        <button class="lab-tool rec" id="lab-live" title="Record from the camera"><i></i>Record</button>
        <label class="lab-tool" title="Open a video file">Import
          <input type="file" id="lab-file" accept="video/*" hidden />
        </label>
        <button class="lab-tool" id="lab-stop" title="Stop">Stop</button>
        <span class="lab-grow"></span>
        <button class="lab-icon" id="lab-undo" title="Undo (Ctrl+Z)" aria-label="Undo">${ICON.undo}</button>
        <button class="lab-icon" id="lab-redo" title="Redo (Ctrl+Shift+Z)" aria-label="Redo">${ICON.redo}</button>
        <button class="lab-tool accent" id="lab-copy" title="Copy the numbers for exercises.py">Export</button>
      </div>

      <div class="lab-work">
        <div class="lab-preview">
          <div class="lab-stage" id="lab-stage">
            <video id="lab-video" playsinline muted></video>
            <canvas id="lab-overlay"></canvas>
            <div class="lab-live" id="lab-live-read"></div>
            <div class="lab-badge" id="lab-result"></div>
          </div>
          <div class="lab-transport">
            <button class="lab-icon" id="lab-back1" title="Back one frame" aria-label="Back one frame">${ICON.back}</button>
            <button class="lab-icon play" id="lab-play" title="Play / pause" aria-label="Play">${ICON.play}</button>
            <button class="lab-icon" id="lab-fwd1" title="Forward one frame" aria-label="Forward one frame">${ICON.fwd}</button>
            <span class="lab-time" id="lab-time">00:00.00</span>
          </div>
        </div>

        <aside class="lab-inspector">
          <div class="lab-tabs" role="tablist">
            <button class="lab-tab on" data-pane="simple" role="tab">Settings</button>
            <button class="lab-tab" data-pane="adv" role="tab">Advanced</button>
            <button class="lab-tab" data-pane="hist" role="tab">History</button>
          </div>
          <div class="lab-pane" data-pane="simple">
            <p class="lab-summary" id="lab-summary"></p>
            <div id="lab-adjust" class="lab-marks">
              <button class="lab-tool" id="lab-set-rest">Mark rest</button>
              <button class="lab-tool accent" id="lab-set-full">Mark full rep</button>
            </div>
            <p class="lab-hint" id="lab-picks"></p>
            <div class="lab-card" id="lab-rep-card" hidden></div>
          </div>
          <div class="lab-pane" data-pane="adv" hidden>
            <div id="lab-knobs"></div>
            <label class="lab-knob"><span>Video frames/sec</span>
              <select id="lab-rate">
                <option value="30">30</option>
                <option value="15">15</option>
              </select></label>
            <div class="lab-row">
              <button class="lab-tool" id="lab-reset">Reset to app values</button>
              <button class="lab-tool" id="lab-download">Save landmarks</button>
            </div>
          </div>
          <div class="lab-pane" data-pane="hist" hidden>
            <ol class="lab-history" id="lab-history"></ol>
            <button class="lab-tool" id="lab-clear">Clear recording</button>
          </div>
          <div class="lab-warn" id="lab-trap" hidden></div>
          <p class="lab-status" id="lab-status">Record or import a video.</p>
        </aside>
      </div>

      <div class="lab-timeline">
        <div class="lab-tracklabels"><span>Reps</span><span>Movement</span></div>
        <canvas id="lab-chart" height="150"></canvas>
      </div>
    </div>`;

  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const exSel = $<HTMLSelectElement>("#lab-ex");
  const sideSel = $<HTMLSelectElement>("#lab-side");
  const rateSel = $<HTMLSelectElement>("#lab-rate");
  const fileIn = $<HTMLInputElement>("#lab-file");
  const status = $<HTMLParagraphElement>("#lab-status");
  const video = $<HTMLVideoElement>("#lab-video");
  const overlay = $<HTMLCanvasElement>("#lab-overlay");
  const stage = $<HTMLDivElement>("#lab-stage");
  const liveRead = $<HTMLDivElement>("#lab-live-read");
  const resultEl = $<HTMLDivElement>("#lab-result");
  const chart = $<HTMLCanvasElement>("#lab-chart");
  const knobs = $<HTMLDivElement>("#lab-knobs");
  const trap = $<HTMLDivElement>("#lab-trap");
  const playBtn = $<HTMLButtonElement>("#lab-play");
  const timeEl = $<HTMLSpanElement>("#lab-time");
  const repCard = $<HTMLDivElement>("#lab-rep-card");
  const ctx = overlay.getContext("2d")!;
  const summaryEl = $<HTMLParagraphElement>("#lab-summary");
  const historyEl = $<HTMLOListElement>("#lab-history");
  const undoBtn = $<HTMLButtonElement>("#lab-undo");
  const redoBtn = $<HTMLButtonElement>("#lab-redo");
  const picksEl = $<HTMLParagraphElement>("#lab-picks");

  let exercise = scored[0]!;
  let rule: ExerciseRule = structuredClone(exercise.pose_rule!) as ExerciseRule;
  let side: Side = "bilateral";
  let frames: Recorded[] = [];
  let aspect = 1;
  let session: LiveSession | null = null;
  let landmarker: PoseLandmarker | null = null;
  let camera: CameraHandle | null = null;
  let objectUrl: string | null = null;
  let running = false;
  let mirrored = false;
  let lastVideoTime = -1;
  let started = 0;
  let rescoreQueued = false;
  /** Bumped to cancel a file that is still being stepped through. */
  let fileRun = 0;
  /** Live camera recording, so the session can be replayed as a video after. */
  let recorder: MediaRecorder | null = null;
  let recorded: Blob[] = [];
  /** True once the clip is on screen to scrub, rather than being captured. */
  let reviewing = false;
  let restPick: number | null = null;
  let fullPick: number | null = null;

  /**
   * Every change, kept like an editor's history panel. Each entry is a whole
   * copy of the rule rather than a diff, so jumping to any point is just
   * loading it -- a rule is a few hundred bytes, so this costs nothing.
   */
  interface Step {
    label: string;
    rule: string;
    rest: number | null;
    full: number | null;
    result: string;
  }
  let history: Step[] = [];
  let at = -1;
  /** The rep clip last clicked on the timeline, shown in the inspector. */
  let selectedRep: number | null = null;
  /** Latest scoring, kept so the timeline can redraw without re-scoring. */
  let lastOutcome: SetResult | null = null;

  // ------------------------------------------------------------ the knobs
  type Knob = {
    label: string;
    get: () => number | null;
    set: (v: number | null) => void;
    step: number;
  };

  function knobList(): Knob[] {
    const list: Knob[] = [];
    const det = rule.detection;
    if (rule.mode === "rep" && det) {
      list.push(
        {
          label: `enter (${det.signal})`,
          get: () => det.enter,
          set: (v) => (det.enter = v ?? det.enter),
          step: 1,
        },
        {
          label: "exit",
          get: () => det.exit,
          set: (v) => (det.exit = v ?? det.exit),
          step: 1,
        },
        {
          label: "min_amplitude",
          get: () => det.min_amplitude,
          set: (v) => (det.min_amplitude = v ?? 0),
          step: 1,
        },
        {
          label: "min_duration_s",
          get: () => det.min_duration_s,
          set: (v) => (det.min_duration_s = v ?? 0),
          step: 0.05,
        },
        {
          label: "tempo_min_s (blank = off)",
          get: () => rule.tempo_min_s ?? null,
          set: (v) => (rule.tempo_min_s = v),
          step: 0.1,
        },
      );
    }
    if (rule.mode === "hold") {
      list.push({
        label: "hold_target_s",
        get: () => rule.hold_target_s ?? null,
        set: (v) => (rule.hold_target_s = v),
        step: 1,
      });
    }
    for (const t of rule.targets) {
      const name = `${t.code} · ${t.metric} ${t.aggregate}`;
      list.push(
        {
          label: `${name} — min`,
          get: () => t.min,
          set: (v) => (t.min = v),
          step: 1,
        },
        {
          label: `${name} — max`,
          get: () => t.max,
          set: (v) => (t.max = v),
          step: 1,
        },
        {
          label: `${name} — tolerance`,
          get: () => t.tolerance,
          set: (v) => (t.tolerance = v ?? 0),
          step: 0.5,
        },
      );
    }
    return list;
  }

  function drawKnobs(): void {
    const list = knobList();
    knobs.innerHTML =
      list
        .map(
          (k, i) => `<label class="lab-knob"><span>${esc(k.label)}</span>
          <input type="number" step="${k.step}" data-knob="${i}" value="${k.get() ?? ""}" /></label>`,
        )
        .join("") +
      rule.targets
        .map(
          (
            t,
            i,
          ) => `<label class="lab-knob"><span>${esc(t.code)} — refuses the rep (critical)</span>
            <input type="checkbox" data-critical="${i}" ${t.critical ? "checked" : ""} /></label>`,
        )
        .join("");
    knobs
      .querySelectorAll<HTMLInputElement>("input[data-knob]")
      .forEach((input) => {
        const k = list[Number(input.dataset.knob)]!;
        // Typing re-scores as you go; the history entry is written once the
        // box is left, so "-3", "-38" is one step, not two.
        let before = k.get();
        input.addEventListener("focus", () => (before = k.get()));
        input.addEventListener("input", () => {
          k.set(input.value.trim() === "" ? null : Number(input.value));
          queueRescore();
        });
        input.addEventListener("change", () => {
          const after = k.get();
          if (after !== before) {
            rescore();
            commit(`${k.label}: ${fmt(before)} → ${fmt(after)}`);
            before = after;
          }
        });
      });
    knobs
      .querySelectorAll<HTMLInputElement>("input[data-critical]")
      .forEach((input) => {
        input.addEventListener("change", () => {
          const t = rule.targets[Number(input.dataset.critical)]!;
          t.critical = input.checked;
          rescore();
          commit(`${t.code}: ${input.checked ? "now refuses the rep" : "no longer refuses the rep"}`);
        });
      });
  }

  // ----------------------------------------------------------- scoring
  function signalOf(f: Frame): number | null {
    const key =
      rule.mode === "rep" ? rule.detection?.signal : rule.targets[0]?.metric;
    if (!key) return null;
    const sides: Side[] = side === "bilateral" ? ["left", "right"] : [side];
    const vals = sides
      .map((s) => computeMetrics(f, s, rule.use_z)[key])
      .filter((v): v is number => typeof v === "number");
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }

  function freshSession(): LiveSession {
    return new LiveSession(rule, side);
  }

  /** Re-run every recorded frame through a new session with the current rule. */
  function rescore(): void {
    session = freshSession();
    for (const r of frames) session.push(Frame.from(r.t, r.landmarks, aspect));
    showResults();
  }

  function queueRescore(): void {
    // Typing "-3" then "-38" fires twice; one re-score per burst.
    if (rescoreQueued) return;
    rescoreQueued = true;
    setTimeout(() => {
      rescoreQueued = false;
      rescore();
    }, 0);
  }

  function currentOutcome(): SetResult | null {
    if (!session || !frames.length) return null;
    // finish() closes any rep still open, so score a throwaway copy.
    const copy = freshSession();
    for (const r of frames) copy.push(Frame.from(r.t, r.landmarks, aspect));
    return copy.finish();
  }

  function showResults(): void {
    const det = rule.detection;
    // The trap that cost a day on the glute bridge: the amplitude gate quietly
    // overrides `enter`. Say so the moment it happens.
    if (
      rule.mode === "rep" &&
      det &&
      det.exit + det.min_amplitude > det.enter
    ) {
      trap.hidden = false;
      trap.textContent =
        `min_amplitude is overriding enter: the real gate is exit + min_amplitude = ` +
        `${fmt(det.exit + det.min_amplitude)}, not ${fmt(det.enter)}. ` +
        `Lower min_amplitude to ${fmt(det.enter - det.exit)} or less.`;
    } else {
      trap.hidden = true;
    }
    if (rule.mode === "rep" && det && det.exit >= det.enter) {
      trap.hidden = false;
      trap.textContent = "exit must be below enter, or nothing can be counted.";
    }

    const out = currentOutcome();
    lastOutcome = out;
    if (!out) {
      resultEl.hidden = !frames.length;
      resultEl.textContent = "Scoring…";
      drawTimeline();
      renderRepCard();
      return;
    }
    resultEl.hidden = false;
    resultEl.className = `lab-badge ${
      rule.mode === "rep" && out.validReps < out.completedReps ? "warn" : ""
    }`;
    resultEl.textContent =
      rule.mode === "hold"
        ? `Held ${fmt(out.holdSeconds, 1)}s`
        : `${out.validReps} of ${out.completedReps} reps counted`;
    drawTimeline();
    renderRepCard();
  }

  // ----------------------------------------------------------- timeline
  /** Where the clip is, in the frames' clock. */
  function playheadT(): number {
    if (reviewing) return video.currentTime;
    return frames.length ? frames[frames.length - 1]!.t : 0;
  }

  const RULER = 22;
  const REP_TRACK = 40;
  const GAP = 8;

  /**
   * The CapCut-style strip under the preview: a time ruler, each rep as a clip
   * (green counted, red refused), the movement as a waveform with the start and
   * end lines across it, and a playhead you can drag.
   */
  function drawTimeline(): void {
    const dpr = window.devicePixelRatio || 1;
    const cssW = chart.clientWidth || 600;
    const cssH = 150;
    if (chart.width !== Math.round(cssW * dpr)) {
      chart.width = Math.round(cssW * dpr);
      chart.height = Math.round(cssH * dpr);
    }
    const g = chart.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = cssW;
    const H = cssH;
    g.clearRect(0, 0, W, H);

    const span = Math.max(1, timelineSpan());
    const X = (t: number) => (t / span) * W;

    // ruler
    g.fillStyle = "#7d8792";
    g.font = "10px ui-monospace, monospace";
    // Space the labels by screen width, not clip length, so a phone does not
    // crowd six timecodes into 300px.
    const tick =
      [1, 2, 5, 10, 15, 30, 60].find((step) => (step / span) * W >= 56) ?? 60;
    for (let t = 0; t <= span; t += tick) {
      g.fillRect(X(t), RULER - 7, 1, 7);
      g.fillText(clock(t, false), X(t) + 3, 11);
    }
    for (let t = 0; t <= span; t += tick / 5) g.fillRect(X(t), RULER - 3, 1, 3);

    const repTop = RULER + 4;
    const waveTop = repTop + REP_TRACK + GAP;
    const waveH = H - waveTop - 4;

    // Empty tracks, so the strip reads as an editor before anything is loaded.
    g.fillStyle = "rgba(255,255,255,0.035)";
    roundRect(g, 0, repTop, W, REP_TRACK, 6);
    roundRect(g, 0, waveTop, W, waveH, 6);

    if (frames.length) {
      // rep clips
      lastOutcome?.reps.forEach((r, i) => {
        const x = X(r.startT);
        const w = Math.max(6, X(r.endT) - x);
        g.fillStyle = r.isValid ? "#2fbf71" : "#ff5a50";
        g.globalAlpha = selectedRep === i ? 1 : 0.85;
        roundRect(g, x, repTop + 3, w, REP_TRACK - 6, 5);
        g.globalAlpha = 1;
        if (selectedRep === i) {
          g.strokeStyle = "#ffffff";
          g.lineWidth = 2;
          g.beginPath();
          g.roundRect(x, repTop + 3, w, REP_TRACK - 6, 5);
          g.stroke();
        }
        if (w > 14) {
          g.fillStyle = "#06120a";
          g.font = "bold 11px ui-sans-serif, sans-serif";
          g.fillText(String(i + 1), x + 6, repTop + REP_TRACK / 2 + 4);
        }
      });

      // waveform
      const pts = frames.map((r) => ({
        t: r.t,
        v: signalOf(Frame.from(r.t, r.landmarks, aspect)),
      }));
      const det = rule.mode === "rep" ? rule.detection : null;
      const vals = pts.map((q) => q.v).filter((v): v is number => v !== null);
      if (det) vals.push(det.enter, det.exit);
      if (vals.length) {
        let lo = Math.min(...vals);
        let hi = Math.max(...vals);
        const pad = (hi - lo) * 0.12 || 1;
        lo -= pad;
        hi += pad;
        const Y = (v: number) => waveTop + waveH - ((v - lo) / (hi - lo)) * waveH;
        // Filled under the line, like an audio waveform.
        g.beginPath();
        let first = true;
        let lastX = 0;
        for (const q of pts) {
          if (q.v === null) continue;
          if (first) {
            g.moveTo(X(q.t), waveTop + waveH);
            first = false;
          }
          g.lineTo(X(q.t), Y(q.v));
          lastX = X(q.t);
        }
        g.lineTo(lastX, waveTop + waveH);
        g.closePath();
        g.fillStyle = "rgba(192,249,23,0.16)";
        g.fill();
        g.beginPath();
        let pen = false;
        for (const q of pts) {
          if (q.v === null) {
            pen = false;
            continue;
          }
          if (pen) g.lineTo(X(q.t), Y(q.v));
          else g.moveTo(X(q.t), Y(q.v));
          pen = true;
        }
        g.strokeStyle = "#c0f917";
        g.lineWidth = 1.5;
        g.stroke();
        if (det) {
          const line = (v: number, colour: string, label: string) => {
            g.strokeStyle = colour;
            g.setLineDash([4, 4]);
            g.lineWidth = 1;
            g.beginPath();
            g.moveTo(0, Y(v));
            g.lineTo(W, Y(v));
            g.stroke();
            g.setLineDash([]);
            g.fillStyle = colour;
            g.font = "10px ui-sans-serif, sans-serif";
            // "end" sits under its line so the two never print on top of each other.
            g.fillText(label, 6, label === "end" ? Y(v) + 11 : Y(v) - 3);
          };
          line(det.enter, "#ffffff", "start");
          line(det.exit, "#ff9f43", "end");
        }
      }
    }

    // playhead
    const px = X(playheadT());
    g.fillStyle = "#ffffff";
    g.fillRect(px - 1, 0, 2, H);
    g.beginPath();
    g.moveTo(px - 6, 0);
    g.lineTo(px + 6, 0);
    g.lineTo(px, 8);
    g.closePath();
    g.fill();
    timeEl.textContent = clock(playheadT(), true);
  }

  function timelineSpan(): number {
    if (reviewing && Number.isFinite(video.duration)) return video.duration;
    return frames.length ? frames[frames.length - 1]!.t : 0;
  }

  function roundRect(
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
    g.beginPath();
    g.roundRect(x, y, w, h, r);
    g.fill();
  }

  function clock(t: number, fine: boolean): string {
    const m = Math.floor(t / 60);
    const sec = t - m * 60;
    const ss = fine
      ? sec.toFixed(2).padStart(5, "0")
      : String(Math.floor(sec)).padStart(2, "0");
    return `${String(m).padStart(2, "0")}:${ss}`;
  }

  /** The clicked rep, in words -- what the old table said, for one rep. */
  function renderRepCard(): void {
    const r = selectedRep !== null ? lastOutcome?.reps[selectedRep] : undefined;
    if (!r) {
      repCard.hidden = true;
      return;
    }
    repCard.hidden = false;
    const why = r.violations.length
      ? r.violations
          .map(
            (v) =>
              `<li>${esc(v.message_en || v.code)} <small>${fmt(v.observed)} (needs ${v.bound === "min" ? "≥" : "≤"} ${fmt(v.limit)})</small></li>`,
          )
          .join("")
      : "<li>Clean rep</li>";
    repCard.innerHTML =
      `<div class="lab-card-head"><b>Rep ${r.index + 1}</b>` +
      `<span class="${r.isValid ? "ok" : "bad"}">${r.isValid ? "Counted" : "Not counted"}</span></div>` +
      `<div class="lab-card-meta">${clock(r.startT, true)} · ${fmt(r.duration, 2)}s · form ${fmt(r.formScore, 0)}</div>` +
      `<ul>${why}</ul>`;
  }

  function exportText(): string {
    const lines: string[] = [`# ${exercise.key}`];
    const det = rule.detection;
    if (rule.mode === "rep" && det) {
      lines.push(
        `detection=RepDetection(signal="${det.signal}", enter=${det.enter.toFixed(1)}, exit=${det.exit.toFixed(1)}, ` +
          `min_amplitude=${det.min_amplitude.toFixed(1)}, min_duration_s=${det.min_duration_s}),`,
        `tempo_min_s=${rule.tempo_min_s ?? "None"},`,
      );
    }
    if (rule.mode === "hold")
      lines.push(`hold_target_s=${rule.hold_target_s ?? "None"},`);
    for (const t of rule.targets) {
      lines.push(
        `# ${t.code}: min=${t.min ?? "None"} max=${t.max ?? "None"} tolerance=${t.tolerance} critical=${t.critical ? "True" : "False"}`,
      );
    }
    return lines.join("\n");
  }

  // ------------------------------------------------------------ history
  function resultLine(): string {
    const out = currentOutcome();
    if (!out) return "no recording";
    return rule.mode === "hold"
      ? `held ${fmt(out.holdSeconds)}s`
      : `${out.completedReps} found · ${out.validReps} counted`;
  }

  /** Record the current state as a new step, dropping anything that was undone. */
  function commit(label: string): void {
    history = history.slice(0, at + 1);
    history.push({
      label,
      rule: JSON.stringify(rule),
      rest: restPick,
      full: fullPick,
      result: resultLine(),
    });
    at = history.length - 1;
    renderHistory();
  }

  /** Jump to any step, the way clicking a history entry in an editor does. */
  function goTo(i: number): void {
    if (i < 0 || i >= history.length) return;
    at = i;
    const s = history[i]!;
    rule = JSON.parse(s.rule) as ExerciseRule;
    restPick = s.rest;
    fullPick = s.full;
    showPicks();
    drawKnobs();
    rescore();
    renderHistory();
  }

  function renderHistory(): void {
    undoBtn.disabled = at <= 0;
    redoBtn.disabled = at >= history.length - 1;
    historyEl.innerHTML = history
      .map(
        (s, i) =>
          `<li class="${i === at ? "now" : i > at ? "undone" : ""}" data-step="${i}">
             <span>${esc(s.label)}</span><small>${esc(s.result)}</small></li>`,
      )
      .join("");
    historyEl.querySelectorAll<HTMLLIElement>("li").forEach((li) =>
      li.addEventListener("click", () => goTo(Number(li.dataset.step))),
    );
    renderSummary();
  }

  /** The plain-language version of the numbers, for the Settings tab. */
  function renderSummary(): void {
    const det = rule.detection;
    if (rule.mode === "rep" && det) {
      summaryEl.innerHTML =
        `A rep <b>starts</b> when ${esc(det.signal)} goes above <b>${fmt(det.enter)}</b>` +
        ` and <b>ends</b> when it drops back below <b>${fmt(det.exit)}</b>.` +
        (rule.tempo_min_s
          ? ` A rep faster than <b>${fmt(rule.tempo_min_s)}s</b> does not count.`
          : "");
    } else {
      summaryEl.innerHTML =
        `Hold for <b>${fmt(rule.hold_target_s ?? null, 0)}s</b>. ` +
        `This exercise is set in the Advanced tab.`;
    }
  }

  function showPane(name: string): void {
    root.querySelectorAll<HTMLElement>(".lab-tab").forEach((t) =>
      t.classList.toggle("on", t.dataset.pane === name),
    );
    root.querySelectorAll<HTMLElement>(".lab-pane").forEach((pane) => {
      pane.hidden = pane.dataset.pane !== name;
    });
  }

  /** The mark buttons only mean something on a paused clip of a rep exercise. */
  function syncMarks(): void {
    const usable = reviewing && rule.mode === "rep" && !!rule.detection;
    $<HTMLButtonElement>("#lab-set-rest").disabled = !usable;
    $<HTMLButtonElement>("#lab-set-full").disabled = !usable;
    showPicks();
  }

  // ------------------------------------------------------------ sources
  function loadExercise(): void {
    exercise = scored.find((e) => e.key === exSel.value) ?? scored[0]!;
    rule = structuredClone(exercise.pose_rule!) as ExerciseRule;
    drawKnobs();
    rescore();
    restPick = null;
    fullPick = null;
    showPicks();
    // A different exercise is a different rule: its history starts afresh.
    history = [];
    at = -1;
    commit(`Loaded ${exercise.name_en}`);
    syncMarks();
    status.textContent =
      `${exercise.name_en}: film from the ${rule.view === "any" ? "front or side" : rule.view}` +
      (frames.length ? ` · re-scored ${frames.length} recorded frames.` : ".");
  }

  function stopSource(): void {
    running = false;
    fileRun++;
    reviewing = false;
    syncMarks();
    if (recorder && recorder.state !== "inactive") recorder.stop();
    recorder = null;
    camera?.stop();
    camera = null;
    video.pause();
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
    video.removeAttribute("src");
    video.srcObject = null;
  }

  async function ensureLandmarker(): Promise<PoseLandmarker> {
    landmarker ??= await createPoseLandmarker("full");
    return landmarker;
  }

  function beginRecording(
    width: number,
    height: number,
    isMirrored: boolean,
    live = true,
  ): void {
    frames = [];
    aspect = width / height;
    overlay.width = width;
    overlay.height = height;
    stage.style.aspectRatio = `${width} / ${height}`;
    mirrored = isMirrored;
    stage.classList.toggle("mirrored", mirrored);
    session = freshSession();
    lastVideoTime = -1;
    started = performance.now();
    running = live;
    if (live) requestAnimationFrame(loop);
  }

  async function startLive(): Promise<void> {
    stopSource();
    status.textContent = "Starting camera…";
    try {
      const lm = await ensureLandmarker();
      void lm;
      camera = await startCamera(video, "user");
      beginRecording(camera.width, camera.height, camera.mirrored);
      // Record the stream as well, so Stop can hand it back as a video to
      // scrub. Started together with the frames, so the two clocks line up.
      recorded = [];
      try {
        recorder = new MediaRecorder(video.srcObject as MediaStream);
        recorder.ondataavailable = (e) => {
          if (e.data.size) recorded.push(e.data);
        };
        recorder.start(1000);
      } catch {
        // No MediaRecorder (older iOS): the numbers still work, only the
        // replay is missing.
        recorder = null;
      }
      status.textContent =
        "Recording from the camera. Change a number any time — the whole recording is re-scored.";
    } catch (error) {
      status.textContent = `Camera failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * A file is stepped through frame by frame rather than played. Played in real
   * time, a slow phone or a background tab drops most frames -- the first try
   * analysed 5 frames of a 10-second clip. Seeking is slower but sees them all,
   * and the times come from the file, so tempo is measured correctly.
   */
  async function startFile(file: File): Promise<void> {
    stopSource();
    status.textContent = "Loading video…";
    const token = ++fileRun;
    try {
      const lm = await ensureLandmarker();
      objectUrl = URL.createObjectURL(file);
      video.src = objectUrl;
      video.muted = true;
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () =>
          reject(new Error("this browser cannot open that file"));
      });
      beginRecording(video.videoWidth, video.videoHeight, false, false);
      const fps = Number(rateSel.value);
      const total = Math.floor(video.duration * fps);
      let stamp = performance.now();
      for (let i = 0; i <= total; i++) {
        if (token !== fileRun || !root.isConnected) return;
        const t = i / fps;
        await new Promise<void>((resolve) => {
          video.onseeked = () => resolve();
          video.currentTime = Math.min(t, Math.max(0, video.duration - 0.001));
        });
        stamp = Math.max(stamp + 1, performance.now());
        const points = lm.detectForVideo(video, stamp).landmarks?.[0];
        handleFrame(points, t);
        if (i % 15 === 0) {
          status.textContent = `Analysing ${file.name}: ${Math.round((100 * i) / Math.max(1, total))}%`;
          showResults();
          // Let the page paint, so the skeleton is visible as it goes.
          await new Promise((r) => setTimeout(() => r(null), 0));
        }
      }
      status.textContent = `Done: ${frames.length} frames from ${file.name}. Scrub the video to set the thresholds, or change the numbers below.`;
      showResults();
      enterReview();
    } catch (error) {
      status.textContent = `Video failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  let lastShown = 0;
  function loop(): void {
    // Left by a tab rather than Back: the screen is gone, so let the camera go.
    if (!root.isConnected) {
      stopSource();
      landmarker?.close();
      landmarker = null;
      return;
    }
    if (!running || !landmarker) return;
    if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      const points = landmarker.detectForVideo(video, performance.now())
        .landmarks?.[0];
      handleFrame(points, (performance.now() - started) / 1000);
      // The table and chart are the expensive part; twice a second is plenty.
      if (performance.now() - lastShown > 500) {
        lastShown = performance.now();
        showResults();
      }
    }
    requestAnimationFrame(loop);
  }

  function handleFrame(points: RawLandmark[] | undefined, t: number): void {
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (points && points.length >= 33) {
      const raw = points.map((p) => ({
        x: p.x,
        y: p.y,
        z: p.z,
        visibility: p.visibility,
      }));
      const frame = Frame.from(t, raw, aspect);
      if (frames.length >= MAX_FRAMES) frames.shift();
      frames.push({ t, landmarks: raw });
      const result = session!.push(frame);
      drawSkeleton(ctx, frame, result.accepted, mirrored);
      const sig = signalOf(frame);
      liveRead.innerHTML =
        `${esc(rule.mode === "rep" ? (rule.detection?.signal ?? "") : (rule.targets[0]?.metric ?? ""))}: <b>${fmt(sig)}</b>` +
        (rule.mode === "rep"
          ? ` · reps ${result.repCount} (${result.validRepCount} counted)`
          : ` · held ${fmt(result.holdSeconds)}s`) +
        (result.problems.length
          ? `<br><small>${esc(result.problems.map((p) => p.message_en).join(" · "))}</small>`
          : "");
    } else {
      liveRead.textContent = "No person found";
    }
  }

  // ------------------------------------------------------------ review
  /** Stop the camera and put the session back on screen as a video. */
  async function stopLive(): Promise<void> {
    const rec = recorder;
    if (!camera || !rec || rec.state === "inactive") {
      // A file, or a browser that could not record: keep what is there.
      if (camera) stopSource();
      status.textContent = `Stopped. ${frames.length} frames kept — still tunable.`;
      showResults();
      return;
    }
    const done = new Promise<void>((resolve) => (rec.onstop = () => resolve()));
    rec.stop();
    await done;
    recorder = null;
    running = false;
    camera.stop();
    camera = null;
    video.srcObject = null;
    objectUrl = URL.createObjectURL(
      new Blob(recorded, { type: rec.mimeType || "video/webm" }),
    );
    video.src = objectUrl;
    await new Promise<void>((resolve) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => resolve();
    });
    // Chrome writes recorded webm without a length, which breaks seeking.
    // Asking for a time far past the end makes it work the length out.
    if (!Number.isFinite(video.duration)) {
      await new Promise<void>((resolve) => {
        video.ondurationchange = () => {
          if (Number.isFinite(video.duration)) resolve();
        };
        video.currentTime = 1e9;
        setTimeout(resolve, 2000);
      });
    }
    status.textContent = `Stopped: ${frames.length} frames. Scrub the video to set the thresholds.`;
    showResults();
    enterReview();
  }

  function enterReview(): void {
    reviewing = true;
    restPick = null;
    fullPick = null;
    video.pause();
    video.currentTime = 0;
    syncMarks();
    if (rule.mode !== "rep") {
      status.textContent += " Hold exercises are set in Advanced.";
    }
  }

  /** The recorded frame nearest the paused video, if one is close by. */
  function frameAtPlayhead(): Recorded | null {
    if (!frames.length) return null;
    const want = video.currentTime;
    let best = frames[0]!;
    for (const r of frames) {
      if (Math.abs(r.t - want) < Math.abs(best.t - want)) best = r;
    }
    return Math.abs(best.t - want) < 0.25 ? best : null;
  }

  function signalName(): string {
    return rule.mode === "rep"
      ? (rule.detection?.signal ?? "")
      : (rule.targets[0]?.metric ?? "");
  }

  function showPlayhead(): void {
    if (!reviewing) return;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    const r = frameAtPlayhead();
    if (r) {
      const frame = Frame.from(r.t, r.landmarks, aspect);
      drawSkeleton(ctx, frame, true, mirrored);
      liveRead.innerHTML = `${esc(signalName())}: <b>${fmt(signalOf(frame))}</b> at ${fmt(video.currentTime, 2)}s`;
    } else {
      liveRead.textContent = "No body found here";
    }
    drawTimeline();
  }

  function showPicks(): void {
    if (!reviewing) {
      picksEl.textContent = "Record or import a clip, then pause on a position to mark it.";
    } else if (restPick === null && fullPick === null) {
      picksEl.textContent = "Pause at rest and press Mark rest. Then pause on your shallowest good rep.";
    } else {
      picksEl.textContent = `Rest ${fmt(restPick)} · Full rep ${fmt(fullPick)}`;
    }
  }

  function pick(which: "rest" | "full"): void {
    const r = frameAtPlayhead();
    const value = r ? signalOf(Frame.from(r.t, r.landmarks, aspect)) : null;
    if (value === null) {
      status.textContent =
        "No body on this frame. Move to one where the skeleton shows.";
      return;
    }
    if (which === "rest") restPick = value;
    else fullPick = value;
    showPicks();
    const applied = applyPicks();
    const det = rule.detection;
    commit(
      `${which === "rest" ? "Rest" : "Full rep"} picked at ${fmt(video.currentTime, 2)}s (${fmt(value)})` +
        (applied && det ? ` → starts ${fmt(det.enter)}, ends ${fmt(det.exit)}` : ""),
    );
  }

  /**
   * Turn two positions into thresholds.
   *
   * A rep starts 80% of the way from rest to the chosen rep, and ends once it
   * is back within 25% of rest. The amplitude gate is half that band, so it can
   * never quietly override `enter` -- the glute bridge trap.
   */
  function applyPicks(): boolean {
    const det = rule.detection;
    if (restPick === null || fullPick === null || !det) return false;
    if (fullPick <= restPick) {
      status.textContent =
        `On ${det.signal} a rep should read higher than rest, but the full rep ` +
        `(${fmt(fullPick)}) is not above rest (${fmt(restPick)}). Pick the frames again.`;
      return false;
    }
    const range = fullPick - restPick;
    const round = (v: number) =>
      range < 5 ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10;
    det.enter = round(restPick + 0.8 * range);
    det.exit = round(restPick + 0.25 * range);
    det.min_amplitude = round((det.enter - det.exit) / 2);
    drawKnobs();
    rescore();
    const out = currentOutcome();
    status.textContent =
      `Set: rep starts at ${fmt(det.enter)}, ends at ${fmt(det.exit)}. ` +
      `Now ${out?.completedReps ?? 0} found, ${out?.validReps ?? 0} counted. ` +
      `Does that match what you did?`;
    return true;
  }

  // ------------------------------------------------------------ wiring
  video.addEventListener("seeked", showPlayhead);
  video.addEventListener("timeupdate", showPlayhead);
  const step = (dir: number): void => {
    video.pause();
    video.currentTime = Math.max(0, video.currentTime + dir / 30);
  };
  $("#lab-back1").addEventListener("click", () => step(-1));
  $("#lab-fwd1").addEventListener("click", () => step(1));
  $("#lab-set-rest").addEventListener("click", () => pick("rest"));
  $("#lab-set-full").addEventListener("click", () => pick("full"));
  exSel.addEventListener("change", loadExercise);
  sideSel.addEventListener("change", () => {
    side = sideSel.value as Side;
    rescore();
  });
  $("#lab-live").addEventListener("click", () => void startLive());
  fileIn.addEventListener("change", () => {
    const file = fileIn.files?.[0];
    if (file) void startFile(file);
    fileIn.value = "";
  });
  $("#lab-stop").addEventListener("click", () => void stopLive());
  $("#lab-reset").addEventListener("click", () => {
    rule = structuredClone(exercise.pose_rule!) as ExerciseRule;
    restPick = null;
    fullPick = null;
    showPicks();
    drawKnobs();
    rescore();
    commit("Reset to app values");
  });
  root.querySelectorAll<HTMLElement>(".lab-tab").forEach((t) =>
    t.addEventListener("click", () => showPane(t.dataset.pane!)),
  );

  // Transport, like an editor's: play/pause, a frame either way.
  const syncPlay = (): void => {
    const playing = reviewing && !video.paused;
    playBtn.innerHTML = playing ? ICON.pause : ICON.play;
    playBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
  };
  playBtn.addEventListener("click", () => {
    if (!reviewing) return;
    if (video.paused) void video.play();
    else video.pause();
  });
  video.addEventListener("play", () => {
    syncPlay();
    // timeupdate only fires a few times a second; follow the playhead smoothly.
    const follow = (): void => {
      if (video.paused || !reviewing) return;
      showPlayhead();
      requestAnimationFrame(follow);
    };
    requestAnimationFrame(follow);
  });
  video.addEventListener("pause", syncPlay);

  // Click or drag anywhere on the timeline to scrub; click a rep clip to inspect it.
  let scrubbing = false;
  const timeAt = (e: PointerEvent): number => {
    const box = chart.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
    return f * Math.max(1, timelineSpan());
  };
  chart.addEventListener("pointerdown", (e) => {
    if (!frames.length) return;
    const t = timeAt(e);
    const box = chart.getBoundingClientRect();
    const y = e.clientY - box.top;
    // In the rep track: select the clip under the pointer.
    if (y >= RULER && y <= RULER + 4 + REP_TRACK) {
      const hit = lastOutcome?.reps.findIndex((r) => t >= r.startT && t <= r.endT) ?? -1;
      selectedRep = hit >= 0 ? hit : null;
      renderRepCard();
      if (hit >= 0) showPane("simple");
    }
    if (reviewing) {
      scrubbing = true;
      chart.setPointerCapture(e.pointerId);
      video.pause();
      video.currentTime = t;
    }
    drawTimeline();
  });
  chart.addEventListener("pointermove", (e) => {
    if (scrubbing) video.currentTime = timeAt(e);
  });
  chart.addEventListener("pointerup", () => (scrubbing = false));
  window.addEventListener("resize", () => root.isConnected && drawTimeline());
  undoBtn.addEventListener("click", () => goTo(at - 1));
  redoBtn.addEventListener("click", () => goTo(at + 1));
  const onKey = (e: KeyboardEvent): void => {
    if (!root.isConnected) return document.removeEventListener("keydown", onKey);
    // Leave Ctrl+Z alone inside a number box, where it undoes the typing.
    if ((e.target as HTMLElement | null)?.tagName === "INPUT") return;
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return;
    e.preventDefault();
    goTo(e.shiftKey ? at + 1 : at - 1);
  };
  document.addEventListener("keydown", onKey);
  $("#lab-clear").addEventListener("click", () => {
    frames = [];
    rescore();
    status.textContent = "Recording cleared.";
  });
  $("#lab-copy").addEventListener("click", () => {
    void navigator.clipboard?.writeText(exportText()).then(
      () =>
        (status.textContent =
          "Settings copied. Paste them into app/data/exercises.py."),
      () =>
        (status.textContent = "Copy failed — select the text below instead."),
    );
  });
  $("#lab-download").addEventListener("click", () => {
    if (!frames.length)
      return void (status.textContent = "Nothing recorded yet.");
    // Same shape as scripts/make_video_fixture.py, so a recording made here can
    // become a test fixture or be checked against the Python engine.
    const blob = new Blob(
      [
        JSON.stringify({
          _comment:
            "Pose Lab recording. Joint coordinates only, no image data.",
          exercise_key: exercise.key,
          side,
          aspect,
          frames: frames.map((r) => ({ t: r.t, landmarks: r.landmarks })),
        }),
      ],
      { type: "application/json" },
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${exercise.key}-lab.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  drawKnobs();
  showResults();
  commit(`Loaded ${exercise.name_en}`);
  syncMarks();
  status.textContent = `${exercise.name_en}: Record or Import a clip.`;

  return () => {
    document.removeEventListener("keydown", onKey);
    stopSource();
    landmarker?.close();
    landmarker = null;
  };
}
