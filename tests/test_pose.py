from __future__ import annotations

import pytest

from app.core.enums import Side
from app.services.pose.analyzer import WrongCameraView, analyze_set, segment_reps
from app.services.pose.geometry import Frame, compute_metrics, detect_view
from app.services.pose.landmarks import LM
from app.services.pose.rules import ExerciseRule, MetricTarget, RepDetection
from tests.factories import build_frame, squat_trace


def _slsq_rule() -> ExerciseRule:
    from app.data.exercises import EXERCISES_BY_KEY

    rule = EXERCISES_BY_KEY["single_leg_squat"].rule
    assert rule is not None
    return rule


@pytest.mark.parametrize("flexion", [0.0, 30.0, 60.0, 90.0, 120.0])
def test_knee_flexion_matches_the_pose_it_was_built_from(flexion: float) -> None:
    frame = build_frame(0.0, flexion, sagittal_axis="x")
    metrics = compute_metrics(frame, Side.LEFT)
    assert metrics["knee_flexion"] == pytest.approx(flexion, abs=0.5)
    assert metrics["knee_extension"] == pytest.approx(-flexion, abs=0.5)


@pytest.mark.parametrize("flexion", [0.0, 60.0, 120.0])
def test_front_view_needs_depth_to_see_flexion_at_all(flexion: float) -> None:
    """The reason front-view rules default to ``use_z=True``."""
    frame = build_frame(0.0, flexion, sagittal_axis="z")
    assert compute_metrics(frame, Side.LEFT, use_z=True)["knee_flexion"] == pytest.approx(
        flexion, abs=0.5
    )
    # Without depth the same pose looks like a straight leg.
    assert compute_metrics(frame, Side.LEFT, use_z=False)["knee_flexion"] < 2.0


def test_trunk_lean_matches_the_pose() -> None:
    frame = build_frame(0.0, 40.0, trunk_lean_deg=18.0, sagittal_axis="x")
    assert compute_metrics(frame, Side.LEFT)["trunk_lean"] == pytest.approx(18.0, abs=1.0)


def test_a_deep_squat_is_not_mistaken_for_valgus() -> None:
    metrics = compute_metrics(build_frame(0.0, 90.0), Side.LEFT, use_z=True)
    assert abs(metrics["knee_valgus"]) < 1.0


def test_knee_shifted_toward_midline_reads_as_positive_valgus() -> None:
    metrics = compute_metrics(build_frame(0.0, 45.0, valgus_shift=0.03), Side.LEFT, use_z=True)
    assert metrics["knee_valgus"] > 4.0


def test_knee_shifted_away_from_midline_reads_as_varus() -> None:
    metrics = compute_metrics(build_frame(0.0, 45.0, valgus_shift=-0.03), Side.LEFT, use_z=True)
    assert metrics["knee_valgus"] < -4.0


def test_segment_reps_uses_hysteresis_to_ignore_threshold_chatter() -> None:
    times = [i * 0.1 for i in range(40)]
    # One clean rep, then wobble that crosses `enter` twice without ever falling
    # back under `exit` -- that is one movement, not three.
    signal = (
        [5, 20, 45, 60, 45, 20, 5]
        + [16, 31, 16, 31, 16]
        + [25, 55, 70, 55, 25, 5]
        + [5] * 22
    )
    windows = segment_reps(
        times, signal, enter=30, exit_=15, min_duration_s=0.2, max_duration_s=10, min_amplitude=10
    )
    assert len(windows) == 2


def test_clean_single_leg_squat_passes() -> None:
    analysis = analyze_set(squat_trace(reps=5, peak_flexion=75.0), _slsq_rule(), Side.LEFT)
    assert analysis.completed_reps == 5
    assert analysis.valid_reps == 5
    assert analysis.form_score > 90
    assert analysis.warnings == []


def test_shallow_squat_flags_depth_but_still_counts_the_rep() -> None:
    analysis = analyze_set(squat_trace(reps=3, peak_flexion=42.0), _slsq_rule(), Side.LEFT)
    assert analysis.completed_reps == 3
    codes = {v.code for rep in analysis.reps for v in rep.violations}
    assert "depth_insufficient" in codes
    # Depth is a coaching cue, not a safety stop -- the rep still counts.
    assert analysis.valid_reps == 3
    assert analysis.form_score < 90


def test_knee_collapse_invalidates_the_rep() -> None:
    analysis = analyze_set(
        squat_trace(reps=3, peak_flexion=75.0, valgus_shift=0.07), _slsq_rule(), Side.LEFT
    )
    codes = {v.code for rep in analysis.reps for v in rep.violations}
    assert "knee_valgus" in codes
    assert analysis.valid_reps == 0  # critical violation


def test_emitted_metrics_feed_the_exit_criteria_engine() -> None:
    analysis = analyze_set(squat_trace(reps=5, peak_flexion=75.0), _slsq_rule(), Side.LEFT)
    emitted = {e.key: e for e in analysis.emitted}
    assert "pose.slsq_knee_flexion" in emitted
    assert emitted["pose.slsq_knee_flexion"].value == pytest.approx(75.0, abs=3.0)
    assert emitted["pose.slsq_knee_flexion"].side is Side.LEFT


