/**
 * Joint angles and body measurements, mirroring app/services/pose/geometry.py.
 *
 * These two files must agree. The phone shows the player a number live; the
 * server later re-derives the same number to decide whether they can go back on
 * a pitch. If they disagree, the app is lying to someone.
 */
import { LANDMARK_COUNT, LM, type Side, sided } from "./landmarks";

export type Vec3 = [number, number, number];

const EPS = 1e-9;
/** MediaPipe grows y downwards, so "up" is -y. */
const UP: Vec3 = [0, -1, 0];

export interface RawLandmark {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

export class Frame {
  readonly t: number;
  readonly xyz: Float64Array; // 33 * 3
  readonly vis: Float64Array; // 33
  readonly aspect: number;

  private constructor(t: number, xyz: Float64Array, vis: Float64Array, aspect: number) {
    this.t = t;
    this.xyz = xyz;
    this.vis = vis;
    this.aspect = aspect;
  }

  /**
   * `aspect` is the video's width / height, and it is not optional in spirit.
   * MediaPipe divides x by the width and y by the height separately, so on a
   * 1080x1920 phone video one x unit is a much shorter distance than one y unit.
   * Skipping this made knee flexion read 21 degrees too high on real footage.
   */
  static from(
    t: number,
    landmarks: readonly RawLandmark[],
    aspect = 1.0,
    space: "image" | "world" = "image",
  ): Frame {
    if (landmarks.length < LANDMARK_COUNT) {
      throw new Error(`expected ${LANDMARK_COUNT} landmarks, got ${landmarks.length}`);
    }
    const xyz = new Float64Array(LANDMARK_COUNT * 3);
    const vis = new Float64Array(LANDMARK_COUNT);
    const scale = space === "image" ? aspect : 1.0;
    for (let i = 0; i < LANDMARK_COUNT; i++) {
      const lm = landmarks[i]!;
      xyz[i * 3] = lm.x * scale;
      xyz[i * 3 + 1] = lm.y;
      xyz[i * 3 + 2] = (lm.z ?? 0) * scale;
      vis[i] = lm.visibility ?? 1.0;
    }
    return new Frame(t, xyz, vis, aspect);
  }

  point(index: number, useZ = false): Vec3 {
    const o = index * 3;
    return [this.xyz[o]!, this.xyz[o + 1]!, useZ ? this.xyz[o + 2]! : 0];
  }

  /** Normalised x, undoing the aspect scaling — for drawing on a canvas. */
  screenX(index: number): number {
    return this.xyz[index * 3]! / (this.aspect || 1);
  }

  screenY(index: number): number {
    return this.xyz[index * 3 + 1]!;
  }

  confidence(index: number): number {
    return this.vis[index]!;
  }

  quality(indices: readonly number[]): number {
    if (indices.length === 0) return 1;
    let total = 0;
    for (const i of indices) total += this.vis[i]!;
    return total / indices.length;
  }

