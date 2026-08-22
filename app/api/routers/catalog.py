from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.deps import DbSession
from app.core.enums import InjurySite, PhaseKey, Position
from app.models.protocol import Exercise, Protocol, ProtocolPhase
from app.schemas.protocol import ExerciseOut, ProtocolOut, ProtocolSummaryOut

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
