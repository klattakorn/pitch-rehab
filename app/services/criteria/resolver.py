from __future__ import annotations

import statistics
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import numpy as np
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.enums import (
    Aggregate,
    MetricScope,
    PhaseKey,
    SessionStatus,
    Side,
)
from app.data.position_norms import position_norm
from app.models.injury import InjuryEpisode
from app.models.metrics import MetricSample
from app.models.protocol import Exercise, ProtocolPhase
from app.models.session import ExerciseSet, PainLog, RehabSession
from app.models.user import PlayerBaseline


@dataclass(slots=True)
class SampleSet:
    """Raw values pulled for one metric, split by limb where it matters."""

    values: list[float]
    unit: str | None
    by_side: dict[Side, list[float]]
    latest_at: datetime | None

    @property
    def count(self) -> int:
        return len(self.values)


def _apply(values: list[float], how: Aggregate) -> float | None:
    if not values:
        return None
    arr = np.asarray(values, dtype=float)
    match how:
        case Aggregate.LATEST:
            return float(values[-1])
        case Aggregate.MAX:
            return float(arr.max())
        case Aggregate.MIN:
            return float(arr.min())
        case Aggregate.MEAN:
            return float(arr.mean())
        case Aggregate.MEDIAN:
            return float(statistics.median(values))
        case Aggregate.P95:
            return float(np.percentile(arr, 95))
        case Aggregate.SUM:
            return float(arr.sum())
        case Aggregate.COUNT:
            return float(len(values))
    return None