  /** Serialise for upload. Undoes the aspect scaling so the server can redo it. */
  toPayload(): { t: number; landmarks: RawLandmark[] } {
    const out: RawLandmark[] = [];
    for (let i = 0; i < LANDMARK_COUNT; i++) {
      out.push({
        x: this.screenX(i),
        y: this.xyz[i * 3 + 1]!,
        z: this.xyz[i * 3 + 2]! / (this.aspect || 1),
        visibility: this.vis[i]!,
      });
    }
    return { t: this.t, landmarks: out };
  }
}

// ---------------------------------------------------------------- primitives
function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function norm(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

export function angleBetween(v1: Vec3, v2: Vec3): number {
  const n1 = norm(v1);
  const n2 = norm(v2);
  if (n1 < EPS || n2 < EPS) return NaN;
  const dot = v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2];
  return (Math.acos(Math.max(-1, Math.min(1, dot / (n1 * n2)))) * 180) / Math.PI;
}

export function jointAngle(f: Frame, a: number, b: number, c: number, useZ = false): number {
  const pb = f.point(b, useZ);
  return angleBetween(sub(f.point(a, useZ), pb), sub(f.point(c, useZ), pb));
}

function midpoint(f: Frame, a: number, b: number, useZ = false): Vec3 {
  const pa = f.point(a, useZ);
  const pb = f.point(b, useZ);
  return [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2];
}

/** Horizontal offset of a point from the start->end line, at the point's height. */
function signedLineDeviation(point: Vec3, start: Vec3, end: Vec3): number {
  const dy = end[1] - start[1];
  if (Math.abs(dy) < EPS) return NaN;
  const ratio = (point[1] - start[1]) / dy;
  return point[0] - (start[0] + ratio * (end[0] - start[0]));
}

// ------------------------------------------------------------------ metrics
export type Metrics = Record<string, number>;

/**
 * Every per-frame measurement for one limb. Angles use clinical conventions:
 * 0 = anatomical neutral, larger = more bend. `knee_valgus` is signed, positive
 * meaning the knee is collapsing inward.
 */
export function computeMetrics(f: Frame, side: Side, useZ = false): Metrics {
  if (side === "bilateral") throw new Error("computeMetrics needs a concrete side");
  const out: Metrics = {};
  const put = (name: string, value: number) => {
    if (Number.isFinite(value)) out[name] = Math.round(value * 1000) / 1000;
  };

  const hip = sided("hip", side);
  const knee = sided("knee", side);
  const ankle = sided("ankle", side);
  const shoulder = sided("shoulder", side);
  const heel = sided("heel", side);
  const toe = sided("foot_index", side);
  const elbow = sided("elbow", side);
  const wrist = sided("wrist", side);

  const midHip = midpoint(f, LM.LEFT_HIP, LM.RIGHT_HIP, useZ);
  const midShoulder = midpoint(f, LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, useZ);

  const kneeFlexion = 180 - jointAngle(f, hip, knee, ankle, useZ);
  const hipFlexion = 180 - jointAngle(f, shoulder, hip, knee, useZ);
  put("knee_flexion", kneeFlexion);
  put("hip_flexion", hipFlexion);
  // Mirrored so rep detection always has a rising trace to latch onto.
  put("knee_extension", -kneeFlexion);
  put("hip_extension", -hipFlexion);
  put("ankle_dorsiflexion", 90 - jointAngle(f, knee, ankle, toe, useZ));

  const trunk = sub(midShoulder, midHip);
  put("trunk_lean", angleBetween(trunk, UP));
  if (Math.abs(trunk[1]) > EPS) {
    put("trunk_lean_signed", (Math.atan2(trunk[0], -trunk[1]) * 180) / Math.PI);
  }

  const lh = f.point(LM.LEFT_HIP, useZ);
  const rh = f.point(LM.RIGHT_HIP, useZ);
  const hipWidth = norm(sub(rh, lh));
  if (hipWidth > EPS) {
    const tilt = (Math.atan2(rh[1] - lh[1], rh[0] - lh[0]) * 180) / Math.PI;
    put("pelvic_drop", side === "left" ? tilt : -tilt);
  }

  const ls = f.point(LM.LEFT_SHOULDER, useZ);
  const rs = f.point(LM.RIGHT_SHOULDER, useZ);
  if (norm(sub(rs, ls)) > EPS) {
    const tilt = (Math.atan2(rs[1] - ls[1], rs[0] - ls[0]) * 180) / Math.PI;
    put("shoulder_tilt", side === "left" ? tilt : -tilt);
  }

  // Valgus is measured purely across the body, never as a 3-point angle: in a 2D
  // projection that angle is just knee flexion in disguise. Needs a front view.
  const pHip = f.point(hip, false);
  const pKnee = f.point(knee, false);
  const pAnkle = f.point(ankle, false);
  const dev = signedLineDeviation(pKnee, pHip, pAnkle);
  const legLen2d = norm(sub(pAnkle, pHip));
  if (Number.isFinite(dev) && legLen2d > EPS) {
    const ratio = dev / legLen2d;
    // A knee cannot sit a whole leg-length off the line. If it saturates, the
    // camera is in the wrong plane — say nothing rather than sound certain.
    if (Math.abs(ratio) < 0.95) {
      const towardMidline = midHip[0] - pKnee[0] >= 0 ? 1 : -1;
      put("knee_valgus", ((Math.asin(ratio) * 180) / Math.PI) * towardMidline);
    }
  }

  const legLen = norm(sub(f.point(ankle, useZ), f.point(hip, useZ)));
  if (legLen > EPS) {
    const sag = useZ ? 2 : 0;
    put("knee_over_toe_ratio", (f.point(knee, useZ)[sag]! - f.point(ankle, useZ)[sag]!) / legLen);
    put("weight_shift_ratio", (midHip[0] - pAnkle[0]) / legLen);
    put("pelvis_height_ratio", (pAnkle[1] - midHip[1]) / legLen);
    put("leg_length", legLen);
  }

  const la = f.point(LM.LEFT_ANKLE, useZ);
  const ra = f.point(LM.RIGHT_ANKLE, useZ);
  if (hipWidth > EPS) put("stance_width_ratio", Math.abs(ra[0] - la[0]) / hipWidth);

  const pHeel = f.point(heel, useZ);
  const pToe = f.point(toe, useZ);
  const footLen = norm(sub(pToe, pHeel));
  if (footLen > EPS) put("heel_raise_ratio", (pToe[1] - pHeel[1]) / footLen);

  put("elbow_flexion", 180 - jointAngle(f, shoulder, elbow, wrist, useZ));
  put(
    "shoulder_abduction",
    angleBetween(sub(f.point(elbow, useZ), f.point(shoulder, useZ)), [0, 1, 0]),
  );

  return out;
}

// ---------------------------------------------------------- sanity measures
export const SIDE_VIEW_BELOW = 0.35;
export const FRONT_VIEW_ABOVE = 0.5;

/** Shoulder + hip width over torso height. High = facing the camera. */
export function openness(f: Frame): number | null {
  const ls = f.point(LM.LEFT_SHOULDER);
  const rs = f.point(LM.RIGHT_SHOULDER);
  const lh = f.point(LM.LEFT_HIP);
  const rh = f.point(LM.RIGHT_HIP);
  const midS: Vec3 = [(ls[0] + rs[0]) / 2, (ls[1] + rs[1]) / 2, 0];
  const midH: Vec3 = [(lh[0] + rh[0]) / 2, (lh[1] + rh[1]) / 2, 0];
  const torso = norm(sub(midS, midH));
  if (torso < EPS) return null;
  return (norm(sub(rs, ls)) + norm(sub(rh, lh))) / (2 * torso);
}

export type CameraView = "front" | "side" | "unknown";

export function classifyView(score: number | null): CameraView {
  if (score === null) return "unknown";
  if (score < SIDE_VIEW_BELOW) return "side";
  if (score > FRONT_VIEW_ABOVE) return "front";
  return "unknown";
}

const BODY_EXTENT = [
  LM.NOSE,
  LM.LEFT_SHOULDER,
  LM.RIGHT_SHOULDER,
  LM.LEFT_HIP,
  LM.RIGHT_HIP,
  LM.LEFT_KNEE,
  LM.RIGHT_KNEE,
  LM.LEFT_ANKLE,
  LM.RIGHT_ANKLE,
];

/** Diagonal of the box the player occupies — a stable measure of apparent size. */
export function bodyScale(f: Frame, minVisibility = 0.3): number | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let seen = 0;
  for (const lm of BODY_EXTENT) {
    if (f.confidence(lm) < minVisibility) continue;
    const [x, y] = f.point(lm);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    seen++;
  }
  if (seen < 4) return null;
  return Math.hypot(maxX - minX, maxY - minY);
}

