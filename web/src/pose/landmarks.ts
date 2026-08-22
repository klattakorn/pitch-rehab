/** The 33 MediaPipe Pose landmarks. Mirrors app/services/pose/landmarks.py. */

export const LM = {
  NOSE: 0,
  LEFT_EYE_INNER: 1,
  LEFT_EYE: 2,
  LEFT_EYE_OUTER: 3,
  RIGHT_EYE_INNER: 4,
  RIGHT_EYE: 5,
  RIGHT_EYE_OUTER: 6,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  MOUTH_LEFT: 9,
  MOUTH_RIGHT: 10,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_PINKY: 17,
  RIGHT_PINKY: 18,
  LEFT_INDEX: 19,
  RIGHT_INDEX: 20,
  LEFT_THUMB: 21,
  RIGHT_THUMB: 22,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
} as const;

export type LandmarkName = keyof typeof LM;
export const LANDMARK_COUNT = 33;

export type Side = "left" | "right" | "bilateral";

const SIDED: Record<string, [number, number]> = {
  shoulder: [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER],
  elbow: [LM.LEFT_ELBOW, LM.RIGHT_ELBOW],
  wrist: [LM.LEFT_WRIST, LM.RIGHT_WRIST],
  hip: [LM.LEFT_HIP, LM.RIGHT_HIP],
  knee: [LM.LEFT_KNEE, LM.RIGHT_KNEE],
  ankle: [LM.LEFT_ANKLE, LM.RIGHT_ANKLE],
  heel: [LM.LEFT_HEEL, LM.RIGHT_HEEL],
  foot_index: [LM.LEFT_FOOT_INDEX, LM.RIGHT_FOOT_INDEX],
  ear: [LM.LEFT_EAR, LM.RIGHT_EAR],
};

/** `sided("knee", "left")` -> LM.LEFT_KNEE */
export function sided(joint: string, side: Side): number {
  const pair = SIDED[joint];
  if (!pair) throw new Error(`unknown sided joint '${joint}'`);
  if (side === "left") return pair[0];
  if (side === "right") return pair[1];
  throw new Error(`'${joint}' needs a concrete side, got ${side}`);
}

/** Bones to draw, so the stick figure reads as a person. */
export const SKELETON: ReadonlyArray<readonly [number, number]> = [
  [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER],
  [LM.LEFT_SHOULDER, LM.LEFT_HIP],
  [LM.RIGHT_SHOULDER, LM.RIGHT_HIP],
  [LM.LEFT_HIP, LM.RIGHT_HIP],
  [LM.LEFT_SHOULDER, LM.LEFT_ELBOW],
  [LM.LEFT_ELBOW, LM.LEFT_WRIST],
  [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW],
  [LM.RIGHT_ELBOW, LM.RIGHT_WRIST],
  [LM.LEFT_HIP, LM.LEFT_KNEE],
  [LM.LEFT_KNEE, LM.LEFT_ANKLE],
  [LM.LEFT_ANKLE, LM.LEFT_HEEL],
  [LM.LEFT_ANKLE, LM.LEFT_FOOT_INDEX],
  [LM.RIGHT_HIP, LM.RIGHT_KNEE],
  [LM.RIGHT_KNEE, LM.RIGHT_ANKLE],
  [LM.RIGHT_ANKLE, LM.RIGHT_HEEL],
  [LM.RIGHT_ANKLE, LM.RIGHT_FOOT_INDEX],
];
