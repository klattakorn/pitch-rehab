"""Bring a database made by an older version up to the current models.

``create_all`` only creates tables that are missing; it never touches one that
exists. So every column added after a database was first made has to be put
there by hand, and that is all this module does. It is deliberately small: a
real deployment wants Alembic (see README), and this is what stands in for it
while the only databases in existence are ``rtp.db`` files on laptops.

Run before ``create_all``. Safe to run any number of times.
"""

from __future__ import annotations

import logging

from sqlalchemy import Engine, inspect
from sqlalchemy.schema import CreateIndex, CreateTable

from app.models.protocol import Protocol

log = logging.getLogger("rtp.migrate")


def _columns(engine: Engine, table: str) -> set[str]:
    inspector = inspect(engine)
    if table not in inspector.get_table_names():
        return set()
    return {column["name"] for column in inspector.get_columns(table)}


def _add_column(engine: Engine, table: str, column: str, ddl: str) -> bool:
    existing = _columns(engine, table)
    if not existing or column in existing:
        return False
    with engine.begin() as connection:
        connection.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")
    log.info("added %s.%s", table, column)
    return True


def _rebuild_protocol_table(engine: Engine) -> bool:
    """Give ``protocol`` its ``age_group`` column *and* its new uniqueness rule.

    Adding the column is not enough. The table was created with
    UNIQUE(position, injury_site, version), and under that rule the youth and
    senior variants of a programme collide with the adult one. SQLite cannot
    alter a constraint, so the table is rebuilt: renamed aside, recreated from
    the model, refilled, dropped.

    Ids are copied across unchanged, because injury episodes and phases point
    at them. Every existing programme becomes the adult variant, which is what
    it was. Enum columns hold the member *name*, hence 'ADULT'.
    """
    existing = _columns(engine, "protocol")
    if not existing or "age_group" in existing:
        return False
    if engine.dialect.name != "sqlite":
        raise RuntimeError(
            "The protocol table predates age groups. Only SQLite is migrated "
            "automatically; add protocol.age_group and widen its unique "
            "constraint by hand, or recreate the database."
        )

    copied = ", ".join(sorted(existing))
    table = Protocol.__table__
    create = [str(CreateTable(table).compile(engine))]
    create += [str(CreateIndex(index).compile(engine)) for index in table.indexes]

    raw = engine.raw_connection()
    try:
        cursor = raw.cursor()
        # Without these, renaming the table would re-point every foreign key in
        # other tables at the renamed copy -- and then at nothing, once dropped.
        # foreign_keys cannot be changed inside a transaction, so it goes first.
        cursor.execute("PRAGMA foreign_keys=OFF")
        cursor.execute("PRAGMA legacy_alter_table=ON")
        # One transaction: SQLite rolls DDL back, so a failure halfway leaves
        # the database exactly as it was rather than with half a library.
        cursor.execute("BEGIN")
        try:
            cursor.execute("ALTER TABLE protocol RENAME TO protocol_old")
            # Index names are global in SQLite, and the old table still holds them.
            for (name,) in cursor.execute(
                "SELECT name FROM sqlite_master WHERE type='index' "
                "AND tbl_name='protocol_old' AND sql IS NOT NULL"
            ).fetchall():
                cursor.execute(f'DROP INDEX "{name}"')
            for statement in create:
                cursor.execute(statement)
            cursor.execute(
                f"INSERT INTO protocol ({copied}, age_group) "
                f"SELECT {copied}, 'ADULT' FROM protocol_old"
            )
            cursor.execute("DROP TABLE protocol_old")
            cursor.execute("COMMIT")
        except Exception:
            cursor.execute("ROLLBACK")
            raise
        finally:
            cursor.execute("PRAGMA legacy_alter_table=OFF")
            cursor.execute("PRAGMA foreign_keys=ON")
    finally:
        raw.close()
    log.info("rebuilt the protocol table with age groups")
    return True


def migrate(engine: Engine) -> None:
    _rebuild_protocol_table(engine)
    _add_column(engine, "player_profile", "age_group", "VARCHAR(6)")
    _add_column(engine, "protocol_phase", "tailoring", "JSON")
