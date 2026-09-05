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
import type { ExerciseRule, Violation } from "./rules";

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

/* Both of these were reported the same way from a real phone: "it detects and
   says good form but it never actually counts the reps". Neither is a scoring
   mistake. In both, work was correctly thrown away and then not mentioned, so
   the only thing the player could see was a counter that would not move.

   They did not show up here before because the fixtures are drawn rather than
   filmed: a drawn skeleton does not change size when it squats, and a drawn rep
   is always deep enough. */

type Raw = { x: number; y: number; z: number; visibility: number };

/** Shrink the skeleton part-way through, the way a real body's bounding box
 *  shrinks on the way down into a squat. */
function shrunk(factor: number): Frame[] {
  return crosscheck.frames.map((f, i) => {
    const phase = Math.max(0, Math.sin((i / crosscheck.frames.length) * Math.PI * 6));
    const k = 1 - (1 - factor) * phase;
    const lms = f.landmarks as Raw[];
    const cx = lms.reduce((a, l) => a + l.x, 0) / lms.length;
    const cy = lms.reduce((a, l) => a + l.y, 0) / lms.length;
    return Frame.from(
      f.t,
      lms.map((l) => ({ ...l, x: cx + (l.x - cx) * k, y: cy + (l.y - cy) * k })),
      crosscheck.aspect,
    );
  });
}

describe("a frame the tracker could not trust", () => {
  it("is never dropped without saying so", () => {
    /* The size check catches MediaPipe collapsing the skeleton, which it
       reports at full confidence -- so nothing else catches it. It used to drop
       the frame in silence, and a dropped frame is never scored: the screen
       went on saying "Good form" over a camera that had stopped counting. */
    const { results } = replay(shrunk(0.5));
    const rejected = results.slice(30).filter((r) => !r.accepted);

    expect(rejected.length).toBeGreaterThan(0);
    for (const frame of rejected) expect(frame.problems.length).toBeGreaterThan(0);
    expect(
      rejected.some((r) => r.problems.some((p) => p.code === "tracking_unstable")),
    ).toBe(true);
  });

  it("still counts the reps it can see", () => {
    // The guard is about refusing to score bad frames, not about giving up.
    expect(replay(shrunk(0.5)).outcome.completedReps).toBeGreaterThan(0);
  });
});

describe("a movement too small to be a rep", () => {
  it("is thrown away with a reason, not in silence", () => {
    /* Raising the floor above what the fixture does is the same thing as the
       player not going deep enough: the detector follows the movement, then
       decides it was not a repetition. That decision is right. Making it
       without telling anyone is what left the counter looking broken. */
    const strict = {
      ...rule,
      detection: { ...rule.detection!, min_amplitude: 500 },
    } as ExerciseRule;
    const session = new LiveSession(strict, side);
    const results = goodFrames().map((f) => session.push(f));
    const outcome = session.finish();

    expect(outcome.completedReps).toBe(0);
    const discards = results.filter((r) => r.discarded);
    expect(discards.length).toBeGreaterThan(0);
    expect(discards[0]!.discarded!.code).toBe("too_shallow");
    expect(discards[0]!.discarded!.message_en).toMatch(/deep/i);
    expect(discards[0]!.discarded!.message_th.length).toBeGreaterThan(0);
    // And it survives into the set summary, not just a flash on the screen.
    expect(outcome.warnings.some((w) => w.startsWith("discarded_too_shallow"))).toBe(true);
  });
});