/** Unit vector from hips to shoulders, in the image plane. */
export function torsoDirection(f: Frame): [number, number] | null {
  const midS = midpoint(f, LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER);
  const midH = midpoint(f, LM.LEFT_HIP, LM.RIGHT_HIP);
  const dx = midS[0] - midH[0];
  const dy = midS[1] - midH[1];
  const len = Math.hypot(dx, dy);
  return len < EPS ? null : [dx / len, dy / len];
}

/** Is the whole player inside the picture, with a little room to spare? */
export function fullyInFrame(f: Frame, margin = 0.02): boolean {
  for (const lm of BODY_EXTENT) {
    if (f.confidence(lm) < 0.3) continue;
    const x = f.screenX(lm);
    const y = f.screenY(lm);
    if (x < margin || x > 1 - margin || y < margin || y > 1 - margin) return false;
  }
  return true;
}

// -------------------------------------------------------------- aggregation
export type AggregateHow =
  | "peak"
  | "max"
  | "min"
  | "mean"
  | "median"
  | "range"
  | "abs_max"
  | "first"
  | "last";

export function aggregate(values: readonly (number | null)[], how: AggregateHow): number | null {
  const clean = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (clean.length === 0) return null;
  switch (how) {
    case "peak":
    case "max":
      return Math.max(...clean);
    case "min":
      return Math.min(...clean);
    case "mean":
      return clean.reduce((a, b) => a + b, 0) / clean.length;
    case "median": {
      const sorted = [...clean].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
    }
    case "range":
      return Math.max(...clean) - Math.min(...clean);
    case "abs_max":
      return Math.max(...clean.map(Math.abs));
    case "first":
      return clean[0]!;
    case "last":
      return clean[clean.length - 1]!;
  }
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return NaN;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
