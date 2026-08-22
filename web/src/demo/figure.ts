/**
 * A parametric stick figure, so every exercise can demonstrate itself.
 *
 * Filming 21 exercises is not realistic, and borrowed footage would show whatever
 * it shows — which may not be what the app actually grades. This builds the
 * figure from joint angles instead, and the depth it moves to comes from the
 * exercise's own scoring rule, so the demonstration and the marking agree.
 *
 * Model space: +x to the figure's left, +y up, +z the way it faces.
 * Lengths are metres for a roughly 1.75 m person.
 */

export interface Posture {
  /** Tip the whole body: 0 standing, 90 on its back, -90 face down. */
  bodyPitch: number;
  /** Roll the whole body: 90 = lying on one side. */
  bodyRoll: number;

  /** Shank lean from the body's long axis, degrees, positive = knee forward. */
  shankTilt: number;
  /** Thigh lean, degrees, positive = hip travels back from the knee. */
  thighTilt: number;
  /** Trunk lean from the body axis, positive = chest folds toward the knees. */
  trunkTilt: number;
  /** Shoulder flexion, 0 = arms by the side, 90 = straight out in front. */
  armLift: number;
  /** Elbow bend, degrees. */
  armBend: number;

  /** 0 = flat foot, 1 = fully up on the toes. */
  heelRaise: number;
  /** Sideways knee drift toward the midline, degrees. The classic fault. */
  valgus: number;
  /** Working leg swinging away from the midline, degrees. */
  hipAbduct: number;

  /** For single-leg work: how far the free leg trails behind, and its knee bend. */
  freeLegLift: number;
  freeLegKnee: number;
  /** How far back the rear foot is planted, metres. 0 = feet level. */
  splitBack: number;

  stance: "double" | "single" | "split";
}

export const NEUTRAL: Posture = {
  bodyPitch: 0,
  bodyRoll: 0,
  shankTilt: 0,
  thighTilt: 0,
  trunkTilt: 4,
  armLift: 6,
  armBend: 12,
  heelRaise: 0,
  valgus: 0,
  hipAbduct: 0,
  freeLegLift: 0,
  freeLegKnee: 0,
  splitBack: 0,
  stance: "double",
};

const SHANK = 0.44;
const THIGH = 0.44;
const TRUNK = 0.53;
const NECK_LEN = 0.11;
const HEAD_R = 0.105;
const UPPER_ARM = 0.31;
const FOREARM = 0.27;
const SHOULDER_HALF = 0.19;
const HIP_HALF = 0.15;
const FOOT = 0.23;

export type P3 = [number, number, number];

export interface FigurePose {
  head: P3;
  neck: P3;
  midShoulder: P3;
  midHip: P3;
  shoulders: [P3, P3];
  hips: [P3, P3];
  knees: [P3, P3];
  ankles: [P3, P3];
  toes: [P3, P3];
  heels: [P3, P3];
  elbows: [P3, P3];
  wrists: [P3, P3];
}

const rad = (d: number) => (d * Math.PI) / 180;

function rotX([x, y, z]: P3, deg: number): P3 {
  const c = Math.cos(rad(deg));
  const s = Math.sin(rad(deg));
  return [x, y * c - z * s, y * s + z * c];
}

function rotZ([x, y, z]: P3, deg: number): P3 {
  const c = Math.cos(rad(deg));
  const s = Math.sin(rad(deg));
  return [x * c - y * s, x * s + y * c, z];
}

function rotY([x, y, z]: P3, deg: number): P3 {
  const c = Math.cos(rad(deg));
  const s = Math.sin(rad(deg));
  return [x * c + z * s, y, -x * s + z * c];
}

