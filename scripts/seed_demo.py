"""Build a demo player who is three weeks into a rehab.

    python scripts/seed_demo.py

A brand new account is honest and useless to show anyone: every chart says
"nothing measured yet", the ring reads 0%, and the testing screen is a list of
things nobody has done. That is correct, and it is a terrible first impression.

This creates one player with a real history behind them -- sessions that
happened, form scores that improved, pain that came down, strength that was
lopsided and is converging -- so the Progress screen has something to draw and
the gate has something to say.

It is also the reset button. Re-running wipes the demo player and rebuilds them
from scratch, so a rehearsal that ends halfway through a session can be undone
in three seconds.

**Only the demo account is touched.** Any other player in the database is left
exactly as they are.

Options:

    --blocker form_quality   which criterion to leave unmet (default)
    --blocker slsq_valgus    ...or leave the knee-control one open instead
    --blocker none           everything passes; the phase is ready to advance
    --list                   show the choices and exit
"""

from __future__ import annotations

import argparse
import random
import sys
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select  # noqa: E402

from app.core.enums import (  # noqa: E402
    CriterionSource,
    EpisodeStatus,
    InjurySite,
    PhaseKey,
    Position,
    Role,
    SessionStatus,
    Severity,
    Side,
    TargetType,
)
from app.core.security import hash_password  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402
from app.models.injury import EpisodeCriterion, InjuryEpisode, PhaseAttempt  # noqa: E402
from app.models.metrics import MetricSample  # noqa: E402
from app.models.protocol import Exercise  # noqa: E402
from app.models.session import ExerciseSet, PainLog, RehabSession  # noqa: E402
from app.models.user import PlayerBaseline, PlayerProfile, User  # noqa: E402
from app.services.criteria import authoring  # noqa: E402
from app.services.criteria.engine import evaluate_phase  # noqa: E402
from app.services.progression import select_protocol  # noqa: E402

EMAIL = "demo@pitchrehab.app"
PASSWORD = "correct-horse-battery"
FULL_NAME = "Alex Mercer"

#: Weeks of history. Long enough for a trend, short enough to stay in one phase.
DAYS = 21
#: The programme says four sessions a week; the demo player does most of them.
SESSIONS_PER_WEEK = 4

#: Phase 2 for a winger with an ACL. The exercises the camera scores.
PHASE_EXERCISES = [
    "single_leg_squat",
    "step_down",
    "wall_sit",
    "single_leg_rdl",
    "single_leg_calf_raise",
]

BLOCKERS = {
    "form_quality": (
        "Movement quality, a whisker under the bar. Read as a 14-day mean, so a "
        "good set nudges it rather than flipping it -- which is the engine "
        "working as designed. Show it as what is still holding the player back."
    ),
    "slsq_valgus": (
        "Knee control on the single-leg squat. A median over 14 days, so a few "
        "clean single-leg squats move it and one does not."
    ),
    "none": "Nothing left. The phase is ready to advance the moment you open it.",
}

#: One live set does not clear a gate, and that is on purpose -- `min_samples`
#: and median aggregates exist so nobody is let back on the strength of one
#: lucky rep. Worth saying out loud rather than engineering a fake flip.
DAMPING_NOTE = (
    "None of these flip from a single set, deliberately: the criteria use "
    "medians and minimum sample counts so one good rep cannot clear a player. "
    "If you want the phase to advance live, run with --blocker none."
)

# The seed is fixed so two runs produce the same player. A demo that looks
# slightly different every rehearsal is a demo you cannot rehearse.
rng = random.Random(20260906)


def wipe(db) -> bool:  # noqa: ANN001
    """Remove the demo account and everything hanging off it. Nobody else."""
    user = db.execute(select(User).where(User.email == EMAIL)).scalar_one_or_none()
    if user is None:
        return False
    db.delete(user)  # cascades to profile -> episodes -> sessions -> sets
    db.flush()
    return True


