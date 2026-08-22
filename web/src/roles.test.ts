import { describe, expect, it } from "vitest";

import type { PositionInfo } from "./api";
import {
  byDemand,
  roleCardHtml,
  roleChanges,
  roleDetailHtml,
  sprintGateFraction,
} from "./roles";
import { bar, progressRing } from "./ui";

/** Shaped like the real `/catalog/positions` payload. */
const position = (over: Partial<PositionInfo> = {}): PositionInfo => ({
  key: "winger",
  label_en: "Winger",
  label_th: "ปีก",
  blurb_en: "Repeated top-speed sprints and sharp cuts.",
  speed_p3: 90,
  speed_p4: 97,
  hsr_p4: 95,
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
  it("leads with the sprint gate, because that is what keeps a player off the pitch", () => {
    const [first] = roleChanges(position());
    expect(first!.label).toBe("Sprint gate");
    expect(first!.detail).toContain("90%");
    expect(first!.detail).toContain("97%");
  });

  it("names both running numbers so neither is a surprise later", () => {
    const details = roleChanges(position()).map((c) => c.detail);
    expect(details.some((d) => d.includes("95%"))).toBe(true);
  });

  it("lists the drills and tests the position adds", () => {
    const changes = roleChanges(position());
    const drills = changes.find((c) => c.label === "Extra drills");
    const tests = changes.find((c) => c.label === "Extra test");
    expect(drills?.detail).toBe("Lateral bound and stick · Repeated sprint ability");
    expect(tests?.detail).toBe("Repeated-sprint drop-off ≤ 5%");
  });

  it("says drill, not drills, when there is only one", () => {
    const one = position({
      extra_exercises: [
        { key: "heading_jump", label_en: "Two-footed heading jump", phase_key: "p3_running", phase_order: 3 },
      ],
    });
    expect(roleChanges(one).map((c) => c.label)).toContain("Extra drill");
  });

  it("shows only the two running lines for a position that adds nothing", () => {
    const plain = position({ extra_exercises: [], extra_criteria: [] });
    expect(roleChanges(plain)).toHaveLength(2);
  });
});

describe("the sprint gate bar", () => {
  it("stays inside the bar no matter what the server sends", () => {
    for (const value of [0, 50, 70, 85, 97, 100, 140]) {
      const fraction = sprintGateFraction(value);
      expect(fraction).toBeGreaterThanOrEqual(0);
      expect(fraction).toBeLessThanOrEqual(1);
    }
  });

  it("ranks the roles apart — the whole reason it is zoomed", () => {
    // On a plain 0-100 scale a keeper (75) and a winger (97) differ by a fifth
    // of the bar and read as identical. The zoom has to separate them clearly.
    const keeper = sprintGateFraction(75);
    const winger = sprintGateFraction(97);
    expect(winger - keeper).toBeGreaterThan(0.5);
  });

  it("never claims a harder gate is easier", () => {
    expect(sprintGateFraction(85)).toBeLessThan(sprintGateFraction(90));
    expect(sprintGateFraction(90)).toBeLessThan(sprintGateFraction(96));
  });
});

describe("ordering", () => {
  it("puts the least demanding role first so the bars climb", () => {
    const keeper = position({ key: "goalkeeper", speed_p4: 85 });
    const winger = position({ key: "winger", speed_p4: 97 });
    const back = position({ key: "centre_back", speed_p4: 92 });
    expect(byDemand([winger, keeper, back]).map((p) => p.key)).toEqual([
      "goalkeeper",
      "centre_back",
      "winger",
    ]);
  });

  it("does not reorder the caller's array", () => {
    const input = [position({ key: "winger", speed_p4: 97 }), position({ key: "gk", speed_p4: 85 })];
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

  it("prints the real percentage next to the comparative bar", () => {
    // The bar is zoomed to make roles distinguishable; the number is the truth,
    // so it has to be on screen beside it.
    expect(roleCardHtml(position(), false)).toContain("97%");
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
  it("gives the role card a bar for animateBars to fill", () => {
    const html = roleCardHtml(position(), false);
    expect(html).toContain('style="width:0"');
    expect(html).toMatch(/data-width="\d+"/);
  });

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
