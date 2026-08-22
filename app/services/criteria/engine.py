from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.enums import (
    PHASE_ORDER,
    Aggregate,
    Comparator,
    CriterionSource,
    CriterionStatus,
    MetricScope,
    PhaseKey,
    TargetType,
)
from app.models.injury import ClinicianSignoff, EpisodeCriterion, InjuryEpisode
from app.models.protocol import ExitCriterion, ProtocolPhase
from app.services.criteria.resolver import MetricResolver, SampleSet
from app.services.criteria.spec import CriterionSpec

_EPS = 1e-9


@dataclass(slots=True)
class CriterionEvaluation:
    key: str
    label_en: str
    label_th: str
    metric: str
    source: CriterionSource
    required: bool
    status: CriterionStatus
    comparator: Comparator
    target_type: TargetType
    observed: float | None
    target: float | None
    unit: str | None
    progress: float
    samples: int
    baseline: float | None = None
    baseline_origin: str | None = None
    detail_en: str = ""
    detail_th: str = ""

    @property
    def passed(self) -> bool:
        return self.status is CriterionStatus.PASS

    def to_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "label_en": self.label_en,
            "label_th": self.label_th,
            "metric": self.metric,
            "source": str(self.source),
            "required": self.required,
            "status": str(self.status),
            "comparator": str(self.comparator),
            "target_type": str(self.target_type),
            "observed": self.observed,
            "target": self.target,
            "unit": self.unit,
            "progress": self.progress,
            "samples": self.samples,
            "baseline": self.baseline,
            "baseline_origin": self.baseline_origin,
            "detail_en": self.detail_en,
            "detail_th": self.detail_th,
        }


@dataclass(slots=True)
class PhaseGateResult:
    """Everything the UI needs to draw the phase card on the poster."""

    episode_id: int
    phase_key: PhaseKey
    passed: bool
    progress: float  # 0-1, mean progress across required criteria
    required_total: int
    required_passed: int
    next_phase: PhaseKey | None
    criteria: list[CriterionEvaluation] = field(default_factory=list)
    blocking: list[str] = field(default_factory=list)
    evaluated_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    def to_dict(self) -> dict[str, Any]:
        return {
            "episode_id": self.episode_id,
            "phase_key": str(self.phase_key),
            "passed": self.passed,
            "progress": self.progress,
            "required_total": self.required_total,
            "required_passed": self.required_passed,
            "next_phase": str(self.next_phase) if self.next_phase else None,
            "criteria": [c.to_dict() for c in self.criteria],
            "blocking": self.blocking,
            "evaluated_at": self.evaluated_at.isoformat(),
        }


# --------------------------------------------------------------------------
# comparison helpers
# --------------------------------------------------------------------------
def _satisfied(comp: Comparator, observed: float, target: float, upper: float | None) -> bool:
    match comp:
        case Comparator.GTE:
            return observed >= target - _EPS
        case Comparator.GT:
            return observed > target
        case Comparator.LTE:
            return observed <= target + _EPS
        case Comparator.LT:
            return observed < target
        case Comparator.EQ:
            return abs(observed - target) <= 1e-6
        case Comparator.BETWEEN:
            return target - _EPS <= observed <= (upper if upper is not None else target) + _EPS
    return False


def _progress(comp: Comparator, observed: float, target: float, upper: float | None) -> float:
    """0-1 "how close am I", so the app can draw the poster's progress bars.

    Passing always reports 1.0. Failing reports a bounded, monotone fraction --
    for "lower is better" criteria (pain, sprint time) the scale is the target
    itself, or 1 unit when the target is zero.
    """
    if _satisfied(comp, observed, target, upper):
        return 1.0
    match comp:
        case Comparator.GTE | Comparator.GT:
            if target <= 0:
                return 0.0
            return max(0.0, min(1.0, observed / target))
        case Comparator.LTE | Comparator.LT:
            scale = max(abs(target), 1.0)
            return max(0.0, min(1.0, 1.0 - (observed - target) / scale))
        case Comparator.BETWEEN:
            hi = upper if upper is not None else target
            distance = target - observed if observed < target else observed - hi
            scale = max(abs(hi - target), 1.0)
            return max(0.0, min(1.0, 1.0 - distance / scale))
        case Comparator.EQ:
            scale = max(abs(target), 1.0)
            return max(0.0, min(1.0, 1.0 - abs(observed - target) / scale))
    return 0.0


