/**
 * How each exercise demonstrates itself.
 *
 * An earlier version tried to derive the whole movement generically from the
 * rule. It produced a recognisable squat and a tangle of lines for everything
 * else, and several exercises showed an identical "mistake". So the posture is
 * authored per exercise here — but the *depth* still comes from the rule's own
 * threshold wherever the movement has one, so the figure goes exactly as far as
 * the app will require. Change the number in app/data/exercises.py and the
 * demonstration follows it.
 */
import {
  type FigurePose,
  type FlatPose,
  NEUTRAL,
  type Posture,
  buildFigure,
  flatFigure,
  lerpFlat,
} from "./figure";
import type { ExerciseRule, MetricTarget } from "../pose/rules";

export interface Camera {
  yaw: number;
  pitch: number;
}

interface Choreo {
  camera: Camera;
  /** Applies to every frame. */
  base?: Partial<Posture>;
  start: Partial<Posture>;
  finish: Partial<Posture>;
  /** Overrides applied to `finish` when showing the mistake. Never null. */
  mistake: Partial<Posture>;
  /**
   * Which posture field the rule's own threshold drives, if any. `split` shares
   * a knee angle between shank and thigh the way a real squat does.
   */
  drive?: { metric: string; apply: (deg: number) => Partial<Posture> };
}

const STAND: Camera = { yaw: 27, pitch: 7 };
/** Floor poses are authored side-on with the body across the screen, so the
 *  camera only needs a slight turn to separate the near and far limbs. */
const FLOOR_CAMERA: Camera = { yaw: 18, pitch: 32 };

/** A squat-like knee bend, shared between shank and thigh as a real one is. */
const kneeBend = (deg: number): Partial<Posture> => ({
  shankTilt: deg * 0.42,
  thighTilt: -deg * 0.58,
});

/** Floor exercises, laid out side-on: [along the body, height off the floor]. */
const FLOOR: Record<string, { start: FlatPose; finish: FlatPose; mistake: FlatPose }> = {
  isometric_quad_set: (() => {
    const lying = (kneeUp: number, kneeAlong: number): FlatPose => ({
      head: [-0.28, 0.14],
      shoulder: [0, 0.13],
      elbow: [0.24, 0.08],
      wrist: [0.46, 0.07],
      hip: [0.54, 0.13],
      knee: [0.54 + kneeAlong, kneeUp],
      ankle: [1.38, 0.07],
      toe: [1.5, 0.12],
    });
    return {
      start: lying(0.22, 0.36),
      finish: lying(0.1, 0.42),
      mistake: lying(0.3, 0.3),
    };
  })(),

  glute_bridge: (() => {
    const bridge = (hipUp: number): FlatPose => ({
      head: [-0.28, 0.12],
      shoulder: [0, 0.12],
      elbow: [0.24, 0.07],
      wrist: [0.46, 0.06],
      hip: [0.56, hipUp],
      knee: [0.88, 0.46],
      ankle: [0.86, 0.07],
      toe: [0.99, 0.05],
    });
    return { start: bridge(0.12), finish: bridge(0.42), mistake: bridge(0.24) };
  })(),

  heel_slide: (() => {
    const slide = (heelAlong: number, kneeUp: number): FlatPose => ({
      head: [-0.28, 0.14],
      shoulder: [0, 0.13],
      elbow: [0.24, 0.08],
      wrist: [0.46, 0.07],
      hip: [0.54, 0.13],
      knee: [0.54 + (1.38 - heelAlong) * 0.45, kneeUp],
      ankle: [heelAlong, 0.07],
      toe: [heelAlong + 0.13, 0.12],
    });
    return { start: slide(1.38, 0.18), finish: slide(0.82, 0.5), mistake: slide(1.14, 0.32) };
  })(),

  prone_hamstring_curl: (() => {
    const curl = (ankleAlong: number, ankleUp: number, hipUp: number): FlatPose => ({
      head: [-0.3, 0.13],
      shoulder: [0, 0.11],
      elbow: [0.2, 0.16],
      wrist: [0.4, 0.09],
      hip: [0.56, hipUp],
      knee: [0.94, 0.09],
      ankle: [ankleAlong, ankleUp],
      toe: [ankleAlong + 0.06, ankleUp + 0.12],
    });
    return {
      start: curl(1.36, 0.08, 0.1),
      finish: curl(0.98, 0.5, 0.1),
      mistake: curl(1.0, 0.48, 0.34),
    };
  })(),

  side_lying_hip_abduction: (() => {
    const lift = (topKneeUp: number, topAnkleUp: number): FlatPose => ({
      head: [-0.3, 0.16],
      shoulder: [0, 0.14],
      elbow: [0.22, 0.1],
      wrist: [0.44, 0.08],
      hip: [0.56, 0.14],
      knee: [0.96, 0.11],
      ankle: [1.36, 0.08],
      toe: [1.48, 0.14],
      knee2: [0.94, topKneeUp],
      ankle2: [1.32, topAnkleUp],
      toe2: [1.44, topAnkleUp + 0.06],
    });
    return { start: lift(0.16, 0.12), finish: lift(0.5, 0.62), mistake: lift(0.26, 0.24) };
  })(),

  side_plank: (() => {
    const plank = (hipUp: number): FlatPose => ({
      head: [-0.26, 0.52],
      shoulder: [0, 0.44],
      elbow: [0.02, 0.05],
      wrist: [0.24, 0.03],
      hip: [0.64, hipUp],
      knee: [1.02, 0.16],
      ankle: [1.36, 0.05],
      toe: [1.46, 0.1],
    });
    return { start: plank(0.14), finish: plank(0.32), mistake: plank(0.08) };
  })(),

  copenhagen_plank: (() => {
    const cope = (hipUp: number, topLegUp: number): FlatPose => ({
      head: [-0.26, 0.56],
      shoulder: [0, 0.48],
      elbow: [0.02, 0.06],
      wrist: [0.24, 0.04],
      hip: [0.64, hipUp],
      knee: [1.0, hipUp - 0.06],
      ankle: [1.34, hipUp - 0.12],
      toe: [1.44, hipUp - 0.08],
      knee2: [1.0, topLegUp],
      ankle2: [1.34, topLegUp + 0.04],
      toe2: [1.44, topLegUp + 0.08],
    });
    return { start: cope(0.2, 0.5), finish: cope(0.42, 0.56), mistake: cope(0.1, 0.46) };
  })(),
};

