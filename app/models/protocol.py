from __future__ import annotations

from typing import Any

from sqlalchemy import JSON, Enum, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.enums import InjurySite, PhaseKey, Position, Side
from app.db.base import Base, TimestampMixin


class Exercise(Base, TimestampMixin):
    """A rehab movement plus the rule MediaPipe scores it against."""

    __tablename__ = "exercise"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name_en: Mapped[str] = mapped_column(String(120))
    name_th: Mapped[str] = mapped_column(String(160))
    category: Mapped[str] = mapped_column(String(40))  # mobility|activation|strength|plyo|running
    cue_en: Mapped[str | None] = mapped_column(Text())
    cue_th: Mapped[str | None] = mapped_column(Text())
    equipment: Mapped[str | None] = mapped_column(String(120))
    demo_url: Mapped[str | None] = mapped_column(String(255))

    #: Serialised ``app.services.pose.rules.ExerciseRule`` -- what "good form" means.
    #: ``None`` means the movement is logged manually (no camera scoring).
    pose_rule: Mapped[dict[str, Any] | None] = mapped_column(JSON())

    prescriptions: Mapped[list[PhasePrescription]] = relationship(back_populates="exercise")


class Protocol(Base, TimestampMixin):
    """One of the 6 x 5 = 30 position/injury programmes."""

    __tablename__ = "protocol"
    __table_args__ = (UniqueConstraint("position", "injury_site", "version"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    position: Mapped[Position] = mapped_column(Enum(Position, native_enum=False), index=True)
    injury_site: Mapped[InjurySite] = mapped_column(Enum(InjurySite, native_enum=False), index=True)
    version: Mapped[int] = mapped_column(default=1)
    title_en: Mapped[str] = mapped_column(String(160))
    title_th: Mapped[str] = mapped_column(String(200))
    summary_en: Mapped[str | None] = mapped_column(Text())
    summary_th: Mapped[str | None] = mapped_column(Text())
    is_active: Mapped[bool] = mapped_column(default=True)

    phases: Mapped[list[ProtocolPhase]] = relationship(
        back_populates="protocol",
        cascade="all, delete-orphan",
        order_by="ProtocolPhase.order_index",
    )


class ProtocolPhase(Base, TimestampMixin):
    __tablename__ = "protocol_phase"
    __table_args__ = (UniqueConstraint("protocol_id", "phase_key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    protocol_id: Mapped[int] = mapped_column(ForeignKey("protocol.id", ondelete="CASCADE"))
    phase_key: Mapped[PhaseKey] = mapped_column(Enum(PhaseKey, native_enum=False))
    order_index: Mapped[int] = mapped_column(default=0)
    title_en: Mapped[str] = mapped_column(String(160))
    title_th: Mapped[str] = mapped_column(String(200))
    goal_en: Mapped[str | None] = mapped_column(Text())
    goal_th: Mapped[str | None] = mapped_column(Text())
    min_days: Mapped[int] = mapped_column(default=0)
    sessions_per_week: Mapped[int] = mapped_column(default=4)

    protocol: Mapped[Protocol] = relationship(back_populates="phases")
    prescriptions: Mapped[list[PhasePrescription]] = relationship(
        back_populates="phase",
        cascade="all, delete-orphan",
        order_by="PhasePrescription.order_index",
    )
    exit_criteria: Mapped[list[ExitCriterion]] = relationship(
        back_populates="phase",
        cascade="all, delete-orphan",
        order_by="ExitCriterion.order_index",
    )


class PhasePrescription(Base, TimestampMixin):
    """Dose: how much of an exercise this phase asks for."""

    __tablename__ = "phase_prescription"

    id: Mapped[int] = mapped_column(primary_key=True)
    phase_id: Mapped[int] = mapped_column(ForeignKey("protocol_phase.id", ondelete="CASCADE"))
    exercise_id: Mapped[int] = mapped_column(ForeignKey("exercise.id", ondelete="CASCADE"))
    order_index: Mapped[int] = mapped_column(default=0)

    sets: Mapped[int] = mapped_column(default=3)
    reps: Mapped[int | None] = mapped_column()
    hold_seconds: Mapped[float | None] = mapped_column()
    rest_seconds: Mapped[int] = mapped_column(default=60)
    tempo: Mapped[str | None] = mapped_column(String(16))  # e.g. "3-1-1-0"
    load_note_en: Mapped[str | None] = mapped_column(String(255))
    load_note_th: Mapped[str | None] = mapped_column(String(255))
    side_mode: Mapped[Side] = mapped_column(Enum(Side, native_enum=False), default=Side.BILATERAL)

    phase: Mapped[ProtocolPhase] = relationship(back_populates="prescriptions")
    exercise: Mapped[Exercise] = relationship(back_populates="prescriptions")


class ExitCriterion(Base, TimestampMixin):
    """A single, measurable gate. All ``required`` criteria of a phase must pass
    before the next phase unlocks."""

    __tablename__ = "exit_criterion"
    __table_args__ = (UniqueConstraint("phase_id", "key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    phase_id: Mapped[int] = mapped_column(ForeignKey("protocol_phase.id", ondelete="CASCADE"))
    key: Mapped[str] = mapped_column(String(64))
    order_index: Mapped[int] = mapped_column(default=0)
    label_en: Mapped[str] = mapped_column(String(160))
    label_th: Mapped[str] = mapped_column(String(200))
    help_en: Mapped[str | None] = mapped_column(Text())
    help_th: Mapped[str | None] = mapped_column(Text())
    required: Mapped[bool] = mapped_column(default=True)

    #: Serialised ``app.services.criteria.spec.CriterionSpec``.
    spec: Mapped[dict[str, Any]] = mapped_column(JSON())

    phase: Mapped[ProtocolPhase] = relationship(back_populates="exit_criteria")