#: How each aggregate reads to a player, rather than to a database.
_HOW_MEASURED: dict[Aggregate, str] = {
    Aggregate.LATEST: "Most recent reading",
    Aggregate.MAX: "Best reading",
    Aggregate.MIN: "Lowest reading",
    Aggregate.MEAN: "Average",
    Aggregate.MEDIAN: "Typical reading",
    Aggregate.P95: "Near-best reading",
    Aggregate.SUM: "Total",
    Aggregate.COUNT: "Number of readings",
}


def _describe(spec: CriterionSpec, target: float | None, unit: str | None) -> tuple[str, str]:
    """Explain *how* this is measured. The label already states the target, so
    repeating it here — or printing the internal metric key — just adds noise."""
    how = _HOW_MEASURED.get(spec.aggregate, "Reading")
    when = (
        f" over the last {spec.window_days} days"
        if spec.window_days
        else " since the injury"
    )
    scope = {
        MetricScope.INJURED: ", injured side",
        MetricScope.UNINJURED: ", healthy side",
        MetricScope.BOTH: ", both sides compared",
    }.get(spec.scope, "")

    en = f"{how}{when}{scope}"
    if spec.min_samples > 1:
        en += f", from at least {spec.min_samples} measurements"
    if target is None:
        en = "Waiting for a baseline to compare against"
    elif spec.target.type is TargetType.PERCENT_OF_BASELINE:
        en += f" — target is {spec.target.value:g}% of your own baseline"
    elif spec.target.type is TargetType.LSI:
        en = f"{how}{when} on each side, compared to each other"

    # Thai copy is no longer shown in the app, but the field stays so the
    # bilingual option remains open without a schema change.
    return en, en


# --------------------------------------------------------------------------
# evaluation
# --------------------------------------------------------------------------
def _needs_more(spec: CriterionSpec, have: int) -> str:
    if have == 0:
        return "Not measured yet"
    missing = spec.min_samples - have
    return f"Needs {missing} more measurement{'s' if missing != 1 else ''}"


def evaluate_criterion(
    resolver: MetricResolver,
    criterion: ExitCriterion,
    signoffs: dict[str | None, ClinicianSignoff] | None = None,
) -> CriterionEvaluation:
    spec = CriterionSpec.model_validate(criterion.spec)
    signoffs = signoffs or {}

    base = dict(
        key=criterion.key,
        label_en=criterion.label_en,
        label_th=criterion.label_th,
        metric=spec.metric,
        source=spec.source,
        required=criterion.required,
        comparator=spec.comparator,
        target_type=spec.target.type,
        unit=spec.target.unit,
    )

    # --- clinician sign-off is a yes/no gate, not a measurement --------------
    if spec.source is CriterionSource.MANUAL:
        signoff = signoffs.get(criterion.key) or signoffs.get(None)
        approved = bool(signoff and signoff.approved)
        return CriterionEvaluation(
            **base,
            status=CriterionStatus.PASS if approved else CriterionStatus.PENDING_SIGNOFF,
            observed=1.0 if approved else 0.0,
            target=1.0,
            progress=1.0 if approved else 0.0,
            samples=1 if signoff else 0,
            detail_en="Signed off by clinician" if approved else "Waiting for clinician sign-off",
            detail_th="ผ่านการรับรองโดยผู้เชี่ยวชาญ" if approved else "รอผู้เชี่ยวชาญรับรอง",
        )

    # --- observed value -----------------------------------------------------
    samples: SampleSet
    if spec.target.type is TargetType.LSI:
        observed, samples = resolver.limb_symmetry(spec.metric, spec.aggregate, spec.window_days)
    else:
        observed, samples = resolver.aggregate(
            spec.metric, spec.aggregate, spec.window_days, spec.scope
        )

    unit = spec.target.unit or samples.unit
    if spec.target.type is TargetType.LSI:
        unit = "%"

    # --- target value -------------------------------------------------------
    baseline: float | None = None
    baseline_origin: str | None = None
    if spec.target.type in (TargetType.PERCENT_OF_BASELINE, TargetType.DELTA):
        baseline, baseline_origin = resolver.baseline(spec.target.baseline_metric or spec.metric)
        if baseline is None:
            target = None
        elif spec.target.type is TargetType.PERCENT_OF_BASELINE:
            target = baseline * spec.target.value / 100.0
        else:
            target = baseline + spec.target.value
    else:
        target = spec.target.value

    detail_en, detail_th = _describe(spec, target, unit)

    if observed is None or samples.count < spec.min_samples or target is None:
        missing_baseline = target is None and spec.target.type is not TargetType.ABSOLUTE
        return CriterionEvaluation(
            **{**base, "unit": unit},
            status=CriterionStatus.NO_DATA,
            observed=observed,
            target=target,
            progress=0.0,
            samples=samples.count,
            baseline=baseline,
            baseline_origin=baseline_origin,
            detail_en=(
                "No baseline to compare against yet"
                if missing_baseline
                else _needs_more(spec, samples.count)
            ),
            detail_th=(
                "No baseline to compare against yet"
                if missing_baseline
                else _needs_more(spec, samples.count)
            ),
        )

    ok = _satisfied(spec.comparator, observed, target, spec.target.upper)
    return CriterionEvaluation(
        **{**base, "unit": unit},
        status=CriterionStatus.PASS if ok else CriterionStatus.FAIL,
        observed=round(observed, 3),
        target=round(target, 3),
        progress=round(_progress(spec.comparator, observed, target, spec.target.upper), 3),
        samples=samples.count,
        baseline=round(baseline, 3) if baseline is not None else None,
        baseline_origin=baseline_origin,
        detail_en=detail_en,
        detail_th=detail_th,
    )


