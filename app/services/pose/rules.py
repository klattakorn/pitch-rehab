from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

AggregateHow = Literal["peak", "max", "min", "mean", "median", "range", "abs_max", "first", "last"]

#: Metrics that only exist across the body, so only a front-on camera can see them.
#: Measured from the side they do not read weakly, they read *wrongly*: on real
#: side-on footage the knee-valgus figure sat at a confident +24 to +40 degrees on
#: every rep, good and bad alike, because a leg swinging forward gets misread as a
#: knee drifting inward.
FRONT_ONLY_METRICS = frozenset({"knee_valgus", "pelvic_drop", "weight_shift_ratio"})


class MetricTarget(BaseModel):
    """One "this is what good looks like" constraint on a rep.

    ``min``/``max`` bound the aggregated value; ``tolerance`` is a grace band that
    is scored but not flagged, so a rep at 11.5 deg of lean against a 12 deg limit
    does not get shouted at.
    """

    metric: str
    aggregate: AggregateHow = "peak"
    min: float | None = None
    max: float | None = None
    tolerance: float = 0.0
    weight: float = 1.0
    #: A critical violation makes the rep not count towards the prescribed reps.
    critical: bool = False
    code: str
    message_en: str = ""
    message_th: str = ""

    @model_validator(mode="after")
    def _needs_a_bound(self) -> MetricTarget:
        if self.min is None and self.max is None:
            raise ValueError(f"target {self.code!r} sets neither min nor max")
        return self


class RepDetection(BaseModel):
    """Hysteresis thresholds that turn a continuous angle trace into reps."""

    signal: str = "knee_flexion"
    enter: float = 30.0
    exit: float = 15.0
    min_duration_s: float = 0.35
    max_duration_s: float = 20.0
    #: Peak must exceed the rep's starting value by at least this much, so a
    #: shuffle of the feet is not counted as a repetition.
    min_amplitude: float = 8.0

    @model_validator(mode="after")
    def _exit_below_enter(self) -> RepDetection:
        if self.exit >= self.enter:
            raise ValueError("rep detection `exit` must sit below `enter` for hysteresis")
        return self


class EmitMetric(BaseModel):
    """Bridge from pose output to the exit-criteria engine.

    ``rep_aggregate`` collapses a rep's frames to one number; ``set_aggregate``
    collapses the set's reps to the single ``MetricSample`` that gets stored
    under ``as_key``.
    """

    metric: str
    as_key: str
    rep_aggregate: AggregateHow = "peak"
    set_aggregate: Literal["max", "min", "mean", "median"] = "median"
    unit: str = "deg"


class ExerciseRule(BaseModel):
    """Serialised onto ``Exercise.pose_rule``."""

    mode: Literal["rep", "hold"] = "rep"
    #: Camera placement the rule assumes. Angles measured from the wrong view are
    #: noise, so by default a mismatch is rejected outright rather than scored.
    view: Literal["front", "side", "any"] = "any"
    #: Set False only for movements where the view genuinely does not matter, or
    #: when the automatic check proves unreliable for a particular exercise.
    enforce_view: bool = True
    space: Literal["image", "world"] = "image"
    #: Include MediaPipe's depth estimate in angle maths. Leave as ``None`` to
    #: let the view decide: from the front, flexion happens along the camera
    #: axis and is invisible in 2D, so depth is required; from the side, flexion
    #: is already in the image plane and the noisier z only hurts.
    use_z: bool | None = None

    detection: RepDetection | None = None
    targets: list[MetricTarget] = Field(default_factory=list)

    required_landmarks: list[str] = Field(
        default_factory=lambda: [
            "LEFT_HIP",
            "RIGHT_HIP",
            "LEFT_KNEE",
            "RIGHT_KNEE",
            "LEFT_ANKLE",
            "RIGHT_ANKLE",
        ]
    )
    min_visibility: float = 0.5
    #: Below this mean visibility the rep is returned as untrusted rather than failed.
    min_tracking_quality: float = 0.55

    smoothing_window: int = 5
    tempo_min_s: float | None = None
    tempo_max_s: float | None = None
    hold_target_s: float | None = None

    emit: list[EmitMetric] = Field(default_factory=list)

    @model_validator(mode="after")
    def _rep_mode_needs_detection(self) -> ExerciseRule:
        if self.use_z is None:
            self.use_z = self.view == "front"
        if self.mode == "rep" and self.detection is None:
            raise ValueError("rep-mode rules need a `detection` block")
        if self.mode == "hold" and self.hold_target_s is None:
            raise ValueError("hold-mode rules need `hold_target_s`")
        if self.view == "side":
            sideways = sorted(
                {t.metric for t in self.targets if t.metric in FRONT_ONLY_METRICS}
                | {e.metric for e in self.emit if e.metric in FRONT_ONLY_METRICS}
            )
            if sideways:
                raise ValueError(
                    f"a side-view rule cannot use {', '.join(sideways)} — those are "
                    "side-to-side movements and a side-on camera reads them as a "
                    "confident but meaningless number. Use view='front'."
                )
        return self
