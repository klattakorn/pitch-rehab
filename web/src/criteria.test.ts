/**
 * The builder's wording and its draft-assembly.
 *
 * The sentence shown live while a number is typed is the only thing standing
 * between a player and a target they did not mean to set, so it is worth
 * pinning: "Run at least 7.5 m/s" is checkable, `{comparator:"gte"}` is not.
 */
import { describe, expect, it } from "vitest";

import type { Authorable, AuthorableCatalogue, CustomCriterion } from "./api";
import {
  ABSOLUTE,
  LSI,
  PERCENT_OF_BASELINE,
  TARGET_TYPE_LABELS,
  draftFrom,
  exercisePickerHtml,
  grouped,
  metricPickerHtml,
  preview,
  splitMetric,
  toDraft,
  unitFor,
  windowText,
} from "./criteria";

const metric = (over: Partial<Authorable> = {}): Authorable => ({
  key: "health.running_speed",
  source: "health",
  group: "Running",
  label_en: "Top running speed",
  unit: "m/s",
  help_en: "Fastest speed your watch recorded.",
  phrase_en: "Run at least … m/s",
  default_target: 7.5,
  comparator: "gte",
  lower_is_better: false,
  default_window_days: 14,
  target_types: [ABSOLUTE, PERCENT_OF_BASELINE],
  step: 0.1,
  needs_exercise: false,
  ...over,
});

const reps = metric({
  key: "session.reps",
  source: "session",
  group: "Exercises",
  label_en: "Reps in one set",
  unit: "reps",
  phrase_en: "Do at least … reps in one set",
  default_target: 20,
  target_types: [ABSOLUTE],
  step: 1,
  needs_exercise: true,
});

const hop = metric({
  key: "test.hop_triple",
  source: "test",
  group: "Strength tests",
  label_en: "Triple hop distance",
  unit: "m",
  phrase_en: "Hop at least … metres in three",
  default_target: 4.5,
  target_types: [ABSOLUTE, LSI],
});

const pain = metric({
  key: "pro.pain_rest",
  source: "pro",
  group: "How you feel",
  label_en: "Pain at rest",
  unit: "NPRS",
  phrase_en: "Pain at rest no more than …/10",
  default_target: 2,
  comparator: "lte",
  lower_is_better: true,
  target_types: [ABSOLUTE],
  default_window_days: 7,
});

const catalogue: AuthorableCatalogue = {
  groups: ["Exercises", "Running", "Strength tests", "How you feel", "Empty group"],
  metrics: [reps, metric(), hop, pain],
  exercises: [
    {
      key: "single_leg_calf_raise",
      name_en: "Single-leg calf raise",
      category: "strength",
      measure: "reps",
      suggested_target: null,
    },
    {
      key: "split_squat",
      name_en: "Split squat",
      category: "strength",
      measure: "reps",
      suggested_target: null,
    },
    // A timed one, so anything reading the catalogue has to cope with both.
    {
      key: "side_plank",
      name_en: "Side plank",
      category: "strength",
      measure: "seconds",
      suggested_target: 30,
    },
  ],
};

describe("the live sentence", () => {
  it("reads as English, not as a spec", () => {
    expect(preview(metric(), ABSOLUTE, 7.5, null)).toBe("Run at least 7.5 m/s");
    expect(preview(pain, ABSOLUTE, 2, null)).toBe("Pain at rest no more than 2/10");
  });

  it("names the exercise when the metric is measured per exercise", () => {
    expect(preview(reps, ABSOLUTE, 20, "Single-leg calf raise")).toBe(
      "Single-leg calf raise: do at least 20 reps in one set",
    );
  });

  it("says what a percentage is a percentage of", () => {
    // "95%" on its own is ambiguous and the two mean very different things.
    expect(preview(hop, LSI, 95, null)).toBe(
      "Triple hop distance at least 95% of the other side",
    );
    expect(preview(metric(), PERCENT_OF_BASELINE, 90, null)).toBe(
      "Top running speed at least 90% of your own best",
    );
  });

  it("asks for a number rather than showing a broken sentence", () => {
    for (const bad of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(preview(metric(), ABSOLUTE, bad, null)).toBe("Enter a number above zero");
    }
  });

  it("does not print floating-point noise at the player", () => {
    expect(preview(metric(), ABSOLUTE, 7.1 + 0.1, null)).toBe("Run at least 7.2 m/s");
  });
});

describe("units and windows", () => {
  it("switches the unit with the comparison", () => {
    expect(unitFor(metric(), ABSOLUTE)).toBe("m/s");
    expect(unitFor(metric(), PERCENT_OF_BASELINE)).toBe("%");
    expect(unitFor(hop, LSI)).toBe("%");
  });

  it("says how far back the reading is taken from", () => {
    expect(windowText(metric(), null)).toContain("14 days");
    expect(windowText(pain, null)).toBe("Read from the last week.");
    expect(windowText(metric(), 1)).toBe("Read from today only.");
    expect(windowText(metric({ default_window_days: null }), null)).toContain(
      "since this phase started",
    );
  });

  it("names both comparisons in a way a player can choose between", () => {
    expect(TARGET_TYPE_LABELS[LSI]).toBe("% of the other side");
    expect(TARGET_TYPE_LABELS[PERCENT_OF_BASELINE]).toBe("% of your own best");
  });
});

