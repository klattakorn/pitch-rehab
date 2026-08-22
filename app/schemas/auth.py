from __future__ import annotations

from datetime import date

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.core.enums import Position, Role, Side


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str = Field(min_length=1, max_length=160)
    role: Role = Role.PLAYER
    locale: str = "th"

    # Player fields -- ignored for clinician/admin registrations.
    position: Position | None = None
    dominant_foot: Side = Side.RIGHT
    date_of_birth: date | None = None
    height_cm: float | None = None
    body_mass_kg: float | None = None


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in_minutes: int


class PlayerProfileOut(ORMModel):
    id: int
    position: Position
    secondary_position: Position | None
    dominant_foot: Side
    date_of_birth: date | None
    height_cm: float | None
    body_mass_kg: float | None
    training_days_per_week: int
    team_id: int | None


class UserOut(ORMModel):
    id: int
    email: EmailStr
    full_name: str
    role: Role
    locale: str
    is_active: bool
    profile: PlayerProfileOut | None = None


class ProfileUpdateIn(BaseModel):
    position: Position | None = None
    secondary_position: Position | None = None
    dominant_foot: Side | None = None
    date_of_birth: date | None = None
    height_cm: float | None = None
    body_mass_kg: float | None = None
    training_days_per_week: int | None = None
