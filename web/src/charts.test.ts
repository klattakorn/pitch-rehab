/**
 * The charts obey the same rule as the rest of the app: a value that was never
 * measured is a gap, not a zero. A line drawn through a fortnight of nothing —
 * or worse, plotted at 0% — tells a player they failed when they simply were
 * not there.
 */
import { describe, expect, it } from "vitest";

import { barChart, lineChart, meterRow } from "./charts";

const day = (n: number) => `2026-08-${String(n).padStart(2, "0")}`;

describe("the accuracy line", () => {
  it("says so plainly when nothing has been measured", () => {
    const html = lineChart([
      { day: day(1), value: null },
      { day: day(2), value: null },
    ]);
    expect(html).toContain("chart-empty");
    expect(html).toContain("Nothing measured yet");
    expect(html).not.toContain("<path");
  });

  it("breaks the line across a gap instead of drawing through it", () => {
    const withGap = lineChart([
      { day: day(1), value: 70 },
      { day: day(2), value: 72 },
      { day: day(3), value: null },
      { day: day(4), value: 90 },
      { day: day(5), value: 92 },
    ]);
    // Two separate strokes, not one continuous claim of steady progress.
    expect(withGap.match(/<path /g)).toHaveLength(2);

    const unbroken = lineChart([
      { day: day(1), value: 70 },
      { day: day(2), value: 72 },
      { day: day(3), value: 74 },
    ]);
    expect(unbroken.match(/<path /g)).toHaveLength(1);
  });

  it("never plots an unmeasured day at zero", () => {
    const html = lineChart([
      { day: day(1), value: 88 },
      { day: day(2), value: null },
      { day: day(3), value: 90 },
    ]);
    // Only the two real readings produce coordinates; both sit high on the
    // chart, so no point can be near the bottom axis.
    const ys = [...html.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) => Number(m[2]));
    expect(ys).toHaveLength(2);
    expect(Math.max(...ys)).toBeLessThan(100);
  });

  it("draws a single reading rather than giving up on it", () => {
    const html = lineChart([
      { day: day(1), value: null },
      { day: day(2), value: 81 },
    ]);
    expect(html).not.toContain("chart-empty");
    expect(html).toContain("<circle");
  });

  it("tells a screen reader the latest figure, not just that a chart exists", () => {
    const html = lineChart([
      { day: day(1), value: 70 },
      { day: day(2), value: 93 },
    ]);
    expect(html).toContain("latest 93 percent");
  });

  it("labels both ends of the window", () => {
    const html = lineChart([
      { day: day(1), value: 70 },
      { day: day(9), value: 80 },
    ]);
    expect(html).toContain("1 Aug");
    expect(html).toContain("9 Aug");
  });
});

describe("the sessions bar chart", () => {
  it("keeps empty days visible, because they are the point", () => {
    const html = barChart([
      { day: day(1), value: 1 },
      { day: day(2), value: 0 },
      { day: day(3), value: 2 },
    ]);
    expect(html.match(/<rect /g)).toHaveLength(3);
    // A day with a session is a state, so it takes the state colour; an empty
    // day takes a flat surface. Neither uses the accent -- the accent means
    // "you can act here", and a chart is not something you act on.
    expect(html).toContain("var(--raised)");
    expect(html).toContain("var(--pass)");
    expect(html).not.toContain("var(--volt)");
  });

  it("says nothing has happened rather than drawing a chart of nothing", () => {
    // Every bar at zero renders as a row of 1.5px slivers under a date axis,
    // which reads as a broken chart rather than an empty one -- and takes more
    // vertical room than a chart with data in it.
    const html = barChart([
      { day: day(1), value: 0 },
      { day: day(2), value: 0 },
    ]);
    expect(html).toContain("chart-empty");
    expect(html).toContain("No sessions logged yet");
    expect(html).not.toContain("<rect");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
  });

  it("draws the chart as soon as one day has something in it", () => {
    const html = barChart([
      { day: day(1), value: 0 },
      { day: day(2), value: 1 },
    ]);
    expect(html).not.toContain("chart-empty");
    expect(html.match(/<rect /g)).toHaveLength(2);
  });

  it("scales the tallest bar to the plot, not to a fixed maximum", () => {
    const heights = (html: string) =>
      [...html.matchAll(/height="([\d.]+)"/g)].map((m) => Number(m[1]));
    const small = heights(barChart([{ day: day(1), value: 1 }, { day: day(2), value: 0 }]));
    const large = heights(barChart([{ day: day(1), value: 9 }, { day: day(2), value: 0 }]));
    expect(Math.max(...small)).toBeCloseTo(Math.max(...large), 1);
  });
});

describe("the meter row", () => {
  it("shows the label, the count and the score", () => {
    const html = meterRow("Split squat", "4 sets", 93.4);
    expect(html).toContain("Split squat");
    expect(html).toContain("4 sets");
    expect(html).toContain("93%");
  });

  it("starts empty and carries its target for the animation to find", () => {
    const html = meterRow("Wall sit", "2 sets", 61);
    expect(html).toContain('style="width:0"');
    expect(html).toContain('data-width="61"');
  });

  it("clamps a score that arrives out of range", () => {
    expect(meterRow("x", "y", 140)).toContain('data-width="100"');
    expect(meterRow("x", "y", -5)).toContain('data-width="0"');
  });
});
