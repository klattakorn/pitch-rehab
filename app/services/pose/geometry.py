from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Literal

import numpy as np

from app.core.enums import Side
from app.services.pose.landmarks import LANDMARK_COUNT, LM, sided

CoordinateSpace = Literal["image", "world"]

#: MediaPipe reports y growing *downwards* in both the normalized image space and
#: the world space, so "up" is -y in either case.
UP = np.array([0.0, -1.0, 0.0])

_EPS = 1e-9


@dataclass(slots=True)
class Frame:
    """One pose observation: 33 landmarks with a timestamp.

    Coordinates are stored **isotropic** -- one unit means the same real distance
    on the x and y axes -- so angles can be trusted. See ``from_payload``.
    """

    t: float
    xyz: np.ndarray  # (33, 3) float64
    vis: np.ndarray  # (33,) float64, MediaPipe visibility 0-1
    space: CoordinateSpace = "image"
    aspect: float = 1.0

    @classmethod
    def from_payload(
        cls,
        t: float,
        landmarks: Sequence[dict | Sequence[float]],
        space: CoordinateSpace = "image",
        aspect: float = 1.0,
    ) -> Frame:
        """Build a frame from raw MediaPipe output.

        ``aspect`` is the source image's width / height, and it matters more than
        it looks. MediaPipe divides x by the image width and y by the image
        height *independently*, so on a 1080x1920 phone video one x unit is 1080
        pixels while one y unit is 1920. Feeding those straight into an angle
        calculation skews every result -- measured on real footage, knee flexion
        came out 21 degrees too high. Scaling x (and z, which MediaPipe reports
        on the same scale as x) by the aspect ratio puts both axes back into the
        same units.

        World-space landmarks are already in metres, so they are left alone.
        """
        if len(landmarks) != LANDMARK_COUNT:
            raise ValueError(f"expected {LANDMARK_COUNT} landmarks, got {len(landmarks)}")
        xyz = np.zeros((LANDMARK_COUNT, 3), dtype=float)
        vis = np.zeros(LANDMARK_COUNT, dtype=float)
        for i, lm in enumerate(landmarks):
            if isinstance(lm, dict):
                xyz[i] = (lm.get("x", 0.0), lm.get("y", 0.0), lm.get("z", 0.0))
                vis[i] = lm.get("visibility", lm.get("v", 1.0))
            else:
                vals = list(lm)
                xyz[i, : min(3, len(vals))] = vals[:3]
                vis[i] = vals[3] if len(vals) > 3 else 1.0
        if space == "image" and aspect != 1.0:
            xyz[:, 0] *= aspect
            xyz[:, 2] *= aspect
        return cls(t=float(t), xyz=xyz, vis=vis, space=space, aspect=aspect)

    def p(self, lm: LM, use_z: bool = False) -> np.ndarray:
        v = self.xyz[int(lm)].copy()
        if not use_z:
            v[2] = 0.0
        return v

    def visible(self, *lms: LM, threshold: float = 0.5) -> bool:
        return all(self.vis[int(lm)] >= threshold for lm in lms)

    def quality(self, lms: Sequence[LM]) -> float:
        if not lms:
            return 1.0
        return float(np.mean([self.vis[int(lm)] for lm in lms]))


# --------------------------------------------------------------------------
# primitives
# --------------------------------------------------------------------------
def angle_between(v1: np.ndarray, v2: np.ndarray) -> float:
    """Unsigned angle between two vectors, in degrees (0-180)."""
    n1 = float(np.linalg.norm(v1))
    n2 = float(np.linalg.norm(v2))
    if n1 < _EPS or n2 < _EPS:
        return float("nan")
    cos = float(np.dot(v1, v2)) / (n1 * n2)
    return math.degrees(math.acos(max(-1.0, min(1.0, cos))))


def joint_angle(frame: Frame, a: LM, b: LM, c: LM, use_z: bool = False) -> float:
    """Interior angle at ``b`` formed by a-b-c, in degrees."""
    pa, pb, pc = frame.p(a, use_z), frame.p(b, use_z), frame.p(c, use_z)
    return angle_between(pa - pb, pc - pb)


def midpoint(frame: Frame, a: LM, b: LM, use_z: bool = False) -> np.ndarray:
    return (frame.p(a, use_z) + frame.p(b, use_z)) / 2.0


def angle_from_vertical(v: np.ndarray) -> float:
    """0 deg = pointing straight up, 90 deg = horizontal."""
    return angle_between(v, UP)


