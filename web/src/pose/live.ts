/**
 * Real-time scoring, frame by frame, as the player moves.
 *
 * The server's version (app/services/pose/analyzer.py) sees a whole set at once
 * and can compare every frame against the median of all of them. Live, there is
 * no "rest of the set" yet — at second one there are thirty frames and no
 * future. So the same guards are rebuilt here against a rolling window of the
 * last few seconds.
 *
 * Two deliberate differences from the server, both unavoidable live:
 *
 *  - smoothing is trailing, not centred (a centred window needs frames that
 *    have not happened yet), so live numbers can differ from the server's by a
 *    fraction of a degree
 *  - the camera-view and body-size checks warm up over the first second
 *
 * The server stays authoritative. What the player sees is coaching; what the
 * server computes is what gates their return to play.
 */
import {
  type CameraView,
  Frame,
  type Metrics,
  aggregate,
  bodyScale,
  classifyView,
  computeMetrics,
  fullyInFrame,
  median,
  openness,
  torsoDirection,
} from "./geometry";
import type { Side } from "./landmarks";
import { LM } from "./landmarks";
import {
  type ExerciseRule,
  type MetricTarget,
  type Violation,
  evaluateTarget,
} from "./rules";

/** ~3 seconds at 30fps. Long enough to be stable, short enough to react. */
const WINDOW_FRAMES = 90;
/** Frames needed before the rolling checks are trusted at all. */
const WARMUP_FRAMES = 15;
const SMOOTHING = 5;

export interface ReadinessProblem {
  code:
    | "no_person"
    | "not_fully_in_frame"
    | "wrong_camera_view"
    | "low_confidence"
    | "tracking_unstable"
    | "warming_up";
  message_en: string;
  message_th: string;
}

/**
 * A movement that was detected and then thrown away.
 *
 * Not a rep and not a failed rep -- something the detector started following
 * and decided was not a repetition at all. It has to be said out loud: from
 * where the player is standing this is indistinguishable from the camera
 * ignoring them, which is exactly how it was reported.
 */
export interface DiscardedRep {
  code: "too_shallow" | "too_quick";
  message_en: string;
  message_th: string;
}

export interface RepResult {
  index: number;
  startT: number;
  endT: number;
  duration: number;
  isValid: boolean;
  formScore: number;
  metrics: Metrics;
  violations: Violation[];
}

export interface FrameResult {
  /** False when the skeleton could not be trusted; nothing was scored. */
  accepted: boolean;
  problems: ReadinessProblem[];
  view: CameraView;
  metrics: Metrics | null;
  inRep: boolean;
  repCount: number;
  validRepCount: number;
  /** Things wrong *right now*, for a live on-screen cue. */
  activeCues: Violation[];
  justCompleted: RepResult | null;
  /** Set on the frame where a movement was followed and then thrown away. */
  discarded: DiscardedRep | null;
  /**
   * Seconds held so far, for a `hold` exercise -- the longest unbroken stretch
   * where every target was satisfied, which is what the server scores it on.
   * Null for a rep exercise, where the rep count is the thing to watch.
   */
  holdSeconds: number | null;
}

export interface SetResult {
  reps: RepResult[];
  completedReps: number;
  validReps: number;
  formScore: number;
  warnings: string[];
  frames: Frame[];
  /** Longest clean hold in seconds, for a `hold` exercise. Null otherwise. */
  holdSeconds: number | null;
}

interface RepBuffer {
  startT: number;
  series: Map<string, number[]>;
  times: number[];
}

export class LiveSession {
  private readonly rule: ExerciseRule;
  private readonly sides: Exclude<Side, "bilateral">[];
  private readonly requiredLandmarks: number[];

  private readonly scales: number[] = [];
  private readonly torsos: [number, number][] = [];
  private readonly opennessScores: number[] = [];
  private readonly recent = new Map<string, number[]>();

