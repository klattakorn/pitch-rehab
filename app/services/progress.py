"""What the player has actually done, summarised for the Progress screen.

Everything here is derived, never stored. The numbers come from the same
sessions the camera wrote and the same gate the testing screen reads, so the
dashboard cannot quietly disagree with either.

One rule throughout: a figure that has not been measured is ``None``, not zero.
A player three days into a rehab has no accuracy yet; showing them 0% would read
as failure rather than as a screen with nothing on it.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import UTC, date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.enums import PHASE_ORDER, Aggregate, PhaseKey, SessionStatus
from app.models.injury import InjuryEpisode, PhaseAttempt
from app.models.protocol import Exercise, ProtocolPhase
from app.models.session import ExerciseSet, RehabSession
from app.services.criteria.engine import evaluate_phase
from app.services.criteria.resolver import MetricResolver

#: Metrics worth showing as a limb-symmetry ring, best first. Strength is the
#: one clinicians actually gate on; the hop tests stand in when it is missing.
SYMMETRY_METRICS = (
    "test.iso_quadriceps",
    "test.iso_hamstring",
    "test.hop_triple",
    "test.cmj_height",
)

#: How far back the trend chart looks.
TREND_DAYS = 28


@dataclass(slots=True)
class TrendPoint:
    day: date
    sessions: int
    exercises: int
    mean_form_score: float | None


@dataclass(slots=True)
class TopExercise:
    key: str
    name_en: str
    sets: int
    mean_form_score: float


@dataclass(slots=True)
class Milestone:
    label_en: str
    detail_en: str
    reached: bool


@dataclass(slots=True)
class Symmetry:
    value: float
    metric: str
    label_en: str
    samples: int


@dataclass(slots=True)
class ProgressReport:
    overall_pct: float
    phase_key: PhaseKey
    phase_order: int
    phase_pct: float
    criteria_passed: int
    criteria_total: int
    week_of: int
    weeks_total: int
    sessions_completed: int
    exercises_completed: int
    mean_form_score: float | None
    symmetry: Symmetry | None
    trend: list[TrendPoint] = field(default_factory=list)
    top_exercises: list[TopExercise] = field(default_factory=list)
    milestones: list[Milestone] = field(default_factory=list)


def _completed_sets(db: Session, episode: InjuryEpisode) -> list[tuple[ExerciseSet, RehabSession]]:
    rows = db.execute(
        select(ExerciseSet, RehabSession)
        .join(RehabSession, ExerciseSet.session_id == RehabSession.id)
        .where(RehabSession.episode_id == episode.id)
        .where(RehabSession.status == SessionStatus.COMPLETED)
        .order_by(RehabSession.started_at)
    ).all()
    return [(s, sess) for s, sess in rows]


def _weeks(db: Session, episode: InjuryEpisode) -> tuple[int, int]:
    """"Week 3 of 12" — where they are against how long the programme runs.

    The total is the sum of every phase's minimum days, which is the shortest
    the programme can possibly take. It is a floor, not a promise, and the
    screen says "of" rather than "until" for that reason.
    """
    phases = list(
        db.execute(
            select(ProtocolPhase)
            .where(ProtocolPhase.protocol_id == episode.protocol_id)
            .order_by(ProtocolPhase.order_index)
        ).scalars()
    ) if episode.protocol_id else []

    total_days = sum(p.min_days or 0 for p in phases)
    weeks_total = max(1, round(total_days / 7)) if total_days else 12

    # Not capped at the total. A player who is past the minimum length but has
    # not cleared the gates is genuinely in week 14 of a 7-week programme, and
    # rounding that down to "week 7" would hide exactly the situation worth
    # noticing. The screen drops the "of N" once the two cross.
    started = episode.injured_on or date.today()
    elapsed_days = max(0, (date.today() - started).days)
    return elapsed_days // 7 + 1, weeks_total


def _symmetry(resolver: MetricResolver, labels: dict[str, str]) -> Symmetry | None:
    for metric in SYMMETRY_METRICS:
        value, samples = resolver.limb_symmetry(metric, Aggregate.MAX, window_days=90)
        if value is not None:
            return Symmetry(
                value=round(value, 1),
                metric=metric,
                label_en=labels.get(metric, metric),
                samples=samples.count,
            )
    return None


SYMMETRY_LABELS = {
    "test.iso_quadriceps": "Quadriceps strength",
    "test.iso_hamstring": "Hamstring strength",
    "test.hop_triple": "Triple hop distance",
    "test.cmj_height": "Jump height",
}


def build_report(db: Session, episode: InjuryEpisode) -> ProgressReport:
    gate = evaluate_phase(db, episode)
    phase_order = PHASE_ORDER.index(episode.current_phase)

    # Where they are across the whole programme, not just this phase. Finishing
    # phase 2 of 4 with a half-full gate is 62%, not 50% and not 12%.
    overall = (phase_order + min(1.0, gate.progress)) / len(PHASE_ORDER)

    rows = _completed_sets(db, episode)
    session_ids = {sess.id for _, sess in rows}
    scored = [s.form_score for s, _ in rows if s.form_score is not None]

    by_day: dict[date, list[ExerciseSet]] = defaultdict(list)
    sessions_by_day: dict[date, set[int]] = defaultdict(set)
    for exercise_set, session in rows:
        day = session.started_at.astimezone(UTC).date()
        by_day[day].append(exercise_set)
        sessions_by_day[day].add(session.id)

    today = date.today()
    trend = []
    for offset in range(TREND_DAYS - 1, -1, -1):
        day = today - timedelta(days=offset)
        sets_today = by_day.get(day, [])
        day_scores = [s.form_score for s in sets_today if s.form_score is not None]
        trend.append(
            TrendPoint(
                day=day,
                sessions=len(sessions_by_day.get(day, ())),
                exercises=len(sets_today),
                mean_form_score=(
                    round(sum(day_scores) / len(day_scores), 1) if day_scores else None
                ),
            )
        )

    per_exercise: dict[int, list[ExerciseSet]] = defaultdict(list)
    for exercise_set, _ in rows:
        per_exercise[exercise_set.exercise_id].append(exercise_set)
    names = {
        e.id: (e.key, e.name_en)
        for e in db.execute(
            select(Exercise).where(Exercise.id.in_(per_exercise.keys() or [0]))
        ).scalars()
    }
    top: list[TopExercise] = []
    for exercise_id, sets in per_exercise.items():
        scores = [s.form_score for s in sets if s.form_score is not None]
        if not scores or exercise_id not in names:
            continue
        key, name = names[exercise_id]
        top.append(
            TopExercise(
                key=key,
                name_en=name,
                sets=len(sets),
                mean_form_score=round(sum(scores) / len(scores), 1),
            )
        )
    top.sort(key=lambda t: (-t.mean_form_score, t.name_en))

    week_of, weeks_total = _weeks(db, episode)
    resolver = MetricResolver(db, episode)

    return ProgressReport(
        overall_pct=round(100 * overall, 1),
        phase_key=episode.current_phase,
        phase_order=phase_order + 1,
        # The share of criteria passed, not the mean progress toward each --
        # averaging lets a phase read 100% while a test is still failing.
        phase_pct=round(
            100 * gate.required_passed / gate.required_total
            if gate.required_total
            else (100.0 if gate.passed else 0.0),
            1,
        ),
        criteria_passed=gate.required_passed,
        criteria_total=gate.required_total,
        week_of=week_of,
        weeks_total=weeks_total,
        sessions_completed=len(session_ids),
        exercises_completed=len(rows),
        mean_form_score=round(sum(scored) / len(scored), 1) if scored else None,
        symmetry=_symmetry(resolver, SYMMETRY_LABELS),
        trend=trend,
        top_exercises=top[:5],
        milestones=_milestones(db, episode, gate),
    )


def _milestones(db: Session, episode: InjuryEpisode, gate) -> list[Milestone]:  # noqa: ANN001
    """Phases already cleared, then the criteria passed in the current one.

    Deliberately not the same list as the testing screen. That screen is the
    gate -- everything still standing between the player and the next phase.
    This is the opposite: what they have already banked.
    """
    titles = {
        p.phase_key: p.title_en
        for p in db.execute(
            select(ProtocolPhase).where(ProtocolPhase.protocol_id == episode.protocol_id)
        ).scalars()
    } if episode.protocol_id else {}

    passed_phases = {
        a.phase_key
        for a in db.execute(
            select(PhaseAttempt)
            .where(PhaseAttempt.episode_id == episode.id)
            .where(PhaseAttempt.passed.is_(True))
        ).scalars()
    }

    out = [
        Milestone(
            label_en=titles.get(key, str(key)),
            detail_en=f"Phase {index + 1} cleared",
            reached=True,
        )
        for index, key in enumerate(PHASE_ORDER)
        if key in passed_phases
    ]
    out.extend(
        Milestone(label_en=c.label_en, detail_en=c.detail_en, reached=True)
        for c in gate.criteria
        if c.passed
    )
    if not out:
        out.append(
            Milestone(
                label_en="Nothing banked yet",
                detail_en="Complete a few sessions and your first milestones appear here",
                reached=False,
            )
        )
    return out
