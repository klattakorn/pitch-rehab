/**
 * Where the camera stands: on the floor, or at hip height.
 *
 * Three exercises were tuned on footage with the phone stood up on the floor
 * (the glute bridge, the calf raise and pogo hops); everything else at hip
 * height. Presenting from a laptop, the camera cannot go on the floor, and
 * those three were then detected less well. This is the player's choice of
 * where the camera is, and the rule is adjusted to match.
 *
 * What changes at hip height, for the floor-tuned three. A laptop or phone
 * propped up about 0.75-0.9 m off the floor, 2-3 m away, looks down at the
 * feet and the floor at roughly 20-25 degrees, so:
 *
 *  - lying side-on, the two shoulders and hips, one behind the other on the
 *    floor, now sit one above the other in the picture, so the body reads less
 *    side-on than it is (shoulder width x sin 20-27 deg): 0.24-0.30 at 2-1.5 m
 *    against a "side view" line of 0.35, which noise pushes over. The glute
 *    bridge was refused as "wrong camera view". The line moves out for it;
 *  - up-and-down movement shrinks by about cos(20-25 deg), 7-10%. That does
 *    NOT move the count lines: real reps clear them by far more (calf raises
 *    peak 0.40-0.48 against 0.17, hops 18-41 against 12), and lowering the
 *    calf raise's line let a 0.19 wobble on the floor clip count as a sixth
 *    rep of five. It does move the one form line that sits close to honest
 *    reps: "get up higher" on the calf raise (0.35; good raises 0.38-0.48).
 *
 * Worked out from the geometry, not from footage at that height: there is
 * none yet. Every floor recording counts exactly the same with these.
 */
import type { ExerciseRule } from "./rules";

export type CameraSpot = "floor" | "hip";

/** The exercises tuned on floor footage. Every other one was tuned at hip height. */
const FLOOR_TUNED = new Set(["glute_bridge", "double_leg_calf_raise", "pogo_hops"]);

/** Where the exercise was tuned, and so where it works best. */
export function tunedSpot(key: string): CameraSpot {
  return FLOOR_TUNED.has(key) ? "floor" : "hip";
}

const STORAGE_KEY = "rtp.cameraSpot";

/** The player's choice, once made; until then, where the exercise was tuned. */
export function getSpot(key: string): CameraSpot {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "floor" || saved === "hip") return saved;
  } catch {
    // Private mode, or storage blocked: fall through to the default.
  }
  return tunedSpot(key);
}

/** Remembered for every exercise: it is where this device's camera is. */
export function setSpot(spot: CameraSpot): void {
  try {
    localStorage.setItem(STORAGE_KEY, spot);
  } catch {
    // Not remembered, but still used for this set.
  }
}

/**
 * The rule as it should run with the camera at `spot`. Unchanged unless a
 * floor-tuned exercise is filmed from hip height. Never mutates `rule`.
 */
export function adjustRule(rule: ExerciseRule, key: string, spot: CameraSpot): ExerciseRule {
  if (spot !== "hip" || !FLOOR_TUNED.has(key)) return rule;
  const out: ExerciseRule = structuredClone(rule);
  if (key === "glute_bridge") {
    // Front-on reads 0.5 and up, so 0.45 still tells the two apart.
    out.side_view_below = 0.45;
  } else if (key === "double_leg_calf_raise") {
    for (const t of out.targets) {
      // A full raise, foreshortened ~8%: 0.38 on the lite model becomes 0.35.
      if (t.metric === "heel_raise_ratio" && t.min !== null) t.min = 0.32;
    }
  }
  // pogo_hops: nothing to change -- only where to put the camera.
  return out;
}
