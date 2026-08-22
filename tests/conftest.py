from __future__ import annotations

import os
import tempfile
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest

# Point every module-level engine at a throwaway database *before* app imports.
_TMP_DB = Path(tempfile.mkdtemp(prefix="rtp-test-")) / "test.db"
os.environ["RTP_DATABASE_URL"] = f"sqlite:///{_TMP_DB.as_posix()}"
os.environ["RTP_SECRET_KEY"] = "test-secret-key-not-for-production"
os.environ["RTP_SEED_ON_STARTUP"] = "false"
os.environ["RTP_ENV"] = "test"

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

import app.models  # noqa: E402,F401  (registers tables)
from app.core.enums import InjurySite, Position, Severity, Side  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.seed import seed_all  # noqa: E402
from app.db.session import SessionLocal, engine  # noqa: E402
from app.main import app as fastapi_app  # noqa: E402
from app.models.injury import InjuryEpisode  # noqa: E402
from app.models.user import PlayerProfile, User  # noqa: E402
from app.services.progression import assign_protocol  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _schema() -> Iterator[None]:
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        seed_all(db)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def db() -> Iterator[Session]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(fastapi_app) as c:
        yield c


def make_player(
    db: Session,
    email: str,
    position: Position = Position.WINGER,
) -> PlayerProfile:
    from app.core.security import hash_password

    user = User(
        email=email,
        password_hash=hash_password("correct-horse-battery"),
        full_name="Test Player",
    )
    db.add(user)
    db.flush()
    profile = PlayerProfile(user_id=user.id, position=position, body_mass_kg=75.0)
    db.add(profile)
    db.flush()
    return profile


def make_episode(
    db: Session,
    player: PlayerProfile,
    site: InjurySite = InjurySite.HAMSTRING,
    side: Side = Side.LEFT,
    days_ago: int = 30,
) -> InjuryEpisode:
    episode = InjuryEpisode(
        player_id=player.id,
        injury_site=site,
        side=side,
        severity=Severity.GRADE_2,
        injured_on=date.today() - timedelta(days=days_ago),
        phase_started_at=datetime.now(UTC) - timedelta(days=days_ago),
    )
    db.add(episode)
    db.flush()
    assign_protocol(db, episode)
    db.flush()
    return episode


@pytest.fixture
def player(db: Session) -> PlayerProfile:
    return make_player(db, f"player-{datetime.now(UTC).timestamp()}@rtpapp.com")


@pytest.fixture
def episode(db: Session, player: PlayerProfile) -> InjuryEpisode:
    return make_episode(db, player)