export function buildFigure(p: Posture): FigurePose {
  // Index 0 is the working side — the limb the exercise is about.
  function leg(index: 0 | 1): { hip: P3; knee: P3; ankle: P3; toe: P3; heel: P3 } {
    const across = (index === 0 ? 1 : -1) * HIP_HALF;
    const working = index === 0;
    const idle = !working && p.stance !== "double";

    const back = !working && p.stance === "split" ? p.splitBack : 0;
    const shank = working || p.stance === "double" ? p.shankTilt : p.shankTilt * 0.3;
    const thigh = working || p.stance === "double" ? p.thighTilt : p.thighTilt * 0.3;

    // Foot pivots about the toes, so rising onto them lifts the whole body —
    // which is the entire point of a calf raise.
    const pivot = rad(p.heelRaise * 52);
    const lifted = idle && p.stance === "single" ? 0.16 : 0;

    const toe: P3 = [across, lifted, back + 0.15];
    const heel: P3 = [
      across,
      lifted + FOOT * Math.sin(pivot),
      toe[2] - FOOT * Math.cos(pivot),
    ];
    const ankle: P3 = [across, heel[1] + 0.07, heel[2] + 0.02];

    if (idle && p.stance === "single") {
      // The free leg trails behind with a bent knee rather than standing on air.
      const hipAnchor: P3 = [across, 0, 0];
      const kneeDir = rad(90 + p.freeLegLift);
      const knee: P3 = [
        across,
        hipAnchor[1] - THIGH * Math.cos(rad(p.freeLegLift)),
        hipAnchor[2] - THIGH * Math.sin(rad(p.freeLegLift)),
      ];
      const shin = rad(p.freeLegKnee);
      const freeAnkle: P3 = [
        across,
        knee[1] - SHANK * Math.cos(kneeDir - Math.PI / 2 + shin) * 0.6 - 0.12,
        knee[2] - SHANK * Math.sin(shin) - 0.1,
      ];
      return {
        hip: hipAnchor,
        knee,
        ankle: freeAnkle,
        toe: [across, freeAnkle[1] - 0.04, freeAnkle[2] + 0.14],
        heel: [across, freeAnkle[1] + 0.02, freeAnkle[2] - 0.06],
      };
    }

    const knee: P3 = [
      across - rad(working ? p.valgus : 0) * SHANK * 0.85,
      ankle[1] + SHANK * Math.cos(rad(shank)),
      ankle[2] + SHANK * Math.sin(rad(shank)),
    ];
    const hip: P3 = [
      across,
      knee[1] + THIGH * Math.cos(rad(thigh)),
      knee[2] - THIGH * Math.sin(rad(thigh)),
    ];

    if (working && p.hipAbduct) {
      // Swing the whole leg out from the hip, in the plane across the body.
      const swingOut = (pt: P3): P3 => {
        const dx = pt[0] - hip[0];
        const dy = pt[1] - hip[1];
        const c = Math.cos(rad(p.hipAbduct));
        const s = Math.sin(rad(p.hipAbduct));
        return [hip[0] + dx * c - dy * s, hip[1] + dx * s + dy * c, pt[2]];
      };
      return {
        hip,
        knee: swingOut(knee),
        ankle: swingOut(ankle),
        toe: swingOut(toe),
        heel: swingOut(heel),
      };
    }
    return { hip, knee, ankle, toe, heel };
  }

  const right = leg(0);
  const left = leg(1);

  // The pelvis sits on the planted leg, so a single-leg pose does not float.
  const planted = p.stance === "double" ? [right.hip, left.hip] : [right.hip];
  const midHip: P3 = [
    0,
    planted.reduce((a, h) => a + h[1], 0) / planted.length,
    planted.reduce((a, h) => a + h[2], 0) / planted.length,
  ];
  if (p.stance !== "double") left.hip = [-HIP_HALF, midHip[1], midHip[2]];
  if (p.stance !== "double") right.hip = [HIP_HALF, midHip[1], midHip[2]];

  const midShoulder: P3 = [
    0,
    midHip[1] + TRUNK * Math.cos(rad(p.trunkTilt)),
    midHip[2] + TRUNK * Math.sin(rad(p.trunkTilt)),
  ];
  const neck: P3 = [
    0,
    midShoulder[1] + NECK_LEN * Math.cos(rad(p.trunkTilt * 0.35)),
    midShoulder[2] + NECK_LEN * Math.sin(rad(p.trunkTilt * 0.35)),
  ];
  const head: P3 = [
    0,
    neck[1] + HEAD_R * Math.cos(rad(p.trunkTilt * 0.2)),
    neck[2] + HEAD_R * Math.sin(rad(p.trunkTilt * 0.2)),
  ];

  const shoulders: [P3, P3] = [
    [SHOULDER_HALF, midShoulder[1], midShoulder[2]],
    [-SHOULDER_HALF, midShoulder[1], midShoulder[2]],
  ];

  const swing = rad(p.armLift + p.trunkTilt * 0.35);
  const arm = (shoulder: P3): { elbow: P3; wrist: P3 } => {
    const elbow: P3 = [
      shoulder[0],
      shoulder[1] - UPPER_ARM * Math.cos(swing),
      shoulder[2] + UPPER_ARM * Math.sin(swing),
    ];
    const bend = swing + rad(p.armBend);
    const wrist: P3 = [
      elbow[0],
      elbow[1] - FOREARM * Math.cos(bend),
      elbow[2] + FOREARM * Math.sin(bend),
    ];
    return { elbow, wrist };
  };
  const ra = arm(shoulders[0]);
  const la = arm(shoulders[1]);

  const pose: FigurePose = {
    head,
    neck,
    midShoulder,
    midHip,
    shoulders,
    hips: [right.hip, left.hip],
    knees: [right.knee, left.knee],
    ankles: [right.ankle, left.ankle],
    toes: [right.toe, left.toe],
    heels: [right.heel, left.heel],
    elbows: [ra.elbow, la.elbow],
    wrists: [ra.wrist, la.wrist],
  };

  // Tip and roll the finished body. Doing it here rather than in the projection
  // keeps the camera free to pick an angle that separates the limbs — flattening
  // the body onto one axis is what made an earlier version draw a tangle of lines.
  if (p.bodyRoll || p.bodyPitch) {
    for (const key of Object.keys(pose) as (keyof FigurePose)[]) {
      const value = pose[key];
      const turn = (pt: P3): P3 => rotX(rotZ(pt, p.bodyRoll), p.bodyPitch);
      if (Array.isArray(value[0])) {
        const pair = value as [P3, P3];
        (pose[key] as [P3, P3]) = [turn(pair[0]), turn(pair[1])];
      } else {
        (pose[key] as P3) = turn(value as P3);
      }
    }
  }
  return pose;
}

