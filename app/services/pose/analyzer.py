from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import asdict, dataclass, field

from app.core.enums import Side
from app.services.pose.geometry import (
    Frame,
    MetricSeries,
    aggregate,
    compute_metrics,
    detect_view,
    implausible_frames,
)
from app.services.pose.landmarks import LM
from app.services.pose.rules import EmitMetric, ExerciseRule, MetricTarget


class WrongCameraView(Exception):
    """The set was filmed from an angle this exercise cannot be scored from.

    Raised rather than returning a low score, because the two mean different
    things to a player: "your form was poor" versus "move your phone".
    """

    def __init__(self, expected: str, detected: str, score: float | None) -> None:
        self.expected = expected
        self.detected = detected
        self.score = score
        super().__init__(
            f"this exercise must be filmed from the {expected}, "
            f"but the video looks {detected}-on"
        )


@dataclass(slots=True)
class Violation:
    code: str
    metric: str
    observed: float
    limit: float
    bound: str  # "min" | "max"
    severity: float  # 0-1, how badly the band was broken
    critical: bool
    message_en: str
    message_th: str

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass(slots=True)
class RepAnalysis:
    index: int
    start_t: float
    end_t: float
    is_valid: bool
    form_score: float
    tracking_quality: float
    metrics: dict[str, float] = field(default_factory=dict)
    violations: list[Violation] = field(default_factory=list)
    hold_seconds: float | None = None

    @property
    def duration(self) -> float:
        return round(self.end_t - self.start_t, 3)


@dataclass(slots=True)
class EmittedMetric:
    key: str
    value: float
    unit: str
    side: Side | None


@dataclass(slots=True)
class SetAnalysis:
    reps: list[RepAnalysis]
    completed_reps: int
    valid_reps: int
    form_score: float
    tracking_quality: float
    emitted: list[EmittedMetric] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def _penalty_scale(limit: float, tolerance: float) -> float:
    """How far past the limit counts as "completely wrong" (severity 1.0).

    Scales with the limit so it works for degrees (12 -> 6) and ratios (0.3 -> 0.15)
    without per-target tuning.
    """
    base = abs(limit) * 0.5 if limit else 1.0
    return max(base, tolerance, 1e-6)


def _evaluate_target(target: MetricTarget, observed: float) -> Violation | None:
    if target.max is not None and observed > target.max + target.tolerance:
        over = observed - target.max
        return Violation(
            code=target.code,
            metric=target.metric,
            observed=round(observed, 3),
            limit=target.max,
            bound="max",
            severity=min(1.0, over / _penalty_scale(target.max, target.tolerance)),
            critical=target.critical,
            message_en=target.message_en,
            message_th=target.message_th,
        )
    if target.min is not None and observed < target.min - target.tolerance:
        under = target.min - observed
        return Violation(
            code=target.code,
            metric=target.metric,
            observed=round(observed, 3),
            limit=target.min,
            bound="min",
            severity=min(1.0, under / _penalty_scale(target.min, target.tolerance)),
            critical=target.critical,
            message_en=target.message_en,
            message_th=target.message_th,
        )
    return None


def segment_reps(
    times: Sequence[float],
    signal: Sequence[float | None],
    enter: float,
    exit_: float,
    min_duration_s: float,
    max_duration_s: float,
    min_amplitude: float,
) -> list[tuple[int, int]]:
    """Turn a continuous angle trace into (start, end) frame-index pairs.

    Hysteresis (``enter`` above ``exit_``) stops a signal hovering at the
    threshold from producing a burst of phantom reps.
    """
    windows: list[tuple[int, int]] = []
    active = False
    start = 0
    peak = -math.inf
    last_below = 0

    for i, raw in enumerate(signal):
        if raw is None:
            continue
        v = float(raw)
        if not active:
            if v <= exit_:
                last_below = i
            elif v >= enter:
                active = True
                start = last_below
                peak = v
        else:
            peak = max(peak, v)
            too_long = times[i] - times[start] > max_duration_s
            if v <= exit_ or too_long:
                duration = times[i] - times[start]
                if duration >= min_duration_s and (peak - exit_) >= min_amplitude:
                    windows.append((start, i))
                active = False
                last_below = i
                peak = -math.inf

    if active:
        i = len(times) - 1
        duration = times[i] - times[start]
        if duration >= min_duration_s and (peak - exit_) >= min_amplitude:
            windows.append((start, i))
    return windows


def _series_for(frames: Sequence[Frame], side: Side, rule: ExerciseRule) -> MetricSeries:
    series = MetricSeries()
    for f in frames:
        series.add(f.t, compute_metrics(f, side, use_z=bool(rule.use_z)))
    return series.smooth(rule.smoothing_window)


