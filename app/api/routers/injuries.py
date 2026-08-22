from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.deps import Clinician, CurrentPlayer, DbSession, Episode
from app.core.enums import CriterionSource, EpisodeStatus, PhaseKey, Side
from app.models.injury import ClinicianSignoff, InjuryEpisode, PhaseAttempt
from app.models.metrics import MetricSample
from app.models.protocol import Protocol, ProtocolPhase
from app.models.session import PainLog
from app.schemas.injury import (
    AdvanceOut,
    EpisodeCreateIn,
    EpisodeOut,
    PhaseAttemptOut,
    PhaseGateOut,
    SignoffIn,
    SignoffOut,
)
from app.schemas.protocol import PhaseOut, ProtocolOut
from app.schemas.session import MetricSampleOut, PainLogIn, PainLogOut, TestResultIn
from app.services.criteria.engine import evaluate_phase
from app.services.progression import advance_if_ready, assign_protocol

router = APIRouter(prefix="/injuries", tags=["injuries"])


@router.post("", response_model=EpisodeOut, status_code=status.HTTP_201_CREATED)
def create_episode(
    payload: EpisodeCreateIn, db: DbSession, player: CurrentPlayer
) -> InjuryEpisode:
    """Open an injury episode and auto-assign the position x injury protocol."""
    now = datetime.now(UTC)
    if payload.phase_started_at and payload.phase_started_at > now:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "phase_started_at cannot be in the future"
        )
    episode = InjuryEpisode(
        player_id=player.id,
        injury_site=payload.injury_site,
        side=payload.side,
        severity=payload.severity,
        diagnosis=payload.diagnosis,
        mechanism=payload.mechanism,
        injured_on=payload.injured_on,
        surgery_on=payload.surgery_on,
        phase_started_at=payload.phase_started_at or now,
    )
    db.add(episode)
    db.flush()

    if assign_protocol(db, episode) is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"no protocol exists for {player.position} + {payload.injury_site}",
        )
    db.commit()
    db.refresh(episode)
    return episode


@router.get("", response_model=list[EpisodeOut])
def list_episodes(
    db: DbSession, player: CurrentPlayer, status_filter: EpisodeStatus | None = None
) -> list[InjuryEpisode]:
    stmt = (
        select(InjuryEpisode)
        .where(InjuryEpisode.player_id == player.id)
        .order_by(InjuryEpisode.injured_on.desc())
    )
    if status_filter:
        stmt = stmt.where(InjuryEpisode.status == status_filter)
    return list(db.execute(stmt).scalars())


@router.get("/{episode_id}", response_model=EpisodeOut)
def get_episode_detail(episode: Episode) -> InjuryEpisode:
    return episode


@router.get("/{episode_id}/protocol", response_model=ProtocolOut)
def get_episode_protocol(episode: Episode, db: DbSession) -> Protocol:
    if episode.protocol_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no protocol assigned")
    protocol = db.execute(
        select(Protocol)
        .where(Protocol.id == episode.protocol_id)
        .options(
            selectinload(Protocol.phases).selectinload(ProtocolPhase.prescriptions),
            selectinload(Protocol.phases).selectinload(ProtocolPhase.exit_criteria),
        )
    ).scalar_one()
    return protocol


@router.get("/{episode_id}/today", response_model=PhaseOut)
def get_current_phase_plan(episode: Episode, db: DbSession) -> ProtocolPhase:
    """The exercises the player should be doing right now."""
    if episode.protocol_id is None and assign_protocol(db, episode) is not None:
        # Self-heal: a protocol can go missing if the library was reseeded.
        # Better to re-attach the right programme than to strand the player.
        db.commit()
    if episode.protocol_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no protocol assigned")
    phase = db.execute(
        select(ProtocolPhase)
        .where(ProtocolPhase.protocol_id == episode.protocol_id)
        .where(ProtocolPhase.phase_key == episode.current_phase)
        .options(
            selectinload(ProtocolPhase.prescriptions),
            selectinload(ProtocolPhase.exit_criteria),
        )
    ).scalar_one_or_none()
    if phase is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "phase not found in protocol")
    return phase


# --------------------------------------------------------------------------
# exit criteria
# --------------------------------------------------------------------------
@router.get("/{episode_id}/exit-criteria", response_model=PhaseGateOut)
def get_exit_criteria(episode: Episode, db: DbSession, phase: PhaseKey | None = None) -> dict:
    """Evaluate every gate for a phase. This is the pass/fail screen on the poster."""
    return evaluate_phase(db, episode, phase).to_dict()


@router.post("/{episode_id}/advance", response_model=AdvanceOut)
def advance_phase(episode: Episode, db: DbSession) -> AdvanceOut:
    """Re-evaluate and move to the next phase if — and only if — every gate passed."""
    if episode.status is not EpisodeStatus.ACTIVE:
        raise HTTPException(status.HTTP_409_CONFLICT, f"episode is {episode.status}")
    gate, advanced = advance_if_ready(db, episode)
    db.commit()
    db.refresh(episode)
    return AdvanceOut(
        advanced=advanced,
        episode=EpisodeOut.model_validate(episode),
        gate=PhaseGateOut.model_validate(gate.to_dict()),
    )