class MetricResolver:
    """Turns a metric key + window + limb scope into numbers.

    Everything the exit-criteria engine knows about a player flows through here:
    stored ``metric_sample`` rows for pose/test/pro/health data, and computed
    values for the ``session.*`` namespace (adherence, time in phase, streaks).
    """

    def __init__(self, db: Session, episode: InjuryEpisode, now: datetime | None = None) -> None:
        self.db = db
        self.episode = episode
        self.now = now or datetime.now(UTC)

    # ------------------------------------------------------------------ samples
    def fetch(
        self,
        metric_key: str,
        window_days: int | None,
        scope: MetricScope = MetricScope.ANY,
    ) -> SampleSet:
        if metric_key.startswith("session."):
            return self._derived(metric_key, window_days)

        stmt = (
            select(MetricSample)
            .where(MetricSample.player_id == self.episode.player_id)
            .where(MetricSample.metric_key == metric_key)
            .order_by(MetricSample.recorded_at)
        )
        if window_days is not None:
            stmt = stmt.where(MetricSample.recorded_at >= self.now - timedelta(days=window_days))
        else:
            # "any time this episode" -- never count pre-injury readings as progress.
            stmt = stmt.where(
                MetricSample.recorded_at
                >= datetime.combine(self.episode.injured_on, datetime.min.time(), tzinfo=UTC)
            )

        rows = list(self.db.execute(stmt).scalars())
        rows = [r for r in rows if self._in_scope(r.side, scope)]

        by_side: dict[Side, list[float]] = {}
        for r in rows:
            if r.side in (Side.LEFT, Side.RIGHT):
                by_side.setdefault(r.side, []).append(r.value)

        return SampleSet(
            values=[r.value for r in rows],
            unit=next((r.unit for r in rows if r.unit), None),
            by_side=by_side,
            latest_at=rows[-1].recorded_at if rows else None,
        )

    def _in_scope(self, side: Side | None, scope: MetricScope) -> bool:
        if scope is MetricScope.ANY:
            return True
        injured = self.episode.side
        healthy = self.episode.uninjured_side
        if scope is MetricScope.INJURED:
            return side == injured or (side is None and injured is Side.BILATERAL)
        if scope is MetricScope.UNINJURED:
            return side == healthy
        return side in (injured, healthy) or side is None  # BOTH

    def aggregate(
        self,
        metric_key: str,
        how: Aggregate,
        window_days: int | None,
        scope: MetricScope = MetricScope.ANY,
    ) -> tuple[float | None, SampleSet]:
        samples = self.fetch(metric_key, window_days, scope)
        return _apply(samples.values, how), samples

    def limb_symmetry(
        self, metric_key: str, how: Aggregate, window_days: int | None
    ) -> tuple[float | None, SampleSet]:
        """Injured limb as a percentage of the healthy one."""
        samples = self.fetch(metric_key, window_days, MetricScope.BOTH)
        injured_side = self.episode.side
        healthy_side = self.episode.uninjured_side
        if healthy_side is None:  # bilateral injury -- symmetry is meaningless
            return None, samples
        injured = _apply(samples.by_side.get(injured_side, []), how)
        healthy = _apply(samples.by_side.get(healthy_side, []), how)
        if injured is None or healthy is None or healthy == 0:
            return None, samples
        return 100.0 * injured / healthy, samples

    # ----------------------------------------------------------------- baseline
    def baseline(self, metric_key: str) -> tuple[float | None, str]:
        """Resolve a personal reference value. Returns ``(value, origin)``."""
        healthy = self.episode.uninjured_side
        stored = list(
            self.db.execute(
                select(PlayerBaseline)
                .where(PlayerBaseline.player_id == self.episode.player_id)
                .where(PlayerBaseline.metric_key == metric_key)
            ).scalars()
        )
        # Prefer the healthy limb's number, then a general one, then anything stored.
        for wanted in ([healthy] if healthy else []) + [Side.BILATERAL]:
            for row in stored:
                if row.side == wanted:
                    return row.value, row.origin
        if stored:
            return stored[0].value, stored[0].origin

        derived = self._pre_injury_value(metric_key)
        if derived is not None:
            return derived, "pre_injury_history"

        player = self.episode.player
        norm = position_norm(player.position, metric_key) if player else None
        if norm is not None:
            return norm, "position_norm"
        return None, "none"

    def _pre_injury_value(self, metric_key: str, lookback_days: int = 90) -> float | None:
        """Best reading in the 90 days before the injury -- the player's own 'normal'."""
        injured_at = datetime.combine(self.episode.injured_on, datetime.min.time(), tzinfo=UTC)
        rows = list(
            self.db.execute(
                select(MetricSample.value)
                .where(MetricSample.player_id == self.episode.player_id)
                .where(MetricSample.metric_key == metric_key)
                .where(MetricSample.recorded_at < injured_at)
                .where(MetricSample.recorded_at >= injured_at - timedelta(days=lookback_days))
            ).scalars()
        )
        if len(rows) < 3:  # too thin to trust as a baseline
            return None
        return float(np.percentile(np.asarray(rows, dtype=float), 90))

    # ------------------------------------------------------------------ derived
    def _derived(self, metric_key: str, window_days: int | None) -> SampleSet:
        fn = _DERIVED.get(metric_key)
        if fn is not None:
            value, unit = fn(self, window_days)
            return (
                SampleSet([], unit, {}, None)
                if value is None
                else SampleSet([value], unit, {}, self.now)
            )

        # Per-exercise metrics carry the exercise in the key itself, so a player
        # can gate on "20 reps of the calf raise" without the library having to
        # anticipate every exercise anyone might choose.
        for prefix, per_exercise in _DERIVED_PER_EXERCISE.items():
            if metric_key.startswith(prefix):
                value, unit = per_exercise(self, metric_key[len(prefix) :], window_days)
                return (
                    SampleSet([], unit, {}, None)
                    if value is None
                    else SampleSet([value], unit, {}, self.now)
                )

        return SampleSet([], None, {}, None)

    # helpers used by the derived-metric table below
    def _phase_start(self) -> datetime:
        return self.episode.phase_started_at or datetime.combine(
            self.episode.injured_on, datetime.min.time(), tzinfo=UTC
        )

    def _current_phase_row(self) -> ProtocolPhase | None:
        if self.episode.protocol_id is None:
            return None
        return self.db.execute(
            select(ProtocolPhase)
            .where(ProtocolPhase.protocol_id == self.episode.protocol_id)
            .where(ProtocolPhase.phase_key == self.episode.current_phase)
        ).scalar_one_or_none()


DerivedFn = Callable[[MetricResolver, int | None], tuple[float | None, str | None]]


def _completed_sessions(r: MetricResolver, window_days: int | None) -> tuple[float | None, str]:
    since = r._phase_start()
    if window_days is not None:
        since = max(since, r.now - timedelta(days=window_days))
    count = r.db.execute(
        select(func.count(RehabSession.id))
        .where(RehabSession.episode_id == r.episode.id)
        .where(RehabSession.phase_key == r.episode.current_phase)
        .where(RehabSession.status == SessionStatus.COMPLETED)
        .where(RehabSession.started_at >= since)
    ).scalar_one()
    return float(count), "count"


def _days_in_phase(r: MetricResolver, _window: int | None) -> tuple[float | None, str]:
    return (r.now - r._phase_start()).total_seconds() / 86400.0, "days"


def _adherence_pct(r: MetricResolver, _window: int | None) -> tuple[float | None, str]:
    phase = r._current_phase_row()
    if phase is None:
        return None, "%"
    days, _ = _days_in_phase(r, None)
    weeks = max((days or 0.0) / 7.0, 1.0 / 7.0)
    expected = max(1.0, phase.sessions_per_week * weeks)
    done, _ = _completed_sessions(r, None)
    return min(100.0, 100.0 * (done or 0.0) / expected), "%"


