from __future__ import annotations

from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, Path, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.enums import Role
from app.core.security import decode_access_token
from app.db.session import get_db
from app.models.injury import InjuryEpisode
from app.models.user import PlayerProfile, User

bearer = HTTPBearer(auto_error=False)

DbSession = Annotated[Session, Depends(get_db)]


def get_current_user(
    db: DbSession,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)] = None,
) -> User:
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing bearer token")
    try:
        payload = decode_access_token(credentials.credentials)
    except jwt.PyJWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid or expired token") from exc

    user = db.get(User, int(payload["sub"]))
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "user not found or disabled")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def get_current_player(db: DbSession, user: CurrentUser) -> PlayerProfile:
    profile = db.execute(
        select(PlayerProfile).where(PlayerProfile.user_id == user.id)
    ).scalar_one_or_none()
    if profile is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "this account has no player profile — create one first",
        )
    return profile


CurrentPlayer = Annotated[PlayerProfile, Depends(get_current_player)]


def require_clinician(user: CurrentUser) -> User:
    if user.role not in (Role.CLINICIAN, Role.ADMIN):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "clinician role required")
    return user


Clinician = Annotated[User, Depends(require_clinician)]


def get_episode(
    db: DbSession,
    user: CurrentUser,
    episode_id: Annotated[int, Path()],
) -> InjuryEpisode:
    """Load an episode the caller is allowed to see.

    A player only ever sees their own; clinicians and admins see everyone's.
    """
    episode = db.get(InjuryEpisode, episode_id)
    if episode is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "injury episode not found")
    if user.role is Role.PLAYER:
        profile = db.execute(
            select(PlayerProfile).where(PlayerProfile.user_id == user.id)
        ).scalar_one_or_none()
        if profile is None or episode.player_id != profile.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "injury episode not found")
    return episode


Episode = Annotated[InjuryEpisode, Depends(get_episode)]
