"""What a player is allowed to build their own exit criteria from.

The criterion engine can gate on any metric key at all. That is the wrong thing
to expose: a free-text metric field would let someone type ``pose.kneeflexion``
and quietly create a test that can never pass, because nothing will ever write
that key. So authoring goes through this catalogue, and the API refuses anything
not in it.

Each entry also carries the sensible defaults for its metric -- which way the
comparison points, over what window, what a plausible number looks like -- so the
screen can ask for one number instead of eight fields.

Everything here is a *default*, not a rule. The thresholds a player sets are
their own, and nothing in this file claims clinical authority; see the warning in
the README.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.core.enums import (
    Aggregate,
    Comparator,
    CriterionSource,
    MetricScope,
    TargetType,
)

ABSOLUTE_ONLY: tuple[TargetType, ...] = (TargetType.ABSOLUTE,)
WITH_LSI: tuple[TargetType, ...] = (TargetType.ABSOLUTE, TargetType.LSI)
WITH_BASELINE: tuple[TargetType, ...] = (TargetType.ABSOLUTE, TargetType.PERCENT_OF_BASELINE)


@dataclass(frozen=True, slots=True)
class Authorable:
    """One thing a player can build a test out of."""

    key: str
    source: CriterionSource
    group: str
    label_en: str
    unit: str
    help_en: str
    default_target: float
    #: Sentence the screen completes with the number, e.g. "Hold for … seconds".
    phrase_en: str
    default_comparator: Comparator = Comparator.GTE
    default_aggregate: Aggregate = Aggregate.MAX
    default_window_days: int | None = 14
    target_types: tuple[TargetType, ...] = field(default=ABSOLUTE_ONLY)
    #: Increment for the number input, and how many decimals to show.
    step: float = 1.0
    #: True when the metric names an exercise, e.g. ``session.reps.<key>``.
    needs_exercise: bool = False
    scope: MetricScope = MetricScope.ANY

    @property
    def lower_is_better(self) -> bool:
        return self.default_comparator in (Comparator.LTE, Comparator.LT)


CATALOGUE: tuple[Authorable, ...] = (
    # ------------------------------------------------------- what the camera sees
    Authorable(
        key="session.reps",
        source=CriterionSource.SESSION,
        group="Exercises",
        label_en="Reps in one set",
        unit="reps",
        help_en=(
            "Your best single set in the window — twenty in a row, not two sets "
            "of ten. Counted from reps the camera accepted, so sloppy ones do "
            "not help you."
        ),
        phrase_en="Do at least … reps in one set",
        default_target=20,
        default_aggregate=Aggregate.LATEST,
        needs_exercise=True,
    ),
    Authorable(
        key="session.hold",
        source=CriterionSource.SESSION,
        group="Exercises",
        label_en="Seconds held in one go",
        unit="seconds",
        help_en=(
            "For the movements that are timed rather than counted — planks, a "
            "wall sit, standing on one leg. Your longest clean hold in the "
            "window, not the total across several attempts."
        ),
        phrase_en="Hold for at least … seconds",
        default_target=30,
        step=5,
        default_aggregate=Aggregate.LATEST,
        needs_exercise=True,
    ),
    Authorable(
        key="session.form",
        source=CriterionSource.SESSION,
        group="Exercises",
        label_en="Form score for an exercise",
        unit="score",
        help_en="Average of every set of that exercise the camera scored.",
        phrase_en="Average form of at least …",
        default_target=85,
        default_aggregate=Aggregate.LATEST,
        needs_exercise=True,
    ),
    Authorable(
        key="pose.knee_flexion_rom",
        source=CriterionSource.POSE,
        group="Movement",
        label_en="Knee bend range",
        unit="deg",
        help_en="How far the knee bends, measured by the camera.",
        phrase_en="Bend the knee to at least … degrees",
        default_target=120,
    ),
    Authorable(
        key="pose.knee_extension_lag",
        source=CriterionSource.POSE,
        group="Movement",
        label_en="Knee straightens fully",
        unit="deg",
        help_en="How many degrees short of straight the knee stops. Lower is better.",
        phrase_en="Stop no more than … degrees short of straight",
        default_target=5,
        default_comparator=Comparator.LTE,
        default_aggregate=Aggregate.MIN,
    ),
    Authorable(
        key="pose.ankle_dorsiflexion",
        source=CriterionSource.POSE,
        group="Movement",
        label_en="Ankle bend",
        unit="deg",
        help_en="Knee-to-wall ankle range.",
        phrase_en="Reach at least … degrees of ankle bend",
        default_target=25,
        target_types=WITH_LSI,
        scope=MetricScope.BOTH,
    ),
    Authorable(
        key="pose.slsq_knee_valgus",
        source=CriterionSource.POSE,
        group="Movement",
        label_en="Knee stays out — single-leg squat",
        unit="deg",
        help_en=(
            "How far the knee falls inward. This is the movement behind ACL "
            "injuries, so lower is better and it has to be filmed front-on."
        ),
        phrase_en="Knee falls inward no more than … degrees",
        default_target=8,
        default_comparator=Comparator.LTE,
        default_aggregate=Aggregate.MAX,
    ),
    Authorable(
        key="pose.landing_knee_valgus",
        source=CriterionSource.POSE,
        group="Movement",
        label_en="Knee stays out — landing",
        unit="deg",
        help_en="Same measurement, taken as you land from a hop.",
        phrase_en="Knee falls inward no more than … degrees on landing",
        default_target=8,
        default_comparator=Comparator.LTE,
    ),
    Authorable(
        key="pose.copenhagen_hold",
        source=CriterionSource.POSE,
        group="Movement",
        label_en="Copenhagen plank hold",
        unit="s",
        help_en="Longest hold the camera timed, each side.",
        phrase_en="Hold for at least … seconds",
        default_target=30,
    ),
    Authorable(
        key="pose.spanish_squat_hold",
        source=CriterionSource.POSE,
        group="Movement",
        label_en="Spanish squat hold",
        unit="s",
        help_en="Longest hold the camera timed.",
        phrase_en="Hold for at least … seconds",
        default_target=45,
    ),
    Authorable(
        key="pose.calf_raise_height",
        source=CriterionSource.POSE,
        group="Movement",
        label_en="Calf raise height",
        unit="ratio",
        help_en="Heel lift as a share of foot length. 0.45 is a full raise.",
        phrase_en="Raise the heel to at least … of full height",
        default_target=0.45,
        step=0.05,
    ),
    # -------------------------------------------------------------------- testing
    Authorable(
        key="test.iso_quadriceps",
        source=CriterionSource.TEST,
        group="Strength tests",
        label_en="Quadriceps strength",
        unit="N/kg",
        help_en="Isometric strength test, entered by hand.",
        phrase_en="Reach at least … N/kg",
        default_target=3.0,
        target_types=WITH_LSI,
        scope=MetricScope.BOTH,
        step=0.1,
    ),
    Authorable(
        key="test.iso_hamstring",
        source=CriterionSource.TEST,
        group="Strength tests",
        label_en="Hamstring strength",
        unit="N/kg",
        help_en="Isometric strength test, entered by hand.",
        phrase_en="Reach at least … N/kg",
        default_target=3.0,
        target_types=WITH_LSI,
        scope=MetricScope.BOTH,
        step=0.1,
    ),
    Authorable(
        key="test.iso_adductor",
        source=CriterionSource.TEST,
        group="Strength tests",
        label_en="Adductor squeeze strength",
        unit="N/kg",
        help_en="Isometric squeeze test, entered by hand.",
        phrase_en="Reach at least … N/kg",
        default_target=2.6,
        target_types=WITH_LSI,
        scope=MetricScope.BOTH,
        step=0.1,
    ),
    Authorable(
        key="test.hop_single",
        source=CriterionSource.TEST,
        group="Strength tests",
        label_en="Single hop distance",
        unit="m",
        help_en="One hop for distance, landing under control.",
        phrase_en="Hop at least … metres",
        default_target=1.4,
        target_types=WITH_LSI,
        scope=MetricScope.BOTH,
        step=0.05,
    ),
    Authorable(
        key="test.hop_triple",
        source=CriterionSource.TEST,
        group="Strength tests",
        label_en="Triple hop distance",
        unit="m",
        help_en="Three hops on one leg, total distance.",
        phrase_en="Hop at least … metres in three",
        default_target=4.5,
        target_types=WITH_LSI,
        scope=MetricScope.BOTH,
        step=0.1,
    ),
    Authorable(
        key="test.cmj_height",
        source=CriterionSource.TEST,
        group="Strength tests",
        label_en="Jump height",
        unit="m",
        help_en="Countermovement jump.",
        phrase_en="Jump at least … metres",
        default_target=0.34,
        target_types=WITH_LSI,
        scope=MetricScope.BOTH,
        step=0.01,
    ),
    Authorable(
        key="test.heel_raise_reps",
        source=CriterionSource.TEST,
        group="Strength tests",
        label_en="Single-leg calf raises",
        unit="reps",
        help_en="Counted by hand, to failure.",
        phrase_en="Complete at least … raises",
        default_target=25,
        target_types=WITH_LSI,
        scope=MetricScope.BOTH,
    ),
    Authorable(
        key="test.sprint_30m",
        source=CriterionSource.TEST,
        group="Strength tests",
        label_en="30 m sprint time",
        unit="s",
        help_en="Timed sprint. Lower is better.",
        phrase_en="Run 30 m in … seconds or less",
        default_target=4.5,
        default_comparator=Comparator.LTE,
        default_aggregate=Aggregate.MIN,
        step=0.05,
    ),
    Authorable(
        key="test.change_of_direction",
        source=CriterionSource.TEST,
        group="Strength tests",
        label_en="Change of direction",
        unit="%",
        help_en="Cutting drill, as a share of your best.",
        phrase_en="Reach at least …% of your best",
        default_target=90,
    ),
    Authorable(
        key="test.yo_yo_ir1",
        source=CriterionSource.TEST,
        group="Strength tests",
        label_en="Yo-Yo intermittent recovery",
        unit="m",
        help_en="Distance covered in the Yo-Yo IR1 test.",
        phrase_en="Cover at least … metres",
        default_target=1200,
        step=40,
    ),
    # ------------------------------------------------------------- how you feel
    Authorable(
        key="pro.pain_rest",
        source=CriterionSource.PRO,
        group="How you feel",
        label_en="Pain at rest",
        unit="NPRS",
        help_en="0 to 10, from your own pain logs. Lower is better.",
        phrase_en="Pain at rest no more than …/10",
        default_target=2,
        default_comparator=Comparator.LTE,
        default_window_days=7,
    ),
    Authorable(
        key="pro.pain_activity",
        source=CriterionSource.PRO,
        group="How you feel",
        label_en="Pain during activity",
        unit="NPRS",
        help_en="0 to 10, from your own pain logs. Lower is better.",
        phrase_en="Pain while training no more than …/10",
        default_target=2,
        default_comparator=Comparator.LTE,
        default_window_days=7,
    ),
    Authorable(
        key="pro.pain_next_morning",
        source=CriterionSource.PRO,
        group="How you feel",
        label_en="Pain the next morning",
        unit="NPRS",
        help_en=(
            "The one that matters for tendons: how it feels 24 hours after "
            "loading it. Lower is better."
        ),
        phrase_en="Pain next morning no more than …/10",
        default_target=3,
        default_comparator=Comparator.LTE,
        default_window_days=7,
    ),
    Authorable(
        key="pro.confidence",
        source=CriterionSource.PRO,
        group="How you feel",
        label_en="Confidence in the leg",
        unit="score",
        help_en="Your own 0-100 rating. Fear of reinjury predicts reinjury.",
        phrase_en="Feel at least …/100 confident",
        default_target=80,
        default_window_days=14,
    ),
    # -------------------------------------------------------------- consistency
    Authorable(
        key="session.completed_in_phase",
        source=CriterionSource.SESSION,
        group="Consistency",
        label_en="Sessions completed",
        unit="count",
        help_en="Completed sessions since this phase started.",
        phrase_en="Complete at least … sessions",
        default_target=12,
        default_aggregate=Aggregate.LATEST,
        default_window_days=None,
    ),
    Authorable(
        key="session.adherence_pct",
        source=CriterionSource.SESSION,
        group="Consistency",
        label_en="Adherence",
        unit="%",
        help_en="Sessions done against sessions prescribed.",
        phrase_en="Complete at least …% of your sessions",
        default_target=80,
        default_aggregate=Aggregate.LATEST,
        default_window_days=None,
    ),
    Authorable(
        key="session.pain_free_days",
        source=CriterionSource.SESSION,
        group="Consistency",
        label_en="Pain-free days in a row",
        unit="days",
        help_en="Counting back from today, days with nothing above 2/10 logged.",
        phrase_en="Go at least … days without pain",
        default_target=7,
        default_aggregate=Aggregate.LATEST,
        default_window_days=30,
    ),
    Authorable(
        key="session.mean_form_score",
        source=CriterionSource.SESSION,
        group="Consistency",
        label_en="Movement quality",
        unit="score",
        help_en="Average of every rep the camera scored.",
        phrase_en="Average at least …/100 on form",
        default_target=85,
        default_aggregate=Aggregate.LATEST,
    ),
)

BY_KEY: dict[str, Authorable] = {item.key: item for item in CATALOGUE}

#: The order groups appear in, most concrete first.
GROUP_ORDER: tuple[str, ...] = (
    "Exercises",
    "Movement",
    "Strength tests",
    "How you feel",
    "Consistency",
)
