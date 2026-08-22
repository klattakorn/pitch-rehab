"""Turning "run at least 7.5 m/s" into a criterion the engine can evaluate.

A `CriterionSpec` has eight fields and most of them have exactly one sensible
value for any given metric. Asking a player for all eight would be a form nobody
finishes and a good way to build a test that can never pass. So the screen asks
for two things -- what to measure, and the number -- and everything else comes
from the catalogue in ``app/data/authorable.py``.

The comparison direction is deliberately not a choice. "Pain at rest of at least
8/10" is not a rehab goal anyone means to set, and every metric here has one
obvious direction, so the catalogue decides it.
"""

from __future__ import annotations

import math
import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.enums import MetricScope, PhaseKey, TargetType
from app.data.authorable import BY_KEY, Authorable
from app.models.injury import InjuryEpisode
from app.models.protocol import Exercise, ExitCriterion, ProtocolPhase
from app.services.criteria.spec import CriterionSpec, TargetSpec

MAX_KEY = 64
#: Nothing measured here is negative, and nothing plausible is astronomical.
MAX_VALUE = 1_000_000.0


class AuthoringError(ValueError):
    """The request cannot become a valid criterion. Message is player-facing."""


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9_]+", "_", value.lower()).strip("_")


def resolve(metric: str) -> Authorable:
    item = BY_KEY.get(metric)
    if item is None:
        raise AuthoringError(
            f"{metric!r} is not something you can build a test from. "
            "Pick one from the list."
        )
    return item


def check_exercise(db: Session, item: Authorable, exercise_key: str | None) -> Exercise | None:
    """Per-exercise metrics need a camera-scored exercise behind them."""
    if not item.needs_exercise:
        if exercise_key:
            raise AuthoringError(f"{item.label_en} is not measured per exercise.")
        return None
    if not exercise_key:
        raise AuthoringError(f"{item.label_en} needs an exercise to measure.")

    exercise = db.execute(
        select(Exercise).where(Exercise.key == exercise_key)
    ).scalar_one_or_none()
    if exercise is None:
        raise AuthoringError(f"There is no exercise called {exercise_key!r}.")
    if exercise.pose_rule is None:
        # Nothing writes reps or a form score for a hand-logged drill, so a test
        # on one would sit at "not measured" forever.
        raise AuthoringError(
            f"{exercise.name_en} is logged by hand, so the camera never counts "
            "reps or scores form for it. Pick an exercise the camera checks."
        )
    return exercise


def check_value(item: Authorable, target_type: TargetType, value: float) -> float:
    if not math.isfinite(value) or value <= 0:
        raise AuthoringError("Give a number above zero.")
    if value > MAX_VALUE:
        raise AuthoringError("That number is too large to be a real target.")
    if target_type not in item.target_types:
        raise AuthoringError(
            f"{item.label_en} cannot be compared that way."
        )
    if target_type is TargetType.ABSOLUTE and item.unit == "%" and value > 100:
        raise AuthoringError("A percentage cannot be above 100.")
    return float(value)


def build_spec(
    item: Authorable,
    *,
    exercise_key: str | None,
    target_type: TargetType,
    value: float,
    window_days: int | None,
) -> CriterionSpec:
    metric = f"{item.key}.{exercise_key}" if item.needs_exercise else item.key
    # An LSI target compares two limbs, so it has to be allowed to read both --
    # the spec validator rejects it otherwise, and rightly so.
    scope = MetricScope.BOTH if target_type is TargetType.LSI else item.scope
    unit = "%" if target_type is not TargetType.ABSOLUTE else item.unit

    return CriterionSpec(
        metric=metric,
        source=item.source,
        aggregate=item.default_aggregate,
        window_days=window_days if window_days is not None else item.default_window_days,
        comparator=item.default_comparator,
        target=TargetSpec(type=target_type, value=value, unit=unit),
        scope=scope,
        min_samples=1,
    )


def build_label(
    item: Authorable,
    *,
    exercise: Exercise | None,
    target_type: TargetType,
    value: float,
) -> str:
    """A sentence, not a field dump. This is what the player reads on the gate."""
    shown = f"{value:g}"
    if target_type is TargetType.LSI:
        body = f"{item.label_en} at least {shown}% of the other side"
    elif target_type is TargetType.PERCENT_OF_BASELINE:
        body = f"{item.label_en} at least {shown}% of your own best"
    else:
        body = item.phrase_en.replace("…", shown)
    return f"{exercise.name_en}: {body[0].lower()}{body[1:]}" if exercise else body


def build_key(item: Authorable, exercise_key: str | None, target_type: TargetType) -> str:
    """Deterministic, so editing a test replaces it instead of adding a twin."""
    parts = ["custom", _slug(item.key)]
    if exercise_key:
        parts.append(_slug(exercise_key))
    if target_type is not TargetType.ABSOLUTE:
        parts.append(target_type.value)
    key = "_".join(parts)
    return key[:MAX_KEY]


def library_criterion(
    db: Session, episode: InjuryEpisode, phase_key: PhaseKey, key: str
) -> ExitCriterion | None:
    if episode.protocol_id is None:
        return None
    phase = db.execute(
        select(ProtocolPhase)
        .where(ProtocolPhase.protocol_id == episode.protocol_id)
        .where(ProtocolPhase.phase_key == phase_key)
    ).scalar_one_or_none()
    if phase is None:
        return None
    return next((c for c in phase.exit_criteria if c.key == key), None)


def check_override(
    db: Session, episode: InjuryEpisode, phase_key: PhaseKey, key: str
) -> None:
    """Refuse to replace the one gate that is not a measurement.

    Phase 4 requires a human to sign the player off. Letting that be swapped for
    a number the player picks themselves would remove the only step in the whole
    app that is not self-assessed.
    """
    existing = library_criterion(db, episode, phase_key, key)
    if existing is None:
        return
    if str(existing.spec.get("source")) == "manual":
        raise AuthoringError(
            "Clinician sign-off cannot be replaced with a number. It is the one "
            "check in the app that a person has to make."
        )
