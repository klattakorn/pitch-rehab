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
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.enums import CriterionSource, Side
from app.db.base import Base, TimestampMixin, UTCDateTime


class MetricSample(Base, TimestampMixin):
    """Every number the exit-criteria engine can read, in one shape.

    Pose reps, field tests, questionnaires and app-derived adherence numbers
    all land here. Rich per-domain detail stays in its own table
    (``rep_record``, ``pain_log``, ...); this is the flat, append-only index the
    rule engine queries. ``metric_key`` is namespaced by source, e.g.
    ``pose.knee_flexion_peak``, ``test.hop_triple``.
    """

    __tablename__ = "metric_sample"
    __table_args__ = (
        Index("ix_metric_lookup", "player_id", "metric_key", "recorded_at"),
        Index("ix_metric_episode", "episode_id", "metric_key"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    player_id: Mapped[int] = mapped_column(
        ForeignKey("player_profile.id", ondelete="CASCADE"), index=True
    )
    episode_id: Mapped[int | None] = mapped_column(
        ForeignKey("injury_episode.id", ondelete="CASCADE")
    )
    session_id: Mapped[int | None] = mapped_column(
        ForeignKey("rehab_session.id", ondelete="SET NULL")
    )

    metric_key: Mapped[str] = mapped_column(String(80), index=True)
    source: Mapped[CriterionSource] = mapped_column(Enum(CriterionSource, native_enum=False))
    value: Mapped[float] = mapped_column(Float())
    unit: Mapped[str | None] = mapped_column(String(24))
    side: Mapped[Side | None] = mapped_column(Enum(Side, native_enum=False))

    recorded_at: Mapped[datetime] = mapped_column(UTCDateTime, index=True)
    recorded_end: Mapped[datetime | None] = mapped_column(UTCDateTime)

    meta: Mapped[dict[str, Any] | None] = mapped_column(JSON())
