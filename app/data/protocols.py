"""The 6 positions x 7 injury sites = 42 protocols.

Rather than hand-writing 42 near-identical programmes, a protocol is composed:

    injury template (what the tissue needs)  +  position profile (what the job needs)

The injury template owns the exercises and the medical gates. The position
profile bumps the running/jumping targets and adds position-specific work --
which is exactly the poster's claim that a winger and a centre-back should not
get the same programme for the same hamstring tear.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field, replace

from app.core.enums import (
    PHASE_ORDER,
    Aggregate,
    Comparator,
    CriterionSource,
    InjurySite,
    MetricScope,
    PhaseKey,
    Position,
    Side,
    TargetType,
)
from app.services.criteria.spec import CriterionSpec, TargetSpec


# --------------------------------------------------------------------------
# building blocks
# --------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class Rx:
    """A prescription: how much of an exercise this phase asks for."""

    exercise: str
    sets: int = 3
    reps: int | None = 10
    hold_seconds: float | None = None
    rest_seconds: int = 60
    tempo: str | None = None
    side_mode: Side = Side.BILATERAL
    load_en: str | None = None
    load_th: str | None = None


@dataclass(frozen=True, slots=True)
class CriterionDef:
    key: str
    label_en: str
    label_th: str
    spec: CriterionSpec
    required: bool = True
    help_en: str = ""
    help_th: str = ""


def absolute(value: float, unit: str | None = None) -> TargetSpec:
    return TargetSpec(type=TargetType.ABSOLUTE, value=value, unit=unit)


def pct_of_baseline(value: float, baseline_metric: str | None = None) -> TargetSpec:
    return TargetSpec(
        type=TargetType.PERCENT_OF_BASELINE, value=value, baseline_metric=baseline_metric
    )


def lsi(value: float) -> TargetSpec:
    return TargetSpec(type=TargetType.LSI, value=value, unit="%")


def crit(
    key: str,
    label_en: str,
    label_th: str,
    *,
    metric: str,
    source: CriterionSource,
    target: TargetSpec,
    comparator: Comparator = Comparator.GTE,
    aggregate: Aggregate = Aggregate.LATEST,
    window_days: int | None = 14,
    scope: MetricScope = MetricScope.ANY,
    min_samples: int = 1,
    required: bool = True,
    help_en: str = "",
    help_th: str = "",
) -> CriterionDef:
    return CriterionDef(
        key=key,
        label_en=label_en,
        label_th=label_th,
        required=required,
        help_en=help_en,
        help_th=help_th,
        spec=CriterionSpec(
            metric=metric,
            source=source,
            aggregate=aggregate,
            window_days=window_days,
            comparator=comparator,
            target=target,
            scope=scope,
            min_samples=min_samples,
        ),
    )


@dataclass(frozen=True, slots=True)
class PhaseTemplate:
    phase_key: PhaseKey
    title_en: str
    title_th: str
    goal_en: str
    goal_th: str
    min_days: int
    sessions_per_week: int
    prescriptions: tuple[Rx, ...]
    criteria: tuple[CriterionDef, ...]


# --------------------------------------------------------------------------
# criteria that every protocol shares
# --------------------------------------------------------------------------
def pain_at_rest(limit: float = 2.0, window: int = 3) -> CriterionDef:
    return crit(
        "pain_at_rest",
        f"Pain at rest ≤ {limit:g}/10",
        f"ปวดขณะพัก ≤ {limit:g}/10",
        metric="pro.pain_rest",
        source=CriterionSource.PRO,
        aggregate=Aggregate.MAX,
        window_days=window,
        comparator=Comparator.LTE,
        target=absolute(limit, "NPRS"),
        min_samples=2,
        help_en="Log your pain daily in the app.",
        help_th="บันทึกระดับความปวดในแอปทุกวัน",
    )


def pain_on_activity(limit: float, window: int = 7) -> CriterionDef:
    return crit(
        "pain_on_activity",
        f"Pain during activity ≤ {limit:g}/10",
        f"ปวดขณะทำกิจกรรม ≤ {limit:g}/10",
        metric="pro.pain_activity",
        source=CriterionSource.PRO,
        aggregate=Aggregate.MAX,
        window_days=window,
        comparator=Comparator.LTE,
        target=absolute(limit, "NPRS"),
        min_samples=2,
    )


def pain_free_days(days: int) -> CriterionDef:
    return crit(
        "pain_free_days",
        f"{days} consecutive pain-free days",
        f"ไม่ปวดต่อเนื่อง {days} วัน",
        metric="session.pain_free_days",
        source=CriterionSource.SESSION,
        aggregate=Aggregate.LATEST,
        window_days=30,
        target=absolute(days, "days"),
    )


def adherence(pct: float) -> CriterionDef:
    return crit(
        "adherence",
        f"Completed ≥ {pct:g}% of prescribed sessions",
        f"ทำครบ ≥ {pct:g}% ของโปรแกรมที่กำหนด",
        metric="session.adherence_pct",
        source=CriterionSource.SESSION,
        target=absolute(pct, "%"),
    )


def change_of_direction(pct: float, required: bool = True) -> CriterionDef:
    """The 505 agility test, scored as a percentage of the player's own best.

    Cutting is where knees and groins actually get hurt, so a straight-line
    speed gate on its own is not enough to clear anyone.
    """
    return crit(
        "change_of_direction",
        f"Change of direction at least {pct:g}% of your best",
        f"ความคล่องตัวเปลี่ยนทิศอย่างน้อย {pct:g}% ของค่าดีที่สุด",
        metric="test.change_of_direction",
        source=CriterionSource.TEST,
        aggregate=Aggregate.MAX,
        window_days=21,
        target=absolute(pct, "%"),
        required=required,
        help_en="505 agility test, turning off each leg. Enter the result as a "
        "percentage of your pre-injury best, or of the healthy side.",
        help_th="ทดสอบความคล่องตัว 505 หมุนตัวด้วยขาแต่ละข้าง แล้วกรอกเป็นเปอร์เซ็นต์",
    )


def confidence(score: float) -> CriterionDef:
    return crit(
        "confidence",
        f"Self-reported readiness ≥ {score:g}/100",
        f"ความมั่นใจในการกลับลงสนาม ≥ {score:g}/100",
        metric="pro.confidence",
        source=CriterionSource.PRO,
        aggregate=Aggregate.LATEST,
        window_days=7,
        target=absolute(score, "score"),
        help_en="Fear of re-injury is one of the strongest predictors of actually "
        "getting re-injured. Answer honestly.",
        help_th="ความกลัวบาดเจ็บซ้ำเป็นตัวทำนายการบาดเจ็บซ้ำที่ชัดเจนมาก ตอบตามความจริง",
    )


def clinician_clearance() -> CriterionDef:
    return crit(
        "clinician_clearance",
        "Cleared by a physio or clinician",
        "ได้รับการรับรองจากนักกายภาพบำบัดหรือแพทย์",
        metric="manual.rtp_clearance",
        source=CriterionSource.MANUAL,
        target=absolute(1),
        help_en="The app measures; a human decides. This step cannot be automated away.",
        help_th="แอปเป็นผู้วัด แต่คนเป็นผู้ตัดสิน ขั้นตอนนี้ข้ามไม่ได้",
    )


def form_quality(score: float = 80.0) -> CriterionDef:
    return crit(
        "form_quality",
        f"Mean movement quality ≥ {score:g}/100",
        f"คะแนนคุณภาพท่าทางเฉลี่ย ≥ {score:g}/100",
        metric="session.mean_form_score",
        source=CriterionSource.SESSION,
        window_days=14,
        target=absolute(score, "score"),
    )


# --------------------------------------------------------------------------
# injury templates
# --------------------------------------------------------------------------
_P1 = PhaseKey.P1_PROTECT
_P2 = PhaseKey.P2_STRENGTH
_P3 = PhaseKey.P3_RUNNING
_P4 = PhaseKey.P4_RETURN

_PHASE_TITLES: dict[PhaseKey, tuple[str, str]] = {
    _P1: ("Protect and activate", "ป้องกันและกระตุ้นกล้ามเนื้อ"),
    _P2: ("Strength and load tolerance", "สร้างความแข็งแรงและทนต่อแรง"),
    _P3: ("Running and change of direction", "วิ่งและเปลี่ยนทิศ"),
    _P4: ("Return to team training", "กลับไปซ้อมกับทีม"),
}

_RUNNING_RX: tuple[Rx, ...] = (
    Rx("progressive_running", sets=1, reps=None, load_en="20 min, 60-70% max speed",
       load_th="20 นาที ที่ 60-70% ของความเร็วสูงสุด"),
    Rx("deceleration_drill", sets=4, reps=4),
    Rx("change_of_direction_45", sets=4, reps=6, side_mode=Side.BILATERAL),
)

_RETURN_RX: tuple[Rx, ...] = (
    Rx("repeated_sprint", sets=1, reps=6, rest_seconds=30),
    Rx("reactive_agility", sets=4, reps=6),
)


def _phase(
    key: PhaseKey,
    goal_en: str,
    goal_th: str,
    min_days: int,
    sessions_per_week: int,
    prescriptions: tuple[Rx, ...],
    criteria: tuple[CriterionDef, ...],
) -> PhaseTemplate:
    title_en, title_th = _PHASE_TITLES[key]
    return PhaseTemplate(
        phase_key=key,
        title_en=title_en,
        title_th=title_th,
        goal_en=goal_en,
        goal_th=goal_th,
        min_days=min_days,
        sessions_per_week=sessions_per_week,
        prescriptions=prescriptions,
        criteria=criteria,
    )


HAMSTRING_TEMPLATE: tuple[PhaseTemplate, ...] = (
    _phase(
        _P1,
        "Settle symptoms, restore pain-free knee range, wake the hamstring up.",
        "ลดอาการ ฟื้นมุมการเคลื่อนไหวเข่าแบบไม่เจ็บ และกระตุ้นกล้ามเนื้อแฮมสตริง",
        min_days=5,
        sessions_per_week=6,
        prescriptions=(
            Rx("glute_bridge", sets=3, reps=12),
            Rx("prone_hamstring_curl", sets=3, reps=12, side_mode=Side.BILATERAL, tempo="3-1-1-0"),
            Rx("side_lying_hip_abduction", sets=3, reps=12, side_mode=Side.BILATERAL),
            Rx("single_leg_balance", sets=3, reps=None, hold_seconds=30, side_mode=Side.BILATERAL),
        ),
        criteria=(
            pain_at_rest(2.0),
            pain_free_days(3),
            crit(
                "knee_rom",
                "Pain-free knee flexion ≥ 120°",
                "งอเข่าได้ ≥ 120° โดยไม่ปวด",
                metric="pose.knee_flexion_rom",
                source=CriterionSource.POSE,
                aggregate=Aggregate.MAX,
                window_days=7,
                scope=MetricScope.INJURED,
                target=absolute(120, "deg"),
            ),
            adherence(70),
        ),
    ),
    _phase(
        _P2,
        "Build eccentric hamstring strength at long muscle lengths.",
        "สร้างความแข็งแรงแบบยืดยาวของแฮมสตริง",
        min_days=10,
        sessions_per_week=4,
        prescriptions=(
            Rx("nordic_hamstring_curl", sets=3, reps=6, tempo="5-0-1-0"),
            Rx("single_leg_rdl", sets=3, reps=8, side_mode=Side.BILATERAL, tempo="3-1-1-0"),
            Rx("glute_bridge", sets=3, reps=15),
            Rx("split_squat", sets=3, reps=10, side_mode=Side.BILATERAL),
        ),
        criteria=(
            pain_on_activity(2.0),
            crit(
                "nordic_break_angle",
                "Nordic break angle ≥ 55°",
                "มุมนอร์ดิกก่อนหลุด ≥ 55°",
                metric="pose.nordic_break_angle",
                source=CriterionSource.POSE,
                aggregate=Aggregate.MAX,
                window_days=14,
                scope=MetricScope.INJURED,
                target=absolute(55, "deg"),
            ),
            crit(
                "hamstring_lsi",
                "Hamstring strength symmetry ≥ 90%",
                "ความแข็งแรงแฮมสตริงสองข้างต่างกันไม่เกิน 10%",
                metric="test.iso_hamstring",
                source=CriterionSource.TEST,
                aggregate=Aggregate.MAX,
                window_days=21,
                scope=MetricScope.BOTH,
                target=lsi(90),
                required=False,
                help_en="Needs a hand-held dynamometer. Skip if you do not have one.",
                help_th="ต้องใช้เครื่องวัดแรง ถ้าไม่มีให้ข้ามได้",
            ),
            form_quality(80),
            adherence(75),
        ),
    ),
    _phase(
        _P3,
        "Reintroduce high-speed running — the specific thing that tears hamstrings.",
        "กลับมาวิ่งเร็ว ซึ่งเป็นกลไกหลักที่ทำให้แฮมสตริงฉีก",
        min_days=10,
        sessions_per_week=4,
        prescriptions=_RUNNING_RX
        + (
            Rx("nordic_hamstring_curl", sets=3, reps=6, tempo="5-0-1-0"),
            Rx("single_leg_hop_landing", sets=3, reps=6, side_mode=Side.BILATERAL),
        ),
        criteria=(
            pain_on_activity(1.0),
            crit(
                "hop_lsi",
                "Triple hop symmetry ≥ 90%",
                "กระโดดสามครั้งต่อเนื่อง ต่างกันไม่เกิน 10%",
                metric="test.hop_triple",
                source=CriterionSource.TEST,
                aggregate=Aggregate.MAX,
                window_days=21,
                scope=MetricScope.BOTH,
                target=lsi(90),
            ),
            form_quality(82),
        ),
    ),
    _phase(
        _P4,
        "Match-speed running volume and full confidence before team training.",
        "ปริมาณการวิ่งระดับแข่งขันและความมั่นใจเต็มร้อยก่อนกลับไปซ้อมทีม",
        min_days=7,
        sessions_per_week=4,
        prescriptions=_RETURN_RX
        + (Rx("nordic_hamstring_curl", sets=3, reps=8, tempo="5-0-1-0"),),
        criteria=(
            pain_free_days(7),
            confidence(80),
            clinician_clearance(),
        ),
    ),
)


KNEE_TEMPLATE: tuple[PhaseTemplate, ...] = (
    _phase(
        _P1,
        "Kill the swelling, get the knee fully straight, switch the quads back on.",
        "ลดบวม เหยียดเข่าให้สุด และกระตุ้นกล้ามเนื้อต้นขาด้านหน้า",
        min_days=7,
        sessions_per_week=6,
        prescriptions=(
            Rx("isometric_quad_set", sets=5, reps=None, hold_seconds=10, side_mode=Side.BILATERAL),
            Rx("heel_slide", sets=3, reps=15, side_mode=Side.BILATERAL),
            Rx("glute_bridge", sets=3, reps=15),
            Rx("single_leg_balance", sets=3, reps=None, hold_seconds=30, side_mode=Side.BILATERAL),
        ),
        criteria=(
            pain_at_rest(2.0),
            crit(
                "extension_lag",
                "Full knee extension (lag ≤ 5°)",
                "เหยียดเข่าได้สุด (เหลือไม่เกิน 5°)",
                metric="pose.knee_extension_lag",
                source=CriterionSource.POSE,
                aggregate=Aggregate.MIN,
                window_days=7,
                scope=MetricScope.INJURED,
                comparator=Comparator.LTE,
                target=absolute(5, "deg"),
            ),
            crit(
                "knee_rom",
                "Knee flexion ≥ 120°",
                "งอเข่าได้ ≥ 120°",
                metric="pose.knee_flexion_rom",
                source=CriterionSource.POSE,
                aggregate=Aggregate.MAX,
                window_days=7,
                scope=MetricScope.INJURED,
                target=absolute(120, "deg"),
            ),
            adherence(70),
        ),
    ),
    _phase(
        _P2,
        "Single-leg strength and control without the knee falling inwards.",
        "สร้างความแข็งแรงและการควบคุมขาเดียว โดยเข่าไม่บิดเข้าด้านใน",
        min_days=14,
        sessions_per_week=4,
        prescriptions=(
            Rx("single_leg_squat", sets=3, reps=10, side_mode=Side.BILATERAL, tempo="3-1-1-0"),
            Rx("step_down", sets=3, reps=10, side_mode=Side.BILATERAL, tempo="3-0-1-0"),
            Rx("wall_sit", sets=3, reps=None, hold_seconds=45),
            Rx("single_leg_rdl", sets=3, reps=8, side_mode=Side.BILATERAL),
            Rx("single_leg_calf_raise", sets=3, reps=15, side_mode=Side.BILATERAL),
        ),
        criteria=(
            pain_on_activity(2.0),
            crit(
                "slsq_depth",
                "Single-leg squat to ≥ 60° knee flexion",
                "สควอทขาเดียวงอเข่า ≥ 60°",
                metric="pose.slsq_knee_flexion",
                source=CriterionSource.POSE,
                aggregate=Aggregate.MEDIAN,
                window_days=14,
                scope=MetricScope.INJURED,
                target=absolute(60, "deg"),
                min_samples=2,
            ),
            crit(
                "slsq_valgus",
                "Knee stays out of valgus (≤ 8°)",
                "เข่าไม่บิดเข้าด้านใน (≤ 8°)",
                metric="pose.slsq_knee_valgus",
                source=CriterionSource.POSE,
                aggregate=Aggregate.MEDIAN,
                window_days=14,
                scope=MetricScope.INJURED,
                comparator=Comparator.LTE,
                target=absolute(8, "deg"),
                min_samples=2,
            ),
            crit(
                "quad_lsi",
                "Quadriceps strength symmetry ≥ 80%",
                "ความแข็งแรงต้นขาด้านหน้าต่างกันไม่เกิน 20%",
                metric="test.iso_quadriceps",
                source=CriterionSource.TEST,
                aggregate=Aggregate.MAX,
                window_days=21,
                scope=MetricScope.BOTH,
                target=lsi(80),
                required=False,
            ),
            form_quality(80),
            adherence(75),
        ),
    ),
    _phase(
        _P3,
        "Land, cut and hop without the knee collapsing.",
        "ลงพื้น เปลี่ยนทิศ และกระโดดโดยเข่าไม่ทรุด",
        min_days=14,
        sessions_per_week=4,
        prescriptions=_RUNNING_RX
        + (
            Rx("single_leg_hop_landing", sets=4, reps=6, side_mode=Side.BILATERAL),
            Rx("lateral_bound", sets=4, reps=6, side_mode=Side.BILATERAL),
            Rx("single_leg_squat", sets=3, reps=12, side_mode=Side.BILATERAL),
        ),
        criteria=(
            pain_on_activity(1.0),
            crit(
                "landing_valgus",
                "Landing knee valgus ≤ 8°",
                "เข่าบิดเข้าด้านในตอนลงพื้น ≤ 8°",
                metric="pose.landing_knee_valgus",
                source=CriterionSource.POSE,
                aggregate=Aggregate.MEDIAN,
                window_days=14,
                scope=MetricScope.INJURED,
                comparator=Comparator.LTE,
                target=absolute(8, "deg"),
                min_samples=3,
            ),
            crit(
                "hop_lsi",
                "Single hop symmetry ≥ 90%",
                "กระโดดขาเดียวต่างกันไม่เกิน 10%",
                metric="test.hop_single",
                source=CriterionSource.TEST,
                aggregate=Aggregate.MAX,
                window_days=21,
                scope=MetricScope.BOTH,
                target=lsi(90),
            ),
            form_quality(82),
        ),
    ),
    _phase(
        _P4,
        "Full symmetry, full speed, and a head that trusts the knee.",
        "สมมาตรเต็มที่ ความเร็วเต็มที่ และความมั่นใจในเข่า",
        min_days=14,
        sessions_per_week=4,
        prescriptions=_RETURN_RX
        + (Rx("single_leg_hop_landing", sets=3, reps=8, side_mode=Side.BILATERAL),),
        criteria=(
            pain_free_days(7),
            crit(
                "hop_triple_lsi",
                "Triple hop symmetry ≥ 95%",
                "กระโดดสามครั้งต่อเนื่องต่างกันไม่เกิน 5%",
                metric="test.hop_triple",
                source=CriterionSource.TEST,
                aggregate=Aggregate.MAX,
                window_days=21,
                scope=MetricScope.BOTH,
                target=lsi(95),
            ),
            confidence(85),
            clinician_clearance(),
        ),
    ),
)


ANKLE_TEMPLATE: tuple[PhaseTemplate, ...] = (
    _phase(
        _P1,
        "Restore dorsiflexion range and single-leg balance.",
        "ฟื้นมุมกระดกข้อเท้าและการทรงตัวขาเดียว",
        min_days=4,
        sessions_per_week=6,
        prescriptions=(
            Rx("ankle_knee_to_wall", sets=3, reps=12, side_mode=Side.BILATERAL),
            Rx("double_leg_calf_raise", sets=3, reps=15),
            Rx("single_leg_balance", sets=4, reps=None, hold_seconds=30, side_mode=Side.BILATERAL),
        ),
        criteria=(
            pain_at_rest(2.0),
            crit(
                "dorsiflexion_lsi",
                "Ankle dorsiflexion symmetry ≥ 90%",
                "มุมกระดกข้อเท้าสองข้างต่างกันไม่เกิน 10%",
                metric="pose.ankle_dorsiflexion",
                source=CriterionSource.POSE,
                aggregate=Aggregate.MAX,
                window_days=7,
                scope=MetricScope.BOTH,
                target=lsi(90),
            ),
            pain_free_days(3),
            adherence(70),
        ),
    ),
    _phase(
        _P2,
        "Calf strength and proprioception under load.",
        "ความแข็งแรงน่องและการรับรู้ตำแหน่งข้อต่อขณะรับน้ำหนัก",
        min_days=10,
        sessions_per_week=5,
        prescriptions=(
            Rx("single_leg_calf_raise", sets=4, reps=15, side_mode=Side.BILATERAL),
            Rx("single_leg_balance", sets=4, reps=None, hold_seconds=45, side_mode=Side.BILATERAL),
            Rx("step_down", sets=3, reps=10, side_mode=Side.BILATERAL),
            Rx("single_leg_squat", sets=3, reps=10, side_mode=Side.BILATERAL),
        ),
        criteria=(
            pain_on_activity(2.0),
            crit(
                "calf_raise_reps_lsi",
                "Single-leg calf raise repetitions ≥ 90% of the other side",
                "จำนวนครั้งเขย่งขาเดียวต่างกันไม่เกิน 10%",
                metric="test.heel_raise_reps",
                source=CriterionSource.TEST,
                aggregate=Aggregate.MAX,
                window_days=21,
                scope=MetricScope.BOTH,
                target=lsi(90),
            ),
            crit(
                "balance_control",
                "Pelvis stays level in single-leg stance (drop ≤ 5°)",
                "ยืนขาเดียวโดยเชิงกรานตกไม่เกิน 5°",
                metric="pose.balance_pelvic_drop",
                source=CriterionSource.POSE,
                aggregate=Aggregate.MEDIAN,
                window_days=14,
                scope=MetricScope.INJURED,
                comparator=Comparator.LTE,
                target=absolute(5, "deg"),
                min_samples=2,
            ),
            form_quality(80),
            adherence(75),
        ),
    ),
    _phase(
        _P3,
        "Hopping, cutting and running on an ankle that can take the load.",
        "กระโดด เปลี่ยนทิศ และวิ่งบนข้อเท้าที่รับแรงได้",
        min_days=7,
        sessions_per_week=4,
        prescriptions=_RUNNING_RX
        + (
            Rx("pogo_hops", sets=4, reps=20),
            Rx("lateral_bound", sets=4, reps=6, side_mode=Side.BILATERAL),
            Rx("single_leg_hop_landing", sets=3, reps=6, side_mode=Side.BILATERAL),
        ),
        criteria=(
            pain_on_activity(1.0),
            crit(
                "hop_lsi",
                "Single hop symmetry ≥ 90%",
                "กระโดดขาเดียวต่างกันไม่เกิน 10%",
                metric="test.hop_single",
                source=CriterionSource.TEST,
                aggregate=Aggregate.MAX,
                window_days=21,
                scope=MetricScope.BOTH,
                target=lsi(90),
            ),
            form_quality(82),
        ),
    ),
    _phase(
        _P4,
        "Full-speed multidirectional work with no swelling the next day.",
        "เคลื่อนไหวหลายทิศทางเต็มความเร็ว โดยวันรุ่งขึ้นไม่บวม",
        min_days=7,
        sessions_per_week=4,
        prescriptions=_RETURN_RX + (Rx("lateral_bound", sets=3, reps=8, side_mode=Side.BILATERAL),),
        criteria=(
            pain_free_days(7),
            confidence(80),
            clinician_clearance(),
        ),
    ),
)


GROIN_TEMPLATE: tuple[PhaseTemplate, ...] = (
    _phase(
        _P1,
        "Calm the adductors down and restore pain-free hip range.",
        "ลดอาการกล้ามเนื้อขาหนีบและฟื้นมุมสะโพกแบบไม่เจ็บ",
        min_days=5,
        sessions_per_week=6,
        prescriptions=(
            Rx("glute_bridge", sets=3, reps=15),
            Rx("side_lying_hip_abduction", sets=3, reps=15, side_mode=Side.BILATERAL),
            Rx("single_leg_balance", sets=3, reps=None, hold_seconds=30, side_mode=Side.BILATERAL),
        ),
        criteria=(
            pain_at_rest(2.0),
            pain_free_days(3),
            adherence(70),
        ),
    ),
    _phase(
        _P2,
        "Adductor strength — the Copenhagen plank is the workhorse here.",
        "สร้างความแข็งแรงกล้ามเนื้อขาหนีบ โดยมีโคเปนเฮเกนแพลงก์เป็นท่าหลัก",
        min_days=14,
        sessions_per_week=4,
        prescriptions=(
            Rx("copenhagen_plank", sets=3, reps=None, hold_seconds=20, side_mode=Side.BILATERAL),
            Rx("single_leg_rdl", sets=3, reps=8, side_mode=Side.BILATERAL),
            Rx("split_squat", sets=3, reps=10, side_mode=Side.BILATERAL),
            Rx("side_plank", sets=3, reps=None, hold_seconds=30, side_mode=Side.BILATERAL),
        ),
        criteria=(
            pain_on_activity(2.0),
            crit(
                "copenhagen_hold",
                "Copenhagen plank hold ≥ 20s each side",
                "โคเปนเฮเกนแพลงก์ค้างได้ ≥ 20 วินาทีต่อข้าง",
                metric="pose.copenhagen_hold",
                source=CriterionSource.POSE,
                aggregate=Aggregate.MAX,
                window_days=14,
                scope=MetricScope.INJURED,
                target=absolute(20, "s"),
            ),
            crit(
                "adductor_lsi",
                "Adductor squeeze strength symmetry ≥ 90%",
                "แรงบีบขาหนีบสองข้างต่างกันไม่เกิน 10%",
                metric="test.iso_adductor",
                source=CriterionSource.TEST,
                aggregate=Aggregate.MAX,
                window_days=21,
                scope=MetricScope.BOTH,
                target=lsi(90),
                required=False,
            ),
            form_quality(80),
            adherence(75),
        ),
    ),
    _phase(
        _P3,
        "Cutting, kicking and lateral load without groin pain.",
        "เปลี่ยนทิศ เตะบอล และรับแรงด้านข้างโดยไม่ปวดขาหนีบ",
        min_days=10,
        sessions_per_week=4,
        prescriptions=_RUNNING_RX
        + (
            Rx("copenhagen_plank", sets=3, reps=None, hold_seconds=30, side_mode=Side.BILATERAL),
            Rx("lateral_bound", sets=4, reps=6, side_mode=Side.BILATERAL),
        ),
        criteria=(
            pain_on_activity(1.0),
            crit(
                "copenhagen_hold_p3",
                "Copenhagen plank hold ≥ 30s each side",
                "โคเปนเฮเกนแพลงก์ค้างได้ ≥ 30 วินาทีต่อข้าง",
                metric="pose.copenhagen_hold",
                source=CriterionSource.POSE,
                aggregate=Aggregate.MAX,
                window_days=14,
                scope=MetricScope.INJURED,
                target=absolute(30, "s"),
            ),
            form_quality(82),
        ),
    ),
    _phase(
        _P4,
        "Full kicking and sprinting volume, symptom-free.",
        "เตะและวิ่งเร็วได้เต็มปริมาณโดยไม่มีอาการ",
        min_days=7,
        sessions_per_week=4,
        prescriptions=_RETURN_RX
        + (Rx("copenhagen_plank", sets=3, reps=None, hold_seconds=30, side_mode=Side.BILATERAL),),
        criteria=(
            pain_free_days(7),
            confidence(80),
            clinician_clearance(),
        ),
    ),
)


CALF_TEMPLATE: tuple[PhaseTemplate, ...] = (
    _phase(
        _P1,
        "Offload the calf, keep the ankle moving, start gentle loading.",
        "ลดแรงกระทำต่อน่อง คงการเคลื่อนไหวข้อเท้า และเริ่มลงน้ำหนักเบาๆ",
        min_days=5,
        sessions_per_week=6,
        prescriptions=(
            Rx("ankle_knee_to_wall", sets=3, reps=12, side_mode=Side.BILATERAL),
            Rx("double_leg_calf_raise", sets=3, reps=15, tempo="2-1-2-0"),
            Rx("single_leg_balance", sets=3, reps=None, hold_seconds=30, side_mode=Side.BILATERAL),
        ),
        criteria=(
            pain_at_rest(2.0),
            pain_free_days(3),
            crit(
                "dorsiflexion",
                "Ankle dorsiflexion ≥ 25°",
                "มุมกระดกข้อเท้า ≥ 25°",
                metric="pose.ankle_dorsiflexion",
                source=CriterionSource.POSE,
                aggregate=Aggregate.MAX,
                window_days=7,
                scope=MetricScope.INJURED,
                target=absolute(25, "deg"),
            ),
            adherence(70),
        ),
    ),
    _phase(
        _P2,
        "Rebuild calf capacity — reps and height, both sides equal.",
        "สร้างความทนทานของน่อง ทั้งจำนวนครั้งและความสูง ให้เท่ากันสองข้าง",
        min_days=12,
        sessions_per_week=5,
        prescriptions=(
            Rx("single_leg_calf_raise", sets=4, reps=20, side_mode=Side.BILATERAL, tempo="2-1-2-0"),
            Rx("wall_sit", sets=3, reps=None, hold_seconds=45),
            Rx("single_leg_rdl", sets=3, reps=8, side_mode=Side.BILATERAL),
            Rx("step_down", sets=3, reps=10, side_mode=Side.BILATERAL),
        ),
        criteria=(
            pain_on_activity(2.0),
            crit(
                "calf_raise_height",
                "Full single-leg calf raise height",
                "เขย่งขาเดียวได้สูงเต็มระยะ",
                metric="pose.calf_raise_height",
                source=CriterionSource.POSE,
                aggregate=Aggregate.MEDIAN,
                window_days=14,
                scope=MetricScope.INJURED,
                target=absolute(0.45, "ratio"),
                min_samples=2,
            ),
            crit(
                "calf_raise_reps_lsi",
                "Calf raise repetitions ≥ 90% of the other side",
                "จำนวนครั้งเขย่งต่างกันไม่เกิน 10%",
                metric="test.heel_raise_reps",
                source=CriterionSource.TEST,
                aggregate=Aggregate.MAX,
                window_days=21,
                scope=MetricScope.BOTH,
                target=lsi(90),
            ),
            form_quality(80),
            adherence(75),
        ),
    ),
    _phase(
        _P3,
        "Springy, repeated loading before full-speed running.",
        "รับแรงกระแทกซ้ำๆ แบบสปริง ก่อนกลับไปวิ่งเต็มความเร็ว",
        min_days=10,
        sessions_per_week=4,
        prescriptions=_RUNNING_RX
        + (
            Rx("pogo_hops", sets=5, reps=20),
            Rx("single_leg_calf_raise", sets=3, reps=20, side_mode=Side.BILATERAL),
        ),
        criteria=(
            pain_on_activity(1.0),
            crit(
                "hop_lsi",
                "Single hop symmetry ≥ 90%",
                "กระโดดขาเดียวต่างกันไม่เกิน 10%",
                metric="test.hop_single",
                source=CriterionSource.TEST,
                aggregate=Aggregate.MAX,
                window_days=21,
                scope=MetricScope.BOTH,
                target=lsi(90),
            ),
            form_quality(82),
        ),
    ),
    _phase(
        _P4,
        "Sprint volume with no next-day tightness.",
        "วิ่งเร็วได้เต็มปริมาณ โดยวันรุ่งขึ้นไม่ตึง",
        min_days=7,
        sessions_per_week=4,
        prescriptions=_RETURN_RX
        + (Rx("single_leg_calf_raise", sets=3, reps=20, side_mode=Side.BILATERAL),),
        criteria=(
            pain_free_days(7),
            confidence(80),
            clinician_clearance(),
        ),
    ),
)


PATELLAR_TENDINOPATHY_TEMPLATE: tuple[PhaseTemplate, ...] = (
    _phase(
        _P1,
        "Settle the tendon with heavy isometric holds - load it, do not rest it.",
        "ลดอาการเอ็นด้วยการเกร็งค้างรับน้ำหนัก ไม่ใช่การพัก",
        min_days=7,
        sessions_per_week=6,
        prescriptions=(
            Rx("spanish_squat", sets=5, reps=None, hold_seconds=45, rest_seconds=120),
            Rx("wall_sit", sets=3, reps=None, hold_seconds=45),
            Rx("glute_bridge", sets=3, reps=15),
            Rx("single_leg_balance", sets=3, reps=None, hold_seconds=30, side_mode=Side.BILATERAL),
        ),
        criteria=(
            # A tendon is allowed to hurt while it is being loaded. Demanding zero
            # pain here would stop the very thing that settles it, so this bar is
            # deliberately looser than for a torn muscle.
            crit(
                "tendon_pain_during",
                "Pain during loading at most 4/10",
                "ปวดขณะลงน้ำหนักไม่เกิน 4/10",
                metric="pro.pain_activity",
                source=CriterionSource.PRO,
                aggregate=Aggregate.MAX,
                window_days=7,
                comparator=Comparator.LTE,
                target=absolute(4, "NPRS"),
                min_samples=2,
                help_en="Tendons tolerate load. Discomfort during the exercise is "
                "expected and is not a reason to stop.",
                help_th="เอ็นรับน้ำหนักได้ ปวดเล็กน้อยขณะออกกำลังกายเป็นเรื่องปกติ",
            ),
            crit(
                "morning_pain",
                "No worse the next morning (at most 3/10)",
                "เช้าวันรุ่งขึ้นไม่แย่ลง (ไม่เกิน 3/10)",
                metric="pro.pain_next_morning",
                source=CriterionSource.PRO,
                aggregate=Aggregate.MAX,
                window_days=7,
                comparator=Comparator.LTE,
                target=absolute(3, "NPRS"),
                min_samples=2,
                help_en="Next-morning pain is the honest signal for a tendon: it tells "
                "you whether the load yesterday was too much.",
                help_th="อาการปวดในเช้าวันรุ่งขึ้นเป็นสัญญาณที่แท้จริงของเอ็น",
            ),
            crit(
                "isometric_hold",
                "Spanish squat hold at least 45s",
                "สแปนิชสควอทค้างได้อย่างน้อย 45 วินาที",
                metric="pose.spanish_squat_hold",
                source=CriterionSource.POSE,
                aggregate=Aggregate.MAX,
                window_days=14,
                scope=MetricScope.INJURED,
                target=absolute(45, "s"),
            ),
            adherence(75),
        ),
    ),
    _phase(
        _P2,
        "Slow heavy resistance through range - the load that rebuilds tendon capacity.",
        "ฝึกแรงต้านหนักช้าเต็มช่วง เพื่อสร้างความทนทานของเอ็น",
        min_days=21,
        sessions_per_week=3,
        prescriptions=(
            Rx("decline_squat", sets=4, reps=8, side_mode=Side.BILATERAL, tempo="3-0-3-0",
               rest_seconds=150, load_en="Add weight so the last rep is hard",
               load_th="เพิ่มน้ำหนักให้ครั้งสุดท้ายรู้สึกหนัก"),
            Rx("split_squat", sets=3, reps=8, side_mode=Side.BILATERAL, tempo="3-0-3-0"),
            Rx("single_leg_calf_raise", sets=3, reps=12, side_mode=Side.BILATERAL),
            Rx("spanish_squat", sets=3, reps=None, hold_seconds=45),
        ),
        criteria=(
            crit(
                "tendon_pain_during_p2",
                "Pain during loading at most 3/10",
                "ปวดขณะลงน้ำหนักไม่เกิน 3/10",
                metric="pro.pain_activity",
                source=CriterionSource.PRO,
                aggregate=Aggregate.MAX,
                window_days=7,
                comparator=Comparator.LTE,
                target=absolute(3, "NPRS"),
                min_samples=2,
            ),
            crit(
                "decline_depth",
                "Single-leg decline squat to at least 55 degrees",
                "สควอทขาเดียวบนพื้นเอียงงอเข่าอย่างน้อย 55 องศา",
                metric="pose.decline_squat_depth",
                source=CriterionSource.POSE,
                aggregate=Aggregate.MEDIAN,
                window_days=14,
                scope=MetricScope.INJURED,
                target=absolute(55, "deg"),
                min_samples=2,
            ),
            crit(
                "quad_lsi_tendon",
                "Quadriceps strength symmetry at least 90%",
                "ความแข็งแรงต้นขาด้านหน้าต่างกันไม่เกิน 10%",
                metric="test.iso_quadriceps",
                source=CriterionSource.TEST,
                aggregate=Aggregate.MAX,
                window_days=21,
                scope=MetricScope.BOTH,
                target=lsi(90),
                required=False,
            ),
            form_quality(80),
            adherence(75),
        ),
    ),
    _phase(
        _P3,
        "Energy storage and release - jumping and landing the tendon can now absorb.",
        "ฝึกเก็บและปล่อยพลังงาน กระโดดและลงพื้นที่เอ็นรับได้แล้ว",
        min_days=14,
        sessions_per_week=4,
        prescriptions=_RUNNING_RX
        + (
            Rx("pogo_hops", sets=4, reps=20),
            Rx("single_leg_hop_landing", sets=4, reps=6, side_mode=Side.BILATERAL),
            Rx("decline_squat", sets=3, reps=8, side_mode=Side.BILATERAL, tempo="3-0-3-0"),
        ),
        criteria=(
            pain_on_activity(2.0),
            crit(
                "landing_control",
                "Lands softly (knee bend at least 45 degrees)",
                "ลงพื้นนุ่มนวล (งอเข่าอย่างน้อย 45 องศา)",
                metric="pose.landing_knee_flexion",
                source=CriterionSource.POSE,
                aggregate=Aggregate.MEDIAN,
                window_days=14,
                scope=MetricScope.INJURED,
                target=absolute(45, "deg"),
                min_samples=3,
            ),
            crit(
                "cmj_lsi_tendon",
                "Jump height symmetry at least 90%",
                "ความสูงกระโดดต่างกันไม่เกิน 10%",
                metric="test.cmj_height",
                source=CriterionSource.TEST,
                aggregate=Aggregate.MAX,
                window_days=21,
                scope=MetricScope.BOTH,
                target=lsi(90),
            ),
            form_quality(82),
        ),
    ),
    _phase(
        _P4,
        "Full jumping and sprinting volume with a quiet tendon the morning after.",
        "กระโดดและวิ่งได้เต็มปริมาณ โดยเช้าวันรุ่งขึ้นเอ็นไม่มีอาการ",
        min_days=14,
        sessions_per_week=4,
        prescriptions=_RETURN_RX
        + (
            Rx("decline_squat", sets=3, reps=8, side_mode=Side.BILATERAL, tempo="3-0-3-0"),
            Rx("heading_jump", sets=3, reps=8),
        ),
        criteria=(
            crit(
                "morning_pain_p4",
                "No morning pain for 7 days (at most 1/10)",
                "ไม่ปวดตอนเช้าเป็นเวลา 7 วัน (ไม่เกิน 1/10)",
                metric="pro.pain_next_morning",
                source=CriterionSource.PRO,
                aggregate=Aggregate.MAX,
                window_days=7,
                comparator=Comparator.LTE,
                target=absolute(1, "NPRS"),
                min_samples=4,
            ),
            confidence(80),
            clinician_clearance(),
        ),
    ),
)


GROIN_PAIN_TEMPLATE: tuple[PhaseTemplate, ...] = (
    _phase(
        _P1,
        "Settle long-standing groin pain and restore pain-free hip range.",
        "ลดอาการปวดขาหนีบเรื้อรังและฟื้นมุมสะโพกแบบไม่เจ็บ",
        min_days=7,
        sessions_per_week=6,
        prescriptions=(
            Rx("adductor_squeeze", sets=5, reps=None, hold_seconds=30, rest_seconds=60),
            Rx("glute_bridge", sets=3, reps=15),
            Rx("side_lying_hip_abduction", sets=3, reps=15, side_mode=Side.BILATERAL),
            Rx("single_leg_balance", sets=3, reps=None, hold_seconds=30, side_mode=Side.BILATERAL),
        ),
        criteria=(
            # Long-standing groin pain rarely goes fully quiet before loading
            # starts, so the phase-1 bar sits where it is actually reachable.
            crit(
                "groin_pain_rest",
                "Pain at rest at most 3/10",
                "ปวดขณะพักไม่เกิน 3/10",
                metric="pro.pain_rest",
                source=CriterionSource.PRO,
                aggregate=Aggregate.MAX,
                window_days=7,
                comparator=Comparator.LTE,
                target=absolute(3, "NPRS"),
                min_samples=2,
            ),
            pain_free_days(3),
            adherence(75),
        ),
    ),
    _phase(
        _P2,
        "Rebuild adductor strength through range.",
        "สร้างความแข็งแรงกล้ามเนื้อขาหนีบเต็มช่วงการเคลื่อนไหว",
        min_days=21,
        sessions_per_week=4,
        prescriptions=(
            Rx("copenhagen_plank", sets=3, reps=None, hold_seconds=20, side_mode=Side.BILATERAL),
            Rx("adductor_squeeze", sets=4, reps=None, hold_seconds=30),
            Rx("single_leg_rdl", sets=3, reps=8, side_mode=Side.BILATERAL),
            Rx("side_plank", sets=3, reps=None, hold_seconds=30, side_mode=Side.BILATERAL),
        ),
        criteria=(
            pain_on_activity(2.0),
            crit(
                "copenhagen_hold",
                "Copenhagen plank hold at least 20s each side",
                "โคเปนเฮเกนแพลงก์ค้างได้อย่างน้อย 20 วินาทีต่อข้าง",
                metric="pose.copenhagen_hold",
                source=CriterionSource.POSE,
                aggregate=Aggregate.MAX,
                window_days=14,
                scope=MetricScope.INJURED,
                target=absolute(20, "s"),
            ),
            crit(
                "adductor_lsi",
                "Adductor squeeze strength symmetry at least 90%",
                "แรงบีบขาหนีบสองข้างต่างกันไม่เกิน 10%",
                metric="test.iso_adductor",
                source=CriterionSource.TEST,
                aggregate=Aggregate.MAX,
                window_days=21,
                scope=MetricScope.BOTH,
                target=lsi(90),
                required=False,
            ),
            form_quality(80),
            adherence(75),
        ),
    ),
    _phase(
        _P3,
        "Cutting, kicking and lateral load without the groin pain returning.",
        "เปลี่ยนทิศ เตะบอล และรับแรงด้านข้างโดยขาหนีบไม่กลับมาปวด",
        min_days=14,
        sessions_per_week=4,
        prescriptions=_RUNNING_RX
        + (
            Rx("copenhagen_plank", sets=3, reps=None, hold_seconds=30, side_mode=Side.BILATERAL),
            Rx("lateral_bound", sets=4, reps=6, side_mode=Side.BILATERAL),
        ),
        criteria=(
            pain_on_activity(1.0),
            crit(
                "copenhagen_hold_p3",
                "Copenhagen plank hold at least 30s each side",
                "โคเปนเฮเกนแพลงก์ค้างได้อย่างน้อย 30 วินาทีต่อข้าง",
                metric="pose.copenhagen_hold",
                source=CriterionSource.POSE,
                aggregate=Aggregate.MAX,
                window_days=14,
                scope=MetricScope.INJURED,
                target=absolute(30, "s"),
            ),
            change_of_direction(90),
            form_quality(82),
        ),
    ),
    _phase(
        _P4,
        "Full kicking and sprinting volume, symptom-free.",
        "เตะและวิ่งเร็วได้เต็มปริมาณโดยไม่มีอาการ",
        min_days=10,
        sessions_per_week=4,
        prescriptions=_RETURN_RX
        + (Rx("copenhagen_plank", sets=3, reps=None, hold_seconds=30, side_mode=Side.BILATERAL),),
        criteria=(
            pain_free_days(7),
            change_of_direction(95),
            confidence(80),
            clinician_clearance(),
        ),
    ),
)


INJURY_TEMPLATES: dict[InjurySite, tuple[PhaseTemplate, ...]] = {
    InjurySite.HAMSTRING: HAMSTRING_TEMPLATE,
    InjurySite.ACL: KNEE_TEMPLATE,
    InjurySite.PATELLAR_TENDINOPATHY: PATELLAR_TENDINOPATHY_TEMPLATE,
    InjurySite.ANKLE: ANKLE_TEMPLATE,
    InjurySite.ADDUCTOR: GROIN_TEMPLATE,
    InjurySite.GROIN: GROIN_PAIN_TEMPLATE,
    InjurySite.CALF: CALF_TEMPLATE,
}


# --------------------------------------------------------------------------
# position profiles
# --------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class PositionProfile:
    position: Position
    label_en: str
    label_th: str
    extra_rx: dict[PhaseKey, tuple[Rx, ...]] = field(default_factory=dict)
    extra_criteria: dict[PhaseKey, tuple[CriterionDef, ...]] = field(default_factory=dict)


def _cmj_lsi(value: float = 90.0) -> CriterionDef:
    return crit(
        "cmj_lsi",
        f"Jump height symmetry ≥ {value:g}%",
        f"ความสูงกระโดดสองข้างต่างกันไม่เกิน {100 - value:g}%",
        metric="test.cmj_height",
        source=CriterionSource.TEST,
        aggregate=Aggregate.MAX,
        window_days=21,
        scope=MetricScope.BOTH,
        target=lsi(value),
    )


POSITION_PROFILES: dict[Position, PositionProfile] = {
    Position.GOALKEEPER: PositionProfile(
        Position.GOALKEEPER,
        "Goalkeeper",
        "ผู้รักษาประตู",
        extra_rx={
            _P3: (Rx("goalkeeper_dive_landing", sets=3, reps=6, side_mode=Side.BILATERAL),),
            _P4: (Rx("goalkeeper_dive_landing", sets=4, reps=8, side_mode=Side.BILATERAL),),
        },
        extra_criteria={
            _P3: (
                crit(
                    "lateral_landing_valgus",
                    "Lateral landing stays controlled (valgus ≤ 8°)",
                    "ลงพื้นด้านข้างควบคุมได้ (เข่าบิดเข้า ≤ 8°)",
                    metric="pose.landing_knee_valgus",
                    source=CriterionSource.POSE,
                    aggregate=Aggregate.MEDIAN,
                    window_days=14,
                    scope=MetricScope.INJURED,
                    comparator=Comparator.LTE,
                    target=absolute(8, "deg"),
                    min_samples=3,
                ),
            ),
            _P4: (_cmj_lsi(90),),
        },
    ),
    Position.CENTRE_BACK: PositionProfile(
        Position.CENTRE_BACK,
        "Centre back",
        "กองหลังตัวกลาง",
        extra_rx={
            _P3: (Rx("heading_jump", sets=3, reps=8),),
            _P4: (Rx("heading_jump", sets=4, reps=8),),
        },
        extra_criteria={_P4: (_cmj_lsi(92),)},
    ),
    Position.FULL_BACK: PositionProfile(
        Position.FULL_BACK,
        "Full back / wing back",
        "แบ็ก / วิงแบ็ก",
        extra_rx={_P4: (Rx("repeated_sprint", sets=2, reps=6, rest_seconds=25),)},
    ),
    Position.CENTRE_MIDFIELD: PositionProfile(
        Position.CENTRE_MIDFIELD,
        "Central midfielder",
        "กองกลาง",
    ),
    Position.WINGER: PositionProfile(
        Position.WINGER,
        "Winger",
        "ปีก",
        extra_rx={
            _P3: (Rx("lateral_bound", sets=4, reps=8, side_mode=Side.BILATERAL),),
            _P4: (Rx("repeated_sprint", sets=2, reps=6, rest_seconds=25),),
        },
        extra_criteria={
            _P4: (
                crit(
                    "repeated_sprint_decrement",
                    "Repeated-sprint drop-off ≤ 5%",
                    "ความเร็วลดลงระหว่างวิ่งซ้ำ ≤ 5%",
                    metric="test.sprint_decrement",
                    source=CriterionSource.TEST,
                    aggregate=Aggregate.LATEST,
                    window_days=21,
                    comparator=Comparator.LTE,
                    target=absolute(5, "%"),
                    required=False,
                    help_en="6 x 30m with 30s rest. Compare the slowest sprint to the fastest.",
                    help_th="วิ่ง 30 เมตร 6 เที่ยว พัก 30 วินาที เทียบเที่ยวช้าสุดกับเร็วสุด",
                ),
            )
        },
    ),
    Position.STRIKER: PositionProfile(
        Position.STRIKER,
        "Striker",
        "กองหน้า",
        extra_rx={
            _P3: (Rx("heading_jump", sets=3, reps=6),),
            _P4: (Rx("repeated_sprint", sets=2, reps=5, rest_seconds=30),),
        },
        extra_criteria={_P4: (_cmj_lsi(90),)},
    ),
}


# --------------------------------------------------------------------------
# composition
# --------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class BuiltProtocol:
    key: str
    position: Position
    injury_site: InjurySite
    title_en: str
    title_th: str
    summary_en: str
    summary_th: str
    phases: tuple[PhaseTemplate, ...]


_INJURY_LABELS: dict[InjurySite, tuple[str, str]] = {
    InjurySite.HAMSTRING: ("Hamstring strain", "กล้ามเนื้อต้นขาด้านหลัง"),
    InjurySite.ACL: ("ACL reconstruction", "เอ็นไขว้หน้าเข่า"),
    InjurySite.PATELLAR_TENDINOPATHY: ("Patellar tendinopathy", "เอ็นสะบ้าอักเสบ"),
    InjurySite.ANKLE: ("Ankle sprain", "ข้อเท้าพลิก"),
    InjurySite.ADDUCTOR: ("Adductor strain", "กล้ามเนื้อขาหนีบฉีก"),
    InjurySite.GROIN: ("Groin pain", "ปวดขาหนีบเรื้อรัง"),
    InjurySite.CALF: ("Calf strain", "น่อง / เอ็นร้อยหวาย"),
}


def _apply_position(phase: PhaseTemplate, profile: PositionProfile) -> PhaseTemplate:
    """Bolt the position-specific work onto a shared phase."""
    criteria: list[CriterionDef] = [copy.deepcopy(c) for c in phase.criteria]

    existing = {c.key for c in criteria}
    for extra in profile.extra_criteria.get(phase.phase_key, ()):
        if extra.key not in existing:
            criteria.append(copy.deepcopy(extra))

    # Cutting is on the poster's test battery and is where knees and groins get
    # hurt, so every programme is gated on it once running has started.
    if phase.phase_key in (_P3, _P4) and "change_of_direction" not in {
        c.key for c in criteria
    }:
        criteria.append(change_of_direction(90 if phase.phase_key is _P3 else 95))

    prescriptions = phase.prescriptions + profile.extra_rx.get(phase.phase_key, ())
    return replace(phase, prescriptions=prescriptions, criteria=tuple(criteria))


#: Phase one is the same four movements for every position and every injury.
#:
#: All four have now had their camera scoring checked against video of a real
#: person with a known rep count, rather than against a skeleton drawn in code.
#: Everything else in the library is still built from the injury and the
#: position; only this one phase is pinned, so that the part anyone is shown
#: first is the part that is known to work.
#:
#: The fourth, the glute bridge, replaced a lateral bound whose reps could not
#: be counted reliably. A bound is continuous: there is no still moment between
#: reps for the counter to reset on, and on real footage a landing wobble inside
#: one bound dipped further than the gap between two separate bounds, so no
#: threshold could tell them apart. The bridge is the opposite on every count
#: that mattered -- filmed side-on so the angles are measured in the image
#: rather than from MediaPipe's depth guess, done lying down so there is no
#: balance to lose, and it comes to rest between every rep.
#:
#: It was the last of the four to be filmed, and filming it found the same fault
#: as the other three: thresholds that were reasoned out rather than measured sat
#: outside what a body actually produces, and refused every honest rep. See the
#: note on `glute_bridge` in app/data/exercises.py. The 2-0-2-0 tempo below is
#: worth reading next to that: it asks for a four-second rep, and the six filmed
#: reps ran 3.2 to 4.3 seconds, so the prescription and the footage agree.
#:
#: Clinically this is not a phase-one selection. It is pinned here for
#: demonstration; deleting `_fixed_phase_one` and its call below restores the
#: real programmes exactly.
_DEMO_PHASE_ONE: tuple[Rx, ...] = (
    Rx("double_leg_calf_raise", sets=3, reps=12, tempo="2-0-2-0"),
    Rx("wall_sit", sets=3, reps=None, hold_seconds=45),
    Rx("split_squat", sets=3, reps=8, side_mode=Side.BILATERAL, tempo="2-0-2-0"),
    Rx("glute_bridge", sets=3, reps=12, tempo="2-0-2-0"),
)


def _fixed_phase_one(phase: PhaseTemplate) -> PhaseTemplate:
    """Swap phase one's work for the four, and re-point its gate at them.

    The criteria have to move with the exercises. Every pose-based phase-one
    criterion in the library is fed by one specific movement -- ankle
    dorsiflexion by knee-to-wall, extension lag by the quad set, knee range by
    the heel slide -- so leaving them behind a different set of exercises would
    leave a gate with nothing to satisfy it. Pain, pain-free days and adherence
    do not depend on which exercises are prescribed, so those stay exactly as
    the injury template wrote them.
    """
    kept = tuple(c for c in phase.criteria if not c.spec.metric.startswith("pose."))
    return replace(
        phase,
        prescriptions=_DEMO_PHASE_ONE,
        criteria=kept
        + (
            crit(
                "wall_sit_hold",
                "Hold a wall sit for 30 seconds",
                "นั่งพิงกำแพงค้างได้ 30 วินาที",
                metric="session.hold.wall_sit",
                source=CriterionSource.SESSION,
                aggregate=Aggregate.MAX,
                window_days=14,
                target=absolute(30, "s"),
                help_en="Timed by the camera, and only while your knees stay in position.",
                help_th="จับเวลาด้วยกล้อง และนับเฉพาะตอนที่เข่าอยู่ในมุมที่ถูกต้อง",
            ),
            crit(
                "calf_raise_reps",
                "12 double-leg calf raises in one set",
                "เขย่งปลายเท้าสองขา 12 ครั้งในหนึ่งเซ็ต",
                metric="session.reps.double_leg_calf_raise",
                source=CriterionSource.SESSION,
                aggregate=Aggregate.MAX,
                window_days=14,
                target=absolute(12, "reps"),
                help_en="Counted from reps the camera accepted, so shallow ones do not help.",
                help_th="นับจากครั้งที่กล้องยอมรับ ครั้งที่ยกไม่สุดจึงไม่ถูกนับ",
            ),
        ),
    )


def build_protocols() -> list[BuiltProtocol]:
    """Materialise all 30 position x injury programmes."""
    built: list[BuiltProtocol] = []
    for position, profile in POSITION_PROFILES.items():
        for site, template in INJURY_TEMPLATES.items():
            injury_en, injury_th = _INJURY_LABELS[site]
            phases = tuple(_apply_position(p, profile) for p in template)
            # After the position has had its say, so nothing a role adds can
            # put a fifth exercise into the one phase that is meant to be fixed.
            phases = tuple(
                _fixed_phase_one(p) if p.phase_key is _P1 else p for p in phases
            )
            assert [p.phase_key for p in phases] == PHASE_ORDER
            built.append(
                BuiltProtocol(
                    key=f"{position.value}__{site.value}",
                    position=position,
                    injury_site=site,
                    title_en=f"{injury_en} rehab — {profile.label_en}",
                    title_th=f"ฟื้นฟู{injury_th} — {profile.label_th}",
                    summary_en=(
                        f"Four-phase return-to-pitch programme for a {profile.label_en.lower()} "
                        f"with a {injury_en.lower()} injury. Each phase opens when its own "
                        f"testing is passed."
                    ),
                    summary_th=(
                        f"โปรแกรมคืนสู่สนาม 4 เฟส สำหรับ{profile.label_th}ที่บาดเจ็บ{injury_th} "
                        f"แต่ละเฟสจะเปิดเมื่อผ่านการทดสอบของเฟสนั้น"
                    ),
                    phases=phases,
                )
            )
    return built
