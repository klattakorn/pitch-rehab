from __future__ import annotations

from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.core.enums import (
    Comparator,
    CriterionSource,
    CriterionStatus,
    EpisodeStatus,
    InjurySite,
    PhaseKey,
    Severity,
    Side,
    TargetType,
)


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class StartingPhaseIn(BaseModel):
    """Which phase of their programme a player says they are already in.

    The app has no way to know this and no business guessing -- somebody who
    starts using it two months into an ACL rehab is not in the protection phase,
    and putting them there hands them exercises they finished weeks ago.
    """

    phase_key: PhaseKey
    #: True when the player is saying where they already are, at the start: the
    #: injury date moves back so the week counter and the phase agree.
    #:
    #: False when they are moving between phases part-way through. The injury
    #: happened when it happened, and rewriting that to suit a phase change
    #: would tell somebody in week 11 that they are in week 1 for going back a
    #: step -- which is not a correction, it is a different and wrong claim.
    backdate: bool = True


class EpisodeCreateIn(BaseModel):
    injury_site: InjurySite
    side: Side
    injured_on: date
    severity: Severity = Severity.GRADE_1
    diagnosis: str | None = None
    mechanism: str | None = None
    surgery_on: date | None = None
    #: For a player who starts using the app part-way through their rehab: when
    #: they actually entered the current phase. Defaults to now. The per-phase
    #: minimum-days gate counts from this, so getting it wrong either holds a
    #: player back or lets them skip healing time they never had.
    phase_started_at: datetime | None = None


class EpisodeOut(ORMModel):
    id: int
    player_id: int
    protocol_id: int | None
    injury_site: InjurySite
    side: Side
    severity: Severity
    diagnosis: str | None
    injured_on: date
    surgery_on: date | None
    status: EpisodeStatus
    current_phase: PhaseKey
    phase_started_at: datetime | None
    cleared_at: datetime | None


class CriterionEvaluationOut(BaseModel):
    key: str
    label_en: str
    label_th: str
    metric: str
    source: CriterionSource
    required: bool
    status: CriterionStatus
    comparator: Comparator
    target_type: TargetType
    observed: float | None
    target: float | None
    unit: str | None
    progress: float
    samples: int
    baseline: float | None = None
    baseline_origin: str | None = None
    detail_en: str = ""
    detail_th: str = ""


class PhaseGateOut(BaseModel):
    episode_id: int
    phase_key: PhaseKey
    passed: bool
    progress: float
    required_total: int
    required_passed: int
    next_phase: PhaseKey | None
    criteria: list[CriterionEvaluationOut]
    blocking: list[str]
    evaluated_at: datetime


class AdvanceOut(BaseModel):
    advanced: bool
    episode: EpisodeOut
    gate: PhaseGateOut


class SignoffIn(BaseModel):
    phase_key: PhaseKey
    criterion_key: str | None = None
    approved: bool = True
    note: str | None = None


class SignoffOut(ORMModel):
    id: int
    episode_id: int
    clinician_id: int
    phase_key: PhaseKey
    criterion_key: str | None
    approved: bool
    note: str | None
    created_at: datetime


class PhaseAttemptOut(ORMModel):
    id: int
    phase_key: PhaseKey
    entered_at: datetime | None
    passed_at: datetime | None
    passed: bool
    snapshot: dict[str, Any] | None


class BaselineIn(BaseModel):
    metric_key: str = Field(max_length=80)
    value: float
    unit: str | None = None
    side: Side = Side.BILATERAL
    note: str | None = None


class BaselineOut(ORMModel):
    id: int
    metric_key: str
    value: float
    unit: str | None
    side: Side
    origin: str
    note: str | None


# --------------------------------------------------------------------------
# progress screen
# --------------------------------------------------------------------------
class TrendPointOut(BaseModel):
    day: date
    sessions: int
    exercises: int
    mean_form_score: float | None


class TopExerciseOut(BaseModel):
    key: str
    name_en: str
    sets: int
    mean_form_score: float


class MilestoneOut(BaseModel):
    label_en: str
    detail_en: str
    reached: bool


class SymmetryOut(BaseModel):
    value: float
    metric: str
    label_en: str
    samples: int


class ProgressOut(BaseModel):
    """Everything the Progress screen draws, derived from what the player did.

    Nothing here is stored. It is recomputed from the same completed sessions
    the camera wrote and the same gate the testing screen reads, so the two
    screens cannot drift apart.
    """

    overall_pct: float
    phase_key: PhaseKey
    phase_order: int
    phase_pct: float
    criteria_passed: int
    criteria_total: int
    week_of: int
    weeks_total: int
    sessions_completed: int
    exercises_completed: int
    #: ``None`` rather than 0 when nothing has been scored yet -- a player three
    #: days in has no accuracy, and 0% would read as failure.
    mean_form_score: float | None
    symmetry: SymmetryOut | None
    trend: list[TrendPointOut]
    top_exercises: list[TopExerciseOut]
    milestones: list[MilestoneOut]


# --------------------------------------------------------------------------
# player-authored exit criteria
# --------------------------------------------------------------------------
class AuthorableOut(BaseModel):
    """One thing a player can build a test from, with its sensible defaults."""

    key: str
    source: CriterionSource
    group: str
    label_en: str
    unit: str
    help_en: str
    phrase_en: str
    default_target: float
    #: Fixed by the metric, not chosen -- "pain of at least 8/10" is not a goal.
    comparator: Comparator
    lower_is_better: bool
    default_window_days: int | None
    target_types: list[TargetType]
    step: float
    needs_exercise: bool


class AuthorableExerciseOut(BaseModel):
    """A camera-scored exercise, for the per-exercise metrics."""

    key: str
    name_en: str
    category: str
    #: "reps" or "seconds". Six of these are holds -- planks, a wall sit, a
    #: single-leg balance -- and asking for twenty reps of a side plank is not a
    #: sentence. The client picks the metric from this rather than guessing.
    measure: str = "reps"
    #: What the programme itself asks for, as a starting number.
    suggested_target: float | None = None


class AuthorableCatalogueOut(BaseModel):
    groups: list[str]
    metrics: list[AuthorableOut]
    exercises: list[AuthorableExerciseOut]


class CriterionCreateIn(BaseModel):
    """Two real decisions: what to measure, and the number to beat."""

    metric: str
    exercise_key: str | None = None
    target_type: TargetType = TargetType.ABSOLUTE
    value: float
    window_days: int | None = None
    required: bool = True
    #: Which phase this gates. Defaults to the one the player is in.
    phase_key: PhaseKey | None = None
    #: Set to a library criterion's key to tighten that one instead of adding a
    #: second, contradictory rule beside it.
    key: str | None = Field(default=None, max_length=64)


class EpisodeCriterionOut(ORMModel):
    id: int
    phase_key: PhaseKey
    key: str
    label_en: str
    help_en: str | None
    required: bool
    spec: dict[str, Any]
