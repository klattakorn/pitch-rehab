/**
 * Where to put the phone, for one exercise.
 *
 * Every angle is measured off the picture, so where the phone stands is half
 * the accuracy, and the camera screen cannot fix a bad view after the fact.
 * One generic line ("hip height, head and feet in shot") was wrong for two of
 * the five camera-checked moves: the glute bridge is filmed lying down, and
 * pogo hops do not need the head (it leaves the top of the frame mid-hop).
 *
 * Written from what real footage showed: the glute bridge, pogo hops and calf
 * raise were all tuned on clips with the phone stood up on the floor, so that
 * is the setup they ask for; side-on, the far foot hides behind the near one.
 * Everything else asks for hip height, the other setup the app is shown with.
 */
import type { Exercise } from "../pose/rules";

export interface Placement {
  /** One line, for the camera screen while the player gets into position. */
  short: string;
  /** The full advice, for the how-to screen. HTML. */
  detail: string;
}

const BY_EXERCISE: Record<string, Placement> = {
  // The three below were tuned on clips filmed with the phone propped up on the
  // floor, so that is the setup they are known to work with.
  glute_bridge: {
    short: "Phone on the floor, side on, about 2 m away",
    detail: `Lie on your back side-on to the phone. Stand it up <strong>on the
      floor</strong>, roughly <strong>2 m away</strong>, so your <strong>shoulders,
      hips and feet</strong> are all in the picture. Without the shoulders the hip
      angle cannot be measured.`,
  },
  pogo_hops: {
    short: "Phone on the floor, facing you, about 3 m away",
    detail: `Stand <strong>facing the phone</strong>, stood up <strong>on the
      floor</strong> about <strong>3 m away</strong>. Keep your <strong>shoulders to
      feet</strong> in the picture, with space under your feet — it is fine if your
      head goes out of the top when you hop. Step back if your feet leave the
      bottom of the picture.`,
  },
  double_leg_calf_raise: {
    short: "Phone on the floor, side on, about 2 m away",
    detail: `Stand <strong>side-on</strong> to the phone, stood up <strong>on the
      floor</strong> roughly <strong>2 m away</strong>, so your <strong>feet and
      heels</strong> are big and clear in the picture. The heel nearest the phone is
      the one measured.`,
  },
};

const SIDE: Placement = {
  short: "Phone at hip height, side on, about 3 m away",
  detail: `Stand <strong>side-on</strong> to the phone, propped up at about
    <strong>hip height</strong>, two to three steps away, so your <strong>head and
    feet</strong> are both in the picture. Filming from the floor, or standing too
    close, bends the angles it measures.`,
};

const FRONT: Placement = {
  short: "Phone at hip height, facing you, about 3 m away",
  detail: `Stand <strong>facing the phone</strong>, propped up at about <strong>hip
    height</strong>, two to three steps away, so your <strong>head and feet</strong>
    are both in the picture. Filming from the floor, or standing too close, bends
    the angles it measures.`,
};

export function placementFor(exercise: Pick<Exercise, "key" | "pose_rule">): Placement {
  const special = BY_EXERCISE[exercise.key];
  if (special) return special;
  return exercise.pose_rule?.view === "side" ? SIDE : FRONT;
}
