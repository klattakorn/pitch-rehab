from __future__ import annotations

from datetime import date
from typing import TYPE_CHECKING

from sqlalchemy import Date, Enum, Float, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.enums import Position, Role, Side
from app.db.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.injury import InjuryEpisode


class Team(Base, TimestampMixin):
    __tablename__ = "team"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    country: Mapped[str | None] = mapped_column(String(2))

    players: Mapped[list[PlayerProfile]] = relationship(back_populates="team")


class User(Base, TimestampMixin):
    __tablename__ = "app_user"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(160))
    role: Mapped[Role] = mapped_column(Enum(Role, native_enum=False), default=Role.PLAYER)
    locale: Mapped[str] = mapped_column(String(5), default="th")
    is_active: Mapped[bool] = mapped_column(default=True)

    profile: Mapped[PlayerProfile | None] = relationship(
        back_populates="user", uselist=False, cascade="all, delete-orphan"
    )


class PlayerProfile(Base, TimestampMixin):
    """Everything the protocol engine needs to individualise a programme."""

    __tablename__ = "player_profile"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"), unique=True)
    team_id: Mapped[int | None] = mapped_column(ForeignKey("team.id", ondelete="SET NULL"))

    position: Mapped[Position] = mapped_column(Enum(Position, native_enum=False), index=True)
    secondary_position: Mapped[Position | None] = mapped_column(Enum(Position, native_enum=False))
    dominant_foot: Mapped[Side] = mapped_column(Enum(Side, native_enum=False), default=Side.RIGHT)

    date_of_birth: Mapped[date | None] = mapped_column(Date())
    height_cm: Mapped[float | None] = mapped_column(Float())
    body_mass_kg: Mapped[float | None] = mapped_column(Float())
    training_days_per_week: Mapped[int] = mapped_column(default=3)

    user: Mapped[User] = relationship(back_populates="profile")
    team: Mapped[Team | None] = relationship(back_populates="players")
    episodes: Mapped[list[InjuryEpisode]] = relationship(
        back_populates="player", cascade="all, delete-orphan"
    )

    @property
    def age(self) -> int | None:
        if self.date_of_birth is None:
            return None
        today = date.today()
        had_birthday = (today.month, today.day) >= (
            self.date_of_birth.month,
            self.date_of_birth.day,
        )
        return today.year - self.date_of_birth.year - (0 if had_birthday else 1)


class PlayerBaseline(Base, TimestampMixin):
    """Pre-injury (or healthy-limb) reference value for a metric.

    ``percent_of_baseline`` exit criteria resolve against this table. If a player has
    no stored baseline, the engine falls back to the position default in
    ``app/data/position_norms.py`` so a first-time user still gets a real target.
    """

    __tablename__ = "player_baseline"
    __table_args__ = (UniqueConstraint("player_id", "metric_key", "side"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    player_id: Mapped[int] = mapped_column(
        ForeignKey("player_profile.id", ondelete="CASCADE"), index=True
    )
    metric_key: Mapped[str] = mapped_column(String(80), index=True)
    side: Mapped[Side] = mapped_column(Enum(Side, native_enum=False), default=Side.BILATERAL)
    value: Mapped[float] = mapped_column(Float())
    unit: Mapped[str | None] = mapped_column(String(24))
    origin: Mapped[str] = mapped_column(String(32), default="manual")  # manual|test|derived
    note: Mapped[str | None] = mapped_column(String(255))
