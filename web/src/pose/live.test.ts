/**
 * The live guards, which exist because of what a real video exposed.
 *
 * Every case here is a failure that actually happened on real footage, rebuilt
 * deterministically so it can be tested without depending on a video file.
 */
import { describe, expect, it } from "vitest";

import crosscheck from "./__fixtures__/crosscheck.json";
import sideOn from "./__fixtures__/side-on.json";
import { Frame } from "./geometry";
import type { Side } from "./landmarks";
import { LiveSession } from "./live";
import type { ExerciseRule } from "./rules";

const rule = crosscheck.rule as unknown as ExerciseRule;
const side = crosscheck.side as Side;

function goodFrames(): Frame[] {
  return crosscheck.frames.map((f) => Frame.from(f.t, f.landmarks, crosscheck.aspect));
}

function replay(frames: Frame[]) {
  const session = new LiveSession(rule, side);
  const results = frames.map((f) => session.push(f));
  return { results, outcome: session.finish() };
}

describe("camera angle", () => {
  it("refuses side-on footage of a front-on exercise", () => {
    const frames = sideOn.frames.map((f) => Frame.from(f.t, f.landmarks, sideOn.aspect));
    const { results, outcome } = replay(frames);

    // Warm-up aside, every frame should be rejected with a clear reason.
    const settled = results.slice(30);
    expect(settled.every((r) => !r.accepted)).toBe(true);
    expect(settled.every((r) => r.view === "side")).toBe(true);
    expect(
      settled.every((r) => r.problems.some((p) => p.code === "wrong_camera_view")),
    ).toBe(true);

    // And nothing gets scored, rather than being scored badly.
    expect(outcome.completedReps).toBe(0);
  });

  it("gives the player an instruction, not an error code", () => {
    const frames = sideOn.frames.map((f) => Frame.from(f.t, f.landmarks, sideOn.aspect));
    const { results } = replay(frames);
    const problem = results
      .slice(30)
      .flatMap((r) => r.problems)
      .find((p) => p.code === "wrong_camera_view")!;
    expect(problem.message_en).toContain("face you");
    expect(problem.message_th.length).toBeGreaterThan(0);
  });
});

describe("framing", () => {
  it("tells the player to step back when they do not fit in the shot", () => {
    // Push everyone down so the feet fall off the bottom edge.
    const frames = crosscheck.frames.map((f) =>
      Frame.from(
        f.t,
        f.landmarks.map((lm) => ({ ...lm, y: lm.y + 0.2 })),
        crosscheck.aspect,
      ),
    );
    const { results } = replay(frames);
    expect(results.every((r) => !r.accepted)).toBe(true);
    expect(
      results.at(-1)!.problems.some((p) => p.code === "not_fully_in_frame"),
    ).toBe(true);
  });

  it("accepts a player who does fit", () => {
    const { results } = replay(goodFrames());
    expect(results.slice(30).every((r) => r.accepted)).toBe(true);
  });
});

describe("MediaPipe returning nonsense at full confidence", () => {
  function collapseFrames(from: number, to: number): Frame[] {
    return crosscheck.frames.map((f, i) => {
      if (i < from || i >= to) return Frame.from(f.t, f.landmarks, crosscheck.aspect);
      // Shrink the whole body toward its centre — exactly what was observed on
      // real footage when the player's head left the top of the shot. Confidence
      // is left untouched at 0.99, because MediaPipe leaves it untouched too.
      const cx = f.landmarks.reduce((a, l) => a + l.x, 0) / f.landmarks.length;
      const cy = f.landmarks.reduce((a, l) => a + l.y, 0) / f.landmarks.length;
      return Frame.from(
        f.t,
        f.landmarks.map((lm) => ({
          ...lm,
          x: cx + (lm.x - cx) * 0.05,
          y: cy + (lm.y - cy) * 0.05,
        })),
        crosscheck.aspect,
      );
    });
  }

  it("drops collapsed frames even though confidence says they are fine", () => {
    const frames = collapseFrames(120, 150);
    const { results, outcome } = replay(frames);

    const rejected = results.slice(120, 150).filter((r) => !r.accepted).length;
    expect(rejected).toBeGreaterThan(20);
    expect(outcome.warnings.some((w) => w.startsWith("dropped_"))).toBe(true);
    // Confidence was never the signal — prove it was high throughout.
    expect(frames[130]!.confidence(0)).toBeGreaterThan(0.9);
  });

  it("does not mistake a tracking break for the end of a rep", () => {
    const clean = replay(goodFrames()).outcome;
    // Break tracking in the middle of the second rep.
    const broken = replay(collapseFrames(120, 135)).outcome;
    expect(broken.completedReps).toBe(clean.completedReps);
  });

  it("still measures the surviving reps correctly", () => {
    const { outcome } = replay(collapseFrames(120, 150));
    for (const rep of outcome.reps) {
      expect(rep.metrics["knee_flexion_peak"]).toBeCloseTo(82, -1);
    }
  });
});

describe("live coaching", () => {
  it("flags a fault while it is happening, not after the rep", () => {
    // Drag the left knee toward the midline part-way through the set.
    const frames = crosscheck.frames.map((f, i) =>
      Frame.from(
        f.t,
        f.landmarks.map((lm, j) => (i > 60 && j === 25 ? { ...lm, x: lm.x + 0.06 } : lm)),
        crosscheck.aspect,
      ),
    );
    const { results } = replay(frames);
    const cued = results.slice(60).filter((r) => r.activeCues.length > 0);
    expect(cued.length).toBeGreaterThan(0);
    expect(cued[0]!.activeCues[0]!.code).toBe("knee_valgus");
    expect(cued[0]!.activeCues[0]!.message_th.length).toBeGreaterThan(0);
  });

  it("stays quiet when the movement is good", () => {
    const { results } = replay(goodFrames());
    expect(results.every((r) => r.activeCues.length === 0)).toBe(true);
  });
});
