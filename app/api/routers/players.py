from __future__ import annotations

from fastapi import APIRouter, status
from sqlalchemy import select

from app.api.deps import CurrentPlayer, CurrentUser, DbSession
from app.core.enums import Side
from app.data.position_norms import METRIC_UNITS, position_norm
from app.models.user import PlayerBaseline, PlayerProfile
from app.schemas.auth import PlayerProfileOut, ProfileUpdateIn, UserOut
from app.schemas.injury import BaselineIn, BaselineOut

router = APIRouter(prefix="/players", tags=["players"])


@router.get("/me", response_model=UserOut)
def get_me(user: CurrentUser) -> object:
    return user


@router.patch("/me/profile", response_model=PlayerProfileOut)
def update_profile(
    payload: ProfileUpdateIn, db: DbSession, player: CurrentPlayer
) -> PlayerProfile:
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(player, field, value)
    db.commit()
    db.refresh(player)
    return player


@router.get("/me/baselines", response_model=list[BaselineOut])
def list_baselines(db: DbSession, player: CurrentPlayer) -> list[PlayerBaseline]:
    return list(
        db.execute(
            select(PlayerBaseline)
            .where(PlayerBaseline.player_id == player.id)
            .order_by(PlayerBaseline.metric_key)
        ).scalars()
    )


@router.put("/me/baselines", response_model=BaselineOut, status_code=status.HTTP_200_OK)
def upsert_baseline(
    payload: BaselineIn, db: DbSession, player: CurrentPlayer
) -> PlayerBaseline:
    """Set the player's own reference value for a metric.

    Everything expressed as "% of baseline" resolves against this. Without one,
    the engine falls back to pre-injury history and then to the position norm.
    """
    row = db.execute(
        select(PlayerBaseline)
        .where(PlayerBaseline.player_id == player.id)
        .where(PlayerBaseline.metric_key == payload.metric_key)
        .where(PlayerBaseline.side == payload.side)
    ).scalar_one_or_none()
    if row is None:
        row = PlayerBaseline(player_id=player.id, metric_key=payload.metric_key, side=payload.side)
        db.add(row)
    row.value = payload.value
    row.unit = payload.unit or METRIC_UNITS.get(payload.metric_key)
    row.origin = "manual"
    row.note = payload.note
    db.commit()
    db.refresh(row)
    return row


@router.get("/me/reference-values")
def reference_values(player: CurrentPlayer) -> dict[str, object]:
    """What the engine would use as a target if the player has no personal baseline."""
    return {
        "position": str(player.position),
        "norms": {
            key: {"value": position_norm(player.position, key), "unit": unit}
            for key, unit in METRIC_UNITS.items()
        },
        "note": (
            "Position norms are configurable placeholders, not clinical reference data. "
            "A stored personal baseline always wins."
        ),
        "sides": [str(s) for s in Side],
    }