/**
 * Orthographic camera. `yaw` turns around the figure, `pitch` raises the
 * viewpoint. Both matter: a movement that happens toward the lens is invisible
 * head-on, and a body lying on the floor needs a raised angle or its left and
 * right limbs land on exactly the same pixels.
 */
export function project(
  point: P3,
  yaw: number,
  pitch: number,
  scale: number,
  originX: number,
  originY: number,
): [number, number] {
  const [x, y] = rotX(rotY(point, yaw), pitch);
  return [originX + x * scale, originY - y * scale];
}

export function bones(f: FigurePose): [P3, P3][] {
  return [
    [f.head, f.neck],
    [f.neck, f.midShoulder],
    [f.shoulders[0], f.shoulders[1]],
    [f.midShoulder, f.midHip],
    [f.hips[0], f.hips[1]],
    [f.shoulders[0], f.elbows[0]],
    [f.elbows[0], f.wrists[0]],
    [f.shoulders[1], f.elbows[1]],
    [f.elbows[1], f.wrists[1]],
    [f.hips[0], f.knees[0]],
    [f.knees[0], f.ankles[0]],
    [f.ankles[0], f.heels[0]],
    [f.heels[0], f.toes[0]],
    [f.hips[1], f.knees[1]],
    [f.knees[1], f.ankles[1]],
    [f.ankles[1], f.heels[1]],
    [f.heels[1], f.toes[1]],
  ];
}

