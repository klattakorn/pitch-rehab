/**
 * The "where is your injury?" body map.
 *
 * A list of seven medical names is a quiz. A body you can point at is not — and
 * the front/back split does real work here, because the two most common
 * football injuries in the list sit on opposite sides of the leg: a hamstring
 * is behind the thigh, an ACL is in front of the knee.
 *
 * The map and the list drive the same selection, so nobody is stuck if a
 * hotspot is fiddly on a small screen.
 */

export interface InjuryOption {
  key: string;
  label: string;
  note: string;
  /** Which silhouette the marker sits on. */
  view: "front" | "back";
  /** Marker centre, in the 100 x 232 viewBox both silhouettes share. */
  x: number;
  y: number;
}

/**
 * The seven sites, placed anatomically.
 *
 * Left/right does not matter here — the side is asked for separately, and a
 * mirrored marker would only imply the injury has to be on that side.
 */
export const INJURY_SITES: InjuryOption[] = [
  {
    key: "groin",
    label: "Groin pain",
    note: "Long-standing, load-related",
    view: "front",
    x: 44,
    y: 104,
  },
  {
    key: "adductor",
    label: "Adductor strain",
    note: "Acute groin muscle tear",
    view: "front",
    x: 42,
    y: 121,
  },
  {
    key: "acl",
    label: "ACL reconstruction",
    note: "Post-surgical knee ligament",
    view: "front",
    x: 38,
    y: 156,
  },
  {
    key: "patellar_tendinopathy",
    label: "Patellar tendinopathy",
    note: "Jumper's knee",
    view: "front",
    x: 62,
    y: 162,
  },
  {
    key: "ankle",
    label: "Ankle sprain",
    note: "Lateral or medial ligament",
    view: "front",
    x: 37,
    y: 210,
  },
  {
    key: "hamstring",
    label: "Hamstring strain",
    note: "Biceps femoris, semitendinosus",
    view: "back",
    x: 38,
    y: 133,
  },
  {
    key: "calf",
    label: "Calf strain",
    note: "Gastrocnemius, soleus, achilles",
    view: "back",
    x: 62,
    y: 188,
  },
];

/**
 * A mannequin, drawn from primitives rather than one hand-tuned outline.
 *
 * Deliberately plain: it exists to be pointed at, and an anatomically detailed
 * figure would compete with the markers sitting on top of it.
 */
function silhouette(back: boolean): string {
  const spine = back
    ? `<path d="M50 46 V96" stroke="var(--body-line)" stroke-width="1.6"
         stroke-linecap="round" opacity="0.55"/>`
    : "";
  return `
    <g class="figure" fill="var(--body)" stroke="none">
      <ellipse cx="50" cy="16" rx="10.5" ry="12.5"/>
      <rect x="45.5" y="26" width="9" height="8" rx="3"/>
      <path d="M30 44 C30 37 36 33 44 33 h12 c8 0 14 4 14 11
               l1.5 26 c0.4 7 -2.5 10 -6 12 l-1.5 18
               c-0.3 4 -2.5 6 -6 6 h-16 c-3.5 0 -5.7 -2 -6 -6
               l-1.5 -18 c-3.5 -2 -6.4 -5 -6 -12 Z"/>
      <rect x="18.5" y="41" width="9.5" height="48" rx="4.75"
            transform="rotate(9 23 65)"/>
      <rect x="72" y="41" width="9.5" height="48" rx="4.75"
            transform="rotate(-9 77 65)"/>
      <rect x="34" y="104" width="14" height="62" rx="7"
            transform="rotate(2.5 41 135)"/>
      <rect x="52" y="104" width="14" height="62" rx="7"
            transform="rotate(-2.5 59 135)"/>
      <rect x="35.5" y="162" width="11" height="56" rx="5.5"
            transform="rotate(1.5 41 190)"/>
      <rect x="53.5" y="162" width="11" height="56" rx="5.5"
            transform="rotate(-1.5 59 190)"/>
      <rect x="33.5" y="215" width="13" height="9" rx="4"/>
      <rect x="53.5" y="215" width="13" height="9" rx="4"/>
      ${spine}
    </g>`;
}

function markers(view: "front" | "back", selected: string | null): string {
  return INJURY_SITES.filter((site) => site.view === view)
    .map(
      (site) => `
        <g class="hotspot${site.key === selected ? " on" : ""}" data-key="${site.key}"
           role="button" tabindex="0" aria-label="${site.label}"
           aria-pressed="${site.key === selected}">
          <circle class="halo" cx="${site.x}" cy="${site.y}" r="13"/>
          <circle class="dot" cx="${site.x}" cy="${site.y}" r="6.5"/>
        </g>`,
    )
    .join("");
}

export function bodyMapHtml(selected: string | null): string {
  const view = (label: string, side: "front" | "back") => `
    <div class="body-view">
      <svg viewBox="-6 -6 112 244" class="body" role="group" aria-label="${label} view">
        ${silhouette(side === "back")}
        ${markers(side, selected)}
      </svg>
      <span class="body-label">${label}</span>
    </div>`;
  return `<div class="bodymap">${view("Front", "front")}${view("Back", "back")}</div>`;
}