def signed_line_deviation(point: np.ndarray, start: np.ndarray, end: np.ndarray) -> float:
    """Horizontal (x) offset of ``point`` from the start->end line, at the point's height.

    Positive means the point sits at a larger x than the line. Returns nan when the
    line is horizontal (no meaningful vertical interpolation).
    """
    dy = end[1] - start[1]
    if abs(dy) < _EPS:
        return float("nan")
    ratio = (point[1] - start[1]) / dy
    x_on_line = start[0] + ratio * (end[0] - start[0])
    return float(point[0] - x_on_line)


# --------------------------------------------------------------------------
# clinical metrics
# --------------------------------------------------------------------------
def _safe(value: float) -> float | None:
    return None if value is None or math.isnan(value) else round(float(value), 3)


def compute_metrics(frame: Frame, side: Side, use_z: bool = False) -> dict[str, float]:
    """All per-frame kinematics for one limb, keyed by metric name.

    Angles are clinical conventions: 0 deg = anatomical neutral (straight leg,
    upright trunk), larger = more flexion / more deviation. ``knee_valgus`` is
    signed -- positive is medial collapse (knock-knee), negative is varus.
    """
    if side is Side.BILATERAL:
        raise ValueError("compute_metrics needs a concrete side")

    out: dict[str, float] = {}
    hip = sided("hip", side)
    knee = sided("knee", side)
    ankle = sided("ankle", side)
    shoulder = sided("shoulder", side)
    heel = sided("heel", side)
    toe = sided("foot_index", side)
    elbow = sided("elbow", side)
    wrist = sided("wrist", side)

    mid_hip = midpoint(frame, LM.LEFT_HIP, LM.RIGHT_HIP, use_z)

    def put(name: str, value: float | None) -> None:
        v = _safe(value)
        if v is not None:
            out[name] = v

    # --- lower limb ------------------------------------------------------
    knee_flexion = 180.0 - joint_angle(frame, hip, knee, ankle, use_z)
    hip_flexion = 180.0 - joint_angle(frame, shoulder, hip, knee, use_z)
    put("knee_flexion", knee_flexion)
    put("hip_flexion", hip_flexion)
    # Mirrored signals so rep detection always has a *rising* trace to latch on
    # to, whichever direction the movement actually goes (bridges, curls, ...).
    put("knee_extension", -knee_flexion)
    put("hip_extension", -hip_flexion)
    put("ankle_dorsiflexion", 90.0 - joint_angle(frame, knee, ankle, toe, use_z))

    # --- trunk -----------------------------------------------------------
    # Measured in the image plane, never with depth, whatever the rule asked
    # for. Leaning forward is a sagittal movement: a camera in front of you
    # cannot see it, and asking MediaPipe's depth estimate for it does not
    # recover the information, it invents it. On a clip of someone standing
    # essentially straight -- true lean under 5 degrees at its worst -- the
    # depth version read a median of 15 and peaked at 37, so a 20-degree limit
    # was breached on nearly every rep, for every player, on footage where
    # nobody had leaned. Flat, this reads whatever the camera can genuinely
    # see: sideways lean from the front, forward lean from the side.
    trunk = midpoint(frame, LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER) - midpoint(
        frame, LM.LEFT_HIP, LM.RIGHT_HIP
    )
    put("trunk_lean", angle_from_vertical(trunk))
    if abs(trunk[1]) > _EPS:
        put("trunk_lean_signed", math.degrees(math.atan2(trunk[0], -trunk[1])))

    # --- pelvis / shoulders (frontal plane) -------------------------------
    lh, rh = frame.p(LM.LEFT_HIP, use_z), frame.p(LM.RIGHT_HIP, use_z)
    hip_width = float(np.linalg.norm(rh - lh))
    if hip_width > _EPS:
        # y grows downward, so a positive angle means the right hip sits lower.
        tilt = math.degrees(math.atan2(rh[1] - lh[1], rh[0] - lh[0]))
        # Report as "contralateral drop while standing on `side`".
        put("pelvic_drop", tilt if side is Side.LEFT else -tilt)

    ls, rs = frame.p(LM.LEFT_SHOULDER, use_z), frame.p(LM.RIGHT_SHOULDER, use_z)
    if float(np.linalg.norm(rs - ls)) > _EPS:
        s_tilt = math.degrees(math.atan2(rs[1] - ls[1], rs[0] - ls[0]))
        put("shoulder_tilt", s_tilt if side is Side.LEFT else -s_tilt)

    # --- knee valgus ------------------------------------------------------
    # Measured strictly in the frontal (x) plane: how far the knee sits from the
    # hip-ankle line horizontally. Deliberately *not* the 3-point knee angle --
    # in a 2D projection that angle is just knee flexion wearing a disguise.
    # Needs a front-facing camera (``ExerciseRule.view == "front"``).
    p_hip, p_knee, p_ankle = frame.p(hip, False), frame.p(knee, False), frame.p(ankle, False)
    dev = signed_line_deviation(p_knee, p_hip, p_ankle)
    leg_len_2d = float(np.linalg.norm(p_ankle - p_hip))
    if not math.isnan(dev) and leg_len_2d > _EPS:
        ratio = dev / leg_len_2d
        # A knee cannot really sit a whole leg-length off the hip-ankle line. When
        # the ratio saturates, the camera is in the wrong plane or tracking has
        # slipped -- report nothing rather than a confident-looking 90 degrees.
        if abs(ratio) < 0.95:
            # Positive when the knee drifts toward the body midline (mid-hip x).
            toward_midline = 1.0 if (mid_hip[0] - p_knee[0]) >= 0 else -1.0
            put("knee_valgus", math.degrees(math.asin(ratio)) * toward_midline)

    leg_len = float(np.linalg.norm(frame.p(ankle, use_z) - frame.p(hip, use_z)))
    if leg_len > _EPS:
        # Sagittal knee travel. Only meaningful from a side view (or with z).
        sag = 2 if use_z else 0
        knee_travel = frame.p(knee, use_z)[sag] - frame.p(ankle, use_z)[sag]
        put("knee_over_toe_ratio", knee_travel / leg_len)
        # Frontal: is the player dumping weight off the injured limb?
        put("weight_shift_ratio", (mid_hip[0] - p_ankle[0]) / leg_len)
        # Squat/jump depth proxy: pelvis height above the ankle.
        put("pelvis_height_ratio", (p_ankle[1] - mid_hip[1]) / leg_len)
        put("leg_length", leg_len)

    la, ra = frame.p(LM.LEFT_ANKLE, use_z), frame.p(LM.RIGHT_ANKLE, use_z)
    if hip_width > _EPS:
        put("stance_width_ratio", abs(ra[0] - la[0]) / hip_width)

    # --- foot ------------------------------------------------------------
    p_heel, p_toe = frame.p(heel, use_z), frame.p(toe, use_z)
    foot_len = float(np.linalg.norm(p_toe - p_heel))
    if foot_len > _EPS:
        # Heel above the toes (y smaller) => raised. Normalised by foot length.
        put("heel_raise_ratio", (p_toe[1] - p_heel[1]) / foot_len)

    # --- upper limb (goalkeeper / upper-body work) ------------------------
    put("elbow_flexion", 180.0 - joint_angle(frame, shoulder, elbow, wrist, use_z))
    put("shoulder_abduction", angle_between(frame.p(elbow, use_z) - frame.p(shoulder, use_z), -UP))

    return out


