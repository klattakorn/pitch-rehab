from __future__ import annotations

import sqlite3
from datetime import date, timedelta
from pathlib import Path

import pytest
from sqlalchemy import create_engine, inspect

from app.core.enums import AgeGroup, InjurySite, Position
from app.data import tailoring
from app.data.exercises import EXERCISES_BY_KEY
from app.data.protocols import build_protocols
from app.models.user import PlayerProfile

EVERYONE = [(p, s, a) for p in Position for s in InjurySite for a in AgeGroup]


@pytest.mark.parametrize(("position", "site", "age"), EVERYONE)
def test_every_player_gets_three_or_four_of_the_five(
    position: Position, site: InjurySite, age: AgeGroup
) -> None:
    plan = tailoring.tailor(position, site, age)
    assert 3 <= len(plan.moves) <= 4
    # Nothing is both given and left out, and nothing vanishes unexplained.
    left = {o.move for o in plan.left_out}
    assert not left & set(plan.moves)
    assert left | set(plan.moves) == set(tailoring.MOVES)
    assert all(o.why.en and o.why.th for o in plan.left_out)
    # The movement the injury most needs is never the one dropped.
    assert tailoring.INJURY_RULES[site].key_move.move in plan.moves
    # Exactly one movement gets the position's extra set.
    extra = [c for c in plan.chosen if c.dose.sets > tailoring.DOSES[c.move][age].sets]
    assert len(extra) == 1


@pytest.mark.parametrize("position", list(Position))
@pytest.mark.parametrize("site", list(InjurySite))
def test_nobody_over_forty_jumps_in_phase_one(position: Position, site: InjurySite) -> None:
    assert tailoring.POGO not in tailoring.tailor(position, site, AgeGroup.SENIOR).moves


@pytest.mark.parametrize("age", list(AgeGroup))
@pytest.mark.parametrize("position", list(Position))
def test_a_position_never_overrides_an_injury(position: Position, age: AgeGroup) -> None:
    # Keepers and wingers want spring; a healing ACL graft still does not hop.
    assert tailoring.POGO not in tailoring.tailor(position, InjurySite.ACL, age).moves
    assert tailoring.SPLIT not in tailoring.tailor(position, InjurySite.ADDUCTOR, age).moves


def test_the_three_inputs_each_change_something() -> None:
    base = tailoring.tailor(Position.WINGER, InjurySite.HAMSTRING, AgeGroup.ADULT)
    by_injury = tailoring.tailor(Position.WINGER, InjurySite.ADDUCTOR, AgeGroup.ADULT)
    by_age = tailoring.tailor(Position.WINGER, InjurySite.HAMSTRING, AgeGroup.SENIOR)
    by_position = tailoring.tailor(Position.GOALKEEPER, InjurySite.HAMSTRING, AgeGroup.ADULT)
    assert len({base.moves, by_injury.moves, by_age.moves, by_position.moves}) == 4


def test_every_move_is_a_real_camera_checked_exercise() -> None:
    for move in tailoring.MOVES:
        assert EXERCISES_BY_KEY[move].rule is not None
        assert set(tailoring.DOSES[move]) == set(AgeGroup)
    for age in AgeGroup:
        # The test must be passable inside one prescribed set.
        hold = tailoring.DOSES[tailoring.WALL][age].hold_seconds
        assert hold is not None and tailoring.WALL_SIT_TEST_S[age] <= hold


def test_adult_programmes_keep_the_keys_they_always_had() -> None:
    built = build_protocols()
    assert len(built) == len({b.key for b in built}) == 126
    adult = {b.key for b in built if b.age_group is AgeGroup.ADULT}
    assert adult == {f"{p.value}__{s.value}" for p in Position for s in InjurySite}


def test_age_group_follows_the_choice_then_the_birth_date() -> None:
    assert AgeGroup.for_age(None) is AgeGroup.ADULT
    assert [AgeGroup.for_age(n) for n in (17, 18, 39, 40)] == [
        AgeGroup.YOUTH,
        AgeGroup.ADULT,
        AgeGroup.ADULT,
        AgeGroup.SENIOR,
    ]
    born = date.today() - timedelta(days=365 * 50)
    assert PlayerProfile(date_of_birth=born).effective_age_group is AgeGroup.SENIOR
    picked = PlayerProfile(date_of_birth=born, age_group=AgeGroup.ADULT)
    assert picked.effective_age_group is AgeGroup.ADULT