describe("a rep the camera measured and then refused", () => {
  /* Reported from a phone: a split squat detected the bend, said good form,
     and counted nothing. Every rep was faster than the exercise's 1.5s minimum
     tempo, so every rep was marked invalid -- and the counter shows valid reps.
     Tempo can only be judged once the rep is over, so it never reaches the live
     cues, which means the player was told nothing at all. */
  const tempoRule = { ...rule, tempo_min_s: 1.5 } as ExerciseRule;

  /** The same movement, replayed faster by rescaling the clock. */
  const atSpeed = (multiplier: number): Frame[] =>
    crosscheck.frames.map((f) =>
      Frame.from(f.t / multiplier, f.landmarks, crosscheck.aspect),
    );

  function run(frames: Frame[]) {
    const session = new LiveSession(tempoRule, side);
    const results = frames.map((f) => session.push(f));
    return { results, outcome: session.finish() };
  }

  it("is detected but does not reach the counter", () => {
    const { outcome } = run(atSpeed(2));
    expect(outcome.completedReps).toBeGreaterThan(0);
    expect(outcome.validReps).toBe(0);
    expect(outcome.reps.every((r) => r.violations.some((v) => v.code === "tempo_too_fast"))).toBe(
      true,
    );
  });

  /** How the camera screen picks the sentence it shows. Kept in step with
      main.ts: only a critical violation or the tempo can refuse a rep. */
  const causeOf = (rep: { violations: Violation[] }) =>
    rep.violations.find((v) => v.critical) ??
    rep.violations.find((v) => v.code === "tempo_too_fast");

  it("says why, on the frame it happened", () => {
    const { results } = run(atSpeed(2));
    const refused = results.filter((r) => r.justCompleted && !r.justCompleted.isValid);
    expect(refused.length).toBeGreaterThan(0);
    // The reason has to be a sentence a player can act on, in both languages.
    const cause = causeOf(refused[0]!.justCompleted!)!;
    expect(cause.message_en).toMatch(/slow/i);
    expect(cause.message_th.length).toBeGreaterThan(0);
  });

  /* The bug this guards: the screen used to print violations[0], which is the
     first target the rule happens to list, not the one that refused the rep.
     A split squat refused for being fast said "Too much lean - keep the chest
     up." -- advice about something that had not stopped anything. */
  it("names the refusal, not whichever target is listed first", () => {
    const noisy = {
      ...tempoRule,
      targets: [
        {
          metric: "trunk_lean",
          aggregate: "peak",
          min: null,
          max: -1, // impossible, so it is always breached and always first
          tolerance: 0,
          weight: 1,
          critical: false,
          judge: "worst",
          code: "trunk_lean",
          message_en: "Too much lean - keep the chest up.",
          message_th: "x",
        },
        ...tempoRule.targets,
      ],
    } as ExerciseRule;
    const session = new LiveSession(noisy, side);
    const results = atSpeed(2).map((f) => session.push(f));
    const refused = results.filter((r) => r.justCompleted && !r.justCompleted.isValid);
    expect(refused.length).toBeGreaterThan(0);
    const rep = refused[0]!.justCompleted!;
    // The lean violation is recorded, and it is first...
    expect(rep.violations[0]!.code).toBe("trunk_lean");
    // ...but it is not what the screen says, because it refused nothing.
    expect(causeOf(rep)!.code).toBe("tempo_too_fast");
  });

  it("counts the same movement when it is done at the asked-for tempo", () => {
    const { outcome } = run(atSpeed(1));
    expect(outcome.validReps).toBeGreaterThan(0);
  });

  /* The screen's big number reads `repCount`, not `validRepCount`, so that a
     rep the camera measured and then refused still moves it -- otherwise doing
     the movement and having nothing change is indistinguishable from not being
     seen at all. That only works if the frame-level count rises for a refused
     rep, which is what this pins down. */
  it("still moves the frame-level count when the rep is refused", () => {
    const { results } = run(atSpeed(2));
    const counts = results.map((r) => r.repCount);
    expect(Math.max(...counts)).toBeGreaterThan(0);
    expect(Math.max(...results.map((r) => r.validRepCount))).toBe(0);
    // And it only ever goes up, so the number on screen cannot jump backwards.
    expect(counts.every((n, i) => i === 0 || n >= counts[i - 1]!)).toBe(true);
  });
});

describe("a hold, which has no reps to count", () => {
  /* A wall sit is scored on the longest unbroken stretch where every target
     was satisfied. The browser had no hold handling at all: it counted reps,
     found none, and left a zero on the screen for forty-five seconds. */
  const holdRule = (min: number | null, max: number | null) =>
    ({
      ...rule,
      mode: "hold",
      hold_target_s: 45,
      detection: null,
      targets: [
        {
          metric: "knee_flexion",
          aggregate: "peak",
          min,
          max,
          tolerance: 0,
          weight: 1,
          critical: false,
          code: "depth",
          message_en: "Sit lower.",
          message_th: "ย่อลงอีก",
        },
      ],
    }) as unknown as ExerciseRule;

  const run = (r: ExerciseRule) => {
    const session = new LiveSession(r, side);
    const results = goodFrames().map((f) => session.push(f));
    return { last: results.at(-1)!, outcome: session.finish() };
  };

  it("counts the time in position, not the length of the clip", () => {
    /* The fixture is a squat cycling 5-83 degrees over 13.3s, so a target of
       "at least 40" is satisfied in bursts. The timer must report the longest
       unbroken burst -- not zero, and not the whole clip. */
    const { last, outcome } = run(holdRule(40, null));
    expect(last.holdSeconds).not.toBeNull();
    expect(outcome.holdSeconds!).toBeGreaterThan(0);
    expect(outcome.holdSeconds!).toBeLessThan(13.3);
  });

  it("credits nothing when the position is never reached", () => {
    // Nothing in the fixture bends past 83, so a 170 degree target is never met.
    expect(run(holdRule(170, null)).outcome.holdSeconds).toBe(0);
  });

  it("runs the whole time when the position is always held", () => {
    // Everything in the fixture is under 200 degrees, so this never breaks.
    const { outcome } = run(holdRule(null, 200));
    expect(outcome.holdSeconds!).toBeGreaterThan(13);
  });

  it("reports nothing for a rep exercise, so the counter stays the rep count", () => {
    const session = new LiveSession(rule, side);
    const last = goodFrames().map((f) => session.push(f)).at(-1)!;
    expect(last.holdSeconds).toBeNull();
    expect(session.finish().holdSeconds).toBeNull();
  });
});
