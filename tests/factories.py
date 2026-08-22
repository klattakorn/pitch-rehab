"""Synthetic MediaPipe landmark traces, so the pose engine can be tested without a camera."""

from __future__ import annotations

import math
from typing import Literal

from app.services.pose.geometry import Frame
from app.services.pose.landmarks import LANDMARK_COUNT, LM

THIGH = 0.20
SHANK = 0.20
TRUNK = 0.25
FOOT = 0.06
MIDLINE_X = 0.5

#: Which axis the sagittal (forward/back) motion lands on. ``"z"`` models a
#: camera in front of the player -- flexion happens along the camera axis, which
#: is exactly why front-view rules need MediaPipe's depth estimate. ``"x"``
#: models a camera at the side, where flexion is in the image plane.
SagittalAxis = Literal["x", "z"]


def build_frame(
    t: float,
    knee_flexion_deg: float,
    *,
    trunk_lean_deg: float = 5.0,
    valgus_shift: float = 0.0,
    pelvic_drop_deg: float = 0.0,
    heel_raise: float = 0.0,
    visibility: float = 0.95,
    sagittal_axis: SagittalAxis = "z",
    thigh_fixed: bool = False,
) -> Frame:
    """One skeleton posed at a given knee flexion.

    Image coordinates: x right, y **down**, normalised 0-1 -- exactly what
    MediaPipe hands back for ``pose_landmarks``.

    ``thigh_fixed`` keeps the femur still and moves only the shank, which is what
    an isolated leg curl looks like; otherwise the pose is shared between thigh
    and shank like a squat.
    """
    theta = math.radians(knee_flexion_deg)
    psi = 0.0 if thigh_fixed else theta / 2.0  # thigh tilt forward
    phi = -theta if thigh_fixed else -theta / 2.0  # shank tilt back

    # The forward/back axis is whichever one points away from the camera; the
    # left/right axis is the other one. Filmed from the side, the two sides of
    # the body separate in depth, so they overlap in the image — which is exactly
    # why a side view cannot show knee valgus, and why the engine checks.
    sag = 0 if sagittal_axis == "x" else 2
    lat = 2 if sagittal_axis == "x" else 0
    # A real side view is never perfectly edge-on; a little width still shows.
    lat_bleed = 0.15 if sagittal_axis == "x" else 0.0

    points = [[MIDLINE_X, 0.5, 0.0] for _ in range(LANDMARK_COUNT)]

    for side_sign, hip_lm, knee_lm, ankle_lm, heel_lm, toe_lm, shoulder_lm in (
        (-1, LM.LEFT_HIP, LM.LEFT_KNEE, LM.LEFT_ANKLE, LM.LEFT_HEEL, LM.LEFT_FOOT_INDEX,
         LM.LEFT_SHOULDER),
        (+1, LM.RIGHT_HIP, LM.RIGHT_KNEE, LM.RIGHT_ANKLE, LM.RIGHT_HEEL, LM.RIGHT_FOOT_INDEX,
         LM.RIGHT_SHOULDER),
    ):
        ankle = [MIDLINE_X, 0.90, 0.0]
        ankle[lat] += side_sign * 0.08
        if lat_bleed:
            ankle[0] += side_sign * 0.08 * lat_bleed

        knee = list(ankle)
        knee[sag] += SHANK * math.sin(phi)
        knee[1] -= SHANK * math.cos(phi)
        # Valgus: the knee drifting toward the body midline, across the body.
        knee[lat] += -side_sign * valgus_shift

        hip = list(knee)
        hip[sag] += THIGH * math.sin(psi)
        hip[1] -= THIGH * math.cos(psi)
        hip[lat] = ankle[lat]  # pelvis stays over the foot
        if side_sign == +1:
            hip[1] += math.radians(pelvic_drop_deg) * 0.1

        lean = math.radians(trunk_lean_deg)
        shoulder = list(hip)
        shoulder[sag] += TRUNK * math.sin(lean)
        shoulder[1] -= TRUNK * math.cos(lean)

        heel = list(ankle)
        heel[sag] -= 0.02
        heel[1] += 0.01 - heel_raise * FOOT
        toe = list(ankle)
        toe[sag] += FOOT
        toe[1] += 0.01

        points[int(hip_lm)] = hip
        points[int(knee_lm)] = knee
        points[int(ankle_lm)] = ankle
        points[int(shoulder_lm)] = shoulder
        points[int(heel_lm)] = heel
        points[int(toe_lm)] = toe

    landmarks = [[p[0], p[1], p[2], visibility] for p in points]
    return Frame.from_payload(t, landmarks)


def squat_trace(
    reps: int = 5,
    peak_flexion: float = 75.0,
    *,
    fps: int = 30,
    seconds_per_rep: float = 3.0,
    valgus_shift: float = 0.0,
    trunk_lean_deg: float = 5.0,
    rest_flexion: float = 5.0,
    sagittal_axis: SagittalAxis = "z",
    thigh_fixed: bool = False,
) -> list[Frame]:
    """A smooth up-down knee-flexion trace, ``reps`` times."""
    frames: list[Frame] = []
    n = int(fps * seconds_per_rep)
    t = 0.0
    for _ in range(reps):
        for i in range(n):
            phase = i / n
            # Half-cosine: rest -> peak -> rest.
            flexion = rest_flexion + (peak_flexion - rest_flexion) * (
                0.5 - 0.5 * math.cos(2 * math.pi * phase)
            )
            depth = (flexion - rest_flexion) / max(peak_flexion - rest_flexion, 1e-6)
            frames.append(
                build_frame(
                    t,
                    flexion,
                    trunk_lean_deg=trunk_lean_deg,
                    valgus_shift=valgus_shift * depth,
                    sagittal_axis=sagittal_axis,
                    thigh_fixed=thigh_fixed,
                )
            )
            t += 1.0 / fps
        # A beat of standing still between reps so the hysteresis can reset.
        for _ in range(fps // 3):
            frames.append(
                build_frame(
                    t,
                    rest_flexion,
                    trunk_lean_deg=trunk_lean_deg,
                    sagittal_axis=sagittal_axis,
                    thigh_fixed=thigh_fixed,
                )
            )
            t += 1.0 / fps
    return frames


def frames_to_payload(frames: list[Frame]) -> list[dict]:
    """Turn ``Frame`` objects back into the JSON the API expects."""
    return [
        {
            "t": f.t,
            "landmarks": [
                {"x": float(x), "y": float(y), "z": float(z), "visibility": float(v)}
                for (x, y, z), v in zip(f.xyz, f.vis, strict=True)
            ],
        }
        for f in frames
    ]
