"""Import every model so ``Base.metadata`` is complete before ``create_all``."""

from app.models.injury import ClinicianSignoff, InjuryEpisode, PhaseAttempt
from app.models.metrics import MetricSample
from app.models.protocol import (
    Exercise,
    ExitCriterion,
    PhasePrescription,
    Protocol,
    ProtocolPhase,
)
from app.models.session import (
    ExerciseSet,
    PainLog,
    RehabSession,
    RepRecord,
)
from app.models.user import PlayerBaseline, PlayerProfile, Team, User

__all__ = [
    "ClinicianSignoff",
    "Exercise",
    "ExerciseSet",
    "ExitCriterion",
    "InjuryEpisode",
    "MetricSample",
    "PainLog",
    "PhaseAttempt",
    "PhasePrescription",
    "PlayerBaseline",
    "PlayerProfile",
    "Protocol",
    "ProtocolPhase",
    "RehabSession",
    "RepRecord",
    "Team",
    "User",
]
