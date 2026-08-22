from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from app.core.enums import (
    CriterionSource,
    CriterionStatus,
    EpisodeStatus,
    InjurySite,
    PhaseKey,
    Position,
    Role,
    Side,
)
from app.models.injury import ClinicianSignoff
from app.models.metrics import MetricSample
from app.models.session import PainLog, RehabSession
from app.models.user import PlayerBaseline, User
from app.services.criteria.engine import evaluate_phase
from app.services.progression import advance_if_ready
from tests.conftest import make_episode, make_player


def add_metric(
    db: Session,
    episode,
    metric_key: str,
    value: float,
    *,
    source: CriterionSource = CriterionSource.POSE,
    side: Side | None = None,
    days_ago: float = 1,
    unit: str | None = None,
) -> None:
    db.add(
        MetricSample(
            player_id=episode.player_id,
            episode_id=episode.id,
            metric_key=metric_key,
            source=source,
            value=value,
            unit=unit,
            side=side,
            recorded_at=datetime.now(UTC) - timedelta(days=days_ago),
        )
    )
    db.flush()


def add_pain_logs(db: Session, episode, days: int, pain: float = 0.0) -> None:
    for d in range(days + 1):
        when = datetime.now(UTC) - timedelta(days=d)
        db.add(
            PainLog(
                episode_id=episode.id,
                recorded_at=when,
                pain_rest=pain,
                pain_activity=pain,
                confidence=90.0,
            )
        )
        for key in ("pro.pain_rest", "pro.pain_activity"):
            db.add(
                MetricSample(
                    player_id=episode.player_id,
                    episode_id=episode.id,
                    metric_key=key,
                    source=CriterionSource.PRO,
                    value=pain,
                    unit="NPRS",
                    recorded_at=when,
                )
            )
    db.flush()


def add_sessions(db: Session, episode, count: int) -> None:
    from app.core.enums import SessionStatus

    for i in range(count):
        db.add(
            RehabSession(
                episode_id=episode.id,
                phase_key=episode.current_phase,
                status=SessionStatus.COMPLETED,
                started_at=datetime.now(UTC) - timedelta(hours=6 * i),
            )
        )
    db.flush()


def find(gate, key: str):
    return next(c for c in gate.criteria if c.key == key)


# --------------------------------------------------------------------------
def test_absolute_criterion_reports_no_data_before_any_measurement(db, episode) -> None:
    gate = evaluate_phase(db, episode, PhaseKey.P1_PROTECT)
    rom = find(gate, "knee_rom")
    assert rom.status is CriterionStatus.NO_DATA
    assert rom.progress == 0.0
    assert gate.passed is False
    assert "knee_rom" in gate.blocking


def test_absolute_criterion_passes_once_the_number_clears_the_target(db, episode) -> None:
    add_metric(db, episode, "pose.knee_flexion_rom", 128.0, side=Side.LEFT)
    rom = find(evaluate_phase(db, episode, PhaseKey.P1_PROTECT), "knee_rom")
    assert rom.status is CriterionStatus.PASS
    assert rom.observed == 128.0
    assert rom.target == 120.0
    assert rom.progress == 1.0


def test_partial_progress_is_reported_so_the_app_can_draw_a_bar(db, episode) -> None:
    add_metric(db, episode, "pose.knee_flexion_rom", 90.0, side=Side.LEFT)
    rom = find(evaluate_phase(db, episode, PhaseKey.P1_PROTECT), "knee_rom")
    assert rom.status is CriterionStatus.FAIL
    assert rom.progress == pytest.approx(0.75, abs=0.01)


def test_injured_limb_scope_ignores_the_healthy_side(db, player) -> None:
    episode = make_episode(db, player, site=InjurySite.ACL, side=Side.LEFT)
    # A great number on the *uninjured* leg must not unlock anything.
    add_metric(db, episode, "pose.knee_flexion_rom", 140.0, side=Side.RIGHT)
    rom = find(evaluate_phase(db, episode, PhaseKey.P1_PROTECT), "knee_rom")
    assert rom.status is CriterionStatus.NO_DATA


def test_personal_baseline_beats_the_position_norm(db, player) -> None:
    episode = make_episode(db, player)  # winger
    db.add(
        PlayerBaseline(
            player_id=player.id,
            metric_key="health.running_speed",
            side=Side.BILATERAL,
            value=9.6,
            unit="m/s",
            origin="manual",
        )
    )
    db.flush()
    speed = find(evaluate_phase(db, episode, PhaseKey.P3_RUNNING), "speed_vs_baseline")
    assert speed.baseline_origin == "manual"
    assert speed.target == pytest.approx(9.6 * 0.90, abs=0.01)  # winger phase-3 gate is 90%


def test_the_same_injury_gets_a_different_speed_target_per_position(db) -> None:
    winger = make_player(db, "winger@rtpapp.com", Position.WINGER)
    centre_back = make_player(db, "cb@rtpapp.com", Position.CENTRE_BACK)
    w_gate = evaluate_phase(db, make_episode(db, winger), PhaseKey.P3_RUNNING)
    c_gate = evaluate_phase(db, make_episode(db, centre_back), PhaseKey.P3_RUNNING)

    w_speed = find(w_gate, "speed_vs_baseline")
    c_speed = find(c_gate, "speed_vs_baseline")
    assert w_speed.baseline_origin == "position_norm"
    assert w_speed.target > c_speed.target  # 90% of 8.9 vs 85% of 8.0
    assert w_speed.target == pytest.approx(8.9 * 0.90, abs=0.01)
    assert c_speed.target == pytest.approx(8.0 * 0.85, abs=0.01)


