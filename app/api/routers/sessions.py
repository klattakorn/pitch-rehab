from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession, Episode
from app.core.enums import CriterionSource, EpisodeStatus, Role, SessionStatus, Side
from app.models.injury import InjuryEpisode
from app.models.metrics import MetricSample
from app.models.protocol import Exercise
from app.models.session import ExerciseSet, RehabSession, RepRecord
from app.models.user import PlayerProfile
from app.schemas.session import (
    SessionCompleteIn,
    SessionOut,
    SessionStartIn,
    SetResultOut,
    SetUploadIn,
)
from app.services.pose.analyzer import SetAnalysis, WrongCameraView, analyze_set
from app.services.pose.geometry import Frame
from app.services.pose.rules import ExerciseRule

router = APIRouter(tags=["sessions"])

#: Landmark traces are only kept for review, so one frame in five is plenty.
FRAME_KEEP_STRIDE = 5


def _load_session(db: DbSession, user: CurrentUser, session_id: int) -> RehabSession:
    session = db.get(RehabSession, session_id)
    if session is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "session not found")
    if user.role is Role.PLAYER:
        profile = db.execute(
            select(PlayerProfile).where(PlayerProfile.user_id == user.id)
        ).scalar_one_or_none()
        episode = db.get(InjuryEpisode, session.episode_id)
        if profile is None or episode is None or episode.player_id != profile.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "session not found")
    return session


@router.post(
    "/injuries/{episode_id}/sessions",
    response_model=SessionOut,
    status_code=status.HTTP_201_CREATED,
)
def start_session(
    payload: SessionStartIn, episode: Episode, db: DbSession
) -> RehabSession:
    if episode.status is not EpisodeStatus.ACTIVE:
        raise HTTPException(status.HTTP_409_CONFLICT, f"episode is {episode.status}")
    session = RehabSession(
        episode_id=episode.id,
        phase_key=episode.current_phase,
        started_at=payload.started_at or datetime.now(UTC),
        device=payload.device,
        app_version=payload.app_version,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@router.get("/injuries/{episode_id}/sessions", response_model=list[SessionOut])
def list_sessions(episode: Episode, db: DbSession, limit: int = 50) -> list[RehabSession]:
    return list(
        db.execute(
            select(RehabSession)
            .where(RehabSession.episode_id == episode.id)
            .order_by(RehabSession.started_at.desc())
            .limit(min(limit, 500))
        ).scalars()
    )


@router.post("/sessions/{session_id}/sets", response_model=SetResultOut)
def upload_set(
    session_id: int, payload: SetUploadIn, db: DbSession, user: CurrentUser
) -> SetResultOut:
    """Score one set of MediaPipe landmarks.

    The phone runs MediaPipe and streams landmarks; the server recomputes every
    angle from those landmarks rather than trusting the client's numbers, then
    writes the results into the metric store the exit criteria read from.
    """
    session = _load_session(db, user, session_id)
    if session.status is not SessionStatus.IN_PROGRESS:
        raise HTTPException(status.HTTP_409_CONFLICT, "session already closed")

    exercise = db.execute(
        select(Exercise).where(Exercise.key == payload.exercise_key)
    ).scalar_one_or_none()
    if exercise is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"unknown exercise {payload.exercise_key}")

    episode = db.get(InjuryEpisode, session.episode_id)
    assert episode is not None

    exercise_set = ExerciseSet(
        session_id=session.id,
        exercise_id=exercise.id,
        prescription_id=payload.prescription_id,
        order_index=payload.order_index,
        side=payload.side,
        prescribed_reps=payload.prescribed_reps,
        load_kg=payload.load_kg,
    )
    db.add(exercise_set)
    db.flush()

    if exercise.pose_rule is None:
        if payload.completed_reps is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                f"{exercise.key} has no camera rule — send `completed_reps` instead of frames",
            )
        exercise_set.completed_reps = payload.completed_reps
        exercise_set.valid_reps = payload.completed_reps
        db.commit()
        return SetResultOut(
            set_id=exercise_set.id,
            exercise_key=exercise.key,
            side=payload.side,
            completed_reps=payload.completed_reps,
            valid_reps=payload.completed_reps,
            form_score=0.0,
            tracking_quality=0.0,
            warnings=["manually_logged"],
            reps=[],
            emitted=[],
        )

    if len(payload.frames) < 2:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"{exercise.key} is camera-scored — send at least 2 landmark frames",
        )

    rule = ExerciseRule.model_validate(exercise.pose_rule)
    aspect = (
        payload.image_width / payload.image_height
        if payload.image_width and payload.image_height
        else 1.0
    )
    frames = [
        Frame.from_payload(
            f.t, [lm.model_dump() for lm in f.landmarks], space=payload.space, aspect=aspect
        )
        for f in payload.frames
    ]
    try:
        analysis = analyze_set(frames, rule, payload.side)
    except WrongCameraView as exc:
        # Not a scoring failure — the player needs to move the phone, and telling
        # them that is far more useful than a made-up score.
        db.rollback()
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            {
                "error": "wrong_camera_view",
                "expected_view": exc.expected,
                "detected_view": exc.detected,
                "message_en": f"Move the phone so it films you from the {exc.expected}, "
                f"then record the set again.",
                "message_th": (
                    "กรุณาย้ายมือถือให้ถ่ายจากด้านหน้า แล้วบันทึกใหม่"
                    if exc.expected == "front"
                    else "กรุณาย้ายมือถือให้ถ่ายจากด้านข้าง แล้วบันทึกใหม่"
                ),
            },
        ) from exc

    exercise_set.completed_reps = analysis.completed_reps
    exercise_set.valid_reps = analysis.valid_reps
    exercise_set.form_score = analysis.form_score

    kept_frames = (
        [
            {"t": f.t, "landmarks": [lm.model_dump() for lm in f.landmarks]}
            for f in payload.frames[::FRAME_KEEP_STRIDE]
        ]
        if payload.keep_frames
        else None
    )
    for rep in analysis.reps:
        db.add(
            RepRecord(
                set_id=exercise_set.id,
                rep_index=rep.index,
                is_valid=rep.is_valid,
                form_score=rep.form_score,
                tempo_seconds=rep.duration,
                hold_seconds=rep.hold_seconds,
                tracking_quality=rep.tracking_quality,
                metrics=rep.metrics,
                violations=[v.to_dict() for v in rep.violations],
                frames=kept_frames if rep.index == 0 else None,
            )
        )

    _store_metrics(db, episode, session, exercise, analysis, payload.side)
    db.commit()

    return SetResultOut(
        set_id=exercise_set.id,
        exercise_key=exercise.key,
        side=payload.side,
        completed_reps=analysis.completed_reps,
        valid_reps=analysis.valid_reps,
        form_score=analysis.form_score,
        tracking_quality=analysis.tracking_quality,
        warnings=analysis.warnings,
        reps=[
            {
                "index": r.index,
                "start_t": r.start_t,
                "end_t": r.end_t,
                "duration": r.duration,
                "is_valid": r.is_valid,
                "form_score": r.form_score,
                "tracking_quality": r.tracking_quality,
                "hold_seconds": r.hold_seconds,
                "metrics": r.metrics,
                "violations": [v.to_dict() for v in r.violations],
            }
            for r in analysis.reps
        ],
        emitted=[
            {"key": e.key, "value": e.value, "unit": e.unit, "side": e.side}
            for e in analysis.emitted
        ],
    )


