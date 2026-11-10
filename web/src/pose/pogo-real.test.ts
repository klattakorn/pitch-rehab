/**
 * Pogo hops, against footage of somebody actually doing them.
 *
 * The rule used to count on knee bend. From the front a stiff-kneed hop barely
 * bends the knee in the image (2-10 degrees), so on the front clip it found 6
 * blobs of up to 2 seconds where there were 10 hops. It now counts on
 * `foot_lift` -- the lower foot's height off the floor -- which these clips pin.
 *
 * Counts are read off the frames by eye, not off the signal under test. The
 * count rule comes from `fallback.ts`, so a stale generated file fails here too.
 *
 * Every hop also reports its air time and the ground contact before it, which
 * is what a physio reads off pogo hops (shorter contact = springier).
 *
 * Regenerate the fixtures (needs the original clips in videos/):
 *   python scripts/make_video_fixture.py videos/pogo-front.mp4 pogo-front --stride 1
 *   python scripts/make_video_fixture.py videos/pogo-valgus.mp4 pogo-valgus --stride 1
 */
import { describe, expect, it } from "vitest";

import { FALLBACK_EXERCISES } from "../fallback";
import front from "./__fixtures__/pogo-front.json";
import valgus from "./__fixtures__/pogo-valgus.json";
import { FootLift, Frame } from "./geometry";
import { LiveSession } from "./live";
import type { ExerciseRule } from "./rules";

const exercise = FALLBACK_EXERCISES.find((e) => e.key === "pogo_hops")!;
const rule = exercise.pose_rule as unknown as ExerciseRule;

type Fixture = typeof front;
const toFrames = (fx: Fixture) => fx.frames.map((f) => Frame.from(f.t, f.landmarks, fx.aspect));

function replay(fx: Fixture) {
  const session = new LiveSession(rule, "bilateral");
  for (const f of toFrames(fx)) session.push(f);
  return session.finish();
}

describe("pogo hops on real footage", () => {
  it("counts on the feet, not the knees", () => {
    expect(rule.detection?.signal).toBe("foot_lift");
  });

  it.each([
    ["front, 10 good hops", front, 10],
    ["front, 6 hops with the knees in", valgus as Fixture, 6],
  ])("counts every hop live: %s", (_name, fx, hops) => {
    const outcome = replay(fx);
    expect(outcome.completedReps).toBe(hops);
    // The front clip's head leaves the top of the frame on every hop. Pogo
    // hops only need the shoulders down in shot, so nothing is refused --
    // which is also what keeps this count equal to the server's.
    expect(outcome.warnings).toEqual([]);
  });

  it("measures ground contact, and it separates springy hops from sinking ones", () => {
    const contacts = (fx: Fixture) =>
      replay(fx)
        .reps.map((r) => r.metrics.ground_contact_s)
        .filter((v): v is number => typeof v === "number");
    const good = contacts(front);
    const sinking = contacts(valgus as Fixture);
    // One per hop after the first: the first has no landing before it.
    expect(good).toHaveLength(9);
    expect(sinking).toHaveLength(5);
    // Measured: 0.13-0.20 s on the good clip, 0.54-0.60 s on the other.
    expect(Math.max(...good)).toBeLessThan(0.3);
    expect(Math.min(...sinking)).toBeGreaterThan(0.4);
    for (const r of replay(front).reps) expect(r.metrics.flight_time_s).toBeCloseTo(r.duration, 3);
  });

  it("keeps exit + min_amplitude under enter, so enter is the real gate", () => {
    const det = rule.detection!;
    expect(det.exit + det.min_amplitude).toBeLessThanOrEqual(det.enter);
  });

  it("standing still reads about zero", () => {
    // The last ~3 s of the front clip are the player standing after the set.
    const tracker = new FootLift();
    const values = toFrames(front)
      .map((f) => ({ t: f.t, v: tracker.push(f) }))
      .filter((r) => r.t > 7.5 && r.v !== null)
      .map((r) => r.v!);
    expect(values.length).toBeGreaterThan(30);
    expect(Math.max(...values)).toBeLessThan(rule.detection!.exit + rule.detection!.min_amplitude);
  });
});
