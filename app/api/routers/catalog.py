from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.deps import DbSession
from app.core.enums import InjurySite, PhaseKey, Position
from app.data.exercises import EXERCISES_BY_KEY
from app.data.protocols import POSITION_PROFILES
from app.models.protocol import Exercise, Protocol, ProtocolPhase
from app.schemas.protocol import (
    ExerciseOut,
    PositionExtraOut,
    PositionOut,
    ProtocolOut,
    ProtocolSummaryOut,
)

router = APIRouter(prefix="/catalog", tags=["catalog"])


@router.get("/exercises", response_model=list[ExerciseOut])
def list_exercises(db: DbSession, category: str | None = None) -> list[Exercise]:
    stmt = select(Exercise).order_by(Exercise.category, Exercise.key)
    if category:
        stmt = stmt.where(Exercise.category == category)
    return list(db.execute(stmt).scalars())


@router.get("/protocols", response_model=list[ProtocolSummaryOut])
def list_protocols(
    db: DbSession,
    position: Position | None = None,
    injury_site: InjurySite | None = None,
) -> list[Protocol]:
    stmt = select(Protocol).where(Protocol.is_active.is_(True)).order_by(Protocol.key)
    if position:
        stmt = stmt.where(Protocol.position == position)
    if injury_site:
        stmt = stmt.where(Protocol.injury_site == injury_site)
    return list(db.execute(stmt).scalars())


@router.get("/protocols/{position}/{injury_site}", response_model=ProtocolOut)
def get_protocol(position: Position, injury_site: InjurySite, db: DbSession) -> Protocol:
    protocol = (
        db.execute(
            select(Protocol)
            .where(Protocol.position == position)
            .where(Protocol.injury_site == injury_site)
            .where(Protocol.is_active.is_(True))
            .order_by(Protocol.version.desc())
            .options(
                selectinload(Protocol.phases)
                .selectinload(ProtocolPhase.prescriptions),
                selectinload(Protocol.phases).selectinload(ProtocolPhase.exit_criteria),
            )
        )
        .scalars()
        .first()
    )
    if protocol is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no protocol for that combination")
    return protocol


#: A plain sentence per role, for the screen where a player picks one. The
#: numbers beside it are pulled from the real position profile -- only the
#: wording lives here, the same way phase labels do below.
_ROLE_BLURBS: dict[Position, str] = {
    Position.GOALKEEPER: (
        "Diving, landing and getting straight back up. Less running than anyone "
        "else, but far more awkward landings."
    ),
    Position.CENTRE_BACK: (
        "Heading duels and short, hard sprints to cover the space in behind."
    ),
    Position.FULL_BACK: (
        "Up and down the touchline all game — the most total running distance "
        "of any outfield role."
    ),
    Position.CENTRE_MIDFIELD: (
        "Covers the most ground overall, at a steadier pace than the wide players."
    ),
    Position.WINGER: (
        "Repeated top-speed sprints and sharp cuts, off both feet."
    ),
    Position.STRIKER: (
        "Explosive short sprints, jumping for the ball, and turning under pressure."
    ),
}

_PHASE_ORDER: dict[PhaseKey, int] = {key: i + 1 for i, key in enumerate(PhaseKey)}


@router.get("/positions", response_model=list[PositionOut])
def list_positions() -> list[PositionOut]:
    """The six roles, and what each one changes about the programme.

    Picking a position is not cosmetic -- it adds drills specific to the role
    and tests other roles do not have to pass. This endpoint returns those
    differences so the picker can show them instead of asking the player to take
    it on trust.
    """
    out: list[PositionOut] = []
    for position, profile in POSITION_PROFILES.items():
        exercises = [
            PositionExtraOut(
                key=rx.exercise,
                label_en=(
                    definition.name_en
                    if (definition := EXERCISES_BY_KEY.get(rx.exercise))
                    else rx.exercise
                ),
                phase_key=phase,
                phase_order=_PHASE_ORDER[phase],
            )
            for phase, items in profile.extra_rx.items()
            for rx in items
        ]
        # A drill can appear in more than one phase; show it once, at the phase
        # it first arrives, so the picker reads as a list of new things.
        seen: set[str] = set()
        unique_exercises = [
            item
            for item in sorted(exercises, key=lambda i: i.phase_order)
            if not (item.key in seen or seen.add(item.key))
        ]

        criteria = [
            PositionExtraOut(
                key=criterion.key,
                label_en=criterion.label_en,
                phase_key=phase,
                phase_order=_PHASE_ORDER[phase],
            )
            for phase, items in profile.extra_criteria.items()
            for criterion in items
        ]

        out.append(
            PositionOut(
                key=position,
                label_en=profile.label_en,
                label_th=profile.label_th,
                blurb_en=_ROLE_BLURBS[position],
                extra_exercises=unique_exercises,
                extra_criteria=sorted(criteria, key=lambda i: i.phase_order),
            )
        )
    return out


@router.get("/phases")
def list_phases() -> list[dict[str, str]]:
    labels = {
        PhaseKey.P1_PROTECT: ("Protect and activate", "ป้องกันและกระตุ้นกล้ามเนื้อ"),
        PhaseKey.P2_STRENGTH: ("Strength and load tolerance", "สร้างความแข็งแรงและทนต่อแรง"),
        PhaseKey.P3_RUNNING: ("Running and change of direction", "วิ่งและเปลี่ยนทิศ"),
        PhaseKey.P4_RETURN: ("Return to team training", "กลับไปซ้อมกับทีม"),
    }
    return [
        {"key": str(k), "order": str(i + 1), "label_en": en, "label_th": th}
        for i, (k, (en, th)) in enumerate(labels.items())
    ]
