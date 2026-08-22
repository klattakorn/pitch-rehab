from __future__ import annotations

from fastapi import APIRouter

from app.api.deps import CurrentPlayer, DbSession
from app.schemas.health import HealthSyncIn, HealthSyncOut, SupportedMetricsOut
from app.services.criteria.resolver import DERIVED_METRIC_KEYS
from app.services.health.ingest import ingest
from app.services.health.mapping import (
    APPLE_TYPE_MAP,
    CANONICAL_UNITS,
    HEALTH_CONNECT_TYPE_MAP,
)

router = APIRouter(prefix="/health", tags=["health"])


@router.post("/sync", response_model=HealthSyncOut)
def sync_health(payload: HealthSyncIn, db: DbSession, player: CurrentPlayer) -> HealthSyncOut:
    """Ingest a batch of records the app read from HealthKit or Health Connect.

    Neither platform has a server API, so the device is the only thing that can
    read the health store. Flow: the app requests read permission, queries with
    its saved anchor, POSTs the delta here, and stores the anchor we echo back.
    Re-sending records already stored is safe -- they are deduplicated on the
    platform's record UUID.
    """
    summary = ingest(
        db,
        player,
        payload.platform,
        payload.records,
        device_id=payload.device_id,
        anchor=payload.anchor,
    )
    db.commit()
    return HealthSyncOut(
        received=summary.received,
        stored=summary.stored,
        duplicates=summary.duplicates,
        derived=summary.derived,
        skipped=summary.skipped,
        anchor=payload.anchor,
    )


@router.get("/supported-metrics", response_model=SupportedMetricsOut)
def supported_metrics() -> SupportedMetricsOut:
    """What the app should ask permission for and send."""
    return SupportedMetricsOut(
        apple_health=APPLE_TYPE_MAP,
        health_connect=HEALTH_CONNECT_TYPE_MAP,
        canonical_units=CANONICAL_UNITS,
        derived=list(DERIVED_METRIC_KEYS) + ["health.distance_high_speed"],
        note=(
            "Anything not in these maps is ignored, so the app can send a whole "
            "batch without filtering. Request the narrowest HealthKit / Health "
            "Connect permission set that covers the metrics your protocol uses."
        ),
    )