  private rep: RepBuffer | null = null;
  private lastBelowExitT = 0;
  private peak = -Infinity;
  private lastDiscard: DiscardedRep | null = null;
  private discardCounts: Record<string, number> = {};
  private holdRunStart: number | null = null;
  private bestHold = 0;
  private readonly reps: RepResult[] = [];
  private readonly captured: Frame[] = [];
  private droppedFrames = 0;
  private totalFrames = 0;

  constructor(rule: ExerciseRule, side: Side) {
    this.rule = rule;
    this.sides = side === "bilateral" ? ["left", "right"] : [side];
    this.requiredLandmarks = rule.required_landmarks
      .map((name) => (LM as Record<string, number>)[name])
      .filter((v): v is number => typeof v === "number");
  }

  get repCount(): number {
    return this.reps.length;
  }

  get validRepCount(): number {
    return this.reps.filter((r) => r.isValid).length;
  }

  /** Feed one frame. Returns what to show on screen. */
  push(frame: Frame): FrameResult {
    this.totalFrames++;
    this.captured.push(frame);

    const problems: ReadinessProblem[] = [];
    const quality = frame.quality(this.requiredLandmarks);

    // --- rolling context ------------------------------------------------
    const scale = bodyScale(frame);
    const torso = torsoDirection(frame);
    const open = openness(frame);
    if (scale !== null) push_(this.scales, scale);
    if (torso !== null) push_(this.torsos, torso);
    if (open !== null) push_(this.opennessScores, open);

    const view = classifyView(
      this.opennessScores.length >= WARMUP_FRAMES ? median(this.opennessScores) : null,
    );

    // --- can this frame be trusted? --------------------------------------
    let trusted = true;
    if (quality < this.rule.min_tracking_quality) {
      problems.push({
        code: "low_confidence",
        message_en: "Cannot see you clearly — more light, or move closer.",
        message_th: "มองไม่ชัด เพิ่มแสงหรือขยับเข้ามาใกล้ขึ้น",
      });
      trusted = false;
    }
    if (!fullyInFrame(frame)) {
      problems.push({
        code: "not_fully_in_frame",
        message_en: "Step back — your whole body needs to be in shot.",
        message_th: "ถอยหลัง ให้เห็นทั้งตัวในกล้อง",
      });
      trusted = false;
    }
    if (this.isCollapsed(scale, torso)) {
      // MediaPipe reports these at full confidence, so nothing but this catches
      // it. It has to announce itself: this drops the frame, and a dropped
      // frame is never scored, so staying quiet leaves the screen saying "Good
      // form" while nothing at all is being counted.
      problems.push({
        code: "tracking_unstable",
        message_en: "Lost track of you — hold the phone still and stay in shot.",
        message_th: "\u0e15\u0e34\u0e14\u0e15\u0e32\u0e21\u0e15\u0e31\u0e27\u0e44\u0e21\u0e48\u0e44\u0e14\u0e49 \u0e16\u0e37\u0e2d\u0e21\u0e37\u0e2d\u0e16\u0e37\u0e2d\u0e43\u0e2b\u0e49\u0e19\u0e34\u0e48\u0e07\u0e41\u0e25\u0e30\u0e2d\u0e22\u0e39\u0e48\u0e43\u0e19\u0e01\u0e23\u0e2d\u0e1a",
      });
      trusted = false;
    }
    if (
      this.rule.enforce_view &&
      this.rule.view !== "any" &&
      view !== "unknown" &&
      view !== this.rule.view
    ) {
      problems.push({
        code: "wrong_camera_view",
        message_en:
          this.rule.view === "front"
            ? "Turn the camera to face you."
            : "Move the camera to your side.",
        message_th:
          this.rule.view === "front" ? "หันกล้องมาด้านหน้า" : "ย้ายกล้องไปด้านข้าง",
      });
      trusted = false;
    }
    if (this.opennessScores.length < WARMUP_FRAMES) {
      problems.push({
        code: "warming_up",
        message_en: "Hold still for a moment...",
        message_th: "ยืนนิ่งสักครู่...",
      });
    }

    if (!trusted) {
      this.droppedFrames++;
      // A break in tracking must not be read as the end of a rep.
      return {
        accepted: false,
        problems,
        view,
        metrics: null,
        inRep: this.rep !== null,
        repCount: this.repCount,
        validRepCount: this.validRepCount,
        activeCues: [],
        justCompleted: null,
        discarded: null,
        holdSeconds: this.rule.mode === "hold" ? this.bestHold : null,
      };
    }

    // --- measure ----------------------------------------------------------
    const perSide = this.sides.map((s) => computeMetrics(frame, s, this.rule.use_z));
    const smoothed = this.smooth(perSide);
    const display = perSide[0] ?? {};

    this.lastDiscard = null;
    const justCompleted = this.advanceReps(frame.t, smoothed);
    if (this.rule.mode === "hold") this.advanceHold(frame.t, smoothed);
    const activeCues =
      this.rule.mode === "hold" ? this.liveCues(smoothed) : this.rep ? this.liveCues(smoothed) : [];

    return {
      accepted: true,
      problems,
      view,
      metrics: display,
      inRep: this.rep !== null,
      repCount: this.repCount,
      validRepCount: this.validRepCount,
      activeCues,
      justCompleted,
      discarded: this.lastDiscard,
      holdSeconds: this.rule.mode === "hold" ? this.bestHold : null,
    };
  }