const CHOREO: Record<string, Choreo> = {
  nordic_hamstring_curl: {
    // Kneeling: shin flat on the floor, the whole body pivoting about the knee.
    camera: { yaw: 12, pitch: 8 },
    base: { shankTilt: 90, armLift: 34, armBend: 26 },
    start: { thighTilt: 0, trunkTilt: 0 },
    finish: { thighTilt: -52, trunkTilt: 52 },
    mistake: { thighTilt: 0, trunkTilt: 58 },
    drive: {
      metric: "trunk_lean",
      apply: (d) => ({ thighTilt: -d, trunkTilt: d }),
    },
  },

  // --------------------------------------------------------- standing work
  ankle_knee_to_wall: {
    camera: { yaw: 12, pitch: 6 },
    base: { stance: "split", splitBack: 0.36, armLift: 30, armBend: 30 },
    start: { shankTilt: 6, thighTilt: -4 },
    finish: { shankTilt: 34, thighTilt: -14 },
    mistake: { shankTilt: 34, thighTilt: -14, heelRaise: 0.55 },
    drive: {
      metric: "ankle_dorsiflexion",
      apply: (d) => ({ shankTilt: d, thighTilt: -d * 0.4 }),
    },
  },
  double_leg_calf_raise: {
    camera: { yaw: 20, pitch: 6 },
    base: { armLift: 8 },
    start: { heelRaise: 0 },
    finish: { heelRaise: 1 },
    mistake: { heelRaise: 0.42, ...kneeBend(26) },
    drive: { metric: "heel_raise_ratio", apply: (r) => ({ heelRaise: Math.min(1, r * 2) }) },
  },
  single_leg_calf_raise: {
    camera: { yaw: 20, pitch: 6 },
    base: { stance: "single", armLift: 14, freeLegLift: 24, freeLegKnee: 60 },
    start: { heelRaise: 0 },
    finish: { heelRaise: 1 },
    mistake: { heelRaise: 0.4, ...kneeBend(24) },
  },
  single_leg_balance: {
    camera: STAND,
    base: { stance: "single", armLift: 16, freeLegLift: 26, freeLegKnee: 70 },
    start: { ...kneeBend(6) },
    finish: { ...kneeBend(12) },
    mistake: { ...kneeBend(14), valgus: 17, trunkTilt: 20 },
  },
  wall_sit: {
    camera: { yaw: 16, pitch: 6 },
    base: { armLift: 74, armBend: 8, trunkTilt: 0 },
    start: { ...kneeBend(18) },
    finish: { ...kneeBend(92) },
    mistake: { ...kneeBend(52) },
    drive: { metric: "knee_flexion", apply: kneeBend },
  },
  single_leg_squat: {
    camera: STAND,
    base: { stance: "single", armLift: 62, armBend: 12, freeLegLift: 18, freeLegKnee: 30 },
    start: { ...kneeBend(8) },
    finish: { ...kneeBend(68), trunkTilt: 14 },
    mistake: { ...kneeBend(68), trunkTilt: 14, valgus: 22 },
    drive: { metric: "knee_flexion", apply: kneeBend },
  },
  split_squat: {
    camera: STAND,
    base: { stance: "split", splitBack: 0.44, armLift: 12 },
    start: { ...kneeBend(12) },
    finish: { ...kneeBend(86), trunkTilt: 10 },
    mistake: { ...kneeBend(86), trunkTilt: 10, valgus: 20 },
    drive: { metric: "knee_flexion", apply: kneeBend },
  },
  step_down: {
    camera: STAND,
    base: { stance: "single", armLift: 52, freeLegLift: 8, freeLegKnee: 14 },
    start: { ...kneeBend(6) },
    finish: { ...kneeBend(56), trunkTilt: 14 },
    mistake: { ...kneeBend(56), trunkTilt: 22, valgus: 20 },
    drive: { metric: "knee_flexion", apply: kneeBend },
  },
  single_leg_rdl: {
    camera: { yaw: 16, pitch: 6 },
    base: { stance: "single", armLift: 4 },
    start: { trunkTilt: 6, thighTilt: 0, freeLegLift: 6, freeLegKnee: 10 },
    finish: { trunkTilt: 74, thighTilt: -8, shankTilt: 6, freeLegLift: 76, freeLegKnee: 8 },
    mistake: { trunkTilt: 52, ...kneeBend(46), freeLegLift: 34, freeLegKnee: 40 },
    drive: {
      metric: "hip_flexion",
      apply: (d) => ({ trunkTilt: d, freeLegLift: d + 4 }),
    },
  },

  // ------------------------------------------------------------- jumping
  pogo_hops: {
    camera: STAND,
    base: { armLift: 16, armBend: 20 },
    start: { ...kneeBend(14), heelRaise: 0.1 },
    finish: { ...kneeBend(24), heelRaise: 0.95 },
    mistake: { ...kneeBend(62), heelRaise: 0.3 },
  },
  single_leg_hop_landing: {
    camera: STAND,
    base: { stance: "single", armLift: 30, freeLegLift: 20, freeLegKnee: 40 },
    start: { ...kneeBend(10), heelRaise: 0.5 },
    finish: { ...kneeBend(52), trunkTilt: 14 },
    mistake: { ...kneeBend(20), trunkTilt: 8, valgus: 22 },
    drive: { metric: "knee_flexion", apply: kneeBend },
  },
  lateral_bound: {
    camera: STAND,
    base: { stance: "single", armLift: 34, freeLegLift: 22, freeLegKnee: 46 },
    start: { ...kneeBend(10), heelRaise: 0.45 },
    finish: { ...kneeBend(48), trunkTilt: 12 },
    mistake: { ...kneeBend(22), valgus: 24 },
    drive: { metric: "knee_flexion", apply: kneeBend },
  },
  heading_jump: {
    camera: STAND,
    base: { armLift: 40, armBend: 18 },
    start: { ...kneeBend(8), heelRaise: 0.6 },
    finish: { ...kneeBend(52), trunkTilt: 10 },
    mistake: { ...kneeBend(14), trunkTilt: 6, valgus: 18 },
    drive: { metric: "knee_flexion", apply: kneeBend },
  },
};