describe("splitting a stored metric back apart", () => {
  it("finds a plain metric", () => {
    const { base, exerciseKey } = splitMetric("health.running_speed", catalogue);
    expect(base?.key).toBe("health.running_speed");
    expect(exerciseKey).toBeNull();
  });

  it("peels the exercise off a per-exercise metric", () => {
    const { base, exerciseKey } = splitMetric(
      "session.reps.single_leg_calf_raise",
      catalogue,
    );
    expect(base?.key).toBe("session.reps");
    expect(exerciseKey).toBe("single_leg_calf_raise");
  });

  it("returns nothing for a metric the builder does not understand", () => {
    // Library criteria exist that this screen cannot edit. Saying so is the
    // point -- it is how the pencil stays off those rows.
    expect(splitMetric("manual.rtp_clearance", catalogue).base).toBeNull();
    expect(splitMetric("pose.nordic_break_angle", catalogue).base).toBeNull();
  });
});

describe("the draft sent to the server", () => {
  const base = {
    exerciseKey: null,
    targetType: ABSOLUTE,
    value: 7.5,
    required: true,
    phaseKey: "p2_strength",
  };

  it("sends the base metric, not the one with the exercise glued on", () => {
    // The server pastes them back together; sending a composed key would make
    // the catalogue lookup fail.
    const draft = toDraft({ ...base, item: reps, exerciseKey: "split_squat", value: 20 });
    expect(draft.metric).toBe("session.reps");
    expect(draft.exercise_key).toBe("split_squat");
  });

  it("leaves the exercise out entirely when the metric has none", () => {
    expect(toDraft({ ...base, item: metric() })).not.toHaveProperty("exercise_key");
  });

  it("carries the phase, so a test can gate a phase you are not in yet", () => {
    expect(toDraft({ ...base, item: metric() }).phase_key).toBe("p2_strength");
  });

  it("sends a key only when replacing an existing criterion", () => {
    expect(toDraft({ ...base, item: metric() }).key).toBeUndefined();
    expect(
      toDraft({ ...base, item: metric(), overrideKey: "speed_vs_baseline" }).key,
    ).toBe("speed_vs_baseline");
  });

  it("never sends a comparator — the metric decides which way it points", () => {
    expect(toDraft({ ...base, item: pain, value: 2 })).not.toHaveProperty("comparator");
  });
});

describe("reopening a saved criterion", () => {
  const saved = (metricKey: string, type = ABSOLUTE, value = 20): CustomCriterion => ({
    id: 1,
    phase_key: "p1_protect",
    key: "custom_session_reps_split_squat",
    label_en: "…",
    help_en: null,
    required: true,
    spec: {
      metric: metricKey,
      source: "session",
      aggregate: "latest",
      window_days: 14,
      comparator: "gte",
      scope: "any",
      target: { type, value, unit: "reps" },
    },
  });

  it("restores exactly what was chosen", () => {
    const draft = draftFrom(saved("session.reps.split_squat"), catalogue);
    expect(draft?.item.key).toBe("session.reps");
    expect(draft?.exerciseKey).toBe("split_squat");
    expect(draft?.value).toBe(20);
    expect(draft?.targetType).toBe(ABSOLUTE);
  });

  it("restores the comparison, not just the number", () => {
    const draft = draftFrom(saved("test.hop_triple", LSI, 95), catalogue);
    expect(draft?.targetType).toBe(LSI);
    expect(draft?.value).toBe(95);
  });

  it("gives up rather than guessing on a metric it does not know", () => {
    expect(draftFrom(saved("manual.rtp_clearance"), catalogue)).toBeNull();
  });
});

describe("the pickers", () => {
  it("keeps the catalogue's grouping and drops empty groups", () => {
    expect(grouped(catalogue).map(([g]) => g)).toEqual([
      "Exercises",
      "Running",
      "Strength tests",
      "How you feel",
    ]);
  });

  it("offers every metric, with what it is for", () => {
    const html = metricPickerHtml(catalogue);
    for (const item of catalogue.metrics) {
      expect(html).toContain(`data-metric="${item.key}"`);
      expect(html).toContain(item.label_en);
      expect(html).toContain(item.help_en);
    }
  });

  it("preselects the exercise already chosen", () => {
    const html = exercisePickerHtml(catalogue, "split_squat");
    expect(html).toContain('value="split_squat" selected');
    expect(html).not.toContain('value="single_leg_calf_raise" selected');
  });

  it("labels the exercise picker for a screen reader", () => {
    expect(exercisePickerHtml(catalogue, null)).toContain('for="ex"');
  });
});
