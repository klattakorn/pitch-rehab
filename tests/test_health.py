from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.core.enums import Aggregate, CriterionSource, HealthPlatform, MetricScope
from app.schemas.health import HealthRecordIn
from app.services.criteria.resolver import MetricResolver
from app.services.health.ingest import ingest
from app.services.health.mapping import UnknownHealthType, convert, metric_for


def record(type_: str, value: float, unit: str | None, minutes_ago: int, uid: str | None = None):
    start = datetime.now(UTC) - timedelta(minutes=minutes_ago)
    return HealthRecordIn(
        type=type_,
        value=value,
        unit=unit,
        start_at=start,
        end_at=start + timedelta(seconds=60),
        external_id=uid,
    )


def test_platform_types_map_to_canonical_metrics() -> None:
    assert (
        metric_for(HealthPlatform.APPLE_HEALTH, "HKQuantityTypeIdentifierRunningSpeed")
        == "health.running_speed"
    )
    assert metric_for(HealthPlatform.HEALTH_CONNECT, "SpeedRecord") == "health.running_speed"
    assert metric_for(HealthPlatform.APPLE_HEALTH, "HKQuantityTypeIdentifierAudioExposure") is None


def test_units_are_converted_not_trusted() -> None:
    assert convert("health.running_speed", 32.4, "km/h") == (pytest.approx(9.0), "m/s")
    assert convert("health.distance_total", 5.0, "km") == (5000.0, "m")
    assert convert("health.sleep_hours", 480.0, "min") == (8.0, "h")
    with pytest.raises(UnknownHealthType):
        convert("health.running_speed", 9.0, "furlongs/fortnight")


def test_sync_stores_records_and_attaches_them_to_the_active_episode(db, episode) -> None:
    player = episode.player
    summary = ingest(
        db,
        player,
        HealthPlatform.APPLE_HEALTH,
        [
            record("HKQuantityTypeIdentifierRunningSpeed", 7.4, "m/s", 30, "uuid-1"),
            record("HKQuantityTypeIdentifierStepCount", 812, "count", 40, "uuid-2"),
        ],
        device_id="iphone-test",
    )
    assert summary.received == 2
    assert summary.stored == 2
    assert summary.duplicates == 0

    resolver = MetricResolver(db, episode)
    value, samples = resolver.aggregate("health.running_speed", Aggregate.MAX, 7, MetricScope.ANY)
    assert value == pytest.approx(7.4)
    assert samples.unit == "m/s"


def test_resyncing_the_same_records_is_a_no_op(db, episode) -> None:
    player = episode.player
    records = [record("HKQuantityTypeIdentifierRunningSpeed", 8.1, "m/s", 20, "dup-uuid")]

    first = ingest(db, player, HealthPlatform.APPLE_HEALTH, records)
    second = ingest(db, player, HealthPlatform.APPLE_HEALTH, records)

    assert first.stored == 1
    assert second.stored == 0
    assert second.duplicates == 1

    resolver = MetricResolver(db, episode)
    _, samples = resolver.aggregate("health.running_speed", Aggregate.MAX, 7)
    assert samples.count == 1


def test_unmapped_types_are_reported_rather_than_swallowed(db, episode) -> None:
    summary = ingest(
        db,
        episode.player,
        HealthPlatform.APPLE_HEALTH,
        [record("HKQuantityTypeIdentifierHeadphoneAudioExposure", 70, "dB", 10, "noise-1")],
    )
    assert summary.stored == 0
    assert summary.skipped == [
        {"type": "HKQuantityTypeIdentifierHeadphoneAudioExposure", "reason": "unmapped_type"}
    ]


def test_high_speed_running_distance_is_derived_from_speed_samples(db, episode) -> None:
    """Neither platform exposes HSR distance, but it is the number that decides
    whether a winger is back to their normal running load."""
    ingest(
        db,
        episode.player,
        HealthPlatform.APPLE_HEALTH,
        [
            record("HKQuantityTypeIdentifierRunningSpeed", 7.0, "m/s", 60, "fast-1"),
            record("HKQuantityTypeIdentifierRunningSpeed", 6.0, "m/s", 59, "fast-2"),
            record("HKQuantityTypeIdentifierRunningSpeed", 3.0, "m/s", 58, "slow-1"),
        ],
    )
    resolver = MetricResolver(db, episode)
    value, _ = resolver.aggregate("health.distance_high_speed", Aggregate.SUM, 7)
    # 60s at 7 m/s + 60s at 6 m/s; the 3 m/s jog is below the threshold.
    assert value == pytest.approx(780.0)


def test_pre_injury_history_becomes_the_baseline(db, player) -> None:
    from app.models.metrics import MetricSample
    from tests.conftest import make_episode

    episode = make_episode(db, player, days_ago=10)
    for i in range(6):
        db.add(
            MetricSample(
                player_id=player.id,
                metric_key="health.running_speed",
                source=CriterionSource.HEALTH,
                value=9.0 + i * 0.1,
                unit="m/s",
                recorded_at=datetime.now(UTC) - timedelta(days=20 + i),
            )
        )
    db.flush()

    baseline, origin = MetricResolver(db, episode).baseline("health.running_speed")
    assert origin == "pre_injury_history"
    assert baseline == pytest.approx(9.45, abs=0.1)