#: Below this the player is side-on; above it they are facing the camera.
#: Measured on real footage: side-on filming sits around 0.17, facing the camera
#: around 0.64. The gap between the two numbers is deliberately left as
#: "not sure", so a borderline reading never causes a set to be thrown away.
SIDE_VIEW_BELOW = 0.35
FRONT_VIEW_ABOVE = 0.50


def openness(frame: Frame) -> float | None:
    """How square-on the player is: shoulder and hip width over torso height.

    Facing the camera both are wide. Side on, one shoulder hides behind the other
    and the width collapses, which is what makes this a usable check.
    """
    ls, rs = frame.p(LM.LEFT_SHOULDER), frame.p(LM.RIGHT_SHOULDER)
    lh, rh = frame.p(LM.LEFT_HIP), frame.p(LM.RIGHT_HIP)
    torso = float(np.linalg.norm((ls + rs) / 2 - (lh + rh) / 2))
    if torso < _EPS:
        return None
    width = float(np.linalg.norm(rs - ls)) + float(np.linalg.norm(rh - lh))
    return width / (2 * torso)


def detect_view(frames: Sequence[Frame]) -> tuple[str, float | None]:
    """Guess where the camera is. Returns ("front" | "side" | "unknown", score)."""
    scores = [v for f in frames if (v := openness(f)) is not None]
    if not scores:
        return "unknown", None
    median = float(np.median(scores))
    if median < SIDE_VIEW_BELOW:
        return "side", median
    if median > FRONT_VIEW_ABOVE:
        return "front", median
    return "unknown", median


#: Landmarks that define how big the person looks in the picture.
_BODY_EXTENT = (
    LM.NOSE,
    LM.LEFT_SHOULDER,
    LM.RIGHT_SHOULDER,
    LM.LEFT_HIP,
    LM.RIGHT_HIP,
    LM.LEFT_KNEE,
    LM.RIGHT_KNEE,
    LM.LEFT_ANKLE,
    LM.RIGHT_ANKLE,
)


