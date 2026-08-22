from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.config import settings
from app.core.enums import CriterionSource, SessionStatus, Side
from app.services.pose.landmarks import LANDMARK_COUNT


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class LandmarkIn(BaseModel):
    """One MediaPipe landmark. ``visibility`` below the configured threshold is
    treated as untracked rather than as a real position."""

    x: float
    y: float
    z: float = 0.0
    visibility: float = 1.0


class FrameIn(BaseModel):
    #: Seconds since the start of the set (not a wall clock).
    t: float
    landmarks: list[LandmarkIn]

    @field_validator("landmarks")
    @classmethod
    def _exactly_33(cls, v: list[LandmarkIn]) -> list[LandmarkIn]:
        if len(v) != LANDMARK_COUNT:
            raise ValueError(f"expected {LANDMARK_COUNT} MediaPipe landmarks, got {len(v)}")
        return v


class SessionStartIn(BaseModel):
    started_at: datetime | None = None
    device: str | None = None
    app_version: str | None = None


class SessionCompleteIn(BaseModel):
    ended_at: datetime | None = None
    rpe: float | None = Field(default=None, ge=0, le=10)
    pain_during: float | None = Field(default=None, ge=0, le=10)
    pain_after: float | None = Field(default=None, ge=0, le=10)
    note: str | None = None


class SetUploadIn(BaseModel):
    exercise_key: str
    side: Side = Side.BILATERAL
    prescription_id: int | None = None
    order_index: int = 0
    prescribed_reps: int | None = None
    load_kg: float | None = None
    space: Literal["image", "world"] = "image"
    #: Pixel size of the frames MediaPipe ran on. Required for correct angles:
    #: MediaPipe scales x and y by width and height separately, so on a portrait
    #: phone video one x unit is a much shorter distance than one y unit. Without
    #: these the server assumes a square image and every angle comes out skewed.
    image_width: int | None = Field(default=None, gt=0)
    image_height: int | None = Field(default=None, gt=0)
    #: Persist a downsampled landmark trace for clinician review.
    keep_frames: bool = False
    #: Landmark stream from MediaPipe. Leave empty for exercises with no camera
    #: rule (running drills, agility work) and send ``completed_reps`` instead.
    frames: list[FrameIn] = []
    completed_reps: int | None = None

    @field_validator("frames")
    @classmethod
    def _bounded(cls, v: list[FrameIn]) -> list[FrameIn]:
        if len(v) > settings.max_frames_per_upload:
            raise ValueError(
                f"too many frames ({len(v)}); max {settings.max_frames_per_upload}. "
                "Downsample on device before uploading."
            )
        return v


class ViolationOut(BaseModel):
    code: str
    metric: str
    observed: float
    limit: float
    bound: str
    severity: float
    critical: bool
    message_en: str
    message_th: str


class RepOut(BaseModel):
    index: int
    start_t: float
    end_t: float
    duration: float
    is_valid: bool
    form_score: float
    tracking_quality: float
    hold_seconds: float | None
    metrics: dict[str, float]
    violations: list[ViolationOut]


class EmittedMetricOut(BaseModel):
    key: str
    value: float
    unit: str
    side: Side | None


class SetResultOut(BaseModel):
    set_id: int
    exercise_key: str
    side: Side
    completed_reps: int
    valid_reps: int
    form_score: float
    tracking_quality: float
    warnings: list[str]
    reps: list[RepOut]
    emitted: list[EmittedMetricOut]


class CameraViewError(BaseModel):
    """Returned with 422 when the set was filmed from an angle we cannot score."""

    error: Literal["wrong_camera_view"] = "wrong_camera_view"
    expected_view: str
    detected_view: str
    message_en: str
    message_th: str


class SessionOut(ORMModel):
    id: int
    episode_id: int
    phase_key: str
    status: SessionStatus
    started_at: datetime
    ended_at: datetime | None
    rpe: float | None
    pain_during: float | None
    pain_after: float | None
    note: str | None


class PainLogIn(BaseModel):
    recorded_at: datetime | None = None
    pain_rest: float = Field(ge=0, le=10)
    pain_activity: float = Field(ge=0, le=10)
    pain_next_morning: float | None = Field(default=None, ge=0, le=10)
    stiffness: float | None = Field(default=None, ge=0, le=10)
    swelling: float | None = Field(default=None, ge=0, le=10)
    confidence: float | None = Field(default=None, ge=0, le=100)
    note: str | None = None


class PainLogOut(ORMModel):
    id: int
    recorded_at: datetime
    pain_rest: float
    pain_activity: float
    pain_next_morning: float | None
    stiffness: float | None
    swelling: float | None
    confidence: float | None
    note: str | None


class TestResultIn(BaseModel):
    """A field test typed in by the player or clinician (hop test, sprint, dynamometer)."""

    metric_key: str = Field(pattern=r"^(test|health)\.[a-z0-9_]+$")
    value: float
    unit: str | None = None
    side: Side | None = None
    recorded_at: datetime | None = None
    meta: dict[str, Any] | None = None


class MetricSampleOut(ORMModel):
    id: int
    metric_key: str
    source: CriterionSource
    value: float
    unit: str | None
    side: Side | None
    recorded_at: datetime
