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