def body_scale(frame: Frame, min_visibility: float = 0.3) -> float | None:
    """Diagonal of the box the player occupies. A stable measure of apparent size."""
    points = [
        frame.p(lm)[:2] for lm in _BODY_EXTENT if frame.vis[int(lm)] >= min_visibility
    ]
    if len(points) < 4:
        return None
    arr = np.asarray(points)
    return float(np.linalg.norm(arr.max(axis=0) - arr.min(axis=0)))


def torso_direction(frame: Frame) -> np.ndarray | None:
    """Unit vector from the hips to the shoulders, in the image plane."""
    trunk = (
        midpoint(frame, LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER)
        - midpoint(frame, LM.LEFT_HIP, LM.RIGHT_HIP)
    )[:2]
    length = float(np.linalg.norm(trunk))
    return None if length < _EPS else trunk / length


def implausible_frames(
    frames: Sequence[Frame],
    tolerance: float = 0.6,
    max_torso_swing_deg: float = 75.0,
) -> set[int]:
    """Indices where the skeleton cannot be trusted.

    When part of the player leaves the shot, MediaPipe does not report low
    confidence -- it returns a scrambled skeleton at full confidence. Measured on
    real footage: the body shrank to 4% of its normal height with the head below
    the feet, while every landmark still claimed 0.99 confidence.

    Two checks, both comparing each frame against the rest of the set rather than
    against an anatomical rule, so they work equally well standing or lying down:

    * apparent body size suddenly changing
    * the torso suddenly pointing a different way (a person does not invert
      halfway through a set)
    """
    bad: set[int] = set()

    scales = [body_scale(f) for f in frames]
    known = [s for s in scales if s is not None]
    if not known:
        return set(range(len(frames)))
    reference = float(np.median(known))
    if reference > _EPS:
        upper = reference / max(tolerance, 0.1)
        bad |= {
            i
            for i, s in enumerate(scales)
            if s is None or s < tolerance * reference or s > upper
        }

    directions = [torso_direction(f) for f in frames]
    usable = [d for i, d in enumerate(directions) if d is not None and i not in bad]
    if len(usable) >= 3:
        mean = np.mean(usable, axis=0)
        if float(np.linalg.norm(mean)) > _EPS:
            mean = mean / np.linalg.norm(mean)
            for i, d in enumerate(directions):
                if d is None or angle_between(d, mean) > max_torso_swing_deg:
                    bad.add(i)

    return bad


@dataclass(slots=True)
class MetricSeries:
    """Per-frame metric values plus the timestamps they were sampled at."""

    t: list[float] = field(default_factory=list)
    values: dict[str, list[float | None]] = field(default_factory=dict)

    def add(self, t: float, metrics: dict[str, float]) -> None:
        self.t.append(t)
        n = len(self.t)
        for key in set(self.values) | set(metrics):
            col = self.values.setdefault(key, [None] * (n - 1))
            while len(col) < n - 1:
                col.append(None)
            col.append(metrics.get(key))

    def column(self, name: str) -> list[float | None]:
        return self.values.get(name, [None] * len(self.t))

    def smooth(self, window: int = 5) -> MetricSeries:
        """Centred moving median -- kills MediaPipe's occasional single-frame flyers
        without rounding off real peaks the way a mean would."""
        if window < 2 or len(self.t) < window:
            return self
        out = MetricSeries(t=list(self.t), values={})
        half = window // 2
        for key, col in self.values.items():
            smoothed: list[float | None] = []
            for i in range(len(col)):
                chunk = [v for v in col[max(0, i - half) : i + half + 1] if v is not None]
                smoothed.append(float(np.median(chunk)) if chunk else None)
            out.values[key] = smoothed
        return out


def aggregate(values: Sequence[float | None], how: str) -> float | None:
    clean = [v for v in values if v is not None and not math.isnan(v)]
    if not clean:
        return None
    arr = np.asarray(clean, dtype=float)
    match how:
        case "peak" | "max":
            return float(arr.max())
        case "min":
            return float(arr.min())
        case "mean":
            return float(arr.mean())
        case "median":
            return float(np.median(arr))
        case "range":
            return float(arr.max() - arr.min())
        case "abs_max":
            return float(np.abs(arr).max())
        case "first":
            return float(arr[0])
        case "last":
            return float(arr[-1])
        case _:
            raise ValueError(f"unknown aggregate {how!r}")
