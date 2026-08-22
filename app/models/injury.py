from __future__ import annotations

from datetime import date, datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import JSON, Date, Enum, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.enums import (
    EpisodeStatus,
    InjurySite,
    PhaseKey,
    Severity,
    Side,
)
from app.db.base import Base, TimestampMixin, UTCDateTime

if TYPE_CHECKING:
    from app.models.protocol import Protocol
    from app.models.user import PlayerProfile


class InjuryEpisode(Base, TimestampMixin):
    """One injury, from the day it happened until the player is cleared."""

    __tablename__ = "injury_episode"

    id: Mapped[int] = mapped_column(primary_key=True)
    player_id: Mapped[int] = mapped_column(
        ForeignKey("player_profile.id", ondelete="CASCADE"), index=True
    )
    protocol_id: Mapped[int | None] = mapped_column(ForeignKey("protocol.id", ondelete="SET NULL"))

    injury_site: Mapped[InjurySite] = mapped_column(Enum(InjurySite, native_enum=False))
    side: Mapped[Side] = mapped_column(Enum(Side, native_enum=False))
    severity: Mapped[Severity] = mapped_column(
        Enum(Severity, native_enum=False), default=Severity.GRADE_1
    )
    diagnosis: Mapped[str | None] = mapped_column(String(200))
    mechanism: Mapped[str | None] = mapped_column(Text())
    injured_on: Mapped[date] = mapped_column(Date())
    surgery_on: Mapped[date | None] = mapped_column(Date())

    status: Mapped[EpisodeStatus] = mapped_column(
        Enum(EpisodeStatus, native_enum=False), default=EpisodeStatus.ACTIVE, index=True
    )
    current_phase: Mapped[PhaseKey] = mapped_column(
        Enum(PhaseKey, native_enum=False), default=PhaseKey.P1_PROTECT
    )
    phase_started_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    cleared_at: Mapped[datetime | None] = mapped_column(UTCDateTime)

    player: Mapped[PlayerProfile] = relationship(back_populates="episodes")
    protocol: Mapped[Protocol | None] = relationship()
    phase_attempts: Mapped[list[PhaseAttempt]] = relationship(
        back_populates="episode", cascade="all, delete-orphan"
    )

    @property
    def uninjured_side(self) -> Side | None:
        if self.side is Side.LEFT:
            return Side.RIGHT
        if self.side is Side.RIGHT:
            return Side.LEFT
        return None


class PhaseAttempt(Base, TimestampMixin):
    """Audit trail of every gate evaluation that changed a player's phase.

    Kept immutable so a clinician can always answer "why was this player cleared?".
    """

    __tablename__ = "phase_attempt"

    id: Mapped[int] = mapped_column(primary_key=True)
    episode_id: Mapped[int] = mapped_column(
        ForeignKey("injury_episode.id", ondelete="CASCADE"), index=True
    )
    phase_key: Mapped[PhaseKey] = mapped_column(Enum(PhaseKey, native_enum=False))
    entered_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    passed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    passed: Mapped[bool] = mapped_column(default=False)

    #: Frozen copy of the ``PhaseGateResult`` at the moment of the decision.
    snapshot: Mapped[dict[str, Any] | None] = mapped_column(JSON())

    episode: Mapped[InjuryEpisode] = relationship(back_populates="phase_attempts")


class ClinicianSignoff(Base, TimestampMixin):
    """Human override / approval. Backs ``manual.*`` exit criteria."""

    __tablename__ = "clinician_signoff"

    id: Mapped[int] = mapped_column(primary_key=True)
    episode_id: Mapped[int] = mapped_column(
        ForeignKey("injury_episode.id", ondelete="CASCADE"), index=True
    )
    clinician_id: Mapped[int] = mapped_column(ForeignKey("app_user.id", ondelete="RESTRICT"))
    phase_key: Mapped[PhaseKey] = mapped_column(Enum(PhaseKey, native_enum=False))
    #: ``None`` signs off the whole phase; otherwise the specific criterion key.
    criterion_key: Mapped[str | None] = mapped_column(String(64))
    approved: Mapped[bool] = mapped_column(default=True)
    note: Mapped[str | None] = mapped_column(Text())


class EpisodeCriterion(Base, TimestampMixin):
    """An exit criterion this player added to their own rehab.

    The library-authored criteria hang off ``ProtocolPhase`` and are shared by
    every player on that protocol, so a personal one cannot live there -- it
    would appear in 41 other people's rehab. These are scoped to one episode.

    ``key`` is what ties the two together. A custom criterion whose key matches
    a library one *replaces* it for this player, which is how "the standard
    sprint gate, but 95% instead of 90%" is expressed. A new key is simply an
    extra test on top.

    Deliberately shaped like ``ExitCriterion``: the same field names, so the
    engine evaluates both without knowing or caring which it is holding.
    """

    __tablename__ = "episode_criterion"
    __table_args__ = (UniqueConstraint("episode_id", "phase_key", "key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    episode_id: Mapped[int] = mapped_column(
        ForeignKey("injury_episode.id", ondelete="CASCADE"), index=True
    )
    phase_key: Mapped[PhaseKey] = mapped_column(Enum(PhaseKey, native_enum=False), index=True)

    key: Mapped[str] = mapped_column(String(64))
    label_en: Mapped[str] = mapped_column(String(200))
    label_th: Mapped[str] = mapped_column(String(200), default="")
    help_en: Mapped[str | None] = mapped_column(Text())
    help_th: Mapped[str | None] = mapped_column(Text())
    required: Mapped[bool] = mapped_column(default=True)
    order_index: Mapped[int] = mapped_column(default=0)

    #: A ``CriterionSpec``, same JSON shape the library stores.
    spec: Mapped[dict[str, Any]] = mapped_column(JSON())

    created_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("app_user.id", ondelete="SET NULL")
    )

    episode: Mapped[InjuryEpisode] = relationship()
