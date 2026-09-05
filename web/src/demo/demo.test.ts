/**
 * Every exercise has to be able to demonstrate itself, and the demonstration has
 * to look like a person.
 *
 * These checks exist because of two faults that reached the screen: floor
 * exercises drew a tangle of lines (the camera angle collapsed the left and
 * right limbs onto the same pixels), and several exercises showed an identical
 * figure for "correct" and "mistake".
 */
import { describe, expect, it } from "vitest";

import { FALLBACK_EXERCISES } from "../fallback";
import { bones, joints, project } from "./figure";
import { buildDemoSpec, targetLines } from "./spec";
import { cameraDiagram, demoPanelHtml } from "./panel";
import type { Exercise } from "../pose/rules";

const withRules = FALLBACK_EXERCISES.filter((e) => e.pose_rule !== null);
const cases = withRules.map((e) => [e.key, e] as const);

function projector(exercise: Exercise) {
  const spec = buildDemoSpec(exercise.key, exercise.pose_rule!);
  return (p: [number, number, number]) =>
    project(p, spec.camera.yaw, spec.camera.pitch, 100, 0, 0);
}

describe("the figure is a person, not a tangle of lines", () => {
  it("has exercises to test", () => {
    expect(cases.length).toBeGreaterThan(15);
  });

  it.each(cases)("%s stays finite through the whole movement", (_key, exercise) => {
    const spec = buildDemoSpec(exercise.key, exercise.pose_rule!);
    for (const wrong of [false, true]) {
      for (let i = 0; i <= 10; i++) {
        const pose = spec.figure(i / 10, wrong);
        for (const point of [pose.head, ...joints(pose)]) {
          expect(point.every(Number.isFinite)).toBe(true);
        }
      }
    }
  });

  it.each(cases)("%s keeps left and right limbs apart on screen", (_key, exercise) => {
    // The bug that produced a Spiderman: a camera angle whose cosine is zero
    // multiplies the across-body axis away, so both legs draw over each other.
    const spec = buildDemoSpec(exercise.key, exercise.pose_rule!);
    const pose = spec.figure(0.5);
    const to = projector(exercise);
    const [rk, lk] = pose.knees.map(to);
    const [rs, ls] = pose.shoulders.map(to);
    expect(Math.hypot(rk![0] - lk![0], rk![1] - lk![1])).toBeGreaterThan(2);
    expect(Math.hypot(rs![0] - ls![0], rs![1] - ls![1])).toBeGreaterThan(2);
  });

  it.each(cases)("%s draws bones with real length, not dots", (_key, exercise) => {
    const spec = buildDemoSpec(exercise.key, exercise.pose_rule!);
    const pose = spec.figure(0.5);
    const to = projector(exercise);
    const lengths = bones(pose).map(([a, b]) => {
      const [x1, y1] = to(a);
      const [x2, y2] = to(b);
      return Math.hypot(x2 - x1, y2 - y1);
    });
    // A collapsed figure has nearly every bone at zero length.
    const degenerate = lengths.filter((l) => l < 1.5).length;
    expect(degenerate).toBeLessThan(4);
  });

  it.each(cases)("%s is roughly upright-or-flat, not a diagonal smear", (_key, exercise) => {
    const spec = buildDemoSpec(exercise.key, exercise.pose_rule!);
    const pose = spec.figure(0.5);
    const to = projector(exercise);
    const points = [pose.head, ...joints(pose)].map(to);
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    // Neither dimension may vanish, or the body has folded onto a line. A person
    // lying flat is legitimately long and thin, so the limit is generous — it is
    // there to catch a collapse, not to police proportions.
    expect(Math.min(w, h)).toBeGreaterThan(8);
    expect(Math.max(w, h) / Math.min(w, h)).toBeLessThan(9);
  });

  it.each(cases)("%s actually moves", (_key, exercise) => {
    const spec = buildDemoSpec(exercise.key, exercise.pose_rule!);
    const start = spec.figure(0);
    const middle = spec.figure(0.5);
    const before = [start.midShoulder, start.midHip, ...start.knees, ...start.heels];
    const after = [middle.midShoulder, middle.midHip, ...middle.knees, ...middle.heels];
    const travelled = Math.max(
      ...before.map((p, i) => Math.hypot(...p.map((v, a) => v - after[i]![a]!))),
    );
    expect(travelled).toBeGreaterThan(0.04);
  });

  it.each(cases)("%s shows a mistake that differs from the correct form", (_key, exercise) => {
    // Several exercises used to show an identical figure for both.
    const spec = buildDemoSpec(exercise.key, exercise.pose_rule!);
    const right = spec.figure(0.5, false);
    const wrong = spec.figure(0.5, true);
    const to = projector(exercise);
    const a = [right.head, ...joints(right)].map(to);
    const b = [wrong.head, ...joints(wrong)].map(to);
    const biggest = Math.max(...a.map((p, i) => Math.hypot(p[0] - b[i]![0]!, p[1] - b[i]![1]!)));
    expect(biggest, "correct and mistake look the same").toBeGreaterThan(4);
  });
});