def make_player(db) -> PlayerProfile:  # noqa: ANN001
    user = User(
        email=EMAIL,
        password_hash=hash_password(PASSWORD),
        full_name=FULL_NAME,
        role=Role.PLAYER,
        locale="en",
    )
    db.add(user)
    db.flush()

    profile = PlayerProfile(
        user_id=user.id,
        position=Position.WINGER,
        dominant_foot=Side.RIGHT,
        date_of_birth=date(2004, 3, 14),
        height_cm=178.0,
        body_mass_kg=72.0,
        training_days_per_week=5,
    )
    db.add(profile)
    db.flush()

    # A pre-injury top speed, so the phase 3 and 4 running gates compare against
    # this player rather than against the position average.
    db.add(
        PlayerBaseline(
            player_id=profile.id,
            metric_key="health.running_speed",
            side=Side.BILATERAL,
            value=8.6,
            unit="m/s",
            origin="manual",
            note="GPS vest, pre-season",
        )
    )
    db.flush()
    return profile


def make_episode(db, profile: PlayerProfile) -> InjuryEpisode:  # noqa: ANN001
    """An ACL reconstruction, ten weeks post-op, three weeks into phase 2."""
    now = datetime.now(UTC)
    episode = InjuryEpisode(
        player_id=profile.id,
        injury_site=InjurySite.ACL,
        side=Side.LEFT,
        severity=Severity.GRADE_3,
        diagnosis="Left ACL rupture, hamstring autograft reconstruction",
        mechanism="Non-contact, cutting inside off the left foot",
        injured_on=(now - timedelta(days=74)).date(),
        surgery_on=(now - timedelta(days=60)).date(),
        status=EpisodeStatus.ACTIVE,
        current_phase=PhaseKey.P2_STRENGTH,
        phase_started_at=now - timedelta(days=DAYS),
    )
    db.add(episode)
    db.flush()

    protocol = select_protocol(db, episode)
    if protocol is None:
        raise SystemExit("No protocol for winger + ACL. Has the library been seeded?")
    episode.protocol_id = protocol.id

    # Phase 1 happened and was cleared; phase 2 is open.
    db.add_all(
        [
            PhaseAttempt(
                episode_id=episode.id,
                phase_key=PhaseKey.P1_PROTECT,
                entered_at=now - timedelta(days=DAYS + 26),
                passed_at=now - timedelta(days=DAYS),
                passed=True,
            ),
            PhaseAttempt(
                episode_id=episode.id,
                phase_key=PhaseKey.P2_STRENGTH,
                entered_at=now - timedelta(days=DAYS),
                passed=False,
            ),
        ]
    )
    db.flush()
    return episode


