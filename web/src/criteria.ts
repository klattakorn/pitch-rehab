/**
 * Building your own exit criterion.
 *
 * A `CriterionSpec` has eight fields; the screen asks for two. Everything else
 * comes from the catalogue the server sends, which is also what stops anyone
 * inventing a metric nothing will ever write a value for.
 *
 * The comparison direction is deliberately not offered. Every metric here has
 * one obvious way round — nobody sets out to require pain of *at least* 8/10 —
 * so the catalogue decides it and the screen states it.
 *
 * Pure string-building and small pure functions, kept out of `main.ts` so the
 * wording and the draft-assembly can be tested without booting the app.
 */
import type { Authorable, AuthorableCatalogue, CriterionDraft, CustomCriterion } from "./api";

export const ABSOLUTE = "absolute";
export const LSI = "lsi";
export const PERCENT_OF_BASELINE = "percent_of_baseline";

/** How each comparison reads to a player choosing between them. */
export const TARGET_TYPE_LABELS: Record<string, string> = {
  [ABSOLUTE]: "A fixed number",
  [LSI]: "% of the other side",
  [PERCENT_OF_BASELINE]: "% of your own best",
};

/** Split `session.reps.single_leg_calf_raise` back into its two halves. */
export function splitMetric(
  metric: string,
  catalogue: AuthorableCatalogue,
): { base: Authorable | null; exerciseKey: string | null } {
  const exact = catalogue.metrics.find((m) => m.key === metric);
  if (exact) return { base: exact, exerciseKey: null };

  for (const candidate of catalogue.metrics) {
    if (candidate.needs_exercise && metric.startsWith(`${candidate.key}.`)) {
      return { base: candidate, exerciseKey: metric.slice(candidate.key.length + 1) };
    }
  }
  return { base: null, exerciseKey: null };
}

/** Metrics this screen understands, grouped in the catalogue's own order. */
export function grouped(catalogue: AuthorableCatalogue): [string, Authorable[]][] {
  return catalogue.groups
    .map(
      (group) =>
        [group, catalogue.metrics.filter((m) => m.group === group)] as [
          string,
          Authorable[],
        ],
    )
    .filter(([, items]) => items.length > 0);
}

/** The unit shown beside the number, which changes with the comparison. */
export function unitFor(item: Authorable, targetType: string): string {
  return targetType === ABSOLUTE ? item.unit : "%";
}

/**
 * What the criterion will read as on the gate.
 *
 * Shown live while the number is being typed, because "at least 7.5 m/s" is a
 * thing a player can sanity-check and `{"comparator":"gte","value":7.5}` is not.
 */
export function preview(
  item: Authorable,
  targetType: string,
  value: number,
  exerciseName: string | null,
): string {
  if (!Number.isFinite(value) || value <= 0) return "Enter a number above zero";
  const shown = String(Number(value.toFixed(3)));
  let body: string;
  if (targetType === LSI) {
    body = `${item.label_en} at least ${shown}% of the other side`;
  } else if (targetType === PERCENT_OF_BASELINE) {
    body = `${item.label_en} at least ${shown}% of your own best`;
  } else {
    body = item.phrase_en.replace("…", shown);
  }
  return exerciseName
    ? `${exerciseName}: ${body.charAt(0).toLowerCase()}${body.slice(1)}`
    : body;
}

/** Plain English for the look-back window, so nobody has to guess. */
export function windowText(item: Authorable, windowDays: number | null): string {
  const days = windowDays ?? item.default_window_days;
  if (days === null) return "Counted since this phase started.";
  if (days === 1) return "Read from today only.";
  if (days === 7) return "Read from the last week.";
  return `Read from the last ${days} days.`;
}

/** Everything the player picked, in the shape the endpoint takes. */
export function toDraft(input: {
  item: Authorable;
  exerciseKey: string | null;
  targetType: string;
  value: number;
  required: boolean;
  phaseKey: string;
  overrideKey?: string | null;
}): CriterionDraft {
  const draft: CriterionDraft = {
    metric: input.item.key,
    target_type: input.targetType,
    value: input.value,
    required: input.required,
    phase_key: input.phaseKey,
  };
  if (input.item.needs_exercise) draft.exercise_key = input.exerciseKey;
  if (input.overrideKey) draft.key = input.overrideKey;
  return draft;
}

/**
 * Reopen an existing criterion in the builder.
 *
 * Works for one a player wrote and for a library one they are tightening — the
 * spec has the same shape either way, which is the whole reason custom criteria
 * are stored as specs rather than as a separate kind of thing.
 */
export function draftFrom(
  criterion: CustomCriterion,
  catalogue: AuthorableCatalogue,
): {
  item: Authorable;
  exerciseKey: string | null;
  targetType: string;
  value: number;
} | null {
  const { base, exerciseKey } = splitMetric(criterion.spec.metric, catalogue);
  if (!base) return null;
  return {
    item: base,
    exerciseKey,
    targetType: criterion.spec.target.type,
    value: criterion.spec.target.value,
  };
}

// ------------------------------------------------------------------- markup
export function metricPickerHtml(catalogue: AuthorableCatalogue): string {
  return grouped(catalogue)
    .map(
      ([group, items]) => `
        <h3>${group}</h3>
        <div class="stack">
          ${items
            .map(
              (item) => `<button class="rowcard" data-metric="${item.key}">
                <span class="rowbody"><b>${item.label_en}</b>
                  <small>${item.help_en}</small></span>
                <span class="chip">${item.unit}</span>
              </button>`,
            )
            .join("")}
        </div>`,
    )
    .join("");
}

export function exercisePickerHtml(
  catalogue: AuthorableCatalogue,
  selected: string | null,
): string {
  return `
    <label class="label" for="ex">Which exercise</label>
    <select id="ex" class="select">
      ${catalogue.exercises
        .map(
          (e) => `<option value="${e.key}"${e.key === selected ? " selected" : ""}>
            ${e.name_en}</option>`,
        )
        .join("")}
    </select>`;
}