def _pain_free_days(r: MetricResolver, window_days: int | None) -> tuple[float | None, str]:
    """Consecutive days, counting back from today, with no logged pain above 2/10."""
    since = r.now - timedelta(days=window_days or 30)
    logs = list(
        r.db.execute(
            select(PainLog)
            .where(PainLog.episode_id == r.episode.id)
            .where(PainLog.recorded_at >= since)
            .order_by(PainLog.recorded_at.desc())
        ).scalars()
    )
    if not logs:
        return None, "days"
    streak_start = r.now
    for log in logs:
        worst = max(log.pain_rest, log.pain_activity, log.pain_next_morning or 0.0)
        if worst > 2.0:
            break
        streak_start = log.recorded_at
    return max(0.0, (r.now - streak_start).total_seconds() / 86400.0), "days"


def _mean_form_score(r: MetricResolver, window_days: int | None) -> tuple[float | None, str]:
    value, _ = r.aggregate(
        "pose.form_score", Aggregate.MEAN, window_days or 14, MetricScope.ANY
    )
    return value, "score"


_DERIVED: dict[str, DerivedFn] = {
    "session.completed_in_phase": _completed_sessions,
    "session.days_in_phase": _days_in_phase,
    "session.adherence_pct": _adherence_pct,
    "session.pain_free_days": _pain_free_days,
    "session.mean_form_score": _mean_form_score,
}

DERIVED_METRIC_KEYS: tuple[str, ...] = tuple(_DERIVED)


# --------------------------------------------------------------- per exercise
def _exercise_sets(
    r: MetricResolver, exercise_key: str, window_days: int | None
) -> list[ExerciseSet]:
    """Every completed set of one exercise inside the window."""
    stmt = (
        select(ExerciseSet)
        .join(RehabSession, ExerciseSet.session_id == RehabSession.id)
        .join(Exercise, ExerciseSet.exercise_id == Exercise.id)
        .where(RehabSession.episode_id == r.episode.id)
        .where(RehabSession.status == SessionStatus.COMPLETED)
        .where(Exercise.key == exercise_key)
    )
    if window_days is not None:
        stmt = stmt.where(RehabSession.started_at >= r.now - timedelta(days=window_days))
    return list(r.db.execute(stmt).scalars())


def _best_reps(
    r: MetricResolver, exercise_key: str, window_days: int | None
) -> tuple[float | None, str]:
    """The best single set, not the total.

    "Do 20 calf raises" means twenty in a row, not two sets of ten spread over a
    fortnight. Summing would let a player clear the gate without ever having
    done the thing the gate is about.
    """
    sets = _exercise_sets(r, exercise_key, window_days)
    if not sets:
        return None, "reps"
    return float(max(s.valid_reps for s in sets)), "reps"


def _best_hold(
    r: MetricResolver, exercise_key: str, window_days: int | None
) -> tuple[float | None, str]:
    """The longest clean hold, for the movements that are timed rather than counted.

    Six of the camera-scored exercises are holds -- planks, a wall sit, a
    single-leg balance -- and "do 20 reps of a side plank" is not a sentence.
    The analyser already times them and writes the result on each rep record,
    so this is the seconds equivalent of ``_best_reps``: the best single effort,
    not the sum of several.
    """
    sets = _exercise_sets(r, exercise_key, window_days)
    holds = [
        rep.hold_seconds
        for one_set in sets
        for rep in one_set.reps
        if rep.is_valid and rep.hold_seconds is not None
    ]
    if not holds:
        return None, "seconds"
    return float(max(holds)), "seconds"


def _mean_form_for_exercise(
    r: MetricResolver, exercise_key: str, window_days: int | None
) -> tuple[float | None, str]:
    scores = [
        s.form_score for s in _exercise_sets(r, exercise_key, window_days)
        if s.form_score is not None
    ]
    if not scores:
        return None, "score"
    return statistics.fmean(scores), "score"


PerExerciseFn = Callable[
    [MetricResolver, str, int | None], tuple[float | None, str | None]
]

#: Prefix -> reader. Anything after the prefix is the exercise key.
_DERIVED_PER_EXERCISE: dict[str, PerExerciseFn] = {
    "session.reps.": _best_reps,
    "session.hold.": _best_hold,
    "session.form.": _mean_form_for_exercise,
}

PER_EXERCISE_PREFIXES: tuple[str, ...] = tuple(_DERIVED_PER_EXERCISE)


def phase_index(phase: PhaseKey) -> int:
    from app.core.enums import PHASE_ORDER

    return PHASE_ORDER.index(phase)
