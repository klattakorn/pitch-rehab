/**
 * Small motion helpers, shared by every screen.
 *
 * Two rules hold everywhere in here:
 *
 * 1. Motion never gates information. Every animation starts from a state that
 *    is already readable and ends at the truth, so a frame drop or a disabled
 *    animation costs polish, never meaning.
 * 2. `prefers-reduced-motion` is honoured in JavaScript as well as CSS. The CSS
 *    file switches the keyframes off; these helpers jump straight to the final
 *    value instead of animating toward it.
 */

/**
 * Apply a value on a later frame, so a CSS transition has two states to move
 * between -- setting both in one go collapses them into a single style
 * resolution and nothing animates.
 *
 * Skipped entirely when there is nothing to watch. A background tab never runs
 * `requestAnimationFrame`, so a bar queued there would sit at zero; applying
 * the value straight away means the screen is already correct when the player
 * comes back to it.
 */
function onNextFrame(apply: () => void): void {
  if (reduceMotion() || (typeof document !== "undefined" && document.hidden)) {
    apply();
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(apply));
}

/** True when the viewer has asked their system to keep animation to a minimum. */
export function reduceMotion(): boolean {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Give each child an `--i` index so CSS can fan their entrances out in time.
 *
 * The delay lives in CSS rather than here because a list of 40 exit criteria
 * would otherwise take two seconds to finish arriving; the stylesheet caps it.
 */
export function stagger(nodes: Iterable<Element>): void {
  let index = 0;
  for (const node of nodes) {
    (node as HTMLElement).style.setProperty("--i", String(index));
    node.classList.add("stagger-in");
    index += 1;
  }
}

const STAGGERED = [
  ".grid > *",
  ".dash > *",
  ".tiles > *",
  ".role-grid > *",
  ".role-changes > li",
  "ul.criteria > li",
  ".reps .row",
].join(", ");

/**
 * Prepare a freshly rendered screen: fan the children in, then run whatever
 * the screen asked to be animated.
 *
 * `shell()` calls this once per render, so individual screens never have to
 * remember to. Anything carrying `data-count`, `data-width` or `data-dash` is
 * picked up automatically.
 */
export function enterScreen(root: ParentNode): void {
  stagger(root.querySelectorAll(STAGGERED));
  animateCounters(root);
  animateBars(root);
  animateRings(root);
}

/**
 * Ease a number from 0 up to its final value.
 *
 * Only the digits move; the element's text is set to the real value the moment
 * the animation ends, and immediately when motion is reduced.
 */
export function countUp(el: HTMLElement, to: number, suffix = "", decimals = 0): void {
  const render = (value: number): void => {
    el.textContent = value.toFixed(decimals) + suffix;
  };
  const hidden = typeof document !== "undefined" && document.hidden;
  if (reduceMotion() || hidden || to === 0) return render(to);

  // Long counts feel sluggish and short ones feel broken, so the duration grows
  // with the number but flattens out quickly.
  const duration = Math.min(900, 380 + Math.abs(to) * 4);
  const start = performance.now();
  const step = (now: number): void => {
    const t = Math.min(1, (now - start) / duration);
    // easeOutExpo: fast off the mark, settles gently on the real figure.
    const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
    render(to * eased);
    if (t < 1) requestAnimationFrame(step);
    else render(to);
  };
  requestAnimationFrame(step);
}

/** Run `countUp` for anything marked `data-count` in the tree. */
export function animateCounters(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>("[data-count]").forEach((el) => {
    const to = Number(el.dataset["count"]);
    if (!Number.isFinite(to)) return;
    countUp(el, to, el.dataset["suffix"] ?? "", Number(el.dataset["decimals"] ?? 0));
  });
}

/**
 * Grow progress bars from empty.
 *
 * Rendered at zero width, then set to the real value a frame later so the CSS
 * transition has something to move between.
 */
export function animateBars(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>("[data-width]").forEach((el) => {
    const width = `${el.dataset["width"]}%`;
    onNextFrame(() => (el.style.width = width));
  });
}

/** Sweep the progress ring round to its real percentage. */
export function animateRings(root: ParentNode): void {
  root.querySelectorAll<SVGCircleElement>("[data-dash]").forEach((el) => {
    const dash = el.dataset["dash"]!;
    onNextFrame(() => el.setAttribute("stroke-dasharray", dash));
  });
}

/**
 * Replay a CSS animation on an element that is already on screen.
 *
 * Re-adding a class does nothing on its own -- the browser only restarts an
 * animation if the class was absent at a style recalculation in between, which
 * is what reading `offsetWidth` forces.
 */
export function pulse(el: HTMLElement, className: string): void {
  if (reduceMotion()) return;
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
}
