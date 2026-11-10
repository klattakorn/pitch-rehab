"""Phase one, fitted to who is doing it: age group x injury x position.

Five movements have been checked against real footage (see ``_fixed_phase_one``
in ``protocols.py``). Nobody is given all five. Each player gets the three or
four that suit them, at a dose that suits their age, and every choice carries
the sentence that explains it -- the app shows those sentences, so a player (or
a judge) can see *why* their plan differs from the next person's.

Three rules, applied in this order:

1. **Injury** can rule one movement out, and names the one that matters most.
2. **Age** can rule one out (jumping after 40) and sets the dose.
3. **Position** picks the movement that gets an extra set, and -- only when
   nothing above removed anything -- drops the one that role needs least.

The order matters: safety first, then relevance. A position can never bring
back something an injury or an age ruled out.

This is a demonstration of the mechanism on five movements, not a clinical
guideline. The reasons are the ordinary ones a physio would give, kept to what
is uncontroversial: no jumping on a healing graft or sprain, no long split
stance on a strained groin, lighter and slower loading at the two ends of the
age range.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.core.enums import AgeGroup, InjurySite, Position

CALF = "double_leg_calf_raise"
WALL = "wall_sit"
SPLIT = "split_squat"
BRIDGE = "glute_bridge"
POGO = "pogo_hops"

#: Display order, and the adult dose every other dose is derived from.
MOVES: tuple[str, ...] = (CALF, WALL, SPLIT, BRIDGE, POGO)

MOVE_NAMES: dict[str, tuple[str, str]] = {
    CALF: ("Calf raise", "เขย่งปลายเท้า"),
    WALL: ("Wall sit", "นั่งพิงกำแพง"),
    SPLIT: ("Split squat", "สปลิทสควอท"),
    BRIDGE: ("Glute bridge", "ยกสะโพก"),
    POGO: ("Pogo hops", "กระโดดสปริงข้อเท้า"),
}


@dataclass(frozen=True, slots=True)
class Text:
    en: str
    th: str


@dataclass(frozen=True, slots=True)
class Pick:
    """One movement singled out, and the sentence that says why."""

    move: str
    why: Text


@dataclass(frozen=True, slots=True)
class InjuryRule:
    key_move: Pick
    avoid: Pick | None = None


@dataclass(frozen=True, slots=True)
class PositionRule:
    #: Gets an extra set. Falls through to ``fallback`` if ``focus`` is ruled out.
    focus: Pick
    fallback: Pick
    #: Dropped only when injury and age removed nothing.
    least: Pick


@dataclass(frozen=True, slots=True)
class AgeRule:
    label: Text
    dose: Text
    avoid: Pick | None = None


_NO_JUMP_GRAFT = Text(
    "no jumping on a healing ACL graft",
    "ยังไม่กระโดดขณะที่เอ็นไขว้หน้ากำลังสมาน",
)

INJURY_RULES: dict[InjurySite, InjuryRule] = {
    InjurySite.HAMSTRING: InjuryRule(
        key_move=Pick(
            BRIDGE,
            Text(
                "works the hamstring without stretching the tear",
                "ใช้กล้ามเนื้อต้นขาด้านหลังโดยไม่ยืดจุดที่ฉีก",
            ),
        ),
    ),
    InjurySite.ACL: InjuryRule(
        key_move=Pick(
            WALL,
            Text(
                "rebuilds the quads, which waste fast after ACL surgery",
                "ฟื้นกล้ามเนื้อต้นขาด้านหน้าที่ลีบเร็วหลังผ่าตัดเอ็นไขว้หน้า",
            ),
        ),
        avoid=Pick(POGO, _NO_JUMP_GRAFT),
    ),
    InjurySite.PATELLAR_TENDINOPATHY: InjuryRule(
        key_move=Pick(
            WALL,
            Text(
                "a long static hold is what settles tendon pain",
                "การเกร็งค้างนานช่วยลดอาการปวดเอ็น",
            ),
        ),
        avoid=Pick(
            POGO,
            Text(
                "jumping is what irritates this tendon",
                "การกระโดดคือสิ่งที่ทำให้เอ็นนี้อักเสบ",
            ),
        ),
    ),
    InjurySite.ANKLE: InjuryRule(
        key_move=Pick(
            CALF,
            Text(
                "rebuilds calf strength and ankle control",
                "ฟื้นแรงน่องและการควบคุมข้อเท้า",
            ),
        ),
        avoid=Pick(
            POGO,
            Text(
                "no hopping on a sprained ankle yet",
                "ยังไม่กระโดดบนข้อเท้าที่แพลง",
            ),
        ),
    ),
    InjurySite.ADDUCTOR: InjuryRule(
        key_move=Pick(
            BRIDGE,
            Text(
                "hip strength with the legs kept in line",
                "เสริมแรงสะโพกโดยขาอยู่ในแนวตรง",
            ),
        ),
        avoid=Pick(
            SPLIT,
            Text(
                "a long split stance stretches the strained groin muscle",
                "ท่ายืนแยกขายาวจะยืดกล้ามเนื้อขาหนีบที่บาดเจ็บ",
            ),
        ),
    ),
    InjurySite.GROIN: InjuryRule(
        key_move=Pick(
            BRIDGE,
            Text(
                "loads the hips without pulling on the groin",
                "ลงน้ำหนักที่สะโพกโดยไม่ดึงขาหนีบ",
            ),
        ),
        avoid=Pick(
            POGO,
            Text(
                "repeated impact aggravates long-standing groin pain",
                "แรงกระแทกซ้ำๆ ทำให้อาการปวดขาหนีบเรื้อรังแย่ลง",
            ),
        ),
    ),
    InjurySite.CALF: InjuryRule(
        key_move=Pick(
            CALF,
            Text(
                "the calf itself, loaded slowly",
                "ลงน้ำหนักที่น่องโดยตรงอย่างช้าๆ",
            ),
        ),
        avoid=Pick(
            POGO,
            Text(
                "hopping loads the calf and Achilles hardest of all",
                "การกระโดดลงน้ำหนักที่น่องและเอ็นร้อยหวายมากที่สุด",
            ),
        ),
    ),
}

POSITION_RULES: dict[Position, PositionRule] = {
    Position.GOALKEEPER: PositionRule(
        focus=Pick(
            POGO,
            Text("keepers need spring for dives and high balls", "ผู้รักษาประตูต้องใช้แรงสปริงในการพุ่งและขึ้นรับลูกโด่ง"),
        ),
        fallback=Pick(
            WALL,
            Text("a keeper's set position is a held squat", "ท่าเตรียมของผู้รักษาประตูคือการย่อค้าง"),
        ),
        least=Pick(
            CALF,
            Text("keepers run the least of any position", "ผู้รักษาประตูวิ่งน้อยที่สุดในทุกตำแหน่ง"),
        ),
    ),
    Position.CENTRE_BACK: PositionRule(
        focus=Pick(
            SPLIT,
            Text("single-leg strength for duels and headers", "แรงขาข้างเดียวสำหรับการเข้าปะทะและโหม่ง"),
        ),
        fallback=Pick(
            BRIDGE,
            Text("hip power for jumping to head the ball", "แรงสะโพกสำหรับกระโดดโหม่ง"),
        ),
        least=Pick(
            WALL,
            Text("a centre-back moves in short bursts, not long holds", "กองหลังตัวกลางเคลื่อนที่เป็นช่วงสั้นๆ ไม่ใช่เกร็งค้างนาน"),
        ),
    ),
    Position.FULL_BACK: PositionRule(
        focus=Pick(
            CALF,
            Text("up and down the line all game, the calves take the load", "วิ่งขึ้นลงริมเส้นทั้งเกม น่องรับภาระมากที่สุด"),
        ),
        fallback=Pick(
            BRIDGE,
            Text("hip drive for repeated sprints", "แรงสะโพกสำหรับการสปรินต์ซ้ำๆ"),
        ),
        least=Pick(
            WALL,
            Text("a full-back's work is running, not static holds", "งานของแบ็กคือการวิ่ง ไม่ใช่การเกร็งค้าง"),
        ),
    ),
    Position.CENTRE_MIDFIELD: PositionRule(
        focus=Pick(
            WALL,
            Text("leg endurance for the most running on the pitch", "ความทนทานของขาสำหรับตำแหน่งที่วิ่งมากที่สุดในสนาม"),
        ),
        fallback=Pick(
            SPLIT,
            Text("single-leg strength for turning under pressure", "แรงขาข้างเดียวสำหรับการหมุนตัวภายใต้แรงกดดัน"),
        ),
        least=Pick(
            POGO,
            Text("the least explosive role on the pitch", "ตำแหน่งที่ใช้แรงระเบิดน้อยที่สุดในสนาม"),
        ),
    ),
    Position.WINGER: PositionRule(
        focus=Pick(
            POGO,
            Text("wingers live on an explosive first step", "ปีกต้องอาศัยก้าวแรกที่ระเบิดแรง"),
        ),
        fallback=Pick(
            CALF,
            Text("the calves are the push-off in every sprint", "น่องคือแรงส่งในทุกการสปรินต์"),
        ),
        least=Pick(
            WALL,
            Text("a winger's work is sprinting, not static holds", "งานของปีกคือการสปรินต์ ไม่ใช่การเกร็งค้าง"),
        ),
    ),
    Position.STRIKER: PositionRule(
        focus=Pick(
            BRIDGE,
            Text("hip drive for sprinting and shooting", "แรงสะโพกสำหรับการสปรินต์และการยิง"),
        ),
        fallback=Pick(
            SPLIT,
            Text("single-leg strength for holding off defenders", "แรงขาข้างเดียวสำหรับการบังบอลจากกองหลัง"),
        ),
        least=Pick(
            WALL,
            Text("a striker's work is short and explosive", "งานของกองหน้าสั้นและระเบิดแรง"),
        ),
    ),
}

AGE_RULES: dict[AgeGroup, AgeRule] = {
    AgeGroup.YOUTH: AgeRule(
        label=Text("Under 18", "ต่ำกว่า 18 ปี"),
        dose=Text(
            "Two sets instead of three, and shorter holds: growing bones and "
            "tendons recover best from small, frequent doses.",
            "ทำ 2 เซ็ตแทน 3 เซ็ต และเกร็งค้างสั้นลง เพราะกระดูกและเอ็นที่กำลังโตฟื้นตัวได้ดีที่สุดจากปริมาณน้อยแต่บ่อย",
        ),
    ),
    AgeGroup.ADULT: AgeRule(
        label=Text("18–39", "18–39 ปี"),
        dose=Text(
            "The standard dose: three sets, full reps.",
            "ปริมาณมาตรฐาน: 3 เซ็ต ครบจำนวนครั้ง",
        ),
    ),
    AgeGroup.SENIOR: AgeRule(
        label=Text("40+", "40 ปีขึ้นไป"),
        dose=Text(
            "Fewer reps, slower tempo and 90 seconds of rest: muscle and "
            "tendon recover more slowly after 40.",
            "จำนวนครั้งน้อยลง จังหวะช้าลง และพัก 90 วินาที เพราะกล้ามเนื้อและเอ็นฟื้นตัวช้าลงหลังอายุ 40",
        ),
        avoid=Pick(
            POGO,
            Text(
                "tendons lose their spring after 40, so jumping waits for a later phase",
                "เอ็นยืดหยุ่นน้อยลงหลังอายุ 40 จึงเลื่อนการกระโดดไปเฟสถัดไป",
            ),
        ),
    ),
}


@dataclass(frozen=True, slots=True)
class Dose:
    sets: int
    reps: int | None = None
    hold_seconds: float | None = None
    rest_seconds: int = 60
    tempo: str | None = None


#: Adult dose first; youth and senior are written out rather than computed, so
#: every number a player is shown is one somebody chose.
DOSES: dict[str, dict[AgeGroup, Dose]] = {
    CALF: {
        AgeGroup.YOUTH: Dose(sets=2, reps=12, tempo="2-0-2-0"),
        AgeGroup.ADULT: Dose(sets=3, reps=12, tempo="2-0-2-0"),
        AgeGroup.SENIOR: Dose(sets=3, reps=10, rest_seconds=90, tempo="3-0-3-0"),
    },
    WALL: {
        AgeGroup.YOUTH: Dose(sets=2, hold_seconds=30),
        AgeGroup.ADULT: Dose(sets=3, hold_seconds=45),
        AgeGroup.SENIOR: Dose(sets=3, hold_seconds=30, rest_seconds=90),
    },
    SPLIT: {
        AgeGroup.YOUTH: Dose(sets=2, reps=8, tempo="2-0-2-0"),
        AgeGroup.ADULT: Dose(sets=3, reps=8, tempo="2-0-2-0"),
        AgeGroup.SENIOR: Dose(sets=3, reps=6, rest_seconds=90, tempo="3-0-3-0"),
    },
    BRIDGE: {
        AgeGroup.YOUTH: Dose(sets=2, reps=12, tempo="2-0-2-0"),
        AgeGroup.ADULT: Dose(sets=3, reps=12, tempo="2-0-2-0"),
        AgeGroup.SENIOR: Dose(sets=3, reps=10, rest_seconds=90, tempo="3-0-3-0"),
    },
    POGO: {
        AgeGroup.YOUTH: Dose(sets=2, reps=10),
        AgeGroup.ADULT: Dose(sets=3, reps=10),
        # Never prescribed -- AGE_RULES rules it out -- but a dose table with a
        # hole in it is a KeyError waiting for the day that rule changes.
        AgeGroup.SENIOR: Dose(sets=2, reps=8, rest_seconds=90),
    },
}

#: What the wall-sit test asks for. Always under the prescribed hold, so the
#: test can be passed inside an ordinary set.
WALL_SIT_TEST_S: dict[AgeGroup, int] = {
    AgeGroup.YOUTH: 20,
    AgeGroup.ADULT: 30,
    AgeGroup.SENIOR: 20,
}


@dataclass(frozen=True, slots=True)
class LeftOut:
    move: str
    why: Text


@dataclass(frozen=True, slots=True)
class Chosen:
    move: str
    dose: Dose
    #: Why this movement stands out for this player; None for an ordinary one.
    note: Text | None


@dataclass(frozen=True, slots=True)
class Tailored:
    age_group: AgeGroup
    chosen: tuple[Chosen, ...]
    left_out: tuple[LeftOut, ...]
    dose: Text

    @property
    def moves(self) -> tuple[str, ...]:
        return tuple(c.move for c in self.chosen)


def _sentence(text: str) -> str:
    return text[:1].upper() + text[1:]


def tailor(position: Position, site: InjurySite, age: AgeGroup) -> Tailored:
    """The phase-one selection for one player. Pure: same inputs, same plan."""
    injury = INJURY_RULES[site]
    role = POSITION_RULES[position]
    years = AGE_RULES[age]

    left_out: dict[str, Text] = {}
    if injury.avoid:
        left_out[injury.avoid.move] = injury.avoid.why
    if years.avoid and years.avoid.move not in left_out:
        left_out[years.avoid.move] = years.avoid.why
    # Position only trims when safety trimmed nothing, and never the movement
    # the injury most needs.
    if not left_out and role.least.move != injury.key_move.move:
        left_out[role.least.move] = role.least.why

    focus = next(
        (p for p in (role.focus, role.fallback) if p.move not in left_out),
        None,
    )

    chosen: list[Chosen] = []
    for move in MOVES:
        if move in left_out:
            continue
        dose = DOSES[move][age]
        en: list[str] = []
        th: list[str] = []
        if move == injury.key_move.move:
            en.append(f"Key move for this injury: {injury.key_move.why.en}.")
            th.append(f"ท่าหลักสำหรับอาการบาดเจ็บนี้: {injury.key_move.why.th}")
        if focus and move == focus.move:
            dose = Dose(
                sets=dose.sets + 1,
                reps=dose.reps,
                hold_seconds=dose.hold_seconds,
                rest_seconds=dose.rest_seconds,
                tempo=dose.tempo,
            )
            en.append(f"Extra set for your position: {focus.why.en}.")
            th.append(f"เพิ่ม 1 เซ็ตสำหรับตำแหน่งของคุณ: {focus.why.th}")
        note = Text(" ".join(en), " ".join(th)) if en else None
        chosen.append(Chosen(move=move, dose=dose, note=note))

    return Tailored(
        age_group=age,
        chosen=tuple(chosen),
        left_out=tuple(
            LeftOut(move, Text(_sentence(why.en) + ".", why.th))
            for move, why in left_out.items()
        ),
        dose=years.dose,
    )