  /**
   * Time in position, counted the way the server counts it.
   *
   * Every target has to be satisfied, not just the ones with an upper bound --
   * a wall sit sat too high fails on `min`, and crediting that as time held
   * would be the screen disagreeing with the score the set finally gets.
   */
  private advanceHold(t: number, perSide: Metrics[]): void {
    let clean = true;
    for (const target of this.rule.targets) {
      const observed = this.judged(perSide, target);
      if (observed === null) continue;
      if (evaluateTarget(target, observed)) {
        clean = false;
        break;
      }
    }
    if (!clean) {
      this.holdRunStart = null;
      return;
    }
    if (this.holdRunStart === null) this.holdRunStart = t;
    this.bestHold = Math.max(this.bestHold, t - this.holdRunStart);
  }

  /** Close the set and hand back everything for upload. */
  finish(): SetResult {
    if (this.rep) this.closeRep(this.rep.times[this.rep.times.length - 1] ?? this.rep.startT);
    const valid = this.reps.filter((r) => r.isValid);
    const warnings: string[] = [];
    if (this.droppedFrames > 0) warnings.push(`dropped_${this.droppedFrames}_untrusted_frames`);
    if (this.droppedFrames / Math.max(1, this.totalFrames) > 0.15) {
      warnings.push("frequent_tracking_loss");
    }
    if (this.reps.length === 0) warnings.push("no_reps_detected");
    // "Nothing counted" and "nothing counted, and here is why" are different
    // reports. The second one is the one worth uploading.
    for (const [code, n] of Object.entries(this.discardCounts)) {
      warnings.push(`discarded_${code}_x${n}`);
    }
    return {
      holdSeconds: this.rule.mode === "hold" ? this.bestHold : null,
      reps: this.reps,
      completedReps: this.reps.length,
      validReps: valid.length,
      formScore: valid.length
        ? Math.round((valid.reduce((a, r) => a + r.formScore, 0) / valid.length) * 10) / 10
        : 0,
      warnings,
      frames: this.captured,
    };
  }

