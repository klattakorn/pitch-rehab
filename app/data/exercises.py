"""The exercise library, with the MediaPipe rule each movement is scored against.

Thai copy here is a first pass -- have a Thai-speaking physio review the wording
before it goes in front of players.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.services.pose.rules import EmitMetric, ExerciseRule, MetricTarget, RepDetection


@dataclass(frozen=True, slots=True)
class ExerciseDef:
    key: str
    name_en: str
    name_th: str
    category: str
    cue_en: str
    cue_th: str
    equipment: str | None = None
    #: A short clip of the movement done properly, served from web/public.
    #: Where there is one, the "how to" screen plays it instead of drawing the
    #: stick figure -- a person watching another person is a better instruction
    #: than an animation, and it is footage of the team doing their own exercise.
    #: The figure stays for the "common mistake" side, which cannot be filmed
    #: safely, and for every exercise that has no clip.
    demo_url: str | None = None
    rule: ExerciseRule | None = None


def _valgus(limit: float = 8.0, critical: bool = True) -> MetricTarget:
    return MetricTarget(
        metric="knee_valgus",
        aggregate="peak",
        max=limit,
        tolerance=2.0,
        weight=2.0,
        critical=critical,
        code="knee_valgus",
        message_en="Knee is collapsing inward — push it out over the middle toes.",
        message_th="เข่าบิดเข้าด้านใน ดันเข่าออกให้อยู่แนวนิ้วเท้ากลาง",
    )


def _pelvic_drop(limit: float = 5.0) -> MetricTarget:
    return MetricTarget(
        metric="pelvic_drop",
        aggregate="peak",
        max=limit,
        tolerance=1.5,
        weight=1.5,
        code="pelvic_drop",
        message_en="Hip is dropping on the other side — keep the pelvis level.",
        message_th="สะโพกอีกข้างตก พยายามรักษาระดับเชิงกรานให้ตรง",
    )


def _trunk(limit: float, weight: float = 1.0) -> MetricTarget:
    return MetricTarget(
        metric="trunk_lean",
        aggregate="peak",
        max=limit,
        tolerance=3.0,
        weight=weight,
        code="trunk_lean",
        message_en="Too much lean — keep the chest up.",
        message_th="ลำตัวเอนมากเกินไป ยกอกขึ้น",
    )


EXERCISES: list[ExerciseDef] = [
    # ---------------------------------------------------------------- phase 1
    ExerciseDef(
        key="isometric_quad_set",
        name_en="Isometric quadriceps set",
        name_th="เกร็งกล้ามเนื้อต้นขาด้านหน้าค้างไว้",
        category="activation",
        cue_en="Press the back of the knee down and hold. Keep the leg straight.",
        cue_th="กดหลังเข่าลงกับพื้นแล้วค้างไว้ เหยียดขาให้ตรง",
        rule=ExerciseRule(
            mode="hold",
            view="side",
            hold_target_s=10.0,
            targets=[
                MetricTarget(
                    metric="knee_flexion",
                    aggregate="peak",
                    max=8.0,
                    tolerance=2.0,
                    code="knee_not_straight",
                    message_en="Straighten the knee fully.",
                    message_th="เหยียดเข่าให้สุด",
                )
            ],
            emit=[EmitMetric(metric="knee_flexion", as_key="pose.knee_extension_lag", unit="deg")],
        ),
    ),
    ExerciseDef(
        key="glute_bridge",
        name_en="Double-leg glute bridge",
        name_th="ยกสะโพกสองขา",
        category="activation",
        cue_en="Drive through the heels, squeeze the glutes at the top.",
        cue_th="ดันส้นเท้าลง บีบก้นตอนอยู่จุดสูงสุด",
        # The clip that plays in the panel is a different person from the one the
        # thresholds below were measured on, and it is the weaker of the two
        # recordings: filmed close enough that 48 of its frames are thrown out as
        # untrusted, with a smoothed hip angle that reaches a physically
        # impossible 157 deg at one point. It is a demonstration of the movement
        # and nothing more -- no number below was read off it.
        demo_url="/demos/glute_bridge.mp4",
        rule=ExerciseRule(
            mode="rep",
            view="side",
            # Measured, finally, against 36s of real footage: six bridges filmed
            # side on, MediaPipe holding the body in 1080 of 1080 frames at 0.83
            # confidence. The numbers that were here before came from anatomy
            # rather than from a camera, and they found zero of the six.
            #
            # The mistake was assuming a good bridge reads as a straight line.
            # It does not. Filmed, this movement swings between:
            #
            #     hips down    hip_flexion  50 to 54 deg   (hip_extension -50 to -54)
            #     hips up      hip_flexion  21 to 33 deg   (hip_extension -21 to -33)
            #
            # so `enter` at -20 sat above anything a body produces.
            #
            # Two things cause that 20-33 deg, and it is worth not conflating
            # them, because they generalise differently. `hip_flexion` is the
            # shoulder-hip-knee angle, and MediaPipe puts the shoulder point at
            # the acromion, forward of and above where a supine torso really
            # pivots. That bias is measurable on this clip: at the bottom of a
            # rep the back is flat on the floor, so any tilt in the
            # shoulder-to-hip line there is pure landmark error, and against the
            # floor direction it comes to 6-13 deg depending which floor
            # reference you take. The other 13-20 deg is this person's own hip
            # extension simply not reaching straight. So these numbers are part
            # camera correction, which should hold for anyone, and part portrait
            # of one man's range, which will not. Treat them as a one-body
            # calibration, not an anatomical constant.
            #
            # That is why `enter` is not tucked in tight against the measured
            # peaks. The six reps peaked at -30.4 to -22.3, so -34 would fit
            # them with 3.6 deg to spare -- but shift the whole trace to stand
            # in for a stiffer body and -34 holds all six only from -2 to +4
            # deg, and reports *zero* at -12. That is the same silent failure
            # this change exists to fix, just waiting for a different person.
            # At -38 with the amplitude gate moved to match, the window is -6 to
            # +4. The cost is that a bridge reaching only 38 deg now counts,
            # which is a shallow rep; the benefit is that a stiff person gets a
            # count at all. Those two errors are not equal -- one is a slightly
            # generous rep, the other is an app that appears broken -- so this
            # leans toward detecting.
            #
            # exit -44: the shallowest trough reached -49.7, so 5.7 deg spare.
            # All six are found anywhere in enter -32..-40 by exit -42..-48.
            #
            # min_amplitude has to move whenever enter and exit do, and this is
            # the trap in this rule: the real gate is max(enter, exit + amplitude).
            # At -44 + 6 that is -38, so `enter` is doing the work. Leave it at
            # 10 and the gate stays at -34 no matter what `enter` says -- which
            # is exactly what the old 15 did, and why lowering `enter` alone
            # changes nothing at all.
            detection=RepDetection(
                signal="hip_extension", enter=-38.0, exit=-44.0, min_amplitude=6.0
            ),
            # Now measured too: the six reps ran 3.2-4.3s each, so the floor is
            # nowhere near them. Left at 0.8 rather than raised -- every tempo
            # floor in this file that was guessed turned out to sit above how
            # fast people really move, and refused honest reps.
            tempo_min_s=0.8,
            targets=[
                MetricTarget(
                    metric="hip_flexion",
                    aggregate="min",
                    # 34, not 12, for the acromion reason above: the worst of
                    # the six good reps read 32.9, so this sits just over it and
                    # the tolerance absorbs body-to-body variation.
                    #
                    # Be clear about which half of the job this does, because
                    # the obvious reading is wrong. Detection gates on the MEAN
                    # of the two legs; this judges the WORSE one against 34 + 5.
                    # So it only ever speaks when the legs disagree:
                    #
                    #   both hips at 36    counted, nothing said
                    #   both hips at 38    no rep at all
                    #   one at 26, other at 40 to 48    "push the hips higher"
                    #   one at 26, other at 50          no rep at all
                    #
                    # A bridge that is evenly too low is therefore never coached,
                    # it is simply not counted -- the counter sits still and the
                    # set does not advance. That is defensible for a rep counter
                    # but it is not what this message implies, so do not read a
                    # form score of 100 as "your height was good". On this
                    # movement it means "counted", nothing more.
                    #
                    # Moving the gate to -38 for the body-variation reason above
                    # widened the useful half by accident and it is worth saying
                    # so: at -34 the lagging-hip window was 40 to 41, two degrees
                    # wide, and a worse asymmetry pulled the mean past the gate
                    # so the rep vanished and nothing was said at all. At -38 it
                    # runs 40 to 48. Still bounded, but no longer a sliver.
                    #
                    # The remaining hole -- the evenly-shallow bridge -- needs
                    # detection to gate on the better leg, so the rep still
                    # exists for this target to judge. That is a change to
                    # segment_reps, which every bilateral exercise in this file
                    # shares, so it is not a thing to do on the day of a demo.
                    # Left measured and written down rather than quietly.
                    max=34.0,
                    tolerance=5.0,
                    weight=1.5,
                    code="hip_not_extended",
                    message_en="Push the hips higher until the body is in one line.",
                    message_th="ยกสะโพกให้สูงจนลำตัวเป็นเส้นตรง",
                ),
                # No pelvic-drop check here: it is a side-to-side movement and this
                # is filmed from the side, so the camera cannot see it.
            ],
            emit=[
                EmitMetric(
                    metric="hip_flexion",
                    as_key="pose.bridge_hip_extension",
                    rep_aggregate="min",
                    unit="deg",
                )
            ],
        ),
    ),
    ExerciseDef(
        key="heel_slide",
        name_en="Heel slide (knee ROM)",
        name_th="ไถส้นเท้าเพื่อเพิ่มมุมงอเข่า",
        category="mobility",
        cue_en="Slide the heel towards the buttock as far as pain allows.",
        cue_th="ไถส้นเท้าเข้าหาก้นเท่าที่ไม่เจ็บ",
        rule=ExerciseRule(
            mode="rep",
            view="side",
            detection=RepDetection(
                signal="knee_flexion", enter=30.0, exit=15.0, min_amplitude=20.0
            ),
            targets=[
                MetricTarget(
                    metric="knee_flexion",
                    aggregate="peak",
                    min=90.0,
                    tolerance=10.0,
                    code="rom_limited",
                    message_en="Aim for more knee bend.",
                    message_th="พยายามงอเข่าให้มากขึ้น",
                )
            ],
            emit=[
                EmitMetric(
                    metric="knee_flexion",
                    as_key="pose.knee_flexion_rom",
                    set_aggregate="max",
                )
            ],
        ),
    ),
    ExerciseDef(
        key="ankle_knee_to_wall",
        name_en="Knee-to-wall ankle mobility",
        name_th="ดันเข่าชนกำแพง (เพิ่มมุมกระดกข้อเท้า)",
        category="mobility",
        cue_en="Keep the heel flat, drive the knee forward over the toes.",
        cue_th="ส้นเท้าติดพื้น ดันเข่าไปข้างหน้าผ่านปลายเท้า",
        rule=ExerciseRule(
            mode="rep",
            view="side",
            detection=RepDetection(
                signal="ankle_dorsiflexion", enter=10.0, exit=3.0, min_amplitude=6.0
            ),
            targets=[
                MetricTarget(
                    metric="ankle_dorsiflexion",
                    aggregate="peak",
                    min=30.0,
                    tolerance=4.0,
                    code="dorsiflexion_limited",
                    message_en="Push the knee further forward without lifting the heel.",
                    message_th="ดันเข่าไปข้างหน้าอีก โดยส้นเท้าห้ามยก",
                ),
                MetricTarget(
                    metric="heel_raise_ratio",
                    aggregate="peak",
                    max=0.12,
                    weight=1.5,
                    critical=True,
                    code="heel_lifted",
                    message_en="Heel came off the floor — that does not count.",
                    message_th="ส้นเท้ายกขึ้น ครั้งนี้ไม่นับ",
                ),
            ],
            emit=[
                EmitMetric(
                    metric="ankle_dorsiflexion",
                    as_key="pose.ankle_dorsiflexion",
                    set_aggregate="max",
                )
            ],
        ),
    ),
    ExerciseDef(
        key="prone_hamstring_curl",
        name_en="Prone hamstring curl",
        name_th="งอเข่าท่านอนคว่ำ",
        category="strength",
        cue_en="Curl the heel up slowly, keep the hips on the floor.",
        cue_th="งอเข่ายกส้นเท้าขึ้นช้าๆ สะโพกแนบพื้น",
        rule=ExerciseRule(
            mode="rep",
            view="side",
            detection=RepDetection(
                signal="knee_flexion", enter=30.0, exit=15.0, min_amplitude=30.0
            ),
            tempo_min_s=1.5,
            targets=[
                MetricTarget(
                    metric="knee_flexion",
                    aggregate="peak",
                    min=90.0,
                    tolerance=10.0,
                    code="rom_limited",
                    message_en="Bring the heel closer to the glute.",
                    message_th="งอเข่าให้ส้นเท้าเข้าใกล้ก้นมากขึ้น",
                ),
                MetricTarget(
                    metric="hip_flexion",
                    aggregate="peak",
                    max=20.0,
                    tolerance=5.0,
                    code="hip_hitch",
                    message_en="Hips are lifting — keep them down.",
                    message_th="สะโพกยกขึ้น กดสะโพกให้แนบพื้น",
                ),
            ],
            emit=[
                EmitMetric(
                    metric="knee_flexion",
                    as_key="pose.knee_flexion_rom",
                    set_aggregate="max",
                )
            ],
        ),
    ),
    ExerciseDef(
        key="side_lying_hip_abduction",
        name_en="Side-lying hip abduction",
        name_th="นอนตะแคงกางสะโพก",
        category="activation",
        cue_en="Lift the top leg without rolling the hips back.",
        cue_th="ยกขาบนขึ้น อย่าให้สะโพกหมุนไปข้างหลัง",
        rule=ExerciseRule(
            mode="rep",
            view="front",
            detection=RepDetection(
                signal="hip_flexion", enter=15.0, exit=7.0, min_amplitude=12.0
            ),
            targets=[
                MetricTarget(
                    metric="hip_flexion",
                    aggregate="peak",
                    min=30.0,
                    tolerance=5.0,
                    code="rom_limited",
                    message_en="Lift the leg a little higher.",
                    message_th="ยกขาให้สูงขึ้นอีกนิด",
                )
            ],
        ),
    ),
    ExerciseDef(
        key="double_leg_calf_raise",
        name_en="Double-leg calf raise",
        name_th="เขย่งปลายเท้าสองขา",
        category="strength",
        cue_en="Rise as high as you can, lower under control.",
        cue_th="เขย่งขึ้นให้สูงที่สุด แล้วลงช้าๆ",
        demo_url="/demos/double_leg_calf_raise.mp4",
        rule=ExerciseRule(
            mode="rep",
            view="side",
            # Tuned against real footage with a known rep count, not guessed.
            # exit was 0.06 -- about 3 degrees of foot tilt, i.e. dead flat.
            # Nobody lowers all the way to flat between reps, so the signal
            # never crossed back down and consecutive reps merged into one.
            # 0.12 is roughly 7 degrees: clearly down, without demanding the
            # foot be pressed flat. min_amplitude falls with it, because
            # amplitude is measured from exit and leaving it high would start
            # silently discarding honest reps.
            detection=RepDetection(
                signal="heel_raise_ratio", enter=0.17, exit=0.12, min_amplitude=0.05
            ),
            # Measured, not guessed. This was 1.2s, which is slower than a real
            # calf raise: five filmed reps ran 0.80-1.17s, so every one of them
            # was found, then refused, and the counter sat at zero -- the thing
            # this whole rule was supposed to stop. The floor is not the asked-for
            # tempo, it is the line below which a movement is a bounce rather
            # than a rep, so it belongs well under the slowest honest rep.
            tempo_min_s=0.6,
            targets=[
                MetricTarget(
                    metric="heel_raise_ratio",
                    aggregate="peak",
                    min=0.42,
                    tolerance=0.05,
                    code="raise_too_low",
                    message_en="Get up higher onto the toes.",
                    message_th="เขย่งให้สูงกว่านี้",
                ),
                MetricTarget(
                    metric="knee_flexion",
                    aggregate="peak",
                    max=15.0,
                    tolerance=4.0,
                    code="knee_bend",
                    message_en="Keep the knees straight.",
                    message_th="เหยียดเข่าให้ตรง",
                ),
            ],
        ),
    ),
    ExerciseDef(
        key="single_leg_balance",
        name_en="Single-leg balance",
        name_th="ยืนขาเดียวทรงตัว",
        category="activation",
        cue_en="Stand tall on one leg, keep the pelvis level.",
        cue_th="ยืนขาเดียวให้ตัวตรง รักษาระดับเชิงกราน",
        rule=ExerciseRule(
            mode="hold",
            view="front",
            hold_target_s=30.0,
            targets=[_pelvic_drop(5.0), _trunk(8.0), _valgus(8.0, critical=False)],
            emit=[
                EmitMetric(
                    metric="pelvic_drop",
                    as_key="pose.balance_pelvic_drop",
                    rep_aggregate="peak",
                    unit="deg",
                )
            ],
        ),
    ),
    # ---------------------------------------------------------------- phase 2
    ExerciseDef(
        key="single_leg_squat",
        name_en="Single-leg squat",
        name_th="สควอทขาเดียว",
        category="strength",
        cue_en="Sit back and down on one leg. Knee tracks over the middle toes.",
        cue_th="ย่อลงบนขาเดียว ให้เข่าอยู่แนวนิ้วเท้ากลาง",
        rule=ExerciseRule(
            mode="rep",
            view="front",
            detection=RepDetection(
                signal="knee_flexion", enter=30.0, exit=15.0, min_amplitude=20.0
            ),
            tempo_min_s=1.5,
            targets=[
                MetricTarget(
                    metric="knee_flexion",
                    aggregate="peak",
                    min=60.0,
                    tolerance=5.0,
                    weight=1.5,
                    code="depth_insufficient",
                    message_en="Go deeper — aim for 60 degrees of knee bend.",
                    message_th="ย่อให้ลึกขึ้น เป้าหมายงอเข่า 60 องศา",
                ),
                _valgus(8.0),
                _pelvic_drop(5.0),
                _trunk(15.0),
            ],
            emit=[
                EmitMetric(metric="knee_flexion", as_key="pose.slsq_knee_flexion", unit="deg"),
                EmitMetric(metric="knee_valgus", as_key="pose.slsq_knee_valgus", unit="deg"),
                EmitMetric(metric="pelvic_drop", as_key="pose.slsq_pelvic_drop", unit="deg"),
            ],
        ),
    ),
    ExerciseDef(
        key="split_squat",
        name_en="Split squat",
        name_th="สควอทท่าแยกขา",
        category="strength",
        cue_en="Drop the back knee straight down, front shin close to vertical.",
        cue_th="ย่อเข่าหลังลงตรงๆ หน้าแข้งขาหน้าเกือบตั้งฉาก",
        # Filmed front-on, which is where this rule needs the camera, so the
        # clip doubles as a demonstration of where to stand the phone.
        demo_url="/demos/split_squat.mp4",
        rule=ExerciseRule(
            mode="rep",
            view="front",
            # Tuned against real footage with a known rep count, not guessed.
            # A split stance does not straighten between reps the way a squat
            # does -- it rests around 20-25 degrees, exactly where exit sat, so
            # the signal hovered on the threshold and every rep ran into the
            # next. Coming back up through 40 is a real, reliable boundary.
            # enter rises with it to keep the hysteresis gap: a rep peaking
            # under 55 is a quarter-range movement, and the depth target still
            # flags anything under 80.
            detection=RepDetection(
                signal="knee_flexion", enter=55.0, exit=40.0, min_amplitude=10.0
            ),
            # Measured. Was 1.5s; five filmed reps ran 1.07-1.30s, so all five
            # were refused on tempo alone. See the calf raise for the reasoning.
            tempo_min_s=0.8,
            targets=[
                MetricTarget(
                    metric="knee_flexion",
                    aggregate="peak",
                    min=80.0,
                    tolerance=8.0,
                    # The front leg is the one this is about. Judged the usual
                    # way -- worse limb -- it read the rear knee, which bends
                    # about half as far by design, and told a player whose front
                    # knee had hit 104 degrees to go deeper. On the filmed reps
                    # that fired on four of five and held the score at 73.
                    judge="best",
                    code="depth_insufficient",
                    message_en="Go deeper on the front leg.",
                    message_th="ย่อขาหน้าให้ลึกขึ้น",
                ),
                _valgus(10.0),
                _trunk(20.0),
            ],
        ),
    ),
    ExerciseDef(
        key="nordic_hamstring_curl",
        name_en="Nordic hamstring curl",
        name_th="นอร์ดิกแฮมสตริง",
        category="strength",
        cue_en="Lower as slowly as you can with the hips locked straight.",
        cue_th="ลดตัวลงช้าที่สุด สะโพกเหยียดตรงตลอด",
        equipment="partner or anchor for the ankles",
        rule=ExerciseRule(
            mode="rep",
            view="side",
            detection=RepDetection(
                signal="trunk_lean", enter=20.0, exit=8.0, min_amplitude=20.0
            ),
            tempo_min_s=2.5,
            targets=[
                MetricTarget(
                    metric="trunk_lean",
                    aggregate="peak",
                    min=45.0,
                    tolerance=5.0,
                    weight=1.5,
                    code="break_point_early",
                    message_en="Try to hold on further before letting go.",
                    message_th="พยายามควบคุมให้ลงได้ไกลกว่านี้",
                ),
                MetricTarget(
                    metric="hip_flexion",
                    aggregate="peak",
                    max=15.0,
                    tolerance=5.0,
                    weight=2.0,
                    critical=True,
                    code="hip_hinge",
                    message_en="You are folding at the hips — keep hips and shoulders in one line.",
                    message_th="งอที่สะโพก ให้สะโพกกับไหล่อยู่ในเส้นเดียวกัน",
                ),
            ],
            emit=[
                EmitMetric(
                    metric="trunk_lean",
                    as_key="pose.nordic_break_angle",
                    set_aggregate="max",
                    unit="deg",
                )
            ],
        ),
    ),
    ExerciseDef(
        key="single_leg_rdl",
        name_en="Single-leg Romanian deadlift",
        name_th="ดันสะโพกขาเดียว (RDL)",
        category="strength",
        cue_en="Hinge at the hip, back flat, free leg in line with the body.",
        cue_th="พับที่สะโพก หลังตรง ขาลอยอยู่แนวเดียวกับลำตัว",
        rule=ExerciseRule(
            mode="rep",
            view="side",
            detection=RepDetection(
                signal="hip_flexion", enter=30.0, exit=15.0, min_amplitude=25.0
            ),
            tempo_min_s=2.0,
            targets=[
                MetricTarget(
                    metric="hip_flexion",
                    aggregate="peak",
                    min=70.0,
                    tolerance=8.0,
                    code="hinge_shallow",
                    message_en="Hinge further forward.",
                    message_th="พับสะโพกลงให้มากขึ้น",
                ),
                MetricTarget(
                    metric="knee_flexion",
                    aggregate="peak",
                    max=30.0,
                    tolerance=6.0,
                    code="knee_bend_excess",
                    message_en="That is turning into a squat — keep the knee soft, not bent.",
                    message_th="กลายเป็นสควอท ให้เข่างอเล็กน้อยพอ",
                ),
                # Hip drop matters a lot in an RDL, but it happens across the body
                # and this is a side-on movement. Scoring it here would invent a
                # number. Worth a second, front-on variant of this exercise.
            ],
            emit=[EmitMetric(metric="hip_flexion", as_key="pose.rdl_hip_hinge", unit="deg")],
        ),
    ),
    ExerciseDef(
        key="single_leg_calf_raise",
        name_en="Single-leg calf raise",
        name_th="เขย่งปลายเท้าขาเดียว",
        category="strength",
        cue_en="Full height every rep, lower slowly.",
        cue_th="เขย่งให้สุดทุกครั้ง ลงช้าๆ",
        rule=ExerciseRule(
            mode="rep",
            view="side",
            # Same numbers as the double-leg version, for the same reason --
            # it is the same movement on one foot, and the old exit of 0.06
            # asked for a flat foot nobody returns to between reps. Only the
            # double-leg version was checked against real footage; this one
            # follows it on the reasoning rather than on evidence of its own.
            detection=RepDetection(
                signal="heel_raise_ratio", enter=0.17, exit=0.12, min_amplitude=0.05
            ),
            # Same movement as the double-leg version, same floor. See there.
            tempo_min_s=0.6,
            targets=[
                MetricTarget(
                    metric="heel_raise_ratio",
                    aggregate="peak",
                    min=0.45,
                    tolerance=0.05,
                    weight=1.5,
                    code="raise_too_low",
                    message_en="Not high enough — that rep does not count.",
                    message_th="เขย่งไม่สูงพอ ครั้งนี้ไม่นับ",
                    critical=True,
                ),
                MetricTarget(
                    metric="knee_flexion",
                    aggregate="peak",
                    max=15.0,
                    tolerance=4.0,
                    code="knee_bend",
                    message_en="Keep the knee straight.",
                    message_th="เหยียดเข่าให้ตรง",
                ),
            ],
            emit=[
                EmitMetric(
                    metric="heel_raise_ratio",
                    as_key="pose.calf_raise_height",
                    unit="ratio",
                )
            ],
        ),
    ),
    ExerciseDef(
        key="copenhagen_plank",
        name_en="Copenhagen adduction plank",
        name_th="โคเปนเฮเกนแพลงก์ (กล้ามเนื้อขาหนีบ)",
        category="strength",
        cue_en="Top leg on the bench, lift the hips until the body is one straight line.",
        cue_th="วางขาบนบนม้านั่ง ยกสะโพกจนลำตัวเป็นเส้นตรง",
        equipment="bench or partner",
        rule=ExerciseRule(
            mode="hold",
            view="front",
            hold_target_s=20.0,
            targets=[
                MetricTarget(
                    metric="trunk_lean",
                    aggregate="mean",
                    min=60.0,
                    max=120.0,
                    tolerance=10.0,
                    code="body_not_horizontal",
                    message_en="Keep the body horizontal.",
                    message_th="รักษาลำตัวให้ขนานกับพื้น",
                ),
                MetricTarget(
                    metric="hip_flexion",
                    aggregate="peak",
                    max=20.0,
                    tolerance=6.0,
                    weight=1.5,
                    code="hip_sag",
                    message_en="Hips are sagging — lift them back into line.",
                    message_th="สะโพกตก ยกขึ้นให้เป็นเส้นตรง",
                ),
            ],
            emit=[
                EmitMetric(
                    metric="hold_seconds",
                    as_key="pose.copenhagen_hold",
                    rep_aggregate="max",
                    set_aggregate="max",
                    unit="s",
                )
            ],
        ),
    ),
    ExerciseDef(
        key="wall_sit",
        name_en="Wall sit",
        name_th="นั่งพิงกำแพง",
        category="strength",
        cue_en="Thighs parallel to the floor, back flat on the wall.",
        cue_th="ต้นขาขนานพื้น หลังแนบกำแพง",
        rule=ExerciseRule(
            mode="hold",
            view="side",
            hold_target_s=45.0,
            targets=[
                MetricTarget(
                    metric="knee_flexion",
                    aggregate="mean",
                    min=80.0,
                    max=110.0,
                    tolerance=8.0,
                    code="knee_angle_off",
                    message_en="Aim for about 90 degrees at the knee.",
                    message_th="ให้มุมเข่าประมาณ 90 องศา",
                )
            ],
        ),
    ),
    ExerciseDef(
        key="step_down",
        name_en="Lateral step-down",
        name_th="ก้าวลงจากกล่องด้านข้าง",
        category="strength",
        cue_en="Lower slowly until the other heel taps the floor.",
        cue_th="ย่อลงช้าๆ จนส้นเท้าอีกข้างแตะพื้น",
        equipment="step / box 20-30cm",
        rule=ExerciseRule(
            mode="rep",
            view="front",
            detection=RepDetection(
                signal="knee_flexion", enter=25.0, exit=12.0, min_amplitude=18.0
            ),
            tempo_min_s=2.0,
            targets=[
                MetricTarget(
                    metric="knee_flexion",
                    aggregate="peak",
                    min=50.0,
                    tolerance=6.0,
                    code="depth_insufficient",
                    message_en="Lower a little further.",
                    message_th="ย่อลงให้ลึกขึ้นอีกนิด",
                ),
                _valgus(8.0),
                _pelvic_drop(6.0),
                _trunk(20.0),
            ],
            emit=[EmitMetric(metric="knee_valgus", as_key="pose.stepdown_knee_valgus", unit="deg")],
        ),
    ),
    ExerciseDef(
        key="side_plank",
        name_en="Side plank",
        name_th="แพลงก์ด้านข้าง",
        category="strength",
        cue_en="Straight line from ear to ankle, hips high.",
        cue_th="ลำตัวเป็นเส้นตรงจากหูถึงข้อเท้า ยกสะโพกสูง",
        rule=ExerciseRule(
            mode="hold",
            view="front",
            hold_target_s=30.0,
            targets=[
                MetricTarget(
                    metric="hip_flexion",
                    aggregate="peak",
                    max=20.0,
                    tolerance=6.0,
                    code="hip_sag",
                    message_en="Hips dropping — push them up.",
                    message_th="สะโพกตก ดันขึ้น",
                )
            ],
        ),
    ),
    # ---------------------------------------------------------------- phase 3
    ExerciseDef(
        key="pogo_hops",
        name_en="Pogo hops",
        name_th="กระโดดสปริงข้อเท้า",
        category="plyo",
        cue_en="Fast, springy hops off the ankles. Knees stay fairly stiff.",
        cue_th="กระโดดถี่ๆ ใช้ข้อเท้าสปริง เข่าเกือบตรง",
        rule=ExerciseRule(
            mode="rep",
            view="front",
            detection=RepDetection(
                signal="knee_flexion",
                enter=18.0,
                exit=8.0,
                min_amplitude=5.0,
                min_duration_s=0.12,
                max_duration_s=2.0,
            ),
            targets=[
                MetricTarget(
                    metric="knee_flexion",
                    aggregate="peak",
                    max=45.0,
                    tolerance=8.0,
                    code="too_much_knee",
                    message_en="Bounce off the ankles, not the knees.",
                    message_th="ใช้ข้อเท้าสปริง ไม่ใช่ย่อเข่า",
                ),
                _valgus(10.0, critical=False),
            ],
        ),
    ),
    ExerciseDef(
        key="spanish_squat",
        name_en="Spanish squat (isometric hold)",
        name_th="สแปนิชสควอทค้างไว้",
        category="strength",
        cue_en="Sit back against a band at knee height, shins vertical, hold.",
        cue_th="ย่อตัวโดยมียางยืดคล้องใต้เข่า หน้าแข้งตั้งฉาก แล้วค้างไว้",
        equipment="strong resistance band anchored at knee height",
        rule=ExerciseRule(
            mode="hold",
            view="side",
            hold_target_s=45.0,
            targets=[
                MetricTarget(
                    metric="knee_flexion",
                    aggregate="mean",
                    min=60.0,
                    max=95.0,
                    tolerance=8.0,
                    code="knee_angle_off",
                    message_en="Aim for roughly 70-80 degrees at the knee.",
                    message_th="ให้มุมเข่าประมาณ 70-80 องศา",
                ),
                MetricTarget(
                    metric="trunk_lean",
                    aggregate="peak",
                    max=25.0,
                    tolerance=6.0,
                    code="trunk_lean",
                    message_en="Keep the chest up and the shins vertical.",
                    message_th="ยกอกขึ้น และให้หน้าแข้งตั้งฉาก",
                ),
            ],
            emit=[
                EmitMetric(
                    metric="hold_seconds",
                    as_key="pose.spanish_squat_hold",
                    rep_aggregate="max",
                    set_aggregate="max",
                    unit="s",
                )
            ],
        ),
    ),
    ExerciseDef(
        key="decline_squat",
        name_en="Single-leg decline squat",
        name_th="สควอทขาเดียวบนพื้นเอียง",
        category="strength",
        cue_en="On a decline board, lower slowly on one leg. Some tendon pain is fine.",
        cue_th="ยืนบนแผ่นเอียง ย่อขาเดียวลงช้าๆ ปวดเอ็นเล็กน้อยได้",
        equipment="25 degree decline board",
        rule=ExerciseRule(
            mode="rep",
            view="side",
            detection=RepDetection(
                signal="knee_flexion", enter=25.0, exit=12.0, min_amplitude=18.0
            ),
            tempo_min_s=3.0,
            targets=[
                MetricTarget(
                    metric="knee_flexion",
                    aggregate="peak",
                    min=55.0,
                    tolerance=6.0,
                    weight=1.5,
                    code="depth_insufficient",
                    message_en="Lower further — the tendon needs the range.",
                    message_th="ย่อลงให้ลึกขึ้น เอ็นต้องการช่วงการเคลื่อนไหวนี้",
                ),
                MetricTarget(
                    metric="trunk_lean",
                    aggregate="peak",
                    max=22.0,
                    tolerance=5.0,
                    code="trunk_lean",
                    message_en="Too much lean — that shifts load off the tendon.",
                    message_th="เอนตัวมากเกินไป ทำให้แรงไม่ลงที่เอ็น",
                ),
            ],
            emit=[
                EmitMetric(
                    metric="knee_flexion",
                    as_key="pose.decline_squat_depth",
                    unit="deg",
                )
            ],
        ),
    ),
    ExerciseDef(
        key="adductor_squeeze",
        name_en="Isometric adductor squeeze",
        name_th="บีบขาหนีบค้างไว้",
        category="activation",
        cue_en="Ball between the knees, squeeze and hold. Pain up to 4/10 is acceptable.",
        cue_th="หนีบลูกบอลระหว่างเข่า บีบค้างไว้ ปวดได้ถึง 4/10",
        equipment="football or small ball",
    ),
    ExerciseDef(
        key="single_leg_hop_landing",
        name_en="Single-leg hop and stick",
        name_th="กระโดดขาเดียวและหยุดนิ่ง",
        category="plyo",
        cue_en="Hop forward and stick the landing for two seconds without wobbling.",
        cue_th="กระโดดไปข้างหน้าแล้วลงน้ำหนักค้างไว้ 2 วินาที ห้ามเซ",
        rule=ExerciseRule(
            mode="rep",
            view="front",
            detection=RepDetection(
                signal="knee_flexion",
                enter=20.0,
                exit=10.0,
                min_amplitude=12.0,
                min_duration_s=0.2,
            ),
            targets=[
                MetricTarget(
                    metric="knee_flexion",
                    aggregate="peak",
                    min=45.0,
                    tolerance=6.0,
                    weight=1.5,
                    code="stiff_landing",
                    message_en="Absorb the landing — bend the knee more.",
                    message_th="ซับแรงตอนลง งอเข่าให้มากขึ้น",
                ),
                _valgus(8.0),
                _trunk(18.0),
            ],
            emit=[
                EmitMetric(metric="knee_valgus", as_key="pose.landing_knee_valgus", unit="deg"),
                EmitMetric(
                    metric="knee_flexion", as_key="pose.landing_knee_flexion", unit="deg"
                ),
            ],
        ),
    ),
    ExerciseDef(
        key="lateral_bound",
        name_en="Lateral bound and stick",
        name_th="กระโดดออกข้างและหยุดนิ่ง",
        category="plyo",
        cue_en="Push sideways off one leg, land on the other and hold.",
        cue_th="ถีบออกด้านข้างด้วยขาหนึ่ง ลงอีกขาแล้วค้างไว้",
        rule=ExerciseRule(
            mode="rep",
            view="front",
            detection=RepDetection(
                signal="knee_flexion",
                enter=22.0,
                exit=10.0,
                min_amplitude=12.0,
                min_duration_s=0.2,
            ),
            targets=[
                MetricTarget(
                    metric="knee_flexion",
                    aggregate="peak",
                    min=40.0,
                    tolerance=6.0,
                    code="stiff_landing",
                    message_en="Bend the knee to absorb the landing.",
                    message_th="งอเข่าเพื่อซับแรงตอนลง",
                ),
                _valgus(8.0),
                _pelvic_drop(7.0),
            ],
            emit=[
                EmitMetric(
                    metric="knee_valgus", as_key="pose.landing_knee_valgus", unit="deg"
                )
            ],
        ),
    ),
    ExerciseDef(
        key="deceleration_drill",
        name_en="Deceleration drill",
        name_th="ฝึกชะลอความเร็ว",
        category="running",
        cue_en="Build to 70% pace over 15m then stop in three steps.",
        cue_th="เร่งถึง 70% ระยะ 15 เมตร แล้วหยุดภายในสามก้าว",
    ),
    ExerciseDef(
        key="change_of_direction_45",
        name_en="45-degree cutting drill",
        name_th="ฝึกเปลี่ยนทิศ 45 องศา",
        category="running",
        cue_en="Plant and cut at 45 degrees, both directions.",
        cue_th="ปักเท้าและเปลี่ยนทิศ 45 องศา ทั้งสองข้าง",
    ),
    ExerciseDef(
        key="progressive_running",
        name_en="Progressive running block",
        name_th="โปรแกรมวิ่งแบบไล่ระดับ",
        category="running",
        cue_en="Run at the prescribed percentage of your max speed. Log it from your watch.",
        cue_th="วิ่งตามเปอร์เซ็นต์ความเร็วที่กำหนด แล้วบันทึกจากนาฬิกา",
    ),
    # ---------------------------------------------------------------- phase 4
    ExerciseDef(
        key="repeated_sprint",
        name_en="Repeated sprint ability",
        name_th="วิ่งเร็วซ้ำหลายเที่ยว",
        category="running",
        cue_en="6 x 30m maximal sprints, 30s recovery.",
        cue_th="วิ่งเร็วสุด 6 เที่ยว เที่ยวละ 30 เมตร พัก 30 วินาที",
    ),
    ExerciseDef(
        key="reactive_agility",
        name_en="Reactive agility with ball",
        name_th="ความคล่องตัวแบบมีสิ่งเร้า พร้อมลูกบอล",
        category="running",
        cue_en="React to a partner's cue while controlling the ball.",
        cue_th="ตอบสนองต่อสัญญาณของเพื่อนขณะควบคุมลูกบอล",
    ),
    ExerciseDef(
        key="goalkeeper_dive_landing",
        name_en="Goalkeeper dive and landing",
        name_th="ผู้รักษาประตู: พุ่งและลงพื้น",
        category="plyo",
        cue_en="Dive both sides, land on the side of the hip, not the elbow.",
        cue_th="พุ่งทั้งสองข้าง ลงด้วยด้านข้างสะโพก ไม่ใช่ข้อศอก",
    ),
    ExerciseDef(
        key="heading_jump",
        name_en="Two-footed heading jump",
        name_th="กระโดดโหม่งสองเท้า",
        category="plyo",
        cue_en="Jump, head an imaginary ball, land soft on both feet.",
        cue_th="กระโดดโหม่งลูกสมมติ ลงพื้นสองเท้าแบบนุ่มนวล",
        rule=ExerciseRule(
            mode="rep",
            view="front",
            detection=RepDetection(
                signal="knee_flexion",
                enter=25.0,
                exit=12.0,
                min_amplitude=15.0,
                min_duration_s=0.25,
            ),
            targets=[
                MetricTarget(
                    metric="knee_flexion",
                    aggregate="peak",
                    min=45.0,
                    tolerance=8.0,
                    code="stiff_landing",
                    message_en="Land softer — bend the knees.",
                    message_th="ลงพื้นให้นุ่มขึ้น งอเข่า",
                ),
                _valgus(10.0),
            ],
        ),
    ),
]

EXERCISES_BY_KEY: dict[str, ExerciseDef] = {e.key: e for e in EXERCISES}
