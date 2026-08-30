/**
 * The role picker: turning a position profile into something a player can read.
 *
 * A position is not a label in this app — it adds drills specific to the job and
 * tests you have to pass that other roles do not. The picker says so out loud,
 * because "pick your position" with no consequence shown is a form field, and
 * this is a decision.
 *
 * It used to lead with the sprint gate, which was the number that separated the
 * roles most clearly. That gate was read from a watch, and with the health-app
 * connection gone there is no honest number to print — so the picker shows the
 * work instead, and a role that adds none says that rather than showing a blank
 * card.
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

/** What picking this role actually changes, in the order a player cares about. */
export function roleChanges(position: PositionInfo): RoleChange[] {
  const changes: RoleChange[] = [];

  if (position.extra_exercises.length) {
    changes.push({
      label: position.extra_exercises.length === 1 ? "Extra drill" : "Extra drills",
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
 * The one-line summary on the card.
 *
 * A role that adds nothing gets a sentence rather than an empty space: the
 * picker is a decision, and "this one changes nothing" is a real answer to it.
 */
export function roleSummary(position: PositionInfo): string {
  const parts: string[] = [];
  const drills = position.extra_exercises.length;
  const tests = position.extra_criteria.length;
  if (drills) parts.push(`${drills} drill${drills === 1 ? "" : "s"}`);
  if (tests) parts.push(`${tests} test${tests === 1 ? "" : "s"}`);
  return parts.length ? `Adds ${parts.join(" · ")}` : "The core programme, unchanged";
}

/**
 * Picker order: the roles down the pitch, keeper first.
 *
 * That is the order the server sends, and it is the order a football player
 * reads a team sheet in. It used to be sorted by how hard the sprint gate was,
 * which no longer exists.
 */
export function byDemand(positions: PositionInfo[]): PositionInfo[] {
  return [...positions];
}

export function roleCardHtml(position: PositionInfo, selected: boolean): string {
  return `
    <button class="role-card${selected ? " on" : ""}" data-key="${position.key}"
      aria-pressed="${selected}">
      <span class="tick" aria-hidden="true"></span>
      <span class="role-name">${position.label_en}</span>
      <span class="role-blurb">${position.blurb_en}</span>
      <span class="role-adds">${roleSummary(position)}</span>
    </button>`;
}

export function roleDetailHtml(position: PositionInfo): string {
  const changes = roleChanges(position);
  const rows = changes
    .map(
      (change) => `<li><span class="k">${change.label}</span>
        <span class="v">${change.detail}</span></li>`,
    )
    .join("");
  return `
    <div class="role-detail" data-for="${position.key}">
      <span class="label">What this changes</span>
      <div class="headline">${position.label_en}</div>
      ${
        changes.length
          ? `<ul class="role-changes">${rows}</ul>`
          : `<p class="sub tiny">This role runs the core programme as it is —
               the drills and the testing are the same for everyone.</p>`
      }
    </div>`;
}
