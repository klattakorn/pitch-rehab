/** Shared bits of chrome: the mark, the shell, and the pass/fail ring. */

export const BRAND_MARK = `
  <svg class="mark" viewBox="0 0 32 32" aria-hidden="true">
    <path d="M6 26 L18 6 h8 L14 26 Z" fill="#7ac943" />
    <path d="M6 6 h9 l-4 7 H6 Z" fill="#7ac943" opacity="0.55" />
  </svg>`;

export const TICK = `
  <svg class="mark" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="10" fill="none" stroke="#7ac943" stroke-width="2"/>
    <path d="M7.5 12.4 l3 3 l6-6.5" fill="none" stroke="#7ac943" stroke-width="2.2"
      stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;

export const CROSS = `
  <svg class="mark" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="10" fill="none" stroke="#ff5f52" stroke-width="2"/>
    <path d="M8.6 8.6 l6.8 6.8 M15.4 8.6 l-6.8 6.8" stroke="#ff5f52" stroke-width="2.2"
      stroke-linecap="round"/>
  </svg>`;

export const DASH = `
  <svg class="mark" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="10" fill="none" stroke="#8c9a91" stroke-width="2"
      stroke-dasharray="3 3"/>
  </svg>`;

/** The result ring: a percentage arc with a verdict underneath.
 *
 * Rendered empty and carrying its real value in `data-dash`; `animateRings`
 * fills it in on the next frame so the arc sweeps round rather than appearing.
 * The percentage underneath counts up from zero the same way. Both land on the
 * true figure, so nothing is lost if the animation is skipped. */
export function progressRing(percent: number, state: string): string {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const filled = circumference * Math.max(0, Math.min(1, percent / 100));
  const colour = percent >= 100 ? "#7ac943" : percent >= 60 ? "#ffb020" : "#ff5f52";
  return `
    <svg class="ring" viewBox="0 0 132 132" role="img"
         aria-label="${Math.round(percent)} percent, ${state}">
      <circle cx="66" cy="66" r="${radius}" fill="none" stroke="#2a2f30" stroke-width="10"/>
      <circle class="arc" cx="66" cy="66" r="${radius}" fill="none" stroke="${colour}"
        stroke-width="10" stroke-linecap="round"
        stroke-dasharray="0 ${circumference}" data-dash="${filled} ${circumference}"
        transform="rotate(-90 66 66)"/>
      <text class="pct" x="66" y="64" text-anchor="middle"
        data-count="${Math.round(percent)}" data-suffix="%">0%</text>
      <text class="state" x="66" y="82" text-anchor="middle">${state.toUpperCase()}</text>
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

/** Marks anything measured by the camera rather than typed in or synced. */
export const CAMERA_ICON = `
  <svg viewBox="0 0 24 24" class="cam-icon" aria-hidden="true">
    <rect x="2.5" y="6.5" width="15" height="11" rx="2.5" fill="none"
      stroke="currentColor" stroke-width="1.8"/>
    <path d="M17.5 11 L21.5 8.4 v7.2 L17.5 13 Z" fill="none" stroke="currentColor"
      stroke-width="1.8" stroke-linejoin="round"/>
    <circle cx="10" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="1.8"/>
  </svg>`;
