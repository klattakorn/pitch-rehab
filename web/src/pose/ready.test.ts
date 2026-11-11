/**
 * The start gate on real footage: it must not open while the player is
 * moving, and must open once they hold still in the start position.
 */
import { describe, expect, it } from "vitest";

import { FALLBACK_EXERCISES } from "../fallback";
import bridge from "./__fixtures__/glute-bridge-real.json";
import pogo from "./__fixtures__/pogo-front.json";
import { Frame } from "./geometry";
import { LiveSession } from "./live";
import { type GateState, StartGate } from "./ready";
import type { ExerciseRule } from "./rules";

type Fixture = { aspect: number; frames: { t: number; landmarks: any[] }[] };

const ruleOf = (key: string) =>
  FALLBACK_EXERCISES.find((e) => e.key === key)!.pose_rule as unknown as ExerciseRule;

/** Exactly how the camera screen drives the gate. */
export function replayGate(rule: ExerciseRule, fx: Fixture) {
  const probe = new LiveSession(rule, "bilateral");
  const gate = new StartGate();
  const states: { t: number; state: GateState }[] = [];
  for (const f of fx.frames) {
    const frame = Frame.from(f.t, f.landmarks, fx.aspect);
    const r = probe.push(frame);
    const ready = r.accepted && !r.problems.some((p) => p.code !== "warming_up");
    const det = rule.mode === "rep" ? rule.detection : null;
    const atRest = !det || (r.signal !== null && r.signal <= det.exit);
    states.push({ t: f.t, state: gate.push({ frame, ready, atRest }) });
  }
  const opened = states.find((s) => s.state.phase === "countdown")?.t ?? null;
  const reps = probe.finish().reps;
  return { states, opened, reps };
}

describe("the start gate", () => {
  it("never opens mid-set on pogo hops, and opens once the player stands still", () => {
    const { opened, reps } = replayGate(ruleOf("pogo_hops"), pogo as Fixture);
    expect(opened).not.toBeNull();
    // Not during the hops...
    const last = reps[reps.length - 1]!;
    expect(opened!).toBeGreaterThan(last.endT);
    // ...but within a few seconds of standing still after them.
    expect(opened! - last.endT).toBeLessThan(5);
  });

  it("never opens inside a glute bridge, even with only short rests between reps", () => {
    // This clip never rests for 3 s (1.7 s before the first rep, about 2 s
    // between), so the gate has to stay shut throughout.
    const { opened } = replayGate(ruleOf("glute_bridge"), bridge as Fixture);
    expect(opened).toBeNull();
  });

  it("opens on a player lying still before a glute bridge, before the first rep", () => {
    // The same clip, with the player lying still for 4 s before it starts.
    const fx = bridge as Fixture;
    const first = fx.frames[0]!;
    const lead = Array.from({ length: 120 }, (_, i) => ({ t: i / 30, landmarks: first.landmarks }));
    const shifted = fx.frames.map((f) => ({ ...f, t: f.t + 4 }));
    const { opened, reps } = replayGate(ruleOf("glute_bridge"), {
      aspect: fx.aspect,
      frames: [...lead, ...shifted],
    });
    expect(opened).not.toBeNull();
    expect(opened!).toBeLessThan(reps[0]!.startT);
  });

  it("starts the hold over when the player moves", () => {
    const gate = new StartGate(3, 3, 0.06);
    const fx = pogo as Fixture;
    const still = fx.frames.at(-1)!;
    const at = (t: number, dy = 0) =>
      Frame.from(
        t,
        still.landmarks.map((p: any) => ({ ...p, y: p.y + dy })),
        fx.aspect,
      );
    gate.push({ frame: at(0), ready: true, atRest: true });
    expect(gate.push({ frame: at(2), ready: true, atRest: true }).phase).toBe("holding");
    expect(gate.push({ frame: at(2.1, 0.1), ready: true, atRest: true })).toEqual({
      phase: "waiting",
      reason: "moving",
    });
    // The clock restarted at 2.1: not done at 4, done at 5.2.
    expect(gate.push({ frame: at(4, 0.1), ready: true, atRest: true }).phase).toBe("holding");
    expect(gate.push({ frame: at(5.2, 0.1), ready: true, atRest: true }).phase).toBe("countdown");
    expect(gate.push({ frame: at(8.3, 0.1), ready: false, atRest: false }).phase).toBe("go");
  });

  it("waits while the player cannot be seen properly", () => {
    const gate = new StartGate();
    const f = (pogo as Fixture).frames.at(-1)!;
    const frame = Frame.from(0, f.landmarks, (pogo as Fixture).aspect);
    expect(gate.push({ frame, ready: false, atRest: true })).toEqual({
      phase: "waiting",
      reason: "not_ready",
    });
    expect(gate.push({ frame, ready: true, atRest: false })).toEqual({
      phase: "waiting",
      reason: "not_at_rest",
    });
  });
});
