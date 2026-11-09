/**
 * A burst for the moments that deserve one: a set where every prescribed rep
 * counted, a phase cleared. Short (about a second), drawn on a throwaway canvas
 * over the page, and gone afterwards -- nothing stays running.
 *
 * Rare on purpose. A burst after every tap is noise; one after a full set is
 * the app noticing.
 */
import { gsap } from "gsap";

const COLOURS = ["#c0f917", "#eef4f8", "#2fbf71", "#c0f917"];

export function celebrate(origin?: HTMLElement): void {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const canvas = document.createElement("canvas");
  canvas.className = "fx-burst";
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  document.body.appendChild(canvas);
  const g = canvas.getContext("2d")!;
  g.scale(dpr, dpr);

  const box = origin?.getBoundingClientRect();
  const ox = box ? box.left + box.width / 2 : innerWidth / 2;
  const oy = box ? box.top + box.height / 2 : innerHeight / 3;

  // A ring of chips flung outward, then pulled down by "gravity" in the tween.
  const bits = Array.from({ length: 90 }, (_, i) => {
    const a = (i / 90) * Math.PI * 2 + Math.random() * 0.3;
    const v = 140 + Math.random() * 220;
    return {
      x: ox,
      y: oy,
      dx: Math.cos(a) * v,
      dy: Math.sin(a) * v - 120,
      r: 2 + Math.random() * 3.5,
      spin: Math.random() * Math.PI,
      colour: COLOURS[i % COLOURS.length]!,
      p: 0,
    };
  });

  const state = { t: 0 };
  gsap.to(state, {
    t: 1,
    duration: 1.15,
    ease: "power2.out",
    onUpdate: () => {
      g.clearRect(0, 0, innerWidth, innerHeight);
      const t = state.t;
      for (const b of bits) {
        const x = b.x + b.dx * t;
        const y = b.y + b.dy * t + 260 * t * t;
        g.globalAlpha = 1 - t;
        g.fillStyle = b.colour;
        g.save();
        g.translate(x, y);
        g.rotate(b.spin + t * 6);
        g.fillRect(-b.r, -b.r / 2, b.r * 2, b.r);
        g.restore();
      }
    },
    onComplete: () => canvas.remove(),
  });


  // And a ring of light expanding from the origin, so the moment has a centre.
  const ring = document.createElement("span");
  ring.className = "fx-ring";
  ring.style.left = `${ox}px`;
  ring.style.top = `${oy}px`;
  document.body.appendChild(ring);
  gsap.fromTo(
    ring,
    { scale: 0.2, opacity: 0.9 },
    { scale: 3.2, opacity: 0, duration: 0.8, ease: "expo.out", onComplete: () => ring.remove() },
  );
  // GSAP's clock pauses with the tab. Never leave a canvas over the page
  // because someone switched apps mid-burst.
  setTimeout(() => {
    canvas.remove();
    ring.remove();
  }, 2500);
}

/**
 * Tilt a card toward the pointer in 3D, like a held object. Only on a device
 * with a real hover pointer: on a phone a card that moves under your thumb
 * reads as a bug, not a flourish.
 */
export function tilt(card: HTMLElement, max = 7): void {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (!matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  // x/y pinned to zero: GSAP reads the card's current transform, and if the
  // screen's entrance animation is mid-flight it would freeze the card wherever
  // that animation had got to.
  gsap.set(card, { transformPerspective: 900, transformStyle: "preserve-3d", x: 0, y: 0 });
  const rx = gsap.quickTo(card, "rotationX", { duration: 0.5, ease: "power3.out" });
  const ry = gsap.quickTo(card, "rotationY", { duration: 0.5, ease: "power3.out" });
  card.addEventListener("pointermove", (e) => {
    const r = card.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    ry(px * max * 2);
    rx(-py * max * 2);
    card.style.setProperty("--shine-x", `${(px + 0.5) * 100}%`);
    card.style.setProperty("--shine-y", `${(py + 0.5) * 100}%`);
  });
  card.addEventListener("pointerleave", () => {
    rx(0);
    ry(0);
  });
}