def test_bilateral_analysis_judges_the_worse_limb() -> None:
    clean = analyze_set(squat_trace(reps=3, peak_flexion=75.0), _slsq_rule(), Side.BILATERAL)
    assert clean.valid_reps == 3

    collapsed = analyze_set(
        squat_trace(reps=3, peak_flexion=75.0, valgus_shift=0.07),
        _slsq_rule(),
        Side.BILATERAL,
    )
    assert collapsed.valid_reps == 0


def test_a_split_stance_target_is_judged_on_the_working_leg() -> None:
    """The two legs of a split squat do different jobs.

    Filmed, the front knee reached 103-127 degrees while the rear one bent
    43-55. Judging the worse limb read the rear knee and told the player their
    front leg was shallow, on four reps out of five, holding a set that was
    actually good at 73/100.
    """
    from app.services.pose.analyzer import _judged

    depth = MetricTarget(
        metric="knee_flexion", min=80.0, code="depth_insufficient", judge="best"
    )
    worse_limb = depth.model_copy(update={"judge": "worst"})

    # Front leg deep, rear leg bent half as far -- a good rep.
    assert _judged([104.0, 55.0], depth) == 104.0
    assert _judged([104.0, 55.0], worse_limb) == 55.0

    # `best` is not "be lenient": a genuinely shallow rep still fails, because
    # the front leg itself did not get there.
    assert _judged([62.0, 40.0], depth) == 62.0

    # And an upper bound inverts the same way, so valgus stays strict.
    valgus = MetricTarget(metric="knee_valgus", max=8.0, code="knee_valgus")
    assert _judged([2.0, 14.0], valgus) == 14.0


def test_poor_but_usable_tracking_is_flagged_and_the_reps_do_not_count() -> None:
    frames = squat_trace(reps=3, peak_flexion=75.0)
    for f in frames:
        f.vis[:] = 0.45  # below the rule's 0.55 bar, but the body is still locatable
    analysis = analyze_set(frames, _slsq_rule(), Side.LEFT)
    assert "low_tracking_quality" in analysis.warnings
    assert analysis.valid_reps == 0


def test_when_the_body_cannot_be_seen_at_all_nothing_is_scored() -> None:
    frames = [build_frame(i / 30.0, 60.0 if i % 20 else 5.0, visibility=0.2) for i in range(60)]
    analysis = analyze_set(frames, _slsq_rule(), Side.LEFT)
    assert analysis.warnings == ["tracking_lost", "not_enough_frames"]
    assert analysis.reps == []


def test_collapsed_skeletons_are_dropped_even_at_full_confidence() -> None:
    """Real failure mode: when part of the player leaves the shot, MediaPipe
    returns a scrambled skeleton *and still claims 0.99 confidence*."""
    frames = squat_trace(reps=4, peak_flexion=80.0)
    for i in range(10, 22):  # squash the body into a tiny blob, confidence untouched
        centre = frames[i].xyz.mean(axis=0)
        frames[i].xyz[:] = centre + (frames[i].xyz - centre) * 0.05

    analysis = analyze_set(frames, _slsq_rule(), Side.LEFT)
    assert any(w.startswith("dropped_") for w in analysis.warnings)
    # The surviving reps are still measured properly.
    assert analysis.completed_reps >= 3
    for rep in analysis.reps:
        assert rep.metrics["knee_flexion_peak"] == pytest.approx(80.0, abs=6.0)


def test_a_torso_that_flips_upside_down_mid_set_is_dropped() -> None:
    """The other half of the same real failure: body size looked fine, but the
    shoulders were placed below the hips, giving 160 degrees of 'trunk lean'."""
    frames = squat_trace(reps=4, peak_flexion=80.0)
    for i in range(14, 26):
        f = frames[i]
        hip_y = (f.xyz[int(LM.LEFT_HIP)][1] + f.xyz[int(LM.RIGHT_HIP)][1]) / 2
        f.xyz[int(LM.LEFT_SHOULDER)][1] = hip_y + 0.2
        f.xyz[int(LM.RIGHT_SHOULDER)][1] = hip_y + 0.2

    analysis = analyze_set(frames, _slsq_rule(), Side.LEFT)
    assert any(w.startswith("dropped_") for w in analysis.warnings)
    for rep in analysis.reps:
        assert rep.metrics.get("trunk_lean_peak", 0) < 45  # no inverted torsos survived


def test_a_side_view_rule_cannot_ask_for_sideways_metrics() -> None:
    """Measured on real side-on footage, knee valgus read a confident +24 to +40
    degrees on every rep — good and bad alike. A rule that asks for it from the
    side is not slightly wrong, it is meaningless, so refuse to build one."""
    with pytest.raises(ValueError, match="side-view rule cannot use knee_valgus"):
        ExerciseRule(
            mode="rep",
            view="side",
            detection=RepDetection(signal="knee_flexion", enter=30.0, exit=15.0),
            targets=[
                MetricTarget(metric="knee_valgus", aggregate="peak", max=8.0, code="valgus")
            ],
        )

    # The same rule from the front is fine.
    ExerciseRule(
        mode="rep",
        view="front",
        detection=RepDetection(signal="knee_flexion", enter=30.0, exit=15.0),
        targets=[MetricTarget(metric="knee_valgus", aggregate="peak", max=8.0, code="valgus")],
    )