/** Anything without an entry gets a plain squat rather than a broken figure. */
const DEFAULT: Choreo = {
  camera: STAND,
  base: { armLift: 40 },
  start: { ...kneeBend(8) },
  finish: { ...kneeBend(70), trunkTilt: 12 },
  mistake: { ...kneeBend(70), trunkTilt: 26, valgus: 20 },
  drive: { metric: "knee_flexion", apply: kneeBend },
};

export interface DemoSpec {
  camera: Camera;
  /** Build the figure at a point in the movement. */
  figure: (phase: number, wrong?: boolean) => FigurePose;
  /** The threshold the movement travels to, when the rule sets one. */
  amount: number | null;
  hasMistake: boolean;
  mistakeCode: string | null;
}

function targetFor(rule: ExerciseRule, metric: string): MetricTarget | undefined {
  return rule.targets.find((t) => t.metric === metric);
}

export function buildDemoSpec(key: string, rule: ExerciseRule): DemoSpec {
  const hold = rule.mode === "hold";
  const ease = (t: number) => 0.5 - 0.5 * Math.cos(2 * Math.PI * t);
  const travel = (phase: number) => (hold ? Math.min(1, phase * 3) : ease(phase));

  const floor = FLOOR[key];
  if (floor) {
    return {
      camera: FLOOR_CAMERA,
      amount: null,
      hasMistake: true,
      mistakeCode: rule.targets.find((t) => t.critical)?.code ?? rule.targets[0]?.code ?? null,
      figure: (phase, wrong = false) =>
        flatFigure(lerpFlat(floor.start, wrong ? floor.mistake : floor.finish, travel(phase))),
    };
  }

  const choreo = CHOREO[key] ?? DEFAULT;

  // Let the rule set how far the movement goes, so the picture and the marking
  // cannot disagree. A `min` is a floor to clear, so overshoot it slightly.
  let amount: number | null = null;
  let driven: Partial<Posture> = {};
  if (choreo.drive) {
    const target = targetFor(rule, choreo.drive.metric);
    const from = target?.min != null ? target.min * 1.08 : null;
    if (from !== null) {
      amount = Math.round(from);
      driven = choreo.drive.apply(from);
    }
  }

  const finish = { ...choreo.finish, ...driven };
  const mistake = { ...finish, ...choreo.mistake };

  const lerp = (a: Partial<Posture>, b: Partial<Posture>, t: number): Posture => {
    const out: Posture = { ...NEUTRAL, ...choreo.base };
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof Posture>;
    for (const k of keys) {
      const from = (a[k] ?? out[k]) as number | string;
      const to = (b[k] ?? out[k]) as number | string;
      if (typeof from === "number" && typeof to === "number") {
        (out[k] as number) = from + (to - from) * t;
      } else {
        (out[k] as unknown) = t > 0.5 ? to : from;
      }
    }
    return out;
  };

  return {
    camera: choreo.camera,
    amount,
    hasMistake: true,
    mistakeCode: rule.targets.find((t) => t.critical)?.code ?? rule.targets[0]?.code ?? null,
    // A hold moves into position and stays there; a rep travels and returns.
    figure: (phase, wrong = false) =>
      buildFigure(lerp(choreo.start, wrong ? mistake : finish, travel(phase))),
  };
}

/** The thresholds worth printing under the animation, in plain words. */
export function targetLines(rule: ExerciseRule): string[] {
  const nice: Record<string, string> = {
    knee_flexion: "Knee bend",
    hip_flexion: "Hip bend",
    trunk_lean: "Trunk lean",
    knee_valgus: "Knee falling in",
    pelvic_drop: "Hip drop",
    ankle_dorsiflexion: "Ankle bend",
    heel_raise_ratio: "Heel height",
  };
  return rule.targets.map((t) => {
    const label = nice[t.metric] ?? t.metric;
    const unit = t.metric.endsWith("_ratio") ? "" : "°";
    const bound =
      t.min != null ? `at least ${t.min}${unit}` : t.max != null ? `no more than ${t.max}${unit}` : "";
    return `${label} — ${bound}`;
  });
}
