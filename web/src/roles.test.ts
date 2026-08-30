import { describe, expect, it } from "vitest";

import type { PositionInfo } from "./api";
import {
  byDemand,
  roleCardHtml,
  roleChanges,
  roleDetailHtml,
  roleSummary,
} from "./roles";
import { bar, progressRing } from "./ui";

/** Shaped like the real `/catalog/positions` payload. */
const position = (over: Partial<PositionInfo> = {}): PositionInfo => ({
  key: "winger",
  label_en: "Winger",
  label_th: "ปีก",
  blurb_en: "Repeated top-speed sprints and sharp cuts.",
  extra_exercises: [
    { key: "lateral_bound", label_en: "Lateral bound and stick", phase_key: "p3_running", phase_order: 3 },
    { key: "repeated_sprint", label_en: "Repeated sprint ability", phase_key: "p4_return", phase_order: 4 },
  ],
  extra_criteria: [
    {
      key: "repeated_sprint_decrement",
      label_en: "Repeated-sprint drop-off ≤ 5%",
      phase_key: "p4_return",
      phase_order: 4,
    },
  ],
  ...over,
});

describe("what a role changes", () => {
  it("lists the drills and tests the position adds", () => {
    const changes = roleChanges(position());
    const drills = changes.find((c) => c.label === "Extra drills");
    const tests = changes.find((c) => c.label === "Extra test");
    expect(drills?.detail).toBe("Lateral bound and stick \u00b7 Repeated sprint ability");
    expect(tests?.detail).toBe("Repeated-sprint drop-off \u2264 5%");
  });

  it("says drill, not drills, when there is only one", () => {
    const one = position({
      extra_exercises: [
        { key: "heading_jump", label_en: "Two-footed heading jump", phase_key: "p3_running", phase_order: 3 },
      ],
    });
    expect(roleChanges(one).map((c) => c.label)).toContain("Extra drill");
  });

  it("has nothing to list for a position that adds nothing", () => {
    const plain = position({ extra_exercises: [], extra_criteria: [] });
    expect(roleChanges(plain)).toHaveLength(0);
  });
});

describe("the line on the card", () => {
  it("counts what the role adds", () => {
    expect(roleSummary(position())).toBe("Adds 2 drills \u00b7 1 test");
  });

  it("says so plainly when a role adds nothing, rather than going blank", () => {
    /* Centre midfield is this case. An empty card in a grid of six reads as a
       loading bug, and the picker is a decision -- "this one changes nothing"
       is a real answer to it. */
    const plain = position({ extra_exercises: [], extra_criteria: [] });
    expect(roleSummary(plain)).toBe("The core programme, unchanged");
    expect(roleCardHtml(plain, false)).toContain("The core programme, unchanged");
    expect(roleDetailHtml(plain)).toMatch(/same for everyone/i);
  });
});

describe("ordering", () => {
  it("keeps the order the server sent, which is keeper first down the pitch", () => {
    const keeper = position({ key: "goalkeeper" });
    const winger = position({ key: "winger" });
    const back = position({ key: "centre_back" });
    expect(byDemand([keeper, back, winger]).map((p) => p.key)).toEqual([
      "goalkeeper",
      "centre_back",
      "winger",
    ]);
  });

  it("does not reorder the caller\u0027s array", () => {
    const input = [position({ key: "winger" }), position({ key: "gk" })];
    byDemand(input);
    expect(input.map((p) => p.key)).toEqual(["winger", "gk"]);
  });
});

describe("markup", () => {
  it("marks the chosen card for both the eye and a screen reader", () => {
    expect(roleCardHtml(position(), true)).toContain('aria-pressed="true"');
    expect(roleCardHtml(position(), true)).toContain("role-card on");
    expect(roleCardHtml(position(), false)).toContain('aria-pressed="false"');
  });

  it("carries the position key, which is what the click handler reads", () => {
    expect(roleCardHtml(position(), false)).toContain('data-key="winger"');
  });

  it("puts every change in the detail panel", () => {
    const html = roleDetailHtml(position());
    for (const change of roleChanges(position())) {
      expect(html).toContain(change.label);
      expect(html).toContain(change.detail);
    }
  });
});

/* The animation helpers find their work by attribute. If a template stops
   emitting these hooks the motion silently dies, and nothing else fails --
   so the contract is pinned here rather than left to a visual check. */
describe("animation hooks", () => {
  it("gives the progress bar a target width and starts it empty", () => {
    expect(bar(64)).toBe('<div class="bar"><i style="width:0" data-width="64"></i></div>');
  });

  it("clamps a bar that is handed nonsense", () => {
    expect(bar(-20)).toContain('data-width="0"');
    expect(bar(180)).toContain('data-width="100"');
  });

  it("gives the ring an empty arc, its real value, and a counter", () => {
    const svg = progressRing(75, "in progress");
    expect(svg).toMatch(/stroke-dasharray="0 [\d.]+"/);
    expect(svg).toMatch(/data-dash="[\d.]+ [\d.]+"/);
    expect(svg).toContain('data-count="75"');
    expect(svg).toContain('data-suffix="%"');
  });

  it("still tells a screen reader the real number while the arc is empty", () => {
    expect(progressRing(75, "in progress")).toContain('aria-label="75 percent, in progress"');
  });
});
