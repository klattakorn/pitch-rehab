from __future__ import annotations

from enum import IntEnum

from app.core.enums import Side


class LM(IntEnum):
    """The 33 MediaPipe Pose landmarks, indices exactly as the solution emits them."""

    NOSE = 0
    LEFT_EYE_INNER = 1
    LEFT_EYE = 2
    LEFT_EYE_OUTER = 3
    RIGHT_EYE_INNER = 4
    RIGHT_EYE = 5
    RIGHT_EYE_OUTER = 6
    LEFT_EAR = 7
    RIGHT_EAR = 8
    MOUTH_LEFT = 9
    MOUTH_RIGHT = 10
    LEFT_SHOULDER = 11
    RIGHT_SHOULDER = 12
    LEFT_ELBOW = 13
    RIGHT_ELBOW = 14
    LEFT_WRIST = 15
    RIGHT_WRIST = 16
    LEFT_PINKY = 17
    RIGHT_PINKY = 18
    LEFT_INDEX = 19
    RIGHT_INDEX = 20
    LEFT_THUMB = 21
    RIGHT_THUMB = 22
    LEFT_HIP = 23
    RIGHT_HIP = 24
    LEFT_KNEE = 25
    RIGHT_KNEE = 26
    LEFT_ANKLE = 27
    RIGHT_ANKLE = 28
    LEFT_HEEL = 29
    RIGHT_HEEL = 30
    LEFT_FOOT_INDEX = 31
    RIGHT_FOOT_INDEX = 32


LANDMARK_COUNT = 33

#: Joints that exist per-side, so a metric can be asked for on the injured limb.
_SIDED: dict[str, tuple[LM, LM]] = {
    "shoulder": (LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER),
    "elbow": (LM.LEFT_ELBOW, LM.RIGHT_ELBOW),
    "wrist": (LM.LEFT_WRIST, LM.RIGHT_WRIST),
    "hip": (LM.LEFT_HIP, LM.RIGHT_HIP),
    "knee": (LM.LEFT_KNEE, LM.RIGHT_KNEE),
    "ankle": (LM.LEFT_ANKLE, LM.RIGHT_ANKLE),
    "heel": (LM.LEFT_HEEL, LM.RIGHT_HEEL),
    "foot_index": (LM.LEFT_FOOT_INDEX, LM.RIGHT_FOOT_INDEX),
    "ear": (LM.LEFT_EAR, LM.RIGHT_EAR),
}


def sided(joint: str, side: Side) -> LM:
    """``sided("knee", Side.LEFT) -> LM.LEFT_KNEE``."""
    try:
        left, right = _SIDED[joint]
    except KeyError as exc:  # pragma: no cover - programmer error
        raise KeyError(f"unknown sided joint {joint!r}") from exc
    if side is Side.LEFT:
        return left
    if side is Side.RIGHT:
        return right
    raise ValueError(f"{joint!r} needs a concrete side, got {side}")


#: Landmarks that must be tracked for lower-limb analysis to mean anything.
LOWER_LIMB_REQUIRED: tuple[LM, ...] = (
    LM.LEFT_HIP,
    LM.RIGHT_HIP,
    LM.LEFT_KNEE,
    LM.RIGHT_KNEE,
    LM.LEFT_ANKLE,
    LM.RIGHT_ANKLE,
    LM.LEFT_SHOULDER,
    LM.RIGHT_SHOULDER,
)
