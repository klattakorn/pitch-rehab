from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from app.core.enums import RETIRED_INJURY_SITES, InjurySite
from app.data.exercises import EXERCISES
from app.data.protocols import build_protocols
from app.models.protocol import (
    Exercise,
    ExitCriterion,
    PhasePrescription,
    Protocol,
    ProtocolPhase,
)

log = logging.getLogger(__name__)


def seed_exercises(db: Session) -> dict[str, Exercise]:
    existing = {e.key: e for e in db.execute(select(Exercise)).scalars()}
    for definition in EXERCISES:
        row = existing.get(definition.key)
        payload = dict(
            name_en=definition.name_en,
            name_th=definition.name_th,
            category=definition.category,
            cue_en=definition.cue_en,
            cue_th=definition.cue_th,
            equipment=definition.equipment,
            pose_rule=definition.rule.model_dump(mode="json") if definition.rule else None,
        )
        if row is None:
            row = Exercise(key=definition.key, **payload)
            db.add(row)
            existing[definition.key] = row
        else:
            for field, value in payload.items():
                setattr(row, field, value)
    db.flush()
    return existing


def seed_protocols(db: Session, exercises: dict[str, Exercise]) -> int:
    """Insert the 42 position x injury programmes.

    The phases are rebuilt from ``app/data/`` on every seed, so that stays the
    only place the library is authored. The ``protocol`` row itself is updated in
    place rather than replaced, because injury episodes point at it by id --
    deleting and recreating it silently detached every player mid-rehab.
    """
    count = 0
    for built in build_protocols():
        protocol = db.execute(
            select(Protocol).where(Protocol.key == built.key)
        ).scalar_one_or_none()

        if protocol is None:
            protocol = Protocol(key=built.key, version=1)
            db.add(protocol)
        else:
            # Drop the children only; the parent id has to survive.
            for phase in list(protocol.phases):
                db.delete(phase)
            db.flush()

        protocol.position = built.position
        protocol.injury_site = built.injury_site
        protocol.title_en = built.title_en
        protocol.title_th = built.title_th
        protocol.summary_en = built.summary_en
        protocol.summary_th = built.summary_th
        protocol.is_active = True
        db.flush()

        for order, phase_def in enumerate(built.phases):
            phase = ProtocolPhase(
                protocol_id=protocol.id,
                phase_key=phase_def.phase_key,
                order_index=order,
                title_en=phase_def.title_en,
                title_th=phase_def.title_th,
                goal_en=phase_def.goal_en,
                goal_th=phase_def.goal_th,
                min_days=phase_def.min_days,
                sessions_per_week=phase_def.sessions_per_week,
            )
            db.add(phase)
            db.flush()

            for rx_order, rx in enumerate(phase_def.prescriptions):
                exercise = exercises.get(rx.exercise)
                if exercise is None:
                    raise KeyError(
                        f"protocol {built.key} phase {phase_def.phase_key} references "
                        f"unknown exercise {rx.exercise!r}"
                    )
                db.add(
                    PhasePrescription(
                        phase_id=phase.id,
                        exercise_id=exercise.id,
                        order_index=rx_order,
                        sets=rx.sets,
                        reps=rx.reps,
                        hold_seconds=rx.hold_seconds,
                        rest_seconds=rx.rest_seconds,
                        tempo=rx.tempo,
                        load_note_en=rx.load_en,
                        load_note_th=rx.load_th,
                        side_mode=rx.side_mode,
                    )
                )

            for c_order, criterion in enumerate(phase_def.criteria):
                db.add(
                    ExitCriterion(
                        phase_id=phase.id,
                        key=criterion.key,
                        order_index=c_order,
                        label_en=criterion.label_en,
                        label_th=criterion.label_th,
                        help_en=criterion.help_en or None,
                        help_th=criterion.help_th or None,
                        required=criterion.required,
                        spec=criterion.spec.model_dump(mode="json"),
                    )
                )
        count += 1
    db.flush()
    return count


def migrate_injury_sites(db: Session) -> int:
    """Fix up rows that predate a rename of the injury-site vocabulary.

    Enum values are stored as plain strings. Loading a row whose value no longer
    exists does not return ``None`` -- SQLAlchemy raises, and it raises on the
    *query*, so the bad row cannot even be deleted through the ORM. Everything
    here therefore runs as raw SQL, and it has to run before anything else in
    the seed touches these tables.

    Episodes are rewritten because a player should not lose their rehab over a
    renamed constant. Protocols are deleted because the library no longer
    authors them; any episode pointing at one is re-attached on its next request.
    """
    # SQLAlchemy persists the enum *name*, not its value -- the column holds
    # "HAMSTRING", not "hamstring". Comparing against values here matched nothing
    # and deleted the entire library on the first run.
    fixed = 0
    for old, new in RETIRED_INJURY_SITES.items():
        fixed += (
            db.execute(
                sql_text(
                    "UPDATE injury_episode SET injury_site = :new WHERE injury_site = :old"
                ),
                {"new": new.name, "old": old.upper()},
            ).rowcount
            or 0
        )

    live = [site.name for site in InjurySite]
    placeholders = ", ".join(f":s{i}" for i in range(len(live)))
    params = {f"s{i}": value for i, value in enumerate(live)}
    dropped = (
        db.execute(
            sql_text(f"DELETE FROM protocol WHERE injury_site NOT IN ({placeholders})"),
            params,
        ).rowcount
        or 0
    )
    db.flush()

    if fixed or dropped:
        log.info(
            "migrated %d episodes and dropped %d protocols using retired injury sites",
            fixed,
            dropped,
        )
    return fixed


def retire_unknown_protocols(db: Session, live_keys: set[str]) -> int:
    """Delete protocols the library no longer authors.

    Any episode still pointing at one is left with a null protocol; the API
    re-attaches the right programme on the next request rather than erroring.
    """
    stale = [
        p
        for p in db.execute(select(Protocol)).scalars()
        if p.key not in live_keys
    ]
    for protocol in stale:
        db.delete(protocol)
    if stale:
        log.info("retired %d protocols no longer in the library", len(stale))
    return len(stale)


def seed_all(db: Session) -> None:
    migrate_injury_sites(db)
    exercises = seed_exercises(db)
    protocols = seed_protocols(db, exercises)
    retired = retire_unknown_protocols(db, {b.key for b in build_protocols()})
    db.commit()
    log.info(
        "seeded %d exercises and %d protocols (%d retired)",
        len(exercises),
        protocols,
        retired,
    )