def test_every_seeded_exercise_rule_is_self_consistent() -> None:
    from app.data.exercises import EXERCISES

    for exercise in EXERCISES:
        if exercise.rule is None:
            continue
        # Re-validating catches any rule that asks its camera for the impossible.
        ExerciseRule.model_validate(exercise.rule.model_dump())


def test_a_normal_set_loses_no_frames() -> None:
    """The guards must not eat good data."""
    analysis = analyze_set(squat_trace(reps=5, peak_flexion=75.0), _slsq_rule(), Side.LEFT)
    assert not any(w.startswith("dropped_") for w in analysis.warnings)
    assert analysis.valid_reps == 5


def test_portrait_video_needs_the_aspect_ratio_or_angles_come_out_wrong() -> None:
    """Regression: MediaPipe divides x by width and y by height separately, so on
    a 1080x1920 phone video one x unit is a much shorter distance than one y unit.

    Found on real footage — knee flexion read 21 degrees high without this."""
    truth = 90.0
    pose = build_frame(0.0, truth, sagittal_axis="x")
    portrait = 1080 / 1920

    # What a portrait camera actually hands over: x already divided by the
    # (narrower) width, so the x axis is stretched relative to y.
    as_filmed = [
        {"x": float(x) / portrait, "y": float(y), "z": float(z) / portrait, "visibility": 1.0}
        for (x, y, z) in pose.xyz
    ]

    corrected = compute_metrics(
        Frame.from_payload(0.0, as_filmed, aspect=portrait), Side.LEFT
    )["knee_flexion"]
    naive = compute_metrics(Frame.from_payload(0.0, as_filmed), Side.LEFT)["knee_flexion"]

    assert corrected == pytest.approx(truth, abs=0.5)
    # And the old behaviour really was wrong — by a lot, not a rounding error.
    assert abs(naive - truth) > 10


def test_world_landmarks_are_left_alone_because_they_are_already_in_metres() -> None:
    frame = build_frame(0.0, 60.0, sagittal_axis="x")
    payload = [
        {"x": float(x), "y": float(y), "z": float(z), "visibility": 1.0}
        for (x, y, z) in frame.xyz
    ]
    world = Frame.from_payload(0.0, payload, space="world", aspect=0.5625)
    assert world.xyz[0][0] == pytest.approx(payload[0]["x"])


def test_camera_angle_is_detected_from_how_wide_the_body_looks() -> None:
    assert detect_view(squat_trace(reps=2, sagittal_axis="z"))[0] == "front"
    assert detect_view(squat_trace(reps=2, sagittal_axis="x"))[0] == "side"


def test_a_set_filmed_from_the_wrong_side_is_refused_not_scored() -> None:
    """The difference between "your form was bad" and "move your phone" matters
    to the player, so the engine must not blur the two."""
    side_on = squat_trace(reps=4, peak_flexion=80.0, sagittal_axis="x")
    with pytest.raises(WrongCameraView) as caught:
        analyze_set(side_on, _slsq_rule(), Side.LEFT)
    assert caught.value.expected == "front"
    assert caught.value.detected == "side"


def test_a_rule_can_opt_out_of_the_camera_check() -> None:
    rule = _slsq_rule().model_copy(update={"enforce_view": False})
    analysis = analyze_set(
        squat_trace(reps=3, peak_flexion=80.0, sagittal_axis="x"), rule, Side.LEFT
    )
    assert analysis.completed_reps >= 0  # ran instead of raising


def test_valgus_is_dropped_rather_than_reported_as_an_impossible_90_degrees() -> None:
    """A knee cannot sit a whole leg-length off the hip-ankle line. When the maths
    saturates, something is wrong — say nothing instead of sounding certain."""
    frame = build_frame(0.0, 45.0, valgus_shift=0.9, sagittal_axis="z")
    assert "knee_valgus" not in compute_metrics(frame, Side.LEFT, use_z=True)

    sane = build_frame(0.0, 45.0, valgus_shift=0.03, sagittal_axis="z")
    assert 0 < compute_metrics(sane, Side.LEFT, use_z=True)["knee_valgus"] < 60


def test_hold_exercise_measures_the_longest_clean_stretch() -> None:
    from app.data.exercises import EXERCISES_BY_KEY

    rule = EXERCISES_BY_KEY["wall_sit"].rule
    assert rule is not None
    assert rule.view == "side" and rule.use_z is False
    # 2s in a good wall-sit position, then the player slides up out of it.
    good = [build_frame(i / 30.0, 90.0, sagittal_axis="x") for i in range(60)]
    bad = [build_frame((60 + i) / 30.0, 40.0, sagittal_axis="x") for i in range(60)]
    analysis = analyze_set(good + bad, rule, Side.BILATERAL)
    assert analysis.reps[0].hold_seconds == pytest.approx(2.0, abs=0.2)
    assert analysis.reps[0].is_valid is False  # target is 45s