  // ------------------------------------------------------------- internals
  /** Has the skeleton collapsed or flipped, relative to the last few seconds? */
  private isCollapsed(scale: number | null, torso: [number, number] | null): boolean {
    if (this.scales.length < WARMUP_FRAMES) return false;
    if (scale === null) return true;
    const reference = median(this.scales);
    if (reference > 1e-9 && (scale < 0.6 * reference || scale > reference / 0.6)) return true;

    if (torso === null || this.torsos.length < WARMUP_FRAMES) return false;
    let sx = 0;
    let sy = 0;
    for (const [x, y] of this.torsos) {
      sx += x;
      sy += y;
    }
    const len = Math.hypot(sx, sy);
    if (len < 1e-9) return false;
    const dot = (torso[0] * sx + torso[1] * sy) / len;
    return Math.acos(Math.max(-1, Math.min(1, dot))) > (75 * Math.PI) / 180;
  }

  /** Trailing median — kills single-frame flyers without waiting on the future. */
  private smooth(perSide: Metrics[]): Metrics[] {
    return perSide.map((metrics, i) => {
      const out: Metrics = {};
      for (const [key, value] of Object.entries(metrics)) {
        const bucket = `${i}:${key}`;
        const history = this.recent.get(bucket) ?? [];
        history.push(value);
        if (history.length > SMOOTHING) history.shift();
        this.recent.set(bucket, history);
        out[key] = median(history);
      }
      return out;
    });
  }

  /** Worst reading across the limbs being judged. */
  /**
   * Pick the limb a target is about. Mirrors `_judged` on the server: an upper
   * bound is failed by the largest reading and a lower bound by the smallest,
   * so judging the worse limb means taking whichever of those the bound needs.
   * `judge: "best"` inverts it for the movements whose legs differ by design.
   */
  private judged(perSide: Metrics[], target: MetricTarget): number | null {
    const values = perSide
      .map((m) => m[target.metric])
      .filter((v): v is number => typeof v === "number");
    if (values.length === 0) return null;
    const high = target.judge === "best" ? target.max === null : target.max !== null;
    return high ? Math.max(...values) : Math.min(...values);
  }

  private liveCues(perSide: Metrics[]): Violation[] {
    const cues: Violation[] = [];
    for (const target of this.rule.targets) {
      // Only bounds that can be broken *during* the movement are worth shouting
      // about live. A "not deep enough" only becomes true once the rep is over.
      if (target.max === null) continue;
      const observed = this.judged(perSide, target);
      if (observed === null) continue;
      const violation = evaluateTarget(target, observed);
      if (violation) cues.push(violation);
    }
    return cues;
  }

  private advanceReps(t: number, perSide: Metrics[]): RepResult | null {
    if (this.rule.mode !== "rep" || !this.rule.detection) {
      this.record(t, perSide);
      return null;
    }
    const det = this.rule.detection;
    const signalValues = perSide
      .map((m) => m[det.signal])
      .filter((v): v is number => typeof v === "number");
    if (signalValues.length === 0) return null;
    const signal = signalValues.reduce((a, b) => a + b, 0) / signalValues.length;

    if (!this.rep) {
      if (signal <= det.exit) this.lastBelowExitT = t;
      else if (signal >= det.enter) {
        this.rep = { startT: this.lastBelowExitT, series: new Map(), times: [] };
        this.peak = signal;
      }
      if (this.rep) this.record(t, perSide);
      return null;
    }

    this.peak = Math.max(this.peak, signal);
    this.record(t, perSide);
    const tooLong = t - this.rep.startT > det.max_duration_s;
    if (signal <= det.exit || tooLong) {
      const closed = this.closeRep(t);
      this.lastBelowExitT = t;
      this.peak = -Infinity;
      return closed;
    }
    return null;
  }

  private discard(code: DiscardedRep["code"], en: string, th: string): void {
    this.lastDiscard = { code, message_en: en, message_th: th };
    this.discardCounts[code] = (this.discardCounts[code] ?? 0) + 1;
  }

  private record(t: number, perSide: Metrics[]): void {
    if (!this.rep) return;
    this.rep.times.push(t);
    for (const metrics of perSide) {
      for (const [key, value] of Object.entries(metrics)) {
        const bucket = this.rep.series.get(key) ?? [];
        bucket.push(value);
        this.rep.series.set(key, bucket);
      }
    }
  }

