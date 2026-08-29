"""Record the backend's answers so the app can run with no backend at all.

    python scripts/make_snapshot.py

Why this exists: the demo is sometimes given on a machine that will not let you
install Python, run a server, or accept a firewall prompt. On those machines
every network fix in this repository is useless -- there is nothing to connect
to. The only thing that survives is a phone with the app already on it.

So the app carries a copy of what the backend would have said. This script logs
in as the demo player, calls every screen's endpoint against the real API, and
writes the replies to ``web/src/demo/snapshot.json``.

The important word is **real**. Nothing here is hand-written or invented: the
protocols come from the seeded database, the exit criteria come from the actual
criteria engine, the progress figures come from ``build_report``. Standalone
mode replays genuine output rather than imitating it, which is what makes it
honest to show a teacher.

What it cannot do is recompute. A set logged with no laptop is stored on the
phone and marked as not yet counted, because the gate that would judge it is
1,000 lines of Python sitting in ``app/services/criteria/``. Pretending
otherwise would be the one thing worse than an offline demo: a dishonest one.

Runs the API in-process, so no server needs to be running. Re-seeds the demo
player first, so the snapshot is always of a known state -- that touches the
demo account only, exactly as ``scripts/seed_demo.py`` does.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
# Same line every script in here carries: run from scripts/, import from the root.
sys.path.insert(0, str(ROOT))

OUT = ROOT / "web" / "src" / "demo" / "snapshot.json"
#: Every protocol, kept out of the bundle and fetched only if somebody changes
#: their injury or position with no laptop. See `_write_protocols`.
PROTOCOLS = ROOT / "web" / "public" / "demo-protocols.json"

EMAIL = "demo@pitchrehab.app"
PASSWORD = "correct-horse-battery"


def _reseed() -> None:
    """Rebuild the demo player, so a snapshot is never of a half-used account."""
    print("Re-seeding the demo player...")
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "seed_demo.py")],
        cwd=ROOT,
        capture_output=True,
        text=True,
        # Piped output defaults to the Windows code page, which cannot hold the
        # arrows the seed summary prints.
        encoding="utf-8",
        errors="replace",
        env={**os.environ, "PYTHONIOENCODING": "utf-8"},
    )
    if result.returncode != 0:
        print(result.stdout)
        print(result.stderr, file=sys.stderr)
        raise SystemExit("Could not seed the demo player.")


def _write_protocols() -> None:
    """Every one of the 42 programmes, so the demo can switch between them.

    The snapshot proper records one player's answers, which is enough until
    somebody changes their position or their injury -- and then the app was
    telling them their plan had been rebuilt while serving the same one. Six
    positions times seven injury sites is the whole claim this project makes,
    and a demo that cannot show it is demonstrating the wrong thing.

    Kept in ``public/`` rather than bundled: 1.6 MB raw, and only somebody who
    actually changes injury ever needs it. Most visitors never fetch it.
    """
    from sqlalchemy import select

    from app.db.session import SessionLocal
    from app.models.protocol import Protocol
    from app.schemas.protocol import ProtocolOut

    with SessionLocal() as db:
        rows = list(
            db.execute(select(Protocol).where(Protocol.is_active.is_(True))).scalars()
        )
        # Keyed by what the app knows about the player, so the lookup is a
        # dictionary hit rather than a search.
        protocols = {
            f"{row.position}|{row.injury_site}": json.loads(
                ProtocolOut.model_validate(row).model_dump_json()
            )
            for row in rows
        }

    PROTOCOLS.parent.mkdir(parents=True, exist_ok=True)
    PROTOCOLS.write_text(
        json.dumps(protocols, separators=(",", ":"), ensure_ascii=False), encoding="utf-8"
    )
    size = PROTOCOLS.stat().st_size
    print(
        f"\nWrote {PROTOCOLS.relative_to(ROOT)}  "
        f"({len(protocols)} protocols, {size / 1024 / 1024:.2f} MB)"
    )


def main() -> None:
    _reseed()

    # Imported after seeding so the module picks up the finished database.
    from fastapi.testclient import TestClient

    from app.main import app

    captured: dict[str, Any] = {}

    # The context manager matters: without it the lifespan never runs, the
    # tables are never created, and every call fails on a missing table.
    with TestClient(app) as client:
        login = client.post(
            "/api/v1/auth/login", json={"email": EMAIL, "password": PASSWORD}
        )
        if login.status_code != 200:
            raise SystemExit(
                f"Could not sign in as {EMAIL} ({login.status_code}). "
                "Run scripts/seed_demo.py by hand and check it succeeds."
            )
        token = login.json()["access_token"]
        auth = {"Authorization": f"Bearer {token}"}

        def grab(path: str) -> Any:
            """Call one endpoint and file it under the exact path the app asks for."""
            response = client.get(f"/api/v1{path}", headers=auth)
            if response.status_code != 200:
                raise SystemExit(f"GET {path} answered {response.status_code}")
            captured[path] = response.json()
            return captured[path]

        grab("/auth/me")
        grab("/catalog/positions")
        grab("/catalog/exercises")
        grab("/health/supported-metrics")
        grab("/injuries/criteria/authorable")

        episodes = grab("/injuries?status_filter=active")
        if not episodes:
            raise SystemExit("The demo player has no active injury to snapshot.")

        for episode in episodes:
            episode_id = episode["id"]
            for path in (
                f"/injuries/{episode_id}/today",
                f"/injuries/{episode_id}/exit-criteria",
                f"/injuries/{episode_id}/sessions?limit=200",
                f"/injuries/{episode_id}/progress",
                f"/injuries/{episode_id}/protocol",
                f"/injuries/{episode_id}/criteria",
            ):
                grab(path)

    _write_protocols()

    OUT.parent.mkdir(parents=True, exist_ok=True)
    # Compact: this is bundled into a 30 MB package that a phone downloads over
    # wifi, and the file is read by code, never by a person.
    OUT.write_text(
        json.dumps(
            {
                "note": (
                    "Recorded from the real backend by scripts/make_snapshot.py. "
                    "Not hand-written. Regenerate rather than editing."
                ),
                "email": EMAIL,
                "responses": captured,
            },
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )

    size = OUT.stat().st_size
    print(f"\nWrote {OUT.relative_to(ROOT)}  ({size / 1024:.0f} KB)")
    print(f"{len(captured)} endpoints captured:")
    for path in captured:
        shape = captured[path]
        count = f"{len(shape)} items" if isinstance(shape, list) else "object"
        print(f"  {path}  ({count})")


if __name__ == "__main__":
    main()