def _store_metrics(
    db: DbSession,
    episode: InjuryEpisode,
    session: RehabSession,
    exercise: Exercise,
    analysis: SetAnalysis,
    side: Side,
) -> None:
    """Push the set's results into ``metric_sample`` so exit criteria can see them."""
    now = datetime.now(UTC)

    def add(metric_key: str, value: float, unit: str | None, sample_side: Side | None) -> None:
        db.add(
            MetricSample(
                player_id=episode.player_id,
                episode_id=episode.id,
                session_id=session.id,
                metric_key=metric_key,
                source=CriterionSource.POSE,
                value=value,
                unit=unit,
                side=sample_side,
                recorded_at=now,
                meta={"exercise": exercise.key},
            )
        )

    for emitted in analysis.emitted:
        add(emitted.key, emitted.value, emitted.unit, emitted.side)

    if analysis.valid_reps:
        add("pose.form_score", analysis.form_score, "score", None)
        add(f"pose.{exercise.key}.form_score", analysis.form_score, "score", side or None)
        add(f"pose.{exercise.key}.valid_reps", float(analysis.valid_reps), "count", side or None)


@router.post("/sessions/{session_id}/complete", response_model=SessionOut)
def complete_session(
    session_id: int, payload: SessionCompleteIn, db: DbSession, user: CurrentUser
) -> RehabSession:
    session = _load_session(db, user, session_id)
    if session.status is not SessionStatus.IN_PROGRESS:
        raise HTTPException(status.HTTP_409_CONFLICT, "session already closed")

    session.ended_at = payload.ended_at or datetime.now(UTC)
    session.status = SessionStatus.COMPLETED
    session.rpe = payload.rpe
    session.pain_during = payload.pain_during
    session.pain_after = payload.pain_after
    session.note = payload.note

    episode = db.get(InjuryEpisode, session.episode_id)
    assert episode is not None
    for metric_key, value in (
        ("pro.pain_activity", payload.pain_during),
        ("pro.pain_after_session", payload.pain_after),
        ("pro.rpe", payload.rpe),
    ):
        if value is None:
            continue
        db.add(
            MetricSample(
                player_id=episode.player_id,
                episode_id=episode.id,
                session_id=session.id,
                metric_key=metric_key,
                source=CriterionSource.PRO,
                value=float(value),
                unit="rpe" if metric_key.endswith("rpe") else "NPRS",
                recorded_at=session.ended_at,
            )
        )
    db.commit()
    db.refresh(session)
    return session
