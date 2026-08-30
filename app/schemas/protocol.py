from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict

from app.core.enums import InjurySite, PhaseKey, Position, Side


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class ExerciseOut(ORMModel):
    id: int
    key: str
    name_en: str
    name_th: str
    category: str
    cue_en: str | None
    cue_th: str | None
    equipment: str | None
    demo_url: str | None
    pose_rule: dict[str, Any] | None


class PrescriptionOut(ORMModel):
    id: int
    order_index: int
    sets: int
    reps: int | None
    hold_seconds: float | None
    rest_seconds: int
    tempo: str | None
    load_note_en: str | None
    load_note_th: str | None
    side_mode: Side
    exercise: ExerciseOut


class ExitCriterionOut(ORMModel):
    id: int
    key: str
    order_index: int
    label_en: str
    label_th: str
    help_en: str | None
    help_th: str | None
    required: bool
    spec: dict[str, Any]


class PhaseOut(ORMModel):
    id: int
    phase_key: PhaseKey
    order_index: int
    title_en: str
    title_th: str
    goal_en: str | None
    goal_th: str | None
    min_days: int
    sessions_per_week: int
    prescriptions: list[PrescriptionOut]
    exit_criteria: list[ExitCriterionOut]


class ProtocolSummaryOut(ORMModel):
    id: int
    key: str
    position: Position
    injury_site: InjurySite
    version: int
    title_en: str
    title_th: str
    summary_en: str | None
    summary_th: str | None


class ProtocolOut(ProtocolSummaryOut):
    phases: list[PhaseOut]


class PositionExtraOut(BaseModel):
    """One drill or test that a position adds on top of the shared injury plan."""

    key: str
    label_en: str
    phase_key: PhaseKey
    phase_order: int


class PositionOut(BaseModel):
    """What picking a position actually changes, so the app can say so up front.

    A player choosing a role is choosing a set of return-to-play targets, not a
    label. The running gates and the extra work below are read straight from
    ``app/data/protocols.py``, so the screen can never drift from the programme
    the player is really given.
    """

    key: Position
    label_en: str
    label_th: str
    blurb_en: str
    #: Sprint speed gate, as a percentage of the player's own pre-injury best.
    #: High-speed running volume gate for the final phase, same basis.
    extra_exercises: list[PositionExtraOut]
    extra_criteria: list[PositionExtraOut]