def _judged(values: list[float], target: MetricTarget) -> float:
    """Pick the limb this target is about, for a movement scored on both.

    Normally that is the one that looks worst -- an upper bound is failed by the
    largest reading, a lower bound by the smallest. ``judge="best"`` inverts it,
    for the movements whose two legs are not doing the same job.
    """
    if len(values) == 1:
        return values[0]
    high = target.max is not None
    if target.judge == "best":
        high = not high
    return max(values) if high else min(values)


def analyze_set(
    frames: Sequence[Frame],
    rule: ExerciseRule,
    side: Side = Side.BILATERAL,
) -> SetAnalysis:
    """Score one set of landmark frames against an exercise rule."""
    warnings: list[str] = []
    if len(frames) < 2:
        return SetAnalysis([], 0, 0, 0.0, 0.0, warnings=["not_enough_frames"])

    # Throw out frames where the skeleton has collapsed. MediaPipe reports these
    # at full confidence, so they have to be caught by how the body looks, not by
    # asking how sure it is.
    dropped = implausible_frames(frames)
    if dropped:
        kept = [f for i, f in enumerate(frames) if i not in dropped]
        share = len(dropped) / len(frames)
        if share > 0.5 or len(kept) < 2:
            return SetAnalysis(
                [], 0, 0, 0.0, 0.0, warnings=["tracking_lost", "not_enough_frames"]
            )
        warnings.append(f"dropped_{len(dropped)}_untrusted_frames")
        if share > 0.15:
            warnings.append("frequent_tracking_loss")
        frames = kept

    sides = [Side.LEFT, Side.RIGHT] if side is Side.BILATERAL else [side]
    series_by_side = {s: _series_for(frames, s, rule) for s in sides}
    times = list(next(iter(series_by_side.values())).t)

    required = [LM[name] for name in rule.required_landmarks if name in LM.__members__]
    per_frame_quality = [f.quality(required) for f in frames]
    overall_quality = sum(per_frame_quality) / len(per_frame_quality)
    if overall_quality < rule.min_tracking_quality:
        warnings.append("low_tracking_quality")

    # Angles measured from the wrong plane are not "a bit off" -- they are
    # meaningless. Stop here rather than write nonsense into the metric store.
    detected, score = detect_view(frames)
    if rule.enforce_view and rule.view != "any" and detected not in ("unknown", rule.view):
        raise WrongCameraView(rule.view, detected, score)
    if detected == "unknown":
        warnings.append("camera_view_uncertain")

    # ---------------------------------------------------------------- windows
    if rule.mode == "hold":
        windows = [(0, len(times) - 1)]
    else:
        det = rule.detection
        assert det is not None  # guaranteed by ExerciseRule validation
        combined: list[float | None] = []
        for i in range(len(times)):
            vals = [
                s.column(det.signal)[i]
                for s in series_by_side.values()
                if s.column(det.signal)[i] is not None
            ]
            combined.append(sum(vals) / len(vals) if vals else None)
        windows = segment_reps(
            times,
            combined,
            det.enter,
            det.exit,
            det.min_duration_s,
            det.max_duration_s,
            det.min_amplitude,
        )
        if not windows:
            warnings.append("no_reps_detected")

    # ---------------------------------------------------------------- scoring
    reps: list[RepAnalysis] = []
    for idx, (a, b) in enumerate(windows):
        rep_metrics: dict[str, float] = {}
        violations: list[Violation] = []
        weighted_ok = 0.0
        total_weight = 0.0

        for target in rule.targets:
            observed_per_side: list[float] = []
            for s, series in series_by_side.items():
                value = aggregate(series.column(target.metric)[a : b + 1], target.aggregate)
                if value is None:
                    continue
                observed_per_side.append(value)
                label = f"{target.metric}_{target.aggregate}"
                rep_metrics[label if len(sides) == 1 else f"{label}_{s.value}"] = round(value, 3)
            if not observed_per_side:
                warnings.append(f"metric_unavailable:{target.metric}")
                continue

            observed = _judged(observed_per_side, target)
            total_weight += target.weight
            violation = _evaluate_target(target, observed)
            if violation is None:
                weighted_ok += target.weight
            else:
                violations.append(violation)
                weighted_ok += target.weight * (1.0 - violation.severity)

        rep_quality = sum(per_frame_quality[a : b + 1]) / max(1, b + 1 - a)
        form_score = round(100.0 * (weighted_ok / total_weight), 1) if total_weight else 100.0

        hold_seconds: float | None = None
        if rule.mode == "hold":
            hold_seconds = _longest_clean_hold(series_by_side, times, rule)
            rep_metrics["hold_seconds"] = round(hold_seconds, 2)

        duration = times[b] - times[a]
        tempo_ok = True
        if rule.tempo_min_s is not None and duration < rule.tempo_min_s:
            tempo_ok = False
            violations.append(
                Violation(
                    code="tempo_too_fast",
                    metric="duration",
                    observed=round(duration, 3),
                    limit=rule.tempo_min_s,
                    bound="min",
                    severity=min(1.0, (rule.tempo_min_s - duration) / rule.tempo_min_s),
                    critical=False,
                    message_en="Slow the movement down — control it.",
                    message_th="ทำให้ช้าลง ควบคุมจังหวะให้ดี",
                )
            )
        if rule.tempo_max_s is not None and duration > rule.tempo_max_s:
            tempo_ok = False

        is_valid = (
            not any(v.critical for v in violations)
            and rep_quality >= rule.min_tracking_quality
            and tempo_ok
        )
        if rule.mode == "hold":
            is_valid = is_valid and (hold_seconds or 0.0) >= (rule.hold_target_s or 0.0)

        reps.append(
            RepAnalysis(
                index=idx,
                start_t=round(times[a], 3),
                end_t=round(times[b], 3),
                is_valid=is_valid,
                form_score=form_score,
                tracking_quality=round(rep_quality, 3),
                metrics=rep_metrics,
                violations=violations,
                hold_seconds=hold_seconds,
            )
        )

    valid = [r for r in reps if r.is_valid]
    set_form = round(sum(r.form_score for r in valid) / len(valid), 1) if valid else 0.0

    return SetAnalysis(
        reps=reps,
        completed_reps=len(reps),
        valid_reps=len(valid),
        form_score=set_form,
        tracking_quality=round(overall_quality, 3),
        emitted=_emit(rule.emit, reps, series_by_side, windows, sides),
        warnings=sorted(set(warnings)),
    )


