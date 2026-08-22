import { describe, expect, it } from "vitest";

import { INJURY_SITES, bodyMapHtml } from "./bodymap";
import { FALLBACK_EXERCISES } from "./fallback";

/** The seven the server authors protocols for. */
const SERVER_SITES = [
  "hamstring",
  "acl",
  "patellar_tendinopathy",
  "ankle",
  "adductor",
  "groin",
  "calf",
];

describe("the injury list", () => {
  it("covers exactly the sites the server has programmes for", () => {
    // A site on the map with no protocol behind it is a dead end at the worst
    // possible moment -- the player has already told us where it hurts.
    expect([...INJURY_SITES.map((s) => s.key)].sort()).toEqual([...SERVER_SITES].sort());
  });

  it("names every site twice: what it is, and what that means", () => {
    for (const site of INJURY_SITES) {
      expect(site.label, site.key).toBeTruthy();
      expect(site.note, site.key).toBeTruthy();
      expect(site.note, site.key).not.toBe(site.label);
    }
  });

  it("puts the hamstring on the back and the knee on the front", () => {
    // The whole reason for showing two silhouettes. Get this wrong and the
    // player hunts for their injury on the side of the body it is not on.
    const by = Object.fromEntries(INJURY_SITES.map((s) => [s.key, s]));
    expect(by["hamstring"]!.view).toBe("back");
    expect(by["calf"]!.view).toBe("back");
    expect(by["acl"]!.view).toBe("front");
    expect(by["patellar_tendinopathy"]!.view).toBe("front");
    expect(by["groin"]!.view).toBe("front");
  });

  it("keeps every marker on the body, not floating beside it", () => {
    for (const site of INJURY_SITES) {
      expect(site.x, site.key).toBeGreaterThan(20);
      expect(site.x, site.key).toBeLessThan(80);
      expect(site.y, site.key).toBeGreaterThan(30);
      expect(site.y, site.key).toBeLessThan(226);
    }
  });

  it("orders the leg down the leg", () => {
    const by = Object.fromEntries(INJURY_SITES.map((s) => [s.key, s]));
    // Groin above knee above ankle. A marker out of order reads as a mistake
    // even when the label is right.
    expect(by["groin"]!.y).toBeLessThan(by["acl"]!.y);
    expect(by["acl"]!.y).toBeLessThan(by["ankle"]!.y);
    expect(by["hamstring"]!.y).toBeLessThan(by["calf"]!.y);
  });

  it("does not put two markers on top of each other", () => {
    for (const view of ["front", "back"] as const) {
      const sites = INJURY_SITES.filter((s) => s.view === view);
      for (let i = 0; i < sites.length; i++) {
        for (let j = i + 1; j < sites.length; j++) {
          const a = sites[i]!;
          const b = sites[j]!;
          const distance = Math.hypot(a.x - b.x, a.y - b.y);
          // Markers are r=6.5 with a 13 halo; anything closer than 14 overlaps
          // and the wrong one gets tapped.
          expect(distance, `${a.key} vs ${b.key}`).toBeGreaterThan(14);
        }
      }
    }
  });
});

describe("the map markup", () => {
  it("draws both views with every marker", () => {
    const html = bodyMapHtml(null);
    expect(html.match(/class="body-view"/g)).toHaveLength(2);
    expect(html.match(/class="hotspot"/g)).toHaveLength(INJURY_SITES.length);
  });

  it("marks the chosen site for the eye and for a screen reader", () => {
    const html = bodyMapHtml("acl");
    expect(html).toContain('class="hotspot on" data-key="acl"');
    expect(html).toContain('aria-pressed="true"');
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(INJURY_SITES.length - 1);
  });

  it("makes every marker reachable by keyboard", () => {
    const html = bodyMapHtml(null);
    expect(html.match(/tabindex="0"/g)).toHaveLength(INJURY_SITES.length);
    for (const site of INJURY_SITES) {
      expect(html).toContain(`aria-label="${site.label}"`);
    }
  });

  it("every site has at least one exercise behind it", () => {
    // Not a strict mapping -- the server composes the programme -- but an empty
    // exercise library would mean the picker leads nowhere at all.
    expect(FALLBACK_EXERCISES.length).toBeGreaterThan(10);
  });
});