def merge_criteria(
    db: Session,
    episode: InjuryEpisode,
    phase_key: PhaseKey,
    library: Sequence[ExitCriterion],
) -> list[ExitCriterion | EpisodeCriterion]:
    """The library's criteria for this phase, plus whatever the player added.

    A custom criterion sharing a key with a library one **replaces** it. That is
    how "the standard sprint gate, but 95%" is said: the player is not adding a
    second, contradictory rule that both have to pass -- they are changing the
    one that already exists.

    Anything with a new key is appended, so the personal tests read as a group
    after the standard battery rather than being scattered through it.
    """
    custom = list(
        db.execute(
            select(EpisodeCriterion)
            .where(EpisodeCriterion.episode_id == episode.id)
            .where(EpisodeCriterion.phase_key == phase_key)
            .order_by(EpisodeCriterion.order_index, EpisodeCriterion.id)
        ).scalars()
    )
    if not custom:
        return list(library)

    overrides = {c.key: c for c in custom}
    merged: list[ExitCriterion | EpisodeCriterion] = [
        overrides.pop(item.key, item) for item in library
    ]
    # Whatever is left over introduced a key the library never had.
    merged.extend(c for c in custom if c.key in overrides)
    return merged


def evaluate_phase(
    db: Session,
    episode: InjuryEpisode,
    phase_key: PhaseKey | None = None,
    now: datetime | None = None,
) -> PhaseGateResult:
    """Run every exit criterion for a phase and decide whether it unlocks."""
    phase_key = phase_key or episode.current_phase
    resolver = MetricResolver(db, episode, now=now)

    phase = (
        db.execute(
            select(ProtocolPhase)
            .where(ProtocolPhase.protocol_id == episode.protocol_id)
            .where(ProtocolPhase.phase_key == phase_key)
        ).scalar_one_or_none()
        if episode.protocol_id
        else None
    )

    idx = PHASE_ORDER.index(phase_key)
    next_phase = PHASE_ORDER[idx + 1] if idx + 1 < len(PHASE_ORDER) else None

    if phase is None:
        return PhaseGateResult(
            episode_id=episode.id,
            phase_key=phase_key,
            passed=False,
            progress=0.0,
            required_total=0,
            required_passed=0,
            next_phase=next_phase,
            blocking=["no_protocol_assigned"],
        )

    signoff_rows = list(
        db.execute(
            select(ClinicianSignoff)
            .where(ClinicianSignoff.episode_id == episode.id)
            .where(ClinicianSignoff.phase_key == phase_key)
            .order_by(ClinicianSignoff.created_at)
        ).scalars()
    )
    signoffs: dict[str | None, ClinicianSignoff] = {s.criterion_key: s for s in signoff_rows}

    evaluations = [
        evaluate_criterion(resolver, c, signoffs)
        for c in merge_criteria(db, episode, phase_key, phase.exit_criteria)
    ]
    required = [e for e in evaluations if e.required]
    required_passed = [e for e in required if e.passed]

    # A minimum time in phase is a tissue-healing constraint, not a metric --
    # enforce it regardless of how good the numbers look.
    blocking = [e.key for e in required if not e.passed]
    elapsed_days = resolver.fetch("session.days_in_phase", None).values
    if phase.min_days and (elapsed_days[0] if elapsed_days else 0.0) < phase.min_days:
        blocking.append("min_days_in_phase")

    if required:
        progress = sum(e.progress for e in required) / len(required)
    else:
        progress = 0.0 if blocking else 1.0

    return PhaseGateResult(
        episode_id=episode.id,
        phase_key=phase_key,
        passed=not blocking,
        progress=round(progress, 3),
        required_total=len(required),
        required_passed=len(required_passed),
        next_phase=next_phase,
        criteria=evaluations,
        blocking=blocking,
    )
