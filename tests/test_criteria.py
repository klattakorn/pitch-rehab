from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.enums import (
    Comparator,
    CriterionSource,
    CriterionStatus,
    EpisodeStatus,
    InjurySite,
    PhaseKey,
    Position,
    Role,
    Side,
    TargetType,
)
from app.models.injury import ClinicianSignoff, EpisodeCriterion
from app.models.metrics import MetricSample
from app.models.session import PainLog, RehabSession
from app.models.user import PlayerBaseline, User
from app.services.criteria import authoring
from app.services.criteria.engine import evaluate_phase
from app.services.criteria.resolver import MetricResolver
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


def test_time_in_phase_is_a_visible_criterion_not_a_hidden_veto(db, player) -> None:
    """A player who cleared everything but is too early must be told why.

    This used to live only in ``gate.blocking``, which no screen reads. The
    result was the worst kind of dead end: a full ring, every row ticked, and a
    message telling the player to pass tests they had already passed -- with the
    actual reason present in the payload and absent from the app.
    """
    episode = make_episode(db, player, days_ago=1)
    _clear_phase_one(db, episode)
    gate = evaluate_phase(db, episode)

    assert gate.passed is False
    # Whatever is stopping them has to be something they can see.
    keys = {c.key for c in gate.criteria}
    assert set(gate.blocking) <= keys, "a blocker with no row on the screen"

    clock = next(c for c in gate.criteria if c.key == "min_days_in_phase")
    assert clock.required is True
    assert clock.status is CriterionStatus.FAIL
    assert clock.observed is not None and clock.target is not None
    assert clock.observed < clock.target
    assert clock.unit == "days"
    # And the counts must agree with it, or the screen contradicts itself.
    assert gate.required_passed < gate.required_total


def test_time_in_phase_passes_once_served_and_stops_blocking(db, player) -> None:
    episode = make_episode(db, player, days_ago=30)
    _clear_phase_one(db, episode)
    gate = evaluate_phase(db, episode)

    clock = next(c for c in gate.criteria if c.key == "min_days_in_phase")
    assert clock.status is CriterionStatus.PASS
    assert gate.blocking == []
    assert gate.passed is True


def test_a_timed_exercise_is_measured_in_seconds_not_reps(db, player) -> None:
    """Six of the camera-scored movements are holds, and reps make no sense for them.

    A side plank has no repetitions. Before there was a seconds metric, the only
    per-exercise target the builder offered was reps, so anyone setting a target
    on a plank got a criterion counting something the analyser never produces --
    permanently unmet, with nothing on screen to explain it.
    """
    from app.models.session import RepRecord

    episode = make_episode(db, player, days_ago=30)
    sets = add_exercise_sets(db, episode, "side_plank", reps=[1, 1])
    # The analyser writes the timed hold onto the rep, not the set.
    db.add_all(
        [
            RepRecord(set_id=sets[0].id, rep_index=0, is_valid=True, hold_seconds=18.0),
            RepRecord(set_id=sets[1].id, rep_index=0, is_valid=True, hold_seconds=34.5),
        ]
    )
    db.flush()

    resolver = MetricResolver(db, episode)
    samples = resolver.fetch("session.hold.side_plank", None)
    # The best single effort, not the total of both.
    assert samples.values == [34.5]
    assert samples.unit == "seconds"


def test_a_hold_that_was_never_timed_reports_nothing_rather_than_zero(db, player) -> None:
    episode = make_episode(db, player, days_ago=30)
    add_exercise_sets(db, episode, "side_plank", reps=[1])
    resolver = MetricResolver(db, episode)
    # No rep records, so no hold was timed. Zero would read as "held for no time
    # at all", which is a different and wrong claim.
    assert MetricResolver(db, episode).fetch("session.hold.side_plank", None).values == []
    assert resolver.fetch("session.hold.side_plank", None).unit == "seconds"


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


# --------------------------------------------------------------------------
# criteria the player writes themselves
# --------------------------------------------------------------------------
def add_exercise_sets(
    db: Session,
    episode,
    exercise_key: str,
    reps: list[int],
    *,
    form: float | None = 90.0,
    days_ago: float = 1,
) -> list:
    """One completed session holding one set per entry in ``reps``."""
    from app.core.enums import SessionStatus
    from app.models.protocol import Exercise
    from app.models.session import ExerciseSet

    exercise = db.execute(
        select(Exercise).where(Exercise.key == exercise_key)
    ).scalar_one()
    session = RehabSession(
        episode_id=episode.id,
        phase_key=episode.current_phase,
        status=SessionStatus.COMPLETED,
        started_at=datetime.now(UTC) - timedelta(days=days_ago),
    )
    db.add(session)
    db.flush()
    rows = [
        ExerciseSet(
            session_id=session.id,
            exercise_id=exercise.id,
            order_index=index,
            completed_reps=count,
            valid_reps=count,
            form_score=form,
        )
        for index, count in enumerate(reps)
    ]
    db.add_all(rows)
    db.flush()
    return rows