  private closeRep(endT: number): RepResult | null {
    const rep = this.rep;
    this.rep = null;
    if (!rep) return null;

    const det = this.rule.detection;
    const duration = endT - rep.startT;
    if (det) {
      // Below either of these it was not a repetition -- a shift of weight, or
      // the tracker flickering. Dropping it is right; dropping it in silence is
      // not, because the player sees a movement they made produce nothing.
      const amplitude = this.peak - det.exit;
      if (amplitude < det.min_amplitude) {
        this.discard("too_shallow", "Not deep enough to count — go further.", "\u0e22\u0e31\u0e07\u0e25\u0e07\u0e44\u0e21\u0e48\u0e25\u0e36\u0e01\u0e1e\u0e2d \u0e04\u0e23\u0e31\u0e49\u0e07\u0e19\u0e35\u0e49\u0e08\u0e36\u0e07\u0e44\u0e21\u0e48\u0e16\u0e39\u0e01\u0e19\u0e31\u0e1a");
        return null;
      }
      if (duration < det.min_duration_s) {
        this.discard("too_quick", "Too quick to count — slow it down.", "\u0e40\u0e23\u0e47\u0e27\u0e40\u0e01\u0e34\u0e19\u0e44\u0e1b \u0e04\u0e23\u0e31\u0e49\u0e07\u0e19\u0e35\u0e49\u0e08\u0e36\u0e07\u0e44\u0e21\u0e48\u0e16\u0e39\u0e01\u0e19\u0e31\u0e1a");
        return null;
      }
    }

    const metrics: Metrics = {};
    const violations: Violation[] = [];
    let weightedOk = 0;
    let totalWeight = 0;

    for (const target of this.rule.targets) {
      const observed = aggregate(rep.series.get(target.metric) ?? [], target.aggregate);
      if (observed === null) continue;
      metrics[`${target.metric}_${target.aggregate}`] = Math.round(observed * 1000) / 1000;
      totalWeight += target.weight;
      const violation = evaluateTarget(target, observed);
      if (violation) {
        violations.push(violation);
        weightedOk += target.weight * (1 - violation.severity);
      } else {
        weightedOk += target.weight;
      }
    }

    let tempoOk = true;
    if (this.rule.tempo_min_s !== null && duration < this.rule.tempo_min_s) {
      tempoOk = false;
      /* Both numbers, because "slow down" on its own is not an instruction --
         it does not say how slow, and the rep that was just refused is the only
         thing the player has to calibrate against. */
      const asked = this.rule.tempo_min_s;
      const took = duration.toFixed(1);
      violations.push({
        code: "tempo_too_fast",
        metric: "duration",
        observed: Math.round(duration * 1000) / 1000,
        limit: asked,
        bound: "min",
        severity: Math.min(1, (asked - duration) / asked),
        critical: false,
        message_en: `Slower — take ${asked}s a rep. That one took ${took}s.`,
        message_th: `ช้าลง ใช้เวลา ${asked} วินาทีต่อครั้ง ครั้งนี้ใช้ ${took} วินาที`,
      });
    }
    if (this.rule.tempo_max_s !== null && duration > this.rule.tempo_max_s) tempoOk = false;

    const result: RepResult = {
      index: this.reps.length,
      startT: Math.round(rep.startT * 1000) / 1000,
      endT: Math.round(endT * 1000) / 1000,
      duration: Math.round(duration * 1000) / 1000,
      isValid: !violations.some((v) => v.critical) && tempoOk,
      formScore: totalWeight ? Math.round((100 * weightedOk) / totalWeight * 10) / 10 : 100,
      metrics,
      violations,
    };
    this.reps.push(result);
    return result;
  }
}

function push_<T>(buffer: T[], value: T): void {
  buffer.push(value);
  if (buffer.length > WINDOW_FRAMES) buffer.shift();
}
