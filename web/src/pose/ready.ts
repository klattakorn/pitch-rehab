/**
 * The start gate: nothing is counted until the player says "go" with their body.
 *
 * Pressing "start camera" used to start the count at once -- while the player
 * was still walking back from the phone, which the counter read as reps. Now
 * the player gets into the exercise's starting position and holds still for
 * a few seconds; then a short countdown runs, and only then does counting start.
 *
 * "Starting position" means the camera can see what it needs (the same checks
 * the counter uses: in shot, right view, clear enough) and, for a rep exercise,
 * the movement reads as at rest. "Still" means no tracked joint has drifted
 * more than a small share of the body's size since the hold began. Both are
 * the counter's own idea of a body, so a gate that opens is a counter that can
 * see. Holding still works lying down as well as standing, which a hand
 * gesture would not: the glute bridge is done on the floor.
 */
import { type Frame, bodyScale } from "./geometry";
import { LM } from "./landmarks";

/** How long to hold still before the countdown starts. */
export const HOLD_TO_START_S = 3;
/** Countdown after the hold, so the player can settle before reps count. */
export const COUNTDOWN_S = 3;
/**
 * How far any joint may drift during the hold, as a share of the body's size.
 * Measured on real footage: standing still drifts about 1-2%, a pogo hop
 * moves the ankles 20%+ and a bridge moves the hips 15%+.
 */
export const STILL_TOLERANCE = 0.06;

const JOINTS = [
  LM.LEFT_SHOULDER,
  LM.RIGHT_SHOULDER,
  LM.LEFT_HIP,
  LM.RIGHT_HIP,
  LM.LEFT_KNEE,
  LM.RIGHT_KNEE,
  LM.LEFT_ANKLE,
  LM.RIGHT_ANKLE,
];

export type GateState =
  /** Not in position: out of shot, wrong view, or mid-movement. */
  | { phase: "waiting"; reason: "not_ready" | "moving" | "not_at_rest" }
  /** Holding still; `progress` runs 0 -> 1 over HOLD_TO_START_S. */
  | { phase: "holding"; progress: number }
  /** Hold done. `remaining` counts down from COUNTDOWN_S to 0. */
  | { phase: "countdown"; remaining: number }
  /** Counting may start. Stays here once reached. */
  | { phase: "go" };

export interface GateInput {
  frame: Frame;
  /** The counter's own verdict on this frame: in shot, right view, clear. */
  ready: boolean;
  /**
   * For a rep exercise, whether the movement reads as at rest (signal at or
   * below the rule's exit line). Always true for a hold.
   */
  atRest: boolean;
}

export class StartGate {
  private holdStart: number | null = null;
  private anchor: [number, number][] | null = null;
  private countdownStart: number | null = null;

  constructor(
    private readonly holdS = HOLD_TO_START_S,
    private readonly countdownS = COUNTDOWN_S,
    private readonly tolerance = STILL_TOLERANCE,
  ) {}

  /** Start again from "get into position" -- after a pause, say. */
  reset(): void {
    this.holdStart = null;
    this.anchor = null;
    this.countdownStart = null;
  }

  push({ frame, ready, atRest }: GateInput): GateState {
    const t = frame.t;
    // Once the countdown has begun it runs on the clock alone. Someone settling
    // into a rep position during "3, 2, 1" is doing exactly what it is for.
    if (this.countdownStart !== null) {
      const remaining = this.countdownS - (t - this.countdownStart);
      return remaining <= 0 ? { phase: "go" } : { phase: "countdown", remaining };
    }

    if (!ready) return this.restart({ phase: "waiting", reason: "not_ready" });
    if (!atRest) return this.restart({ phase: "waiting", reason: "not_at_rest" });

    const scale = bodyScale(frame);
    const here = JOINTS.map((j): [number, number] => {
      const [x, y] = frame.point(j);
      return [x, y];
    });
    if (scale === null) return this.restart({ phase: "waiting", reason: "not_ready" });

    if (this.anchor === null || this.holdStart === null) {
      this.anchor = here;
      this.holdStart = t;
      return { phase: "holding", progress: 0 };
    }
    const drift = Math.max(
      ...here.map(([x, y], i) => Math.hypot(x - this.anchor![i]![0], y - this.anchor![i]![1])),
    );
    if (drift > this.tolerance * scale) {
      // Moved: the hold starts over from where they are now.
      this.anchor = here;
      this.holdStart = t;
      return { phase: "waiting", reason: "moving" };
    }

    const held = t - this.holdStart;
    if (held >= this.holdS) {
      this.countdownStart = t;
      return { phase: "countdown", remaining: this.countdownS };
    }
    return { phase: "holding", progress: held / this.holdS };
  }

  private restart(state: GateState): GateState {
    this.holdStart = null;
    this.anchor = null;
    return state;
  }
}