def add_custom(
    db: Session,
    episode,
    *,
    metric: str,
    value: float,
    exercise_key: str | None = None,
    target_type: TargetType = TargetType.ABSOLUTE,
    key: str | None = None,
    phase_key: PhaseKey | None = None,
) -> EpisodeCriterion:
    """Build a criterion the way the endpoint does, without the HTTP hop."""
    item = authoring.resolve(metric)
    exercise = authoring.check_exercise(db, item, exercise_key)
    checked = authoring.check_value(item, target_type, value)
    row = EpisodeCriterion(
        episode_id=episode.id,
        phase_key=phase_key or episode.current_phase,
        key=key or authoring.build_key(item, exercise_key, target_type),
        label_en=authoring.build_label(
            item, exercise=exercise, target_type=target_type, value=checked
        ),
        required=True,
        spec=authoring.build_spec(
            item,
            exercise_key=exercise_key,
            target_type=target_type,
            value=checked,
            window_days=None,
        ).model_dump(mode="json"),
    )
    db.add(row)
    db.flush()
    return row


def test_a_custom_criterion_joins_the_gate(db, episode) -> None:
    before = evaluate_phase(db, episode)
    add_custom(db, episode, metric="health.running_speed", value=7.5)
    after = evaluate_phase(db, episode)

    assert after.required_total == before.required_total + 1
    mine = find(after, "custom_health_running_speed")
    assert mine.label_en == "Run at least 7.5 m/s"
    assert mine.status is CriterionStatus.NO_DATA

    add_metric(
        db, episode, "health.running_speed", 7.9,
        source=CriterionSource.HEALTH, unit="m/s",
    )
    assert find(evaluate_phase(db, episode), "custom_health_running_speed").passed


def test_reps_of_an_exercise_read_the_best_single_set(db, episode) -> None:
    """"Do 20 reps" means twenty in a row.

    Summing sets would let a player clear the gate with two sets of ten spread
    over a fortnight, having never once done the thing the gate is about.
    """
    add_custom(
        db, episode,
        metric="session.reps",
        exercise_key="single_leg_calf_raise",
        value=20,
    )
    key = "custom_session_reps_single_leg_calf_raise"
    assert find(evaluate_phase(db, episode), key).status is CriterionStatus.NO_DATA

    # Three sets adding up to 24, but the best is 10. Nowhere near.
    add_exercise_sets(db, episode, "single_leg_calf_raise", [8, 10, 6])
    result = find(evaluate_phase(db, episode), key)
    assert result.observed == 10
    assert not result.passed

    add_exercise_sets(db, episode, "single_leg_calf_raise", [21])
    result = find(evaluate_phase(db, episode), key)
    assert result.observed == 21
    assert result.passed


def test_only_reps_the_camera_accepted_count(db, episode) -> None:
    add_custom(
        db, episode,
        metric="session.reps",
        exercise_key="single_leg_calf_raise",
        value=20,
    )
    # Twenty-five attempted, ten of them sloppy enough to be thrown out.
    (only_set,) = add_exercise_sets(db, episode, "single_leg_calf_raise", [25])
    only_set.valid_reps = 15
    db.flush()

    key = "custom_session_reps_single_leg_calf_raise"
    assert find(evaluate_phase(db, episode), key).observed == 15


def test_a_custom_criterion_replaces_the_library_one_with_the_same_key(db, episode) -> None:
    """"The standard gate, but stricter" is a change, not a second rule."""
    before = evaluate_phase(db, episode)
    library = find(before, "adherence")
    assert library.target == 70

    add_custom(db, episode, metric="session.adherence_pct", value=90, key="adherence")
    after = evaluate_phase(db, episode)

    assert after.required_total == before.required_total  # replaced, not added
    assert len([c for c in after.criteria if c.key == "adherence"]) == 1
    assert find(after, "adherence").target == 90


