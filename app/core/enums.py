from __future__ import annotations

from enum import StrEnum


class Role(StrEnum):
    PLAYER = "player"
    CLINICIAN = "clinician"  # physio / sports scientist / coach
    ADMIN = "admin"


class Position(StrEnum):
    """The 6 playing positions the rehab library is indexed on."""

    GOALKEEPER = "goalkeeper"
    CENTRE_BACK = "centre_back"
    FULL_BACK = "full_back"
    CENTRE_MIDFIELD = "centre_midfield"
    WINGER = "winger"
    STRIKER = "striker"


class InjurySite(StrEnum):
    """The 7 injury sites. 6 positions x 7 sites = the 42 protocol variants.

    Split finer than "knee" and "groin" on purpose: an ACL reconstruction and a
    patellar tendinopathy need opposite handling in the early phases -- one is
    protected while it heals, the other is *loaded* because that is what settles
    tendon pain. Lumping them together would hand a player the wrong programme.
    """

    HAMSTRING = "hamstring"
    ACL = "acl"  # ACL reconstruction / rupture
    PATELLAR_TENDINOPATHY = "patellar_tendinopathy"  # jumper's knee
    ANKLE = "ankle"  # lateral / medial ligament sprain
    ADDUCTOR = "adductor"  # acute adductor strain
    GROIN = "groin"  # long-standing groin pain
    CALF = "calf"  # gastroc / soleus / achilles


#: Values that used to exist, and what they became. Used to migrate rows written
#: before the split so an existing player is not left pointing at nothing.
RETIRED_INJURY_SITES: dict[str, InjurySite] = {
    "knee": InjurySite.ACL,
}


class Side(StrEnum):
    LEFT = "left"
    RIGHT = "right"
    BILATERAL = "bilateral"


class Severity(StrEnum):
    GRADE_1 = "grade_1"
    GRADE_2 = "grade_2"
    GRADE_3 = "grade_3"
    POST_SURGICAL = "post_surgical"


class PhaseKey(StrEnum):
    """The 4 phases a player must clear before returning to the pitch."""

    P1_PROTECT = "p1_protect"  # ป้องกันและกระตุ้นกล้ามเนื้อ
    P2_STRENGTH = "p2_strength"  # สร้างความแข็งแรงและรับแรง
    P3_RUNNING = "p3_running"  # วิ่งและเปลี่ยนทิศ
    P4_RETURN = "p4_return"  # กลับซ้อมกับทีม


PHASE_ORDER: list[PhaseKey] = [
    PhaseKey.P1_PROTECT,
    PhaseKey.P2_STRENGTH,
    PhaseKey.P3_RUNNING,
    PhaseKey.P4_RETURN,
]


class EpisodeStatus(StrEnum):
    ACTIVE = "active"
    CLEARED = "cleared"  # passed phase 4, back on the pitch
    PAUSED = "paused"  # flare-up / re-assessment
    ABANDONED = "abandoned"


class SessionStatus(StrEnum):
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    ABANDONED = "abandoned"


# --------------------------------------------------------------------------
# Exit-criteria vocabulary
# --------------------------------------------------------------------------
class CriterionSource(StrEnum):
    POSE = "pose"  # measured by MediaPipe during a rehab session
    TEST = "test"  # a field test (30m sprint, CMJ, hop test, isometric)
    PRO = "pro"  # patient-reported outcome (pain, confidence, questionnaire)
    HEALTH = "health"  # synced from Apple Health / Google Health Connect
    SESSION = "session"  # adherence / volume derived from the app itself
    MANUAL = "manual"  # clinician sign-off


class Aggregate(StrEnum):
    LATEST = "latest"
    MAX = "max"
    MIN = "min"
    MEAN = "mean"
    MEDIAN = "median"
    P95 = "p95"
    SUM = "sum"
    COUNT = "count"


class Comparator(StrEnum):
    GTE = "gte"
    LTE = "lte"
    GT = "gt"
    LT = "lt"
    EQ = "eq"
    BETWEEN = "between"


class TargetType(StrEnum):
    ABSOLUTE = "absolute"  # e.g. max speed >= 8.5 m/s
    PERCENT_OF_BASELINE = "percent_of_baseline"  # e.g. >= 90% of pre-injury max speed
    LSI = "lsi"  # limb symmetry index: injured / healthy * 100
    DELTA = "delta"  # change vs. baseline in raw units


class MetricScope(StrEnum):
    ANY = "any"  # side does not matter
    INJURED = "injured"  # only samples from the injured limb
    UNINJURED = "uninjured"
    BOTH = "both"  # both limbs must satisfy it


class CriterionStatus(StrEnum):
    PASS = "pass"
    FAIL = "fail"
    NO_DATA = "no_data"  # never measured -> cannot pass, but is not a failure
    PENDING_SIGNOFF = "pending_signoff"


class HealthPlatform(StrEnum):
    APPLE_HEALTH = "apple_health"
    HEALTH_CONNECT = "health_connect"  # Google / Android
    MANUAL = "manual"
    OTHER = "other"
