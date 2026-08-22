/**
 * The role picker: turning a position profile into something a player can read.
 *
 * A position is not a label in this app — it moves the sprint targets you have
 * to hit before you are allowed back, and adds drills specific to the job. The
 * picker says so out loud, because "pick your position" with no consequence
 * shown is a form field, and this is a decision.
 *
 * Everything here is pure string-building on top of `api.PositionInfo`, which
 * the server derives from the same profiles it uses to compose the programme.
 * Kept out of `main.ts` so it can be tested without booting the app.
 */
import type { PositionInfo } from "./api";

export interface RoleChange {
  label: string;
  detail: string;
}

const joinNames = (items: { label_en: string }[]): string =>
  items.map((i) => i.label_en).join(" · ");

/**
 * What picking this role actually changes, in the order a player cares about.
 *
 * Speed comes first because it is the gate that keeps people off the pitch
 * longest, and it is the number that differs most between roles.
 */
export function roleChanges(position: PositionInfo): RoleChange[] {
  const changes: RoleChange[] = [
    {
      label: "Sprint gate",
      detail:
        `${position.speed_p3}% of your own best before you start running again, ` +
        `${position.speed_p4}% before you play`,
    },
    {
      label: "Running volume",
      detail: `Back to ${position.hsr_p4}% of your normal weekly high-speed distance`,
    },
  ];

  if (position.extra_exercises.length) {
    changes.push({
      label:
        position.extra_exercises.length === 1 ? "Extra drill" : "Extra drills",
      detail: joinNames(position.extra_exercises),
    });
  }
  if (position.extra_criteria.length) {
    changes.push({
      label: position.extra_criteria.length === 1 ? "Extra test" : "Extra tests",
      detail: joinNames(position.extra_criteria),
    });
  }
  return changes;
}

/**
 * Where a role's sprint gate sits, as a 0–1 fraction, for the bar on each card.
 *
 * Every gate falls between 85% and 97%, so a plain 0–100 bar would show six
 * near-identical stripes. The bar is zoomed to the 70–100 band it lives in and
 * exists only to rank the roles against each other — the true percentage is
 * printed beside it, and that is the number that means anything.
 */
export function sprintGateFraction(speedP4: number): number {
  const FLOOR = 70;
  const CEILING = 100;
  const clamped = Math.max(FLOOR, Math.min(CEILING, speedP4));
  return (clamped - FLOOR) / (CEILING - FLOOR);
}

/** Sort order for the picker: least demanding role first, so the bars climb. */
export function byDemand(positions: PositionInfo[]): PositionInfo[] {
  return [...positions].sort((a, b) => a.speed_p4 - b.speed_p4);
}

export function roleCardHtml(position: PositionInfo, selected: boolean): string {
  const fill = Math.round(sprintGateFraction(position.speed_p4) * 100);
  return `
    <button class="role-card${selected ? " on" : ""}" data-key="${position.key}"
      aria-pressed="${selected}">
      <span class="tick" aria-hidden="true"></span>
      <span class="role-name">${position.label_en}</span>
      <span class="role-blurb">${position.blurb_en}</span>
      <span class="gate">
        <span class="gate-bar"><i style="width:0" data-width="${fill}"></i></span>
        <span class="gate-num">${position.speed_p4}%</span>
      </span>
      <span class="gate-label">sprint gate to play</span>
    </button>`;
}

export function roleDetailHtml(position: PositionInfo): string {
  const rows = roleChanges(position)
    .map(
      (change) => `<li><span class="k">${change.label}</span>
        <span class="v">${change.detail}</span></li>`,
    )
    .join("");
  return `
    <div class="role-detail" data-for="${position.key}">
      <span class="label">What this changes</span>
      <div class="headline">${position.label_en}</div>
      <ul class="role-changes">${rows}</ul>
    </div>`;
}