export function joints(f: FigurePose): P3[] {
  return [
    f.neck,
    ...f.shoulders,
    ...f.elbows,
    ...f.wrists,
    ...f.hips,
    ...f.knees,
    ...f.ankles,
  ];
}

export const HEAD_RADIUS = HEAD_R;

/**
 * Floor exercises, placed joint by joint.
 *
 * The chain above builds upward from a planted foot, which is exactly right
 * standing up and nonsense lying down — a glute bridge lifts the hips while the
 * shoulders and feet stay put, so nothing is anchored where the chain assumes.
 * Rather than bend that model out of shape, these poses are authored directly in
 * the side-on plane: `[along, up]`, where `along` runs head-to-toe and `up` is
 * height off the floor. Both in metres.
 */
export interface FlatPose {
  head: [number, number];
  shoulder: [number, number];
  elbow: [number, number];
  wrist: [number, number];
  hip: [number, number];
  knee: [number, number];
  ankle: [number, number];
  toe: [number, number];
  /** The upper limb pair, when it does something different (a lifted top leg). */
  knee2?: [number, number];
  ankle2?: [number, number];
  toe2?: [number, number];
}

/** Turn a side-on layout into a full figure, spreading the limb pairs apart.
 *
 * The body runs along the screen's x axis and the near/far limbs are separated
 * in depth. Putting the body length in depth instead squashes it by the camera's
 * sine — an earlier version lost two thirds of the body that way. */
export function flatFigure(p: FlatPose): FigurePose {
  const at = ([along, up]: [number, number], side: number, spread: number): P3 => [
    along,
    up,
    side * spread,
  ];
  const near = HIP_HALF * 0.75;
  const neck: [number, number] = [
    (p.head[0] + p.shoulder[0]) / 2,
    (p.head[1] + p.shoulder[1]) / 2,
  ];
  return {
    head: at(p.head, 0, 0),
    neck: at(neck, 0, 0),
    midShoulder: at(p.shoulder, 0, 0),
    midHip: at(p.hip, 0, 0),
    shoulders: [at(p.shoulder, 1, SHOULDER_HALF), at(p.shoulder, -1, SHOULDER_HALF)],
    hips: [at(p.hip, 1, near), at(p.hip, -1, near)],
    knees: [at(p.knee, 1, near), at(p.knee2 ?? p.knee, -1, near)],
    ankles: [at(p.ankle, 1, near), at(p.ankle2 ?? p.ankle, -1, near)],
    toes: [at(p.toe, 1, near), at(p.toe2 ?? p.toe, -1, near)],
    heels: [
      at([p.ankle[0] - 0.05, p.ankle[1]], 1, near),
      at([(p.ankle2 ?? p.ankle)[0] - 0.05, (p.ankle2 ?? p.ankle)[1]], -1, near),
    ],
    elbows: [at(p.elbow, 1, SHOULDER_HALF), at(p.elbow, -1, SHOULDER_HALF)],
    wrists: [at(p.wrist, 1, SHOULDER_HALF), at(p.wrist, -1, SHOULDER_HALF)],
  };
}

export function lerpFlat(a: FlatPose, b: FlatPose, t: number): FlatPose {
  const mix = (
    x: [number, number] | undefined,
    y: [number, number] | undefined,
  ): [number, number] | undefined =>
    x && y ? [x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t] : (y ?? x);
  return {
    head: mix(a.head, b.head)!,
    shoulder: mix(a.shoulder, b.shoulder)!,
    elbow: mix(a.elbow, b.elbow)!,
    wrist: mix(a.wrist, b.wrist)!,
    hip: mix(a.hip, b.hip)!,
    knee: mix(a.knee, b.knee)!,
    ankle: mix(a.ankle, b.ankle)!,
    toe: mix(a.toe, b.toe)!,
    knee2: mix(a.knee2, b.knee2),
    ankle2: mix(a.ankle2, b.ankle2),
    toe2: mix(a.toe2, b.toe2),
  };
}
