from __future__ import annotations

from pydantic import BaseModel, Field, model_validator

from app.core.enums import (
    Aggregate,
    Comparator,
    CriterionSource,
    MetricScope,
    TargetType,
)


class TargetSpec(BaseModel):
    """What the number has to beat.

    * ``absolute`` -- a raw threshold (``8.5`` m/s).
    * ``percent_of_baseline`` -- ``value``% of the player's own pre-injury number,
      which is what makes the same criterion mean different things for a winger
      and a centre-back without hard-coding either.
    * ``lsi`` -- limb symmetry index, injured / uninjured x 100.
    * ``delta`` -- baseline plus/minus a raw amount.
    """

    type: TargetType = TargetType.ABSOLUTE
    value: float
    upper: float | None = None  # only for Comparator.BETWEEN
    unit: str | None = None
    #: Which baseline to read when the type is relative. Defaults to the metric itself.
    baseline_metric: str | None = None


class CriterionSpec(BaseModel):
    """A declarative exit criterion. Stored as JSON on ``ExitCriterion.spec``."""

    metric: str = Field(description="Namespaced metric key, e.g. 'health.running_speed_max'")
    source: CriterionSource
    aggregate: Aggregate = Aggregate.LATEST
    #: Look-back window. ``None`` means "any time during this injury episode".
    window_days: int | None = 14
    comparator: Comparator = Comparator.GTE
    target: TargetSpec
    scope: MetricScope = MetricScope.ANY
    #: Guards against clearing a player off one lucky reading.
    min_samples: int = 1

    @model_validator(mode="after")
    def _check(self) -> CriterionSpec:
        if self.comparator is Comparator.BETWEEN and self.target.upper is None:
            raise ValueError("`between` comparator needs target.upper")
        if not self.metric.startswith(f"{self.source.value}."):
            raise ValueError(
                f"metric {self.metric!r} must be namespaced with its source "
                f"({self.source.value}.*)"
            )
        if self.target.type is TargetType.LSI and self.scope is not MetricScope.BOTH:
            raise ValueError("LSI targets need scope='both' so each limb is measured")
        return self