def _longest_clean_hold(
    series_by_side: dict[Side, MetricSeries],
    times: Sequence[float],
    rule: ExerciseRule,
) -> float:
    """Longest continuous stretch where every target was satisfied."""
    best = 0.0
    run_start: int | None = None
    for i in range(len(times)):
        ok = True
        for target in rule.targets:
            vals = [
                s.column(target.metric)[i]
                for s in series_by_side.values()
                if s.column(target.metric)[i] is not None
            ]
            if not vals:
                continue
            observed = _judged([float(v) for v in vals], target)  # type: ignore[arg-type]
            if _evaluate_target(target, observed) is not None:
                ok = False
                break
        if ok:
            if run_start is None:
                run_start = i
            best = max(best, times[i] - times[run_start])
        else:
            run_start = None
    return best


def _emit(
    specs: Sequence[EmitMetric],
    reps: Sequence[RepAnalysis],
    series_by_side: dict[Side, MetricSeries],
    windows: Sequence[tuple[int, int]],
    sides: Sequence[Side],
) -> list[EmittedMetric]:
    """Roll rep-level kinematics up into the samples the exit-criteria engine reads."""
    out: list[EmittedMetric] = []
    valid_windows = [w for r, w in zip(reps, windows, strict=False) if r.is_valid]
    if not valid_windows:
        return out

    valid_reps = [r for r in reps if r.is_valid]

    for spec in specs:
        # Rep-level scalars are not frame series -- read them off the reps.
        if spec.metric in {"hold_seconds", "form_score", "tracking_quality"}:
            per_rep = [
                v
                for r in valid_reps
                if (v := getattr(r, spec.metric, None)) is not None
            ]
            value = aggregate(per_rep, spec.set_aggregate) if per_rep else None
            if value is not None:
                out.append(
                    EmittedMetric(
                        key=spec.as_key,
                        value=round(value, 3),
                        unit=spec.unit,
                        side=sides[0] if len(sides) == 1 else None,
                    )
                )
            continue

        for s in sides:
            series = series_by_side[s]
            per_rep = [
                v
                for a, b in valid_windows
                if (v := aggregate(series.column(spec.metric)[a : b + 1], spec.rep_aggregate))
                is not None
            ]
            if not per_rep:
                continue
            value = aggregate(per_rep, spec.set_aggregate)
            if value is None:
                continue
            out.append(
                EmittedMetric(
                    key=spec.as_key,
                    value=round(value, 3),
                    unit=spec.unit,
                    side=s if len(sides) > 1 or s is not Side.BILATERAL else None,
                )
            )
    return out