OLD_SCHEMA = """
CREATE TABLE protocol (
    id INTEGER PRIMARY KEY, key VARCHAR(80) NOT NULL, position VARCHAR(15) NOT NULL,
    injury_site VARCHAR(21) NOT NULL, version INTEGER NOT NULL,
    title_en VARCHAR(160) NOT NULL, title_th VARCHAR(200) NOT NULL,
    summary_en TEXT, summary_th TEXT, is_active BOOLEAN NOT NULL,
    created_at DATETIME, updated_at DATETIME,
    UNIQUE (position, injury_site, version));
CREATE UNIQUE INDEX ix_protocol_key ON protocol (key);
CREATE INDEX ix_protocol_position ON protocol (position);
CREATE TABLE protocol_phase (
    id INTEGER PRIMARY KEY,
    protocol_id INTEGER NOT NULL REFERENCES protocol(id) ON DELETE CASCADE,
    phase_key VARCHAR(12) NOT NULL);
CREATE TABLE player_profile (id INTEGER PRIMARY KEY, position VARCHAR(15));
INSERT INTO protocol VALUES (7, 'winger__acl', 'WINGER', 'ACL', 1, 'T', 'T',
    NULL, NULL, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO protocol_phase VALUES (3, 7, 'P1_PROTECT');
INSERT INTO player_profile VALUES (1, 'WINGER');
"""


def test_an_old_database_is_migrated_in_place(tmp_path: Path) -> None:
    """A database made before age groups keeps its rows, ids and links."""
    from app.db.migrate import migrate

    path = tmp_path / "old.db"
    raw = sqlite3.connect(path)
    raw.executescript(OLD_SCHEMA)
    raw.commit()
    raw.close()

    engine = create_engine(f"sqlite:///{path.as_posix()}")
    migrate(engine)
    migrate(engine)  # twice: it has to be safe to run on every start

    with engine.begin() as connection:
        rows = connection.exec_driver_sql("SELECT id, key, age_group FROM protocol").all()
        assert rows == [(7, "winger__acl", "ADULT")]
        # The phase still points at its programme, not at a dropped table.
        assert connection.exec_driver_sql("SELECT protocol_id FROM protocol_phase").all() == [(7,)]
        assert connection.exec_driver_sql("PRAGMA foreign_key_check").all() == []
        # The old uniqueness rule would have refused this; the new one allows it.
        connection.exec_driver_sql(
            "INSERT INTO protocol (key, position, injury_site, age_group, version, "
            "title_en, title_th, is_active, created_at, updated_at) VALUES "
            "('winger__acl__youth', 'WINGER', 'ACL', 'YOUTH', 1, 'T', 'T', 1, "
            "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        )
    inspector = inspect(engine)
    assert "age_group" in {c["name"] for c in inspector.get_columns("player_profile")}
    assert "tailoring" in {c["name"] for c in inspector.get_columns("protocol_phase")}
    assert [fk["referred_table"] for fk in inspector.get_foreign_keys("protocol_phase")] == [
        "protocol"
    ]
    engine.dispose()


def test_a_failed_migration_leaves_the_database_as_it_was(tmp_path: Path) -> None:
    from app.db.migrate import migrate

    path = tmp_path / "old.db"
    raw = sqlite3.connect(path)
    # A row the new table cannot hold: no timestamps.
    raw.executescript(OLD_SCHEMA.replace("CURRENT_TIMESTAMP, CURRENT_TIMESTAMP", "NULL, NULL"))
    raw.commit()
    raw.close()

    engine = create_engine(f"sqlite:///{path.as_posix()}")
    with pytest.raises(sqlite3.IntegrityError):
        migrate(engine)
    inspector = inspect(engine)
    assert "protocol_old" not in inspector.get_table_names()
    assert "age_group" not in {c["name"] for c in inspector.get_columns("protocol")}
    with engine.connect() as connection:
        assert connection.exec_driver_sql("SELECT id FROM protocol").all() == [(7,)]
    engine.dispose()
