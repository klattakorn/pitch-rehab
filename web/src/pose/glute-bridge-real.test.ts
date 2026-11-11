/**
 * The glute bridge, against footage of somebody actually doing it.
 *
 * This is the only exercise test in here that runs on a real body rather than a
 * skeleton drawn in code, and it exists because of what filming it exposed. The
 * thresholds shipped for this movement were reasoned out from anatomy -- a good
 * bridge is a straight line, so the hip angle should approach zero -- and on 36
 * seconds of clean footage they found zero of six reps. MediaPipe puts the
 * shoulder point at the acromion, which on someone lying down sits forward of
 * where the torso really pivots, so a bridge that looks perfectly straight still
 * measures 20-33 degrees short of one. The whole range is shifted.
 *
 * Two things are pinned here, and they fail for different reasons:
 *
 *  - the count, which breaks if anyone retunes the thresholds in
 *    app/data/exercises.py without re-checking them against a body;
 *  - the fact that the count is read out of `fallback.ts` rather than typed in
 *    here, which breaks if that generated file is left stale after a change.
 *    That has now happened twice in this project, both times silently, and both
 *    times the shipped app kept the old numbers while the tests passed.
 *
 * Regenerate the fixture (needs the original clip):
 *   python scripts/make_video_fixture.py <clip> glute-bridge-real --stride 1
 */
import { describe, expect, it } from "vitest";

import { FALLBACK_EXERCISES } from "../fallback";
import fixture from "./__fixtures__/glute-bridge-real.json";
import second from "./__fixtures__/glute-bridge-second.json";
import { Frame } from "./geometry";
import { LiveSession } from "./live";
import type { ExerciseRule } from "./rules";

/** Counted by eye off the frames, not off the signal being tested. */
const REPS_IN_THE_VIDEO = 6;

const exercise = FALLBACK_EXERCISES.find((e) => e.key === "glute_bridge")!;
const rule = exercise.pose_rule as unknown as ExerciseRule;
const frames = fixture.frames.map((f) => Frame.from(f.t, f.landmarks, fixture.aspect));

function replay() {
  const session = new LiveSession(rule, "bilateral");
  const results = frames.map((f) => session.push(f));
  return { results, outcome: session.finish() };
}

describe("glute bridge on real footage", () => {
  it("finds every rep, and counts only the ones held 3 s at the top", () => {
    const { outcome } = replay();
    expect(outcome.completedReps).toBe(REPS_IN_THE_VIDEO);
    // This clip was filmed before the hold was asked for: three of the six
    // happen to be held for 3 s or more (3.0-3.8 s), three are not (2.6-2.8 s).
    expect(outcome.validReps).toBe(3);
    for (const rep of outcome.reps) {
      const held = rep.metrics.top_hold_s!;
      expect(rep.isValid).toBe(held >= 3);
      if (!rep.isValid) expect(rep.violations.map((v) => v.code)).toContain("hold_at_top");
    }
  });

  it("does not quietly refuse any of them", () => {
    const { outcome } = replay();
    // A rep that is found but not counted is the failure this movement had for
    // its whole life before it was filmed, so it is worth its own assertion:
    // "6 found, 0 counted" and "0 found" are different bugs with different fixes.
    // A refusal surfaces on `warnings` as discarded_<code>_x<n> (live.ts:319) --
    // there is no `discarded` array on SetResult, and asserting against one
    // typechecks as an error while vitest, which does not typecheck, waves it
    // through as always-empty. Assert on the whole list instead: it is empty on
    // this clip, so it pins the frame drops and the tracking warnings too.
    expect(outcome.warnings).toEqual([]);
    expect(outcome.formScore).toBeGreaterThanOrEqual(90);
  });

  it("tracks the body in every frame, so the count is not luck", () => {
    const { results } = replay();
    // The clip is filmed close, because that is how far away a phone on the
    // floor actually is. If a future model or guard starts throwing these
    // frames away, the count above could still pass for the wrong reason.
    expect(results.every((r) => r.accepted)).toBe(true);
  });

  it("reads the camera as side on", () => {
    const { results } = replay();
    const settled = results.slice(30);
    expect(settled.every((r) => r.view === "side")).toBe(true);
  });

  it("counts on the rise above rest, so the phone's position cannot shift it", () => {
    // Two clips, two phone positions: one rested at -51 and peaked at -26, the
    // other rested at -41 and peaked at -4 -- one clip's top was the other's
    // rest. Fixed lines cannot count both; the rise above rest counts each.
    expect(rule.detection!.relative_to_rest_s).toBeGreaterThan(0);
  });

  it("counts all 10 bridges in the second clip, filmed from a different spot", () => {
    const frames2 = second.frames.map((f) => Frame.from(f.t, f.landmarks, second.aspect));
    const session = new LiveSession(rule, "bilateral");
    for (const f of frames2) session.push(f);
    const outcome = session.finish();
    // All ten are found; none was held at the top for 3 s (about 2 s each), so
    // none counts -- the up-and-down pumping the hold exists to stop.
    expect(outcome.completedReps).toBe(10);
    expect(outcome.validReps).toBe(0);
  });

  it("keeps the amplitude gate from silently overriding `enter`", () => {
    // The trap in this rule. segment_reps opens a rep at `enter` and then throws
    // it away unless peak - exit >= min_amplitude, so the gate that really runs
    // is max(enter, exit + min_amplitude). Leave min_amplitude at the old value
    // while lowering `enter` to help a stiffer person and nothing happens at
    // all -- the counts come out byte-identical and it reads as "the threshold
    // made no difference" rather than "the threshold was ignored".
    const { enter, exit, min_amplitude } = rule.detection!;
    expect(exit + min_amplitude).toBeLessThanOrEqual(enter);
  });
});
