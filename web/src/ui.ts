/** Shared chrome: the mark, the icon set, and the small data shapes. */

/**
 * The Pitch Rehab mark — a sprinting figure, built from primitives so it stays
 * crisp at 24px in the tab bar and at 80px on the opening screen.
 */
export const BRAND_MARK = `
  <svg class="mark" viewBox="0 0 40 40" aria-hidden="true">
    <circle cx="26.5" cy="7.5" r="4.2" fill="currentColor"/>
    <path d="M23.5 14.5 L30 17.5 L35.5 14" fill="none" stroke="currentColor"
      stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M23.5 14.5 L17 20 L20.5 26.5 L15.5 35" fill="none" stroke="currentColor"
      stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M20.5 26.5 L28 29 L30 36.5" fill="none" stroke="currentColor"
      stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M17 20 L9 22.5" fill="none" stroke="currentColor"
      stroke-width="3.4" stroke-linecap="round"/>
    <g opacity="0.42" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
      <path d="M3 13 h7"/><path d="M1 20 h5"/><path d="M4 27 h6"/>
    </g>
  </svg>`;

/** The wordmark. Two weights, because the logo is one word said two ways. */
export const WORDMARK = `
  <span class="wordmark"><b>PITCH</b><i>REHAB</i></span>`;

export const TICK = `
  <svg class="mark" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/>
    <path d="M7.5 12.4 l3 3 l6-6.5" fill="none" stroke="currentColor" stroke-width="2.2"
      stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;

export const TICK_FILLED = `
  <svg class="mark" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="10" fill="currentColor"/>
    <path d="M7.5 12.4 l3 3 l6-6.5" fill="none" stroke="var(--green-ink)" stroke-width="2.4"
      stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;

export const CROSS = `
  <svg class="mark" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/>
    <path d="M8.6 8.6 l6.8 6.8 M15.4 8.6 l-6.8 6.8" stroke="currentColor" stroke-width="2.2"
      stroke-linecap="round"/>
  </svg>`;

export const DASH = `
  <svg class="mark" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"
      stroke-dasharray="3 3"/>
  </svg>`;

export const CHEVRON = `
  <svg class="chev" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M9 5 l7 7 l-7 7" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;

export const BACK_ARROW = `
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
    <path d="M15 5 l-7 7 l7 7" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;

export const BELL = `
  <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true">
    <path d="M6 10 a6 6 0 0 1 12 0 c0 4 1.4 5.6 2 6.4 H4 c0.6 -0.8 2 -2.4 2 -6.4 Z"
      fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M10 19.4 a2.2 2.2 0 0 0 4 0" fill="none" stroke="currentColor"
      stroke-width="1.8" stroke-linecap="round"/>
  </svg>`;

/** Marks anything measured by the camera rather than typed in or synced. */
export const CAMERA_ICON = `
  <svg viewBox="0 0 24 24" class="cam-icon" aria-hidden="true">
    <rect x="2.5" y="6.5" width="15" height="11" rx="2.5" fill="none"
      stroke="currentColor" stroke-width="1.8"/>
    <path d="M17.5 11 L21.5 8.4 v7.2 L17.5 13 Z" fill="none" stroke="currentColor"
      stroke-width="1.8" stroke-linejoin="round"/>
    <circle cx="10" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="1.8"/>
  </svg>`;

