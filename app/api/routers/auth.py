from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession
from app.core.config import settings
from app.core.enums import Position, Role
from app.core.security import create_access_token, hash_password, verify_password
from app.models.user import PlayerProfile, User
from app.schemas.auth import LoginIn, RegisterIn, TokenOut, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterIn, db: DbSession) -> User:
    existing = db.execute(select(User).where(User.email == payload.email)).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "email already registered")

    if payload.role is Role.PLAYER and payload.position is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "players must pick a position — it decides which protocol they get",
        )

    user = User(
        email=str(payload.email),
        password_hash=hash_password(payload.password),
        full_name=payload.full_name,
        role=payload.role,
        locale=payload.locale,
    )
    db.add(user)
    db.flush()

    if payload.role is Role.PLAYER:
        db.add(
            PlayerProfile(
                user_id=user.id,
                position=payload.position or Position.CENTRE_MIDFIELD,
                dominant_foot=payload.dominant_foot,
                date_of_birth=payload.date_of_birth,
                height_cm=payload.height_cm,
                body_mass_kg=payload.body_mass_kg,
            )
        )
    db.commit()
    db.refresh(user)
    return user


@router.post("/login", response_model=TokenOut)
def login(payload: LoginIn, db: DbSession) -> TokenOut:
    user = db.execute(select(User).where(User.email == payload.email)).scalar_one_or_none()
    # Same error for "no such user" and "wrong password" so the endpoint cannot
    # be used to enumerate registered emails.
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "incorrect email or password")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "account disabled")
    return TokenOut(
        access_token=create_access_token(user.id, user.role),
        expires_in_minutes=settings.access_token_ttl_minutes,
    )


@router.get("/me", response_model=UserOut)
def me(user: CurrentUser) -> User:
    return user