def session_days() -> list[int]:
    """Days ago on which a session happened — four a week, with one missed."""
    days = [d for d in range(DAYS) if d % 7 in (0, 2, 4, 5)]
    days.remove(days[len(days) // 2])  # everybody misses one
    return sorted(days, reverse=True)


def ramp(day_ago: int, start: float, end: float) -> float:
    """Interpolate across the window. ``day_ago`` counts backwards from today."""
    t = 1.0 - (day_ago / max(1, DAYS - 1))
    return start + (end - start) * t


def add_sessions(db, episode: InjuryEpisode, exercises: dict[str, Exercise],  # noqa: ANN001
                 mean_form_ceiling: float) -> int:
    """Three weeks of camera sessions, getting steadily cleaner.

    Form climbs from the low seventies to ``mean_form_ceiling`` so the accuracy
    chart has a real slope rather than a flat line.
    """
    now = datetime.now(UTC)
    count = 0
    for day_ago in session_days():
        started = now - timedelta(days=day_ago, hours=rng.uniform(1, 9))
        session = RehabSession(
            episode_id=episode.id,
            phase_key=PhaseKey.P2_STRENGTH,
            status=SessionStatus.COMPLETED,
            started_at=started,
            ended_at=started + timedelta(minutes=rng.randint(22, 38)),
            rpe=round(ramp(day_ago, 7.0, 5.0) + rng.uniform(-0.5, 0.5), 1),
            pain_during=round(max(0.0, ramp(day_ago, 3.0, 0.5)), 1),
            pain_after=round(max(0.0, ramp(day_ago, 3.5, 0.5)), 1),
            device="demo-seed",
        )
        db.add(session)
        db.flush()

        for order, key in enumerate(PHASE_EXERCISES):
            exercise = exercises.get(key)
            if exercise is None:
                continue
            reps = rng.randint(8, 12)
            dropped = rng.choice([0, 0, 0, 1, 1, 2])
            score = round(
                min(97.0, ramp(day_ago, 71.0, mean_form_ceiling) + rng.uniform(-4, 4)), 1
            )
            db.add(
                ExerciseSet(
                    session_id=session.id,
                    exercise_id=exercise.id,
                    order_index=order,
                    side=Side.LEFT,
                    prescribed_reps=10,
                    completed_reps=reps,
                    valid_reps=max(0, reps - dropped),
                    form_score=score,
                )
            )
            # The upload endpoint writes these alongside the set, and the
            # movement-quality criterion reads them rather than the set rows.
            # Seeding one without the other leaves the gate saying "not
            # measured" for work that plainly happened.
            for metric_key, side in (
                ("pose.form_score", None),
                (f"pose.{key}.form_score", Side.LEFT),
            ):
                db.add(
                    MetricSample(
                        player_id=episode.player_id,
                        episode_id=episode.id,
                        metric_key=metric_key,
                        source=CriterionSource.POSE,
                        value=score,
                        unit="score",
                        side=side,
                        recorded_at=started,
                    )
                )
        count += 1
    db.flush()
    return count


def add_pain_logs(db, episode: InjuryEpisode) -> None:  # noqa: ANN001
    """Daily logs, settling from sore to almost nothing."""
    now = datetime.now(UTC)
    for day_ago in range(DAYS):
        when = now - timedelta(days=day_ago, hours=20)
        rest = round(max(0.0, ramp(day_ago, 3.0, 0.0)), 1)
        activity = round(max(0.0, ramp(day_ago, 4.0, 1.0)), 1)
        morning = round(max(0.0, ramp(day_ago, 3.5, 0.5)), 1)
        db.add(
            PainLog(
                episode_id=episode.id,
                recorded_at=when,
                pain_rest=rest,
                pain_activity=activity,
                pain_next_morning=morning,
                confidence=round(ramp(day_ago, 55.0, 88.0), 0),
            )
        )
        for key, value, unit in (
            ("pro.pain_rest", rest, "NPRS"),
            ("pro.pain_activity", activity, "NPRS"),
            ("pro.pain_next_morning", morning, "NPRS"),
            ("pro.confidence", round(ramp(day_ago, 55.0, 88.0), 0), "score"),
        ):
            db.add(
                MetricSample(
                    player_id=episode.player_id,
                    episode_id=episode.id,
                    metric_key=key,
                    source=CriterionSource.PRO,
                    value=value,
                    unit=unit,
                    recorded_at=when,
                )
            )
    db.flush()


def add_metrics(db, episode: InjuryEpisode, *, valgus_passes: bool) -> None:  # noqa: ANN001
    """Camera readings, strength tests and watch data across the window.

    The strength numbers are the story worth showing: the injured leg starts
    well behind and closes on the healthy one, which is exactly what the
    symmetry ring on the Progress screen is for.
    """
    now = datetime.now(UTC)
    injured, healthy = Side.LEFT, Side.RIGHT

    def sample(key: str, value: float, unit: str, day_ago: int, *,
               source: CriterionSource, side: Side | None = None) -> None:
        db.add(
            MetricSample(
                player_id=episode.player_id,
                episode_id=episode.id,
                metric_key=key,
                source=source,
                value=round(value, 2),
                unit=unit,
                side=side,
                recorded_at=now - timedelta(days=day_ago, hours=6),
            )
        )

    for day_ago in session_days():
        # What the camera measured, on the injured leg.
        sample("pose.slsq_knee_flexion", ramp(day_ago, 48, 71) + rng.uniform(-3, 3),
               "deg", day_ago, source=CriterionSource.POSE, side=injured)
        sample(
            "pose.slsq_knee_valgus",
            # Ends under the 8-degree limit, or stubbornly above it.
            (ramp(day_ago, 14, 5) if valgus_passes else ramp(day_ago, 15, 10.5))
            + rng.uniform(-0.8, 0.8),
            "deg", day_ago, source=CriterionSource.POSE, side=injured,
        )
        sample("pose.calf_raise_height", ramp(day_ago, 0.31, 0.49) + rng.uniform(-0.02, 0.02),
               "ratio", day_ago, source=CriterionSource.POSE, side=injured)
        sample("pose.rdl_hip_hinge", ramp(day_ago, 62, 84) + rng.uniform(-4, 4),
               "deg", day_ago, source=CriterionSource.POSE, side=injured)

    # Strength tests, roughly weekly. 68% symmetry to about 86%.
    for day_ago in (19, 12, 5, 1):
        sample("test.iso_quadriceps", ramp(day_ago, 2.10, 2.78), "N/kg", day_ago,
               source=CriterionSource.TEST, side=injured)
        sample("test.iso_quadriceps", ramp(day_ago, 3.08, 3.22), "N/kg", day_ago,
               source=CriterionSource.TEST, side=healthy)
        sample("test.iso_hamstring", ramp(day_ago, 2.20, 2.68), "N/kg", day_ago,
               source=CriterionSource.TEST, side=injured)
        sample("test.iso_hamstring", ramp(day_ago, 2.95, 3.02), "N/kg", day_ago,
               source=CriterionSource.TEST, side=healthy)
        sample("test.hop_single", ramp(day_ago, 0.95, 1.24), "m", day_ago,
               source=CriterionSource.TEST, side=injured)
        sample("test.hop_single", ramp(day_ago, 1.46, 1.49), "m", day_ago,
               source=CriterionSource.TEST, side=healthy)

    # Watch and phone data, every day.
    for day_ago in range(DAYS):
        asymmetry = max(0.4, ramp(day_ago, 6.5, 1.6)) + rng.uniform(-0.3, 0.3)
        sample("health.walking_asymmetry", asymmetry, "%", day_ago,
               source=CriterionSource.HEALTH)
        sample("health.step_count", ramp(day_ago, 5200, 9100) + rng.uniform(-700, 700),
               "count", day_ago, source=CriterionSource.HEALTH)
        if day_ago in session_days():
            sample("health.distance_total", ramp(day_ago, 1800, 4200) + rng.uniform(-250, 250),
                   "m", day_ago, source=CriterionSource.HEALTH)
    db.flush()


def report(db, episode: InjuryEpisode, sessions: int, blocker: str) -> None:  # noqa: ANN001
    gate = evaluate_phase(db, episode)
    print()
    print(f"  Signed in as   {EMAIL}")
    print(f"  Password       {PASSWORD}")
    print(f"  Player         {FULL_NAME}, winger, left ACL reconstruction")
    print(f"  Phase          2 of 4 — Strength & Control, day {DAYS} of it")
    print(f"  History        {sessions} completed sessions, {DAYS} days of pain logs")
    print()
    print(f"  Testing        {gate.required_passed} of {gate.required_total} required "
          f"criteria met ({gate.progress * 100:.0f}%)")
    for c in gate.criteria:
        mark = {"pass": "PASS", "fail": "FAIL"}.get(str(c.status), "----")
        observed = "—" if c.observed is None else f"{c.observed:g}"
        target = "—" if c.target is None else f"{c.target:g}"
        flag = "" if c.required else "  (optional)"
        print(f"    {mark}  {c.label_en[:46]:48} {observed:>7} / {target}{flag}")
    print()
    if gate.passed:
        print("  Nothing is blocking the phase. Open Test and it will offer to advance.")
    else:
        print(f"  Blocking: {', '.join(gate.blocking)}")
        print(f"  {BLOCKERS.get(blocker, '')}")
        print()
        print(f"  {DAMPING_NOTE}")
    print()
    print("  Re-run this script any time to reset the demo player.")
    print()


def add_own_targets(db, episode: InjuryEpisode) -> None:  # noqa: ANN001
    """Two targets the player set for themselves.

    Without these the Exit Criteria screen opens on an empty "Your targets"
    section, and the one feature that is genuinely the player's own looks
    unbuilt. Built through the same authoring service the app calls, so what the
    demo shows is what the button does -- not a row inserted behind its back.

    One is nearly there and one is not, because a screen where everything is
    green teaches nobody what the screen is for.
    """
    targets = [
        # Comfortably met: this player has been doing these for weeks.
        ("session.reps", "single_leg_squat", 10.0, True),
        # Not yet. Deliberately not required: `--blocker none` promises a phase
        # ready to advance, and a second permanent blocker would quietly break
        # that promise for anyone rehearsing the advance.
        ("session.reps", "lateral_bound", 12.0, False),
    ]
    for index, (metric, exercise_key, value, required) in enumerate(targets, start=1):
        item = authoring.resolve(metric)
        exercise = authoring.check_exercise(db, item, exercise_key)
        checked = authoring.check_value(item, TargetType.ABSOLUTE, value)
        db.add(
            EpisodeCriterion(
                episode_id=episode.id,
                phase_key=episode.current_phase,
                key=authoring.build_key(item, exercise_key, TargetType.ABSOLUTE),
                order_index=index,
                label_en=authoring.build_label(
                    item, exercise=exercise, target_type=TargetType.ABSOLUTE, value=checked
                ),
                label_th="",
                help_en=item.help_en,
                required=required,
                spec=authoring.build_spec(
                    item,
                    exercise_key=exercise_key,
                    target_type=TargetType.ABSOLUTE,
                    value=checked,
                    window_days=None,
                ).model_dump(mode="json"),
            )
        )


def main() -> None:
    # The summary below uses arrows and a "<=" sign. Python picks the console's
    # code page for those, and gets cp1252 whenever output is piped rather than
    # shown -- so `seed_demo.py > log.txt` died on a character it could print
    # perfectly well to a window. Replace rather than raise: a mangled dash in a
    # log file is a nuisance, a crash halfway through seeding is a lost demo.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="Build the demo player.")
    parser.add_argument(
        "--blocker",
        choices=sorted(BLOCKERS),
        default="form_quality",
        help="which criterion to leave unmet, so the live demo has something to fill",
    )
    parser.add_argument("--list", action="store_true", help="show the choices and exit")
    args = parser.parse_args()

    if args.list:
        print("\n  --blocker choices:\n")
        for key, note in BLOCKERS.items():
            print(f"    {key:14} {note}")
        print()
        return

    # Movement quality is the mean of every scored rep over 14 days, so the
    # ceiling on the form scores is what decides whether it clears its 80. Set
    # just under, so the screen reads "nearly there" rather than "miles off".
    ceiling = 83.0 if args.blocker == "form_quality" else 91.0

    with SessionLocal() as db:
        replaced = wipe(db)
        profile = make_player(db)
        episode = make_episode(db, profile)
        exercises = {
            e.key: e
            for e in db.execute(
                select(Exercise).where(Exercise.key.in_(PHASE_EXERCISES))
            ).scalars()
        }
        sessions = add_sessions(db, episode, exercises, ceiling)
        add_pain_logs(db, episode)
        add_metrics(db, episode, valgus_passes=args.blocker != "slsq_valgus")
        add_own_targets(db, episode)
        db.commit()

        print()
        print("  PITCH REHAB — demo player")
        print(f"  {'Rebuilt' if replaced else 'Created'} from scratch. No other account touched.")
        report(db, episode, sessions, args.blocker)


if __name__ == "__main__":
    main()
