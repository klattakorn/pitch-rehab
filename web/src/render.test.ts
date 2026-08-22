/**
 * The overlay has to land on the body.
 *
 * A front camera is mirrored so the player sees themselves as they would in a
 * mirror; a rear camera is not. The video is flipped in CSS and the skeleton is
 * flipped in JavaScript, and if those two ever disagree the skeleton slides to
 * the wrong side of the screen while every angle it reports stays correct --
 * which looks like the pose engine is broken when it is not.
 *
 * So the flip is pinned here rather than left to someone noticing.
 */
import { describe, expect, it } from "vitest";

import crosscheck from "./pose/__fixtures__/crosscheck.json";
import { Frame } from "./pose/geometry";
import { FRIENDLY, drawSkeleton, metricsToShow, renderReadout } from "./render";
import type { FrameResult } from "./pose/live";

/** Records the coordinates a draw pass would have used. */
function recordingContext(width = 640, height = 480) {
  const xs: number[] = [];
  const ys: number[] = [];
  const noop = (): void => {};
  const ctx = {
    canvas: { width, height },
    lineWidth: 0,
    strokeStyle: "",
    fillStyle: "",
    globalAlpha: 1,
    beginPath: noop,
    stroke: noop,
    fill: noop,
    moveTo: (x: number, y: number) => {
      xs.push(x);
      ys.push(y);
    },
    lineTo: (x: number, y: number) => {
      xs.push(x);
      ys.push(y);
    },
    arc: (x: number, y: number) => {
      xs.push(x);
      ys.push(y);
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, xs, ys };
}

const frame = (): Frame => {
  const first = crosscheck.frames[0]!;
  return Frame.from(first.t, first.landmarks, crosscheck.aspect);
};

describe("skeleton mirroring", () => {
  it("draws the same points on both sides of the frame, mirrored", () => {
    const width = 640;
    const front = recordingContext(width);
    const rear = recordingContext(width);
    drawSkeleton(front.ctx, frame(), true, true);
    drawSkeleton(rear.ctx, frame(), true, false);

    expect(front.xs.length).toBeGreaterThan(20);
    expect(front.xs).toHaveLength(rear.xs.length);
    // Vertical position never changes; only left/right does.
    expect(front.ys).toEqual(rear.ys);
    front.xs.forEach((x, i) => expect(x + rear.xs[i]!).toBeCloseTo(width, 5));
  });

  it("actually moves the points — a no-op flip would pass the sum test at centre", () => {
    const front = recordingContext();
    const rear = recordingContext();
    drawSkeleton(front.ctx, frame(), true, true);
    drawSkeleton(rear.ctx, frame(), true, false);
    expect(front.xs).not.toEqual(rear.xs);
  });

  it("keeps every point inside the canvas in both modes", () => {
    for (const mirrored of [true, false]) {
      const { ctx, xs, ys } = recordingContext(640, 480);
      drawSkeleton(ctx, frame(), true, mirrored);
      // A little slack: a hand can genuinely sit just outside the frame.
      expect(Math.min(...xs)).toBeGreaterThan(-160);
      expect(Math.max(...xs)).toBeLessThan(800);
      expect(Math.min(...ys)).toBeGreaterThan(-120);
      expect(Math.max(...ys)).toBeLessThan(600);
    }
  });

  it("defaults to mirrored, which is what a front camera wants", () => {
    const explicit = recordingContext();
    const implied = recordingContext();
    drawSkeleton(explicit.ctx, frame(), true, true);
    drawSkeleton(implied.ctx, frame(), true);
    expect(implied.xs).toEqual(explicit.xs);
  });
});

describe("the live readout", () => {
  const result = (metrics: Record<string, number> | null): FrameResult =>
    ({ metrics }) as unknown as FrameResult;

  it("labels readings in English", () => {
    // This read the Thai column until it was caught -- on the camera screen,
    // the most watched screen in the app.
    const el = { innerHTML: "" } as HTMLElement;
    renderReadout(el, result({ knee_flexion: 88.4, trunk_lean: 12 }), [
      "knee_flexion",
      "trunk_lean",
    ]);
    expect(el.innerHTML).toContain("knee bend");
    expect(el.innerHTML).toContain("lean");
    expect(el.innerHTML).not.toMatch(/[฀-๿]/); // no Thai characters
  });

  it("rounds to whole degrees and marks the unit", () => {
    const el = { innerHTML: "" } as HTMLElement;
    renderReadout(el, result({ knee_flexion: 88.4 }), ["knee_flexion"]);
    expect(el.innerHTML).toContain("88°");
  });

  it("leaves ratios unitless", () => {
    const el = { innerHTML: "" } as HTMLElement;
    renderReadout(el, result({ heel_raise_ratio: 0.7 }), ["heel_raise_ratio"]);
    expect(el.innerHTML).not.toContain("°");
  });

  it("says so when there is no reading rather than showing a stale one", () => {
    const el = { innerHTML: "" } as HTMLElement;
    renderReadout(el, result(null), ["knee_flexion"]);
    expect(el.innerHTML).toContain("no reading");
  });

  it("every friendly name has both languages, so neither column can go missing", () => {
    for (const [key, names] of Object.entries(FRIENDLY)) {
      expect(names.en, key).toBeTruthy();
      expect(names.th, key).toBeTruthy();
    }
  });

  it("falls back to something readable when an exercise checks nothing familiar", () => {
    expect(metricsToShow([])).toEqual(["knee_flexion", "trunk_lean"]);
    expect(metricsToShow(["made_up_metric"])).toEqual(["knee_flexion", "trunk_lean"]);
  });

  it("shows each metric once, in the order the rule lists them", () => {
    expect(metricsToShow(["trunk_lean", "knee_flexion", "trunk_lean"])).toEqual([
      "trunk_lean",
      "knee_flexion",
    ]);
  });
});