def test_one_players_custom_criterion_stays_theirs(db) -> None:
    """They hang off the episode, not the phase -- otherwise a personal target
    would appear in every other player's rehab on the same protocol."""
    mine = make_episode(db, make_player(db, "mine@rtpapp.com"), InjurySite.CALF)
    theirs = make_episode(db, make_player(db, "theirs@rtpapp.com"), InjurySite.CALF)
    assert mine.protocol_id == theirs.protocol_id  # same programme

    add_custom(db, mine, metric="health.running_speed", value=7.5)

    assert any(c.key.startswith("custom") for c in evaluate_phase(db, mine).criteria)
    assert not any(c.key.startswith("custom") for c in evaluate_phase(db, theirs).criteria)


def test_a_custom_criterion_can_block_a_phase_that_would_otherwise_pass(db, episode) -> None:
    """The point of letting a player set their own bar is that it holds them."""
    # A hamstring in phase 1: no pain, full knee range, sessions actually done.
    add_pain_logs(db, episode, days=6, pain=0.0)
    # scope=injured, so the reading has to be on the injured side
    add_metric(db, episode, "pose.knee_flexion_rom", 132.0, side=Side.LEFT)
    add_sessions(db, episode, 30)
    assert evaluate_phase(db, episode).passed, evaluate_phase(db, episode).blocking

    add_custom(
        db, episode,
        metric="session.reps",
        exercise_key="single_leg_calf_raise",
        value=25,
    )
    gate = evaluate_phase(db, episode)
    assert not gate.passed
    assert "custom_session_reps_single_leg_calf_raise" in gate.blocking


def test_the_builder_refuses_a_metric_nothing_ever_writes(db, episode) -> None:
    """A free-text metric field would let someone create a test that can never
    pass, because no part of the system produces that key."""
    with pytest.raises(authoring.AuthoringError, match="not something you can build"):
        authoring.resolve("health.runningspeed")


def test_the_builder_refuses_reps_on_a_hand_logged_drill(db, episode) -> None:
    item = authoring.resolve("session.reps")
    with pytest.raises(authoring.AuthoringError, match="logged by hand"):
        authoring.check_exercise(db, item, "adductor_squeeze")


def test_the_builder_refuses_a_comparison_the_metric_cannot_make(db) -> None:
    # Limb symmetry needs two limbs. Running speed is one number for the player.
    item = authoring.resolve("health.running_speed")
    with pytest.raises(authoring.AuthoringError, match="cannot be compared"):
        authoring.check_value(item, TargetType.LSI, 90)


def test_the_builder_refuses_a_number_that_is_not_a_target(db) -> None:
    item = authoring.resolve("health.running_speed")
    for bad in (0, -3, float("nan"), float("inf")):
        with pytest.raises(authoring.AuthoringError):
            authoring.check_value(item, TargetType.ABSOLUTE, bad)


def test_the_direction_of_the_comparison_is_not_the_players_to_choose(db, episode) -> None:
    """"Pain at rest of at least 8/10" is not a goal anyone means to set."""
    add_custom(db, episode, metric="pro.pain_rest", value=2, key="my_pain")
    spec = find(evaluate_phase(db, episode), "my_pain")
    assert spec.comparator is Comparator.LTE

    add_custom(db, episode, metric="health.running_speed", value=7, key="my_speed")
    assert find(evaluate_phase(db, episode), "my_speed").comparator is Comparator.GTE


def test_clinician_signoff_cannot_be_swapped_for_a_number(db, episode) -> None:
    """Phase 4 needs a human. It is the only check in the app that is not
    self-assessed, so it is the one thing a player cannot redefine."""
    with pytest.raises(authoring.AuthoringError, match="Clinician sign-off"):
        authoring.check_override(db, episode, PhaseKey.P4_RETURN, "clinician_clearance")

    # Everything else in phase 4 is fair game.
    authoring.check_override(db, episode, PhaseKey.P4_RETURN, "confidence")


def test_a_custom_criterion_can_gate_a_phase_the_player_is_not_in_yet(db, episode) -> None:
    add_custom(
        db, episode,
        metric="test.hop_triple",
        target_type=TargetType.LSI,
        value=95,
        phase_key=PhaseKey.P3_RUNNING,
    )
    assert not any(
        c.key.startswith("custom") for c in evaluate_phase(db, episode).criteria
    )
    later = evaluate_phase(db, episode, PhaseKey.P3_RUNNING)
    mine = find(later, "custom_test_hop_triple_lsi")
    assert mine.label_en == "Triple hop distance at least 95% of the other side"
    assert mine.target_type is TargetType.LSI
