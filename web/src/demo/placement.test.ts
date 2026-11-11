import { describe, expect, it } from "vitest";

import { FALLBACK_EXERCISES } from "../fallback";
import type { ExerciseRule } from "../pose/rules";
import { placementFor } from "./placement";

const byKey = (key: string) => FALLBACK_EXERCISES.find((e) => e.key === key)!;
const ruleOf = (key: string) => byKey(key).pose_rule as unknown as ExerciseRule;

describe("where to put the phone", () => {
  it("gives every camera-checked exercise advice that matches its camera view", () => {
    for (const e of FALLBACK_EXERCISES) {
      if (!e.pose_rule) continue;
      const p = placementFor({ key: e.key, pose_rule: e.pose_rule as unknown as ExerciseRule });
      expect(p.short.length).toBeGreaterThan(10);
      const view = (e.pose_rule as unknown as ExerciseRule).view;
      if (view === "side") expect(p.short).toMatch(/side on/);
      if (view === "front") expect(p.short).toMatch(/facing you/);
    }
  });

  it("asks for the shoulders on the glute bridge, which is measured from them", () => {
    expect(placementFor({ key: "glute_bridge", pose_rule: ruleOf("glute_bridge") }).detail).toMatch(
      /shoulders/,
    );
  });

  it("does not ask for the head on pogo hops", () => {
    const p = placementFor({ key: "pogo_hops", pose_rule: ruleOf("pogo_hops") });
    expect(p.detail).toMatch(/fine if your\s+head goes out/);
  });

  it("asks for the floor where the tuning was done on the floor, hip height elsewhere", () => {
    for (const key of ["pogo_hops", "glute_bridge", "double_leg_calf_raise"])
      expect(placementFor({ key, pose_rule: ruleOf(key) }).short).toMatch(/on the floor/);
    expect(placementFor({ key: "wall_sit", pose_rule: ruleOf("wall_sit") }).short).toMatch(
      /hip height/,
    );
  });
});