@router.get("/{episode_id}/attempts", response_model=list[PhaseAttemptOut])
def list_attempts(episode: Episode, db: DbSession) -> list[PhaseAttempt]:
    return list(
        db.execute(
            select(PhaseAttempt)
            .where(PhaseAttempt.episode_id == episode.id)
            .order_by(PhaseAttempt.id)
        ).scalars()
    )


@router.post(
    "/{episode_id}/signoff", response_model=SignoffOut, status_code=status.HTTP_201_CREATED
)
def create_signoff(
    payload: SignoffIn, episode: Episode, db: DbSession, clinician: Clinician
) -> ClinicianSignoff:
    """Clinician approval. Backs every ``manual.*`` exit criterion.

    The app can measure a player all day; a human still signs the release.
    """
    signoff = ClinicianSignoff(
        episode_id=episode.id,
        clinician_id=clinician.id,
        phase_key=payload.phase_key,
        criterion_key=payload.criterion_key,
        approved=payload.approved,
        note=payload.note,
    )
    db.add(signoff)
    db.commit()
    db.refresh(signoff)
    return signoff


# --------------------------------------------------------------------------
# self-reported data and field tests
# --------------------------------------------------------------------------
@router.post(
    "/{episode_id}/pain-logs", response_model=PainLogOut, status_code=status.HTTP_201_CREATED
)
def log_pain(payload: PainLogIn, episode: Episode, db: DbSession) -> PainLog:
    recorded_at = payload.recorded_at or datetime.now(UTC)
    log = PainLog(
        episode_id=episode.id,
        recorded_at=recorded_at,
        pain_rest=payload.pain_rest,
        pain_activity=payload.pain_activity,
        pain_next_morning=payload.pain_next_morning,
        stiffness=payload.stiffness,
        swelling=payload.swelling,
        confidence=payload.confidence,
        note=payload.note,
    )
    db.add(log)

    # Mirror into the metric store so `pro.*` criteria can read it.
    for metric_key, value, unit in (
        ("pro.pain_rest", payload.pain_rest, "NPRS"),
        ("pro.pain_activity", payload.pain_activity, "NPRS"),
        ("pro.pain_next_morning", payload.pain_next_morning, "NPRS"),
        ("pro.stiffness", payload.stiffness, "NPRS"),
        ("pro.swelling", payload.swelling, "NPRS"),
        ("pro.confidence", payload.confidence, "score"),
    ):
        if value is None:
            continue
        db.add(
            MetricSample(
                player_id=episode.player_id,
                episode_id=episode.id,
                metric_key=metric_key,
                source=CriterionSource.PRO,
                value=float(value),
                unit=unit,
                recorded_at=recorded_at,
            )
        )
    db.commit()
    db.refresh(log)
    return log


@router.get("/{episode_id}/pain-logs", response_model=list[PainLogOut])
def list_pain_logs(episode: Episode, db: DbSession, limit: int = 60) -> list[PainLog]:
    return list(
        db.execute(
            select(PainLog)
            .where(PainLog.episode_id == episode.id)
            .order_by(PainLog.recorded_at.desc())
            .limit(min(limit, 365))
        ).scalars()
    )


@router.post(
    "/{episode_id}/tests", response_model=MetricSampleOut, status_code=status.HTTP_201_CREATED
)
def record_test(payload: TestResultIn, episode: Episode, db: DbSession) -> MetricSample:
    """Type in a field test result (hop distance, hand-timed sprint, dynamometer).

    Side matters: symmetry criteria need both limbs measured separately.
    """
    sample = MetricSample(
        player_id=episode.player_id,
        episode_id=episode.id,
        metric_key=payload.metric_key,
        source=(
            CriterionSource.HEALTH
            if payload.metric_key.startswith("health.")
            else CriterionSource.TEST
        ),
        value=payload.value,
        unit=payload.unit,
        side=payload.side,
        recorded_at=payload.recorded_at or datetime.now(UTC),
        meta=payload.meta,
    )
    db.add(sample)
    db.commit()
    db.refresh(sample)
    return sample


@router.get("/{episode_id}/metrics", response_model=list[MetricSampleOut])
def list_metrics(
    episode: Episode,
    db: DbSession,
    metric_key: str | None = None,
    side: Side | None = None,
    limit: int = 200,
) -> list[MetricSample]:
    stmt = (
        select(MetricSample)
        .where(MetricSample.player_id == episode.player_id)
        .order_by(MetricSample.recorded_at.desc())
        .limit(min(limit, 1000))
    )
    if metric_key:
        stmt = stmt.where(MetricSample.metric_key == metric_key)
    if side:
        stmt = stmt.where(MetricSample.side == side)
    return list(db.execute(stmt).scalars())
