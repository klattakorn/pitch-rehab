/**
 * The hip-height adjustments (camera-spot.ts) are worked out from geometry,
 * with no footage from that height to tune on. What can be pinned is that
 * they do no harm: the rules stay well-formed, nothing else changes, and every
 * floor recording still counts exactly as it does with the floor rule.
 */
import { describe, expect, it } from "vitest";

import { FALLBACK_EXERCISES } from "../fallback";
import calf from "./__fixtures__/calf-raise-real.json";
import bridge from "./__fixtures__/glute-bridge-real.json";
import bridge2 from "./__fixtures__/glute-bridge-second.json";
import pogoCorrect from "./__fixtures__/pogo-correct.json";
import pogoFront from "./__fixtures__/pogo-front.json";
import { adjustRule, tunedSpot } from "./camera-spot";
import { Frame } from "./geometry";
import { LiveSession } from "./live";
import type { ExerciseRule } from "./rules";

type Fixture = { aspect: number; frames: { t: number; landmarks: Parameters<typeof Frame.from>[1] }[] };

const ruleOf = (key: string) =>
  FALLBACK_EXERCISES.find((e) => e.key === key)!.pose_rule as unknown as ExerciseRule;

function count(rule: ExerciseRule, fx: Fixture) {
  const session = new LiveSession(rule, "bilateral");
  for (const f of fx.frames) session.push(Frame.from(f.t, f.landmarks, fx.aspect));
  return session.finish();
}

const FLOOR_TUNED = ["glute_bridge", "double_leg_calf_raise", "pogo_hops"];

describe("camera at hip height", () => {
  it("knows which exercises were tuned on the floor", () => {
    for (const key of FLOOR_TUNED) expect(tunedSpot(key)).toBe("floor");
    expect(tunedSpot("wall_sit")).toBe("hip");
  });

  it("changes nothing on the floor, or for exercises tuned at hip height", () => {
    for (const e of FALLBACK_EXERCISES) {
      if (!e.pose_rule) continue;
      const rule = e.pose_rule as unknown as ExerciseRule;
      expect(adjustRule(rule, e.key, "floor")).toBe(rule);
      if (!FLOOR_TUNED.includes(e.key)) expect(adjustRule(rule, e.key, "hip")).toBe(rule);
    }
  });

  it("never edits the rule it was given", () => {
    for (const key of FLOOR_TUNED) {
      const rule = ruleOf(key);
      const before = JSON.stringify(rule);
      adjustRule(rule, key, "hip");
      expect(JSON.stringify(rule)).toBe(before);
    }
  });

  it("leaves the count lines alone", () => {
    // Honest reps clear them by far more than a camera tilt takes away, and a
    // lower calf-raise line counted a wobble on the floor clip as a rep.
    for (const key of FLOOR_TUNED) {
      expect(adjustRule(ruleOf(key), key, "hip").detection).toEqual(ruleOf(key).detection);
    }
  });

  it("eases the one form line honest calf raises sit close to", () => {
    const line = (r: ExerciseRule) => r.targets.find((t) => t.metric === "heel_raise_ratio")!.min!;
    const floor = line(ruleOf("double_leg_calf_raise"));
    const hip = line(adjustRule(ruleOf("double_leg_calf_raise"), "double_leg_calf_raise", "hip"));
    expect(hip).toBeLessThan(floor);
    expect(hip).toBeGreaterThanOrEqual(floor * 0.9);
  });

  it("reads a lying body as side-on from above", () => {
    expect(adjustRule(ruleOf("glute_bridge"), "glute_bridge", "hip").side_view_below).toBeGreaterThan(
      0.35,
    );
  });

  it.each([
    ["glute bridge, first clip", "glute_bridge", bridge],
    ["glute bridge, second clip", "glute_bridge", bridge2],
    ["pogo, front", "pogo_hops", pogoFront],
    ["pogo, springy", "pogo_hops", pogoCorrect],
    ["calf raise", "double_leg_calf_raise", calf],
  ])("counts floor footage the same either way: %s", (_name, key, fx) => {
    const floor = count(ruleOf(key), fx as unknown as Fixture);
    const hip = count(adjustRule(ruleOf(key), key, "hip"), fx as unknown as Fixture);
    expect(floor.completedReps).toBeGreaterThan(0);
    expect(hip.completedReps).toBe(floor.completedReps);
    expect(hip.validReps).toBe(floor.validReps);
  });
});
