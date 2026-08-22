from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.enums import CriterionSource, EpisodeStatus, HealthPlatform
from app.models.injury import InjuryEpisode
from app.models.metrics import MetricSample
from app.models.session import HealthSyncState
from app.models.user import PlayerProfile
from app.services.health.mapping import (
    HIGH_SPEED_THRESHOLD_MS,
    UnknownHealthType,
    convert,
    metric_for,
)


class HealthRecord(Protocol):
    """Shape of one incoming record (see ``app.schemas.health.HealthRecordIn``)."""

    type: str
    value: float
    unit: str | None
    start_at: datetime
    end_at: datetime | None
    external_id: str | None
    meta: dict | None


@dataclass(slots=True)
class IngestSummary:
    received: int = 0
    stored: int = 0
    duplicates: int = 0
    derived: int = 0
    skipped: list[dict] = field(default_factory=list)


def active_episode(db: Session, player_id: int, at: datetime | None = None) -> InjuryEpisode | None:
    stmt = (
        select(InjuryEpisode)
        .where(InjuryEpisode.player_id == player_id)
        .where(InjuryEpisode.status == EpisodeStatus.ACTIVE)
        .order_by(InjuryEpisode.injured_on.desc())
    )
    episode = db.execute(stmt).scalars().first()
    if episode is None or at is None:
        return episode
    injured_at = datetime.combine(episode.injured_on, datetime.min.time(), tzinfo=UTC)
    # Pre-injury readings stay unattached so they can serve as baselines.
    return episode if at >= injured_at else None


def ingest(
    db: Session,
    player: PlayerProfile,
    platform: HealthPlatform,
    records: Iterable[HealthRecord],
    device_id: str | None = None,
    anchor: str | None = None,
) -> IngestSummary:
    """Idempotently store health records. Re-sending the same records is a no-op.

    Deduplication uses the platform's own record UUID (``external_id``), so a
    phone that re-syncs a window it already sent cannot double-count a run.
    """
    summary = IngestSummary()
    records = list(records)
    summary.received = len(records)
    if not records:
        return summary

    incoming_ids = {r.external_id for r in records if r.external_id}
    existing: set[tuple[str, str]] = set()
    if incoming_ids:
        rows = db.execute(
            select(MetricSample.metric_key, MetricSample.external_id)
            .where(MetricSample.player_id == player.id)
            .where(MetricSample.external_id.in_(incoming_ids))
        ).all()
        existing = {(m, e) for m, e in rows}

    speed_by_day: dict[str, float] = defaultdict(float)
    new_rows: list[MetricSample] = []

    for record in records:
        metric_key = metric_for(platform, record.type)
        if metric_key is None:
            summary.skipped.append({"type": record.type, "reason": "unmapped_type"})
            continue
        try:
            value, unit = convert(metric_key, float(record.value), record.unit)
        except UnknownHealthType as exc:
            summary.skipped.append({"type": record.type, "reason": str(exc)})
            continue

        if record.external_id and (metric_key, record.external_id) in existing:
            summary.duplicates += 1
            continue

        start = _aware(record.start_at)
        episode = active_episode(db, player.id, start)
        new_rows.append(
            MetricSample(
                player_id=player.id,
                episode_id=episode.id if episode else None,
                metric_key=metric_key,
                source=CriterionSource.HEALTH,
                value=value,
                unit=unit,
                recorded_at=start,
                recorded_end=_aware(record.end_at) if record.end_at else None,
                platform=platform,
                external_id=record.external_id,
                meta=record.meta,
            )
        )
        if record.external_id:
            existing.add((metric_key, record.external_id))

        # Accumulate high-speed running distance from speed samples.
        if metric_key == "health.running_speed" and value >= HIGH_SPEED_THRESHOLD_MS:
            end = _aware(record.end_at) if record.end_at else None
            seconds = (end - start).total_seconds() if end else 1.0
            if seconds > 0:
                speed_by_day[start.date().isoformat()] += value * seconds

    db.add_all(new_rows)
    summary.stored = len(new_rows)
    summary.derived = _upsert_high_speed_distance(db, player, speed_by_day)

    if device_id:
        _update_sync_state(db, player, platform, device_id, anchor, summary.stored)

    db.flush()
    return summary


def _aware(dt: datetime) -> datetime:
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt.astimezone(UTC)


def _upsert_high_speed_distance(
    db: Session, player: PlayerProfile, by_day: dict[str, float]
) -> int:
    """Roll speed samples into a daily high-speed-running distance metric.

    Neither platform exposes HSR distance directly, but it is the number that
    actually tells you whether a winger is back to their normal running load,
    so we derive it: sum(speed x duration) for every sample above the threshold.
    """
    if not by_day:
        return 0
    written = 0
    for day, metres in by_day.items():
        external_id = f"derived:hsr:{day}"
        existing = db.execute(
            select(MetricSample)
            .where(MetricSample.player_id == player.id)
            .where(MetricSample.metric_key == "health.distance_high_speed")
            .where(MetricSample.external_id == external_id)
        ).scalar_one_or_none()
        recorded_at = datetime.fromisoformat(day).replace(tzinfo=UTC)
        if existing:
            existing.value += round(metres, 2)
        else:
            episode = active_episode(db, player.id, recorded_at)
            db.add(
                MetricSample(
                    player_id=player.id,
                    episode_id=episode.id if episode else None,
                    metric_key="health.distance_high_speed",
                    source=CriterionSource.HEALTH,
                    value=round(metres, 2),
                    unit="m",
                    recorded_at=recorded_at,
                    platform=HealthPlatform.OTHER,
                    external_id=external_id,
                    meta={"derived_from": "health.running_speed", "threshold_ms": 5.5},
                )
            )
        written += 1
    return written


def _update_sync_state(
    db: Session,
    player: PlayerProfile,
    platform: HealthPlatform,
    device_id: str,
    anchor: str | None,
    stored: int,
) -> None:
    state = db.execute(
        select(HealthSyncState)
        .where(HealthSyncState.player_id == player.id)
        .where(HealthSyncState.platform == str(platform))
        .where(HealthSyncState.device_id == device_id)
    ).scalar_one_or_none()
    if state is None:
        state = HealthSyncState(
            player_id=player.id, platform=str(platform), device_id=device_id
        )
        db.add(state)
    state.last_synced_at = datetime.now(UTC)
    # Column defaults are applied at flush, so a freshly built row still has None.
    state.samples_ingested = (state.samples_ingested or 0) + stored
    if anchor:
        state.anchor = anchor
