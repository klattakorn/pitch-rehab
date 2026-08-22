/**
 * The browser and the server must agree.
 *
 * The app shows a player a number live and coaches them on it; the server later
 * recomputes it and decides whether they can go back on a pitch. Two
 * implementations of the same maths is a real risk, so this pins them together:
 * the fixture holds what Python computed for a set of frames, and these tests
 * assert TypeScript gets the same answers.
 *
 * Regenerate after changing app/services/pose:
 *   python scripts/make_crosscheck_fixture.py
 */
import { describe, expect, it } from "vitest";

import fixture from "./__fixtures__/crosscheck.json";
import { Frame, computeMetrics, openness } from "./geometry";
import type { Side } from "./landmarks";
import { LiveSession } from "./live";
import type { ExerciseRule } from "./rules";

const rule = fixture.rule as unknown as ExerciseRule;
const side = fixture.side as Side;
const aspect = fixture.aspect;

const frames = fixture.frames.map((f) => Frame.from(f.t, f.landmarks, aspect));

describe("geometry matches the Python implementation", () => {
  it("computes identical joint angles on every frame", () => {
    // Tight tolerance: this is the same arithmetic, so only floating-point noise
    // and the servers' 3-decimal rounding should separate them.
    let compared = 0;
    frames.forEach((frame, i) => {
      const expected = fixture.expected.per_frame_metrics[i] as Record<string, number>;
      const actual = computeMetrics(frame, side, rule.use_z);
      for (const [key, value] of Object.entries(expected)) {
        expect(actual[key], `frame ${i}, metric ${key}`).toBeCloseTo(value, 3);
        compared++;
      }
    });
    expect(compared).toBeGreaterThan(1000);
  });

  it("reads the same body openness, so both agree on the camera angle", () => {
    frames.forEach((frame, i) => {
      expect(openness(frame)!).toBeCloseTo(fixture.expected.openness[i]!, 5);
    });
  });

  it("undoes the aspect ratio when serialising back for upload", () => {
    const original = fixture.frames[0]!.landmarks[0]!;
    const round_tripped = frames[0]!.toPayload().landmarks[0]!;
    expect(round_tripped.x).toBeCloseTo(original.x, 9);
    expect(round_tripped.y).toBeCloseTo(original.y, 9);
  });
});

describe("live scoring agrees with the server's batch scoring", () => {
  const session = new LiveSession(rule, side);
  const results = frames.map((f) => session.push(f));
  const outcome = session.finish();

  it("counts the same number of reps", () => {
    expect(outcome.completedReps).toBe(fixture.expected.completed_reps);
    expect(outcome.validReps).toBe(fixture.expected.valid_reps);
  });

  it("scores each rep the same, allowing for trailing vs centred smoothing", () => {
    outcome.reps.forEach((rep, i) => {
      const expected = fixture.expected.reps[i]!;
      expect(rep.isValid, `rep ${i} validity`).toBe(expected.is_valid);
      // Live smoothing looks only backwards, so peaks can land a hair differently.
      expect(rep.formScore, `rep ${i} score`).toBeCloseTo(expected.form_score, 0);
      expect(rep.duration, `rep ${i} duration`).toBeCloseTo(expected.duration, 1);
    });
  });

  it("flags the same faults", () => {
    outcome.reps.forEach((rep, i) => {
      const codes = rep.violations.map((v) => v.code).sort();
      expect(codes).toEqual(fixture.expected.reps[i]!.violation_codes);
    });
  });

  it("measures the same peak angles per rep", () => {
    outcome.reps.forEach((rep, i) => {
      const expected = fixture.expected.reps[i]!.metrics as Record<string, number>;
      for (const [key, value] of Object.entries(expected)) {
        if (!(key in rep.metrics)) continue;
        expect(rep.metrics[key], `rep ${i}, ${key}`).toBeCloseTo(value, 0);
      }
    });
  });

  it("accepts the frames instead of rejecting good footage", () => {
    const accepted = results.filter((r) => r.accepted).length;
    expect(accepted / results.length).toBeGreaterThan(0.9);
  });

  it("settles on the camera view the rule expects", () => {
    const settled = results.slice(30);
    expect(settled.every((r) => r.view === rule.view)).toBe(true);
  });
});
