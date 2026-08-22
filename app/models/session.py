from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Enum,
    Float,
    ForeignKey,
    Index,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.enums import PhaseKey, SessionStatus, Side
from app.db.base import Base, TimestampMixin, UTCDateTime


class RehabSession(Base, TimestampMixin):
    """One workout the player did in front of the camera."""

    __tablename__ = "rehab_session"

    id: Mapped[int] = mapped_column(primary_key=True)
    episode_id: Mapped[int] = mapped_column(
        ForeignKey("injury_episode.id", ondelete="CASCADE"), index=True
    )
    phase_key: Mapped[PhaseKey] = mapped_column(Enum(PhaseKey, native_enum=False))
    status: Mapped[SessionStatus] = mapped_column(
        Enum(SessionStatus, native_enum=False), default=SessionStatus.IN_PROGRESS
    )
    started_at: Mapped[datetime] = mapped_column(UTCDateTime, index=True)
    ended_at: Mapped[datetime | None] = mapped_column(UTCDateTime)

    # Player self-report for the session as a whole.
    rpe: Mapped[float | None] = mapped_column(Float())  # 0-10 Borg CR10
    pain_during: Mapped[float | None] = mapped_column(Float())  # 0-10 NPRS
    pain_after: Mapped[float | None] = mapped_column(Float())
    note: Mapped[str | None] = mapped_column(Text())

    device: Mapped[str | None] = mapped_column(String(64))
    app_version: Mapped[str | None] = mapped_column(String(32))

    sets: Mapped[list[ExerciseSet]] = relationship(
        back_populates="session", cascade="all, delete-orphan", order_by="ExerciseSet.order_index"
    )

    @property
    def duration_seconds(self) -> float | None:
        if self.ended_at is None:
            return None
        return (self.ended_at - self.started_at).total_seconds()


class ExerciseSet(Base, TimestampMixin):
    __tablename__ = "exercise_set"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("rehab_session.id", ondelete="CASCADE"), index=True
    )
    exercise_id: Mapped[int] = mapped_column(ForeignKey("exercise.id", ondelete="RESTRICT"))
    prescription_id: Mapped[int | None] = mapped_column(
        ForeignKey("phase_prescription.id", ondelete="SET NULL")
    )
    order_index: Mapped[int] = mapped_column(default=0)
    side: Mapped[Side] = mapped_column(Enum(Side, native_enum=False), default=Side.BILATERAL)

    prescribed_reps: Mapped[int | None] = mapped_column()
    completed_reps: Mapped[int] = mapped_column(default=0)
    valid_reps: Mapped[int] = mapped_column(default=0)
    load_kg: Mapped[float | None] = mapped_column(Float())
    form_score: Mapped[float | None] = mapped_column(Float())  # 0-100, mean of valid reps

    session: Mapped[RehabSession] = relationship(back_populates="sets")
    reps: Mapped[list[RepRecord]] = relationship(
        back_populates="set", cascade="all, delete-orphan", order_by="RepRecord.rep_index"
    )


class RepRecord(Base, TimestampMixin):
    """Per-repetition output of the pose analyser.

    Raw landmark frames are *not* stored by default -- the phone streams them,
    the server scores them, and only the derived numbers are persisted. Set
    ``keep_frames`` on the upload to retain a downsampled trace for clinician
    review.
    """

    __tablename__ = "rep_record"
    __table_args__ = (Index("ix_rep_set_index", "set_id", "rep_index"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    set_id: Mapped[int] = mapped_column(ForeignKey("exercise_set.id", ondelete="CASCADE"))
    rep_index: Mapped[int] = mapped_column(default=0)

    is_valid: Mapped[bool] = mapped_column(default=True)
    form_score: Mapped[float] = mapped_column(Float(), default=0.0)  # 0-100
    tempo_seconds: Mapped[float | None] = mapped_column(Float())
    hold_seconds: Mapped[float | None] = mapped_column(Float())
    tracking_quality: Mapped[float] = mapped_column(Float(), default=1.0)  # 0-1

    #: ``{"knee_flexion_peak": 84.2, "trunk_lean_max": 9.1, ...}`` degrees / ratios.
    metrics: Mapped[dict[str, Any]] = mapped_column(JSON(), default=dict)
    #: ``[{"code": "trunk_lean_excess", "observed": 18.4, "limit": 12.0, ...}]``
    violations: Mapped[list[dict[str, Any]]] = mapped_column(JSON(), default=list)
    #: Optional downsampled landmark trace kept for clinician review.
    frames: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON())

    set: Mapped[ExerciseSet] = relationship(back_populates="reps")


class PainLog(Base, TimestampMixin):
    """Daily symptom check-in. Feeds the ``pro.*`` criteria namespace."""

    __tablename__ = "pain_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    episode_id: Mapped[int] = mapped_column(
        ForeignKey("injury_episode.id", ondelete="CASCADE"), index=True
    )
    recorded_at: Mapped[datetime] = mapped_column(UTCDateTime, index=True)

    pain_rest: Mapped[float] = mapped_column(Float(), default=0.0)  # NPRS 0-10
    pain_activity: Mapped[float] = mapped_column(Float(), default=0.0)
    pain_next_morning: Mapped[float | None] = mapped_column(Float())
    stiffness: Mapped[float | None] = mapped_column(Float())
    swelling: Mapped[float | None] = mapped_column(Float())
    #: Psychological readiness 0-100 (short ACL-RSI style single item).
    confidence: Mapped[float | None] = mapped_column(Float())
    note: Mapped[str | None] = mapped_column(Text())


class HealthSyncState(Base, TimestampMixin):
    """Per-device watermark so the phone only uploads new health records."""

    __tablename__ = "health_sync_state"

    id: Mapped[int] = mapped_column(primary_key=True)
    player_id: Mapped[int] = mapped_column(
        ForeignKey("player_profile.id", ondelete="CASCADE"), index=True
    )
    platform: Mapped[str] = mapped_column(String(32))
    device_id: Mapped[str] = mapped_column(String(128))
    last_synced_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    anchor: Mapped[str | None] = mapped_column(String(255))  # HKQueryAnchor / HC change token
    samples_ingested: Mapped[int] = mapped_column(default=0)
