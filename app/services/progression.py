from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.enums import PHASE_ORDER, EpisodeStatus, PhaseKey
from app.models.injury import InjuryEpisode, PhaseAttempt
from app.models.protocol import Protocol
from app.services.criteria.engine import PhaseGateResult, evaluate_phase


def select_protocol(db: Session, episode: InjuryEpisode) -> Protocol | None:
    """Pick the programme for this player's position and injury site.

    The same hamstring tear gets a different programme for a winger than for a
    centre-back -- 6 positions x 7 injury sites.
    """
    player = episode.player
    if player is None:
        return None
    return db.execute(
        select(Protocol)
        .where(Protocol.position == player.position)
        .where(Protocol.injury_site == episode.injury_site)
        .where(Protocol.is_active.is_(True))
        .order_by(Protocol.version.desc())
    ).scalars().first()


def assign_protocol(db: Session, episode: InjuryEpisode) -> Protocol | None:
    protocol = select_protocol(db, episode)
    if protocol is None:
        return None
    episode.protocol_id = protocol.id
    episode.current_phase = PHASE_ORDER[0]
    episode.phase_started_at = episode.phase_started_at or datetime.now(UTC)
    db.add(
        PhaseAttempt(
            episode_id=episode.id,
            phase_key=PHASE_ORDER[0],
            entered_at=episode.phase_started_at,
        )
    )
    return protocol


def realign_protocol(db: Session, episode: InjuryEpisode) -> Protocol | None:
    """Move an in-progress episode onto the programme for the player's position.

    Called when a player changes position mid-rehab. The role picker promises
    that a position sets the targets you have to clear, so leaving someone on
    their old programme would quietly make that untrue.

    Deliberately *not* ``assign_protocol``: that one restarts the episode at
    phase 1 and opens a fresh attempt, which is right for a new injury and
    wrong here. Every protocol carries the same four phases, so the player
    keeps their phase, their clock and their history -- only the targets move.

    Returns the new protocol when something changed, otherwise ``None``.
    """
    protocol = select_protocol(db, episode)
    if protocol is None or protocol.id == episode.protocol_id:
        return None
    episode.protocol_id = protocol.id
    return protocol


def realign_active_episodes(db: Session, player_id: int) -> int:
    """Re-point every open episode after a position change. Returns how many moved."""
    episodes = db.execute(
        select(InjuryEpisode)
        .where(InjuryEpisode.player_id == player_id)
        .where(InjuryEpisode.status == EpisodeStatus.ACTIVE)
    ).scalars()
    return sum(1 for episode in episodes if realign_protocol(db, episode) is not None)


def _open_attempt(db: Session, episode: InjuryEpisode, phase: PhaseKey) -> PhaseAttempt:
    attempt = db.execute(
        select(PhaseAttempt)
        .where(PhaseAttempt.episode_id == episode.id)
        .where(PhaseAttempt.phase_key == phase)
        .where(PhaseAttempt.passed.is_(False))
        .order_by(PhaseAttempt.id.desc())
    ).scalars().first()
    if attempt is None:
        attempt = PhaseAttempt(
            episode_id=episode.id,
            phase_key=phase,
            entered_at=episode.phase_started_at or datetime.now(UTC),
        )
        db.add(attempt)
        db.flush()
    return attempt


def advance_if_ready(
    db: Session,
    episode: InjuryEpisode,
    now: datetime | None = None,
) -> tuple[PhaseGateResult, bool]:
    """Evaluate the current gate and move the player on if every criterion passed.

    Returns ``(result, advanced)``. Nothing moves unless the gate is clean --
    there is no partial credit for getting close.
    """
    now = now or datetime.now(UTC)
    result = evaluate_phase(db, episode, episode.current_phase, now=now)
    attempt = _open_attempt(db, episode, episode.current_phase)
    attempt.snapshot = result.to_dict()

    if not result.passed:
        db.flush()
        return result, False

    attempt.passed = True
    attempt.passed_at = now

    if result.next_phase is None:
        episode.status = EpisodeStatus.CLEARED
        episode.cleared_at = now
    else:
        episode.current_phase = result.next_phase
        episode.phase_started_at = now
        db.add(
            PhaseAttempt(
                episode_id=episode.id,
                phase_key=result.next_phase,
                entered_at=now,
            )
        )

    db.flush()
    return result, True