def test_limb_symmetry_index_compares_injured_against_healthy(db, player) -> None:
    episode = make_episode(db, player, site=InjurySite.HAMSTRING, side=Side.LEFT)
    add_metric(
        db, episode, "test.hop_triple", 4.0, source=CriterionSource.TEST, side=Side.LEFT
    )
    add_metric(
        db, episode, "test.hop_triple", 5.0, source=CriterionSource.TEST, side=Side.RIGHT
    )
    hop = find(evaluate_phase(db, episode, PhaseKey.P3_RUNNING), "hop_lsi")
    assert hop.observed == pytest.approx(80.0)  # 4.0 / 5.0
    assert hop.status is CriterionStatus.FAIL

    add_metric(
        db, episode, "test.hop_triple", 4.8, source=CriterionSource.TEST, side=Side.LEFT
    )
    hop = find(evaluate_phase(db, episode, PhaseKey.P3_RUNNING), "hop_lsi")
    assert hop.observed == pytest.approx(96.0)
    assert hop.status is CriterionStatus.PASS


def test_min_samples_stops_one_lucky_rep_from_clearing_a_gate(db, player) -> None:
    episode = make_episode(db, player, site=InjurySite.ACL, side=Side.LEFT)
    episode.current_phase = PhaseKey.P2_STRENGTH
    db.flush()
    add_metric(db, episode, "pose.slsq_knee_flexion", 72.0, side=Side.LEFT)
    depth = find(evaluate_phase(db, episode, PhaseKey.P2_STRENGTH), "slsq_depth")
    assert depth.status is CriterionStatus.NO_DATA  # needs 2 measurements
    assert depth.samples == 1

    add_metric(db, episode, "pose.slsq_knee_flexion", 68.0, side=Side.LEFT)
    depth = find(evaluate_phase(db, episode, PhaseKey.P2_STRENGTH), "slsq_depth")
    assert depth.status is CriterionStatus.PASS


def test_clinician_signoff_is_pending_until_a_clinician_signs(db, player) -> None:
    episode = make_episode(db, player)
    gate = evaluate_phase(db, episode, PhaseKey.P4_RETURN)
    clearance = find(gate, "clinician_clearance")
    assert clearance.status is CriterionStatus.PENDING_SIGNOFF

    clinician = User(
        email="physio@rtpapp.com", password_hash="x", full_name="Physio", role=Role.CLINICIAN
    )
    db.add(clinician)
    db.flush()
    db.add(
        ClinicianSignoff(
            episode_id=episode.id,
            clinician_id=clinician.id,
            phase_key=PhaseKey.P4_RETURN,
            criterion_key="clinician_clearance",
            approved=True,
        )
    )
    db.flush()
    clearance = find(evaluate_phase(db, episode, PhaseKey.P4_RETURN), "clinician_clearance")
    assert clearance.status is CriterionStatus.PASS


def test_optional_criteria_never_block_a_phase(db, episode) -> None:
    gate = evaluate_phase(db, episode, PhaseKey.P1_PROTECT)
    walking = find(gate, "walking_symmetry")
    assert walking.required is False
    assert walking.status is CriterionStatus.NO_DATA
    assert "walking_symmetry" not in gate.blocking


def _clear_phase_one(db: Session, episode) -> None:
    add_pain_logs(db, episode, days=7, pain=0.0)
    add_metric(db, episode, "pose.knee_flexion_rom", 130.0, side=Side.LEFT)
    add_sessions(db, episode, 30)


def test_advance_only_moves_the_player_when_every_gate_is_clean(db, player) -> None:
    episode = make_episode(db, player, days_ago=20)

    gate, advanced = advance_if_ready(db, episode)
    assert advanced is False
    assert episode.current_phase is PhaseKey.P1_PROTECT

    _clear_phase_one(db, episode)
    gate, advanced = advance_if_ready(db, episode)
    assert gate.passed is True, gate.blocking
    assert advanced is True
    assert episode.current_phase is PhaseKey.P2_STRENGTH
    assert episode.phase_started_at is not None


def test_minimum_time_in_phase_blocks_even_with_perfect_numbers(db, player) -> None:
    # Hamstring phase 1 demands 5 days; this player is 1 day in.
    episode = make_episode(db, player, days_ago=1)
    _clear_phase_one(db, episode)
    gate, advanced = advance_if_ready(db, episode)
    assert advanced is False
    assert "min_days_in_phase" in gate.blocking


def test_passing_the_last_phase_clears_the_player(db, player) -> None:
    episode = make_episode(db, player, days_ago=90)
    episode.current_phase = PhaseKey.P4_RETURN
    db.flush()

    add_pain_logs(db, episode, days=8, pain=0.0)
    add_sessions(db, episode, 40)
    add_metric(
        db, episode, "health.running_speed", 20.0, source=CriterionSource.HEALTH, unit="m/s"
    )
    add_metric(
        db,
        episode,
        "health.distance_high_speed",
        99999.0,
        source=CriterionSource.HEALTH,
        unit="m",
    )
    add_metric(db, episode, "pro.confidence", 95.0, source=CriterionSource.PRO)
    add_metric(
        db, episode, "test.change_of_direction", 99.0, source=CriterionSource.TEST
    )

    clinician = User(
        email="physio2@rtpapp.com", password_hash="x", full_name="Physio", role=Role.CLINICIAN
    )
    db.add(clinician)
    db.flush()
    db.add(
        ClinicianSignoff(
            episode_id=episode.id,
            clinician_id=clinician.id,
            phase_key=PhaseKey.P4_RETURN,
            criterion_key=None,
            approved=True,
        )
    )
    db.flush()

    gate, advanced = advance_if_ready(db, episode)
    assert gate.passed is True, gate.blocking
    assert advanced is True
    assert episode.status is EpisodeStatus.CLEARED
    assert episode.cleared_at is not None
