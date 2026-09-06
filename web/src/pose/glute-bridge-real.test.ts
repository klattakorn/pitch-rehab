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
  it("counts every rep the person did", () => {
    const { outcome } = replay();
    expect(outcome.completedReps).toBe(REPS_IN_THE_VIDEO);
    expect(outcome.validReps).toBe(REPS_IN_THE_VIDEO);
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

  it("leaves the thresholds room on both sides", () => {
    // The measured peaks ran -30.4 to -22.3 and the troughs -53.8 to -49.7, and
    // all six are found anywhere in enter -32..-40 by exit -42..-48. Shipping a
    // value on the edge of that plateau would count six today and five after any
    // change of camera or body, so the margins are asserted, not just the count.
    const detection = rule.detection!;
    expect(detection.enter).toBeLessThanOrEqual(-32);
    expect(detection.enter).toBeGreaterThanOrEqual(-40);
    expect(detection.exit).toBeLessThanOrEqual(-42);
    expect(detection.exit).toBeGreaterThanOrEqual(-48);
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