/** Switch between the front and rear camera. Phones have two; laptops do not. */
export const FLIP_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true" width="20" height="20">
    <path d="M4 8.5 A8 8 0 0 1 18.5 6.2" fill="none" stroke="currentColor"
      stroke-width="1.9" stroke-linecap="round"/>
    <path d="M20 15.5 A8 8 0 0 1 5.5 17.8" fill="none" stroke="currentColor"
      stroke-width="1.9" stroke-linecap="round"/>
    <path d="M18.9 2.6 L18.9 6.6 L14.9 6.6" fill="none" stroke="currentColor"
      stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M5.1 21.4 L5.1 17.4 L9.1 17.4" fill="none" stroke="currentColor"
      stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="1.9"/>
  </svg>`;

export const PAUSE_ICON = `
  <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
    <rect x="7" y="5" width="3.6" height="14" rx="1.4" fill="currentColor"/>
    <rect x="13.4" y="5" width="3.6" height="14" rx="1.4" fill="currentColor"/>
  </svg>`;

export const PLAY_ICON = `
  <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
    <path d="M8 5.5 L18.5 12 L8 18.5 Z" fill="currentColor" stroke="currentColor"
      stroke-width="2" stroke-linejoin="round"/>
  </svg>`;

/** Change the target on a test. Only appears where the builder can open it. */
export const PENCIL = `
  <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
    <path d="M4 20 l0.9 -4 L15.4 5.5 a2 2 0 0 1 2.8 0 l1.3 1.3 a2 2 0 0 1 0 2.8
      L9 20.1 Z" fill="none" stroke="currentColor" stroke-width="1.8"
      stroke-linejoin="round"/>
    <path d="M14.2 6.7 L17.3 9.8" fill="none" stroke="currentColor" stroke-width="1.8"/>
  </svg>`;

// --------------------------------------------------------------- tab bar
/** The five tabs. Line icons, so the active one reads by colour, not weight. */
export const TAB_ICONS: Record<string, string> = {
  home: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 10.5 L12 3.5 l8.5 7
    v9 a1.5 1.5 0 0 1 -1.5 1.5 h-4 v-6 h-6 v6 h-4 A1.5 1.5 0 0 1 3.5 19.5 Z"
    fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
  plan: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17"
    height="16" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/>
    <path d="M8 3 v3 M16 3 v3 M3.5 9.5 h17" fill="none" stroke="currentColor"
    stroke-width="1.8" stroke-linecap="round"/>
    <path d="M8.5 14 l2 2 l4.5 -4.5" fill="none" stroke="currentColor" stroke-width="1.8"
    stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  progress: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20 v-6 M10 20 v-11
    M16 20 v-4 M22 20 h-20" fill="none" stroke="currentColor" stroke-width="1.8"
    stroke-linecap="round"/><path d="M20 20 v-15" fill="none" stroke="currentColor"
    stroke-width="1.8" stroke-linecap="round"/></svg>`,
  test: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3.5 h6 a1.5 1.5 0 0 1
    1.5 1.5 v1.5 h2 A1.5 1.5 0 0 1 20 8 v11.5 A1.5 1.5 0 0 1 18.5 21 h-13
    A1.5 1.5 0 0 1 4 19.5 V8 a1.5 1.5 0 0 1 1.5 -1.5 h2 V5 A1.5 1.5 0 0 1 9 3.5 Z"
    fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M8.5 13.5 l2.2 2.2 l4.8 -5" fill="none" stroke="currentColor"
    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  profile: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="4"
    fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4.5 20.5
    c0 -4.2 3.4 -6.5 7.5 -6.5 s7.5 2.3 7.5 6.5" fill="none" stroke="currentColor"
    stroke-width="1.8" stroke-linecap="round"/></svg>`,
};

// --------------------------------------------------------------- data shapes
/**
 * A percentage arc with a label inside.
 *
 * Rendered empty and carrying its real value in `data-dash`; `animateRings`
 * fills it in on the next frame so the arc sweeps round rather than appearing.
 * The number counts up the same way. Both land on the true figure, so nothing
 * is lost if the animation is skipped.
 */
export function progressRing(
  percent: number,
  state: string,
  size: "lg" | "sm" = "lg",
): string {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const filled = circumference * Math.max(0, Math.min(1, percent / 100));
  const colour =
    percent >= 100 ? "var(--green)" : percent >= 60 ? "var(--amber)" : "var(--red)";
  return `
    <svg class="ring ring-${size}" viewBox="0 0 132 132" role="img"
         aria-label="${Math.round(percent)} percent, ${state}">
      <circle cx="66" cy="66" r="${radius}" fill="none" stroke="var(--panel-3)"
        stroke-width="9"/>
      <circle class="arc" cx="66" cy="66" r="${radius}" fill="none" stroke="${colour}"
        stroke-width="9" stroke-linecap="round"
        stroke-dasharray="0 ${circumference}" data-dash="${filled} ${circumference}"
        transform="rotate(-90 66 66)"/>
      <text class="pct" x="66" y="64" text-anchor="middle"
        data-count="${Math.round(percent)}" data-suffix="%">0%</text>
      <text class="state" x="66" y="83" text-anchor="middle">${state.toUpperCase()}</text>
    </svg>`;
}

/** A progress bar that grows from empty once it is on screen. */
export function bar(percent: number): string {
  const clamped = Math.max(0, Math.min(100, percent));
  return `<div class="bar"><i style="width:0" data-width="${clamped}"></i></div>`;
}

export function titleCase(value: string): string {
  return value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Two letters for an avatar, from whatever name we were given. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