describe("floor exercises look like the exercise", () => {
  const spec = (key: string) => {
    const exercise = withRules.find((e) => e.key === key)!;
    return buildDemoSpec(key, exercise.pose_rule!);
  };

  it("lays a lying body out horizontally, head at one end and feet at the other", () => {
    for (const key of ["glute_bridge", "prone_hamstring_curl", "isometric_quad_set"]) {
      const pose = spec(key).figure(0.5);
      const to = projector(withRules.find((e) => e.key === key)!);
      const [headX] = to(pose.head);
      const [hipX] = to(pose.midHip);
      const [ankleX] = to(pose.ankles[0]);
      expect(headX, `${key}: head should be beyond the hips`).toBeLessThan(hipX);
      expect(hipX, `${key}: hips should sit between head and feet`).toBeLessThan(ankleX);
    }
  });

  it("lifts the hips in a glute bridge, and only half way in the mistake", () => {
    const s = spec("glute_bridge");
    const down = s.figure(0).midHip[1];
    const up = s.figure(0.5).midHip[1];
    const half = s.figure(0.5, true).midHip[1];
    expect(up, "hips should rise").toBeGreaterThan(down);
    expect(half).toBeGreaterThan(down);
    expect(half, "the mistake should not reach full height").toBeLessThan(up);
  });

  it("brings the heel toward the hips in a heel slide", () => {
    const s = spec("heel_slide");
    const startGap = Math.abs(s.figure(0).ankles[0][0] - s.figure(0).midHip[0]);
    const endGap = Math.abs(s.figure(0.5).ankles[0][0] - s.figure(0.5).midHip[0]);
    expect(endGap).toBeLessThan(startGap);
  });

  it("raises the ankle in a prone curl while the hips stay down", () => {
    const s = spec("prone_hamstring_curl");
    expect(s.figure(0.5).ankles[0][1]).toBeGreaterThan(s.figure(0).ankles[0][1]);
    // The classic fault is the hips lifting to help.
    expect(s.figure(0.5, true).midHip[1]).toBeGreaterThan(s.figure(0.5).midHip[1]);
  });

  it("lifts the top leg in a side-lying abduction", () => {
    const s = spec("side_lying_hip_abduction");
    const [near, far] = s.figure(0.5).knees;
    expect(Math.abs(far[1] - near[1]), "the legs should separate").toBeGreaterThan(0.15);
  });

  it("straightens the body in a side plank and sags it in the mistake", () => {
    const s = spec("side_plank");
    expect(s.figure(0.5).midHip[1]).toBeGreaterThan(s.figure(0).midHip[1]);
    expect(s.figure(0.5, true).midHip[1]).toBeLessThan(s.figure(0.5).midHip[1]);
  });
});

describe("the demonstration matches the marking", () => {
  it("squats to the depth the rule requires", () => {
    const squat = withRules.find((e) => e.key === "single_leg_squat")!;
    const depth = squat.pose_rule!.targets.find((t) => t.metric === "knee_flexion")!;
    const spec = buildDemoSpec(squat.key, squat.pose_rule!);
    expect(spec.amount).toBeGreaterThanOrEqual(depth.min!);
  });

  it("prints the same thresholds the player will be judged on", () => {
    const squat = withRules.find((e) => e.key === "single_leg_squat")!;
    const lines = targetLines(squat.pose_rule!);
    for (const target of squat.pose_rule!.targets) {
      const bound = target.min ?? target.max;
      expect(lines.some((line) => line.includes(String(bound)))).toBe(true);
    }
  });

  it("draws a camera-placement hint for front and side exercises", () => {
    expect(cameraDiagram("front")).toContain("svg");
    expect(cameraDiagram("side")).toContain("svg");
    expect(cameraDiagram("any")).toBe("");
  });
});

describe("a filmed demonstration, where the team recorded one", () => {
  /* The drawn figure is a fallback, not the goal: watching a person do the
     movement is a better instruction than watching a stick figure do it. But a
     clip only ever shows the correct version -- nobody films a deliberately bad
     rep on an injured knee -- so the figure has to survive underneath for the
     "common mistake" half. */
  const filmed = FALLBACK_EXERCISES.filter((e) => e.demo_url !== null);

  it("has at least one exercise with a clip", () => {
    expect(filmed.length).toBeGreaterThan(0);
  });

  it("points every clip at a file the site actually serves", () => {
    for (const exercise of filmed) {
      // Same-origin and under /demos, so it is something in web/public and not
      // a link to a video host that will not load on a locked-down network.
      expect(exercise.demo_url).toBe(`/demos/${exercise.key}.mp4`);
    }
  });

  it("plays the clip and keeps the drawing for the mistake", () => {
    const exercise = filmed[0]!;
    const html = demoPanelHtml(exercise);
    expect(html).toContain(`src="${exercise.demo_url}"`);
    // Muted and inline, or a phone refuses to autoplay it at all.
    expect(html).toMatch(/<video[^>]*\bmuted\b/);
    expect(html).toMatch(/<video[^>]*\bplaysinline\b/);
    expect(html).toMatch(/<video[^>]*\bloop\b/);
    // The canvas is still there, just not the thing on show.
    expect(html).toMatch(/<canvas[^>]*\bhidden\b/);
    expect(html).toContain("Common mistake");
  });

  it("draws the figure as before when there is no clip", () => {
    const plain = withRules.find((e) => e.demo_url === null)!;
    const html = demoPanelHtml(plain);
    expect(html).not.toContain("<video");
    expect(html).not.toMatch(/<canvas[^>]*\bhidden\b/);
  });
});
