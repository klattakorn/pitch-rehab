"""Run a real video through the pose engine and see whether it agrees with your eyes.

Everything else in this project has only ever been tested on skeletons generated
in code. This script closes that gap: it runs MediaPipe over an actual video the
same way the phone app will, feeds the result into the *same* scoring code the
API uses, and tells you what it saw.

    python scripts/check_video.py squat.mp4 single_leg_squat --side left
    python scripts/check_video.py squat.mp4 single_leg_squat --side left --out marked.mp4

`--out` writes a copy of your video with the skeleton and the live angles drawn
on it. Watch that back — if the numbers on screen match what your body is doing,
the engine works. If they jump around, the thresholds in app/data/exercises.py
need loosening (or the camera needs moving).

Needs a MediaPipe model file. The script offers to fetch it on first run.
"""

from __future__ import annotations

import argparse
import os
import sys
import urllib.request
from pathlib import Path

# MediaPipe and its TensorFlow Lite backend log a wall of INFO/WARNING lines on
# startup. Must be set before importing them, or the report is unreadable. One
# "Feedback manager requires a model with a single signature" warning still gets
# through from the C++ layer -- it is harmless and cannot be silenced from here.
os.environ.setdefault("GLOG_minloglevel", "2")
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")
os.environ.setdefault("GRPC_VERBOSITY", "ERROR")

import cv2  # noqa: E402
import mediapipe as mp  # noqa: E402
import numpy as np  # noqa: E402
from mediapipe.tasks import python as mp_python  # noqa: E402
from mediapipe.tasks.python import vision  # noqa: E402
from PIL import Image  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.enums import Side  # noqa: E402
from app.data.exercises import EXERCISES_BY_KEY  # noqa: E402
from app.services.pose.analyzer import WrongCameraView, analyze_set  # noqa: E402
from app.services.pose.geometry import Frame, compute_metrics, detect_view  # noqa: E402
from app.services.pose.landmarks import LANDMARK_COUNT, LM  # noqa: E402

MODEL_DIR = Path(__file__).resolve().parent.parent / "models"
MODEL_PATH = MODEL_DIR / "pose_landmarker_full.task"
MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_full/float16/1/pose_landmarker_full.task"
)
MODEL_SIZE_MB = 9

#: Plain-English names for the angles, for the report and the on-screen overlay.
FRIENDLY = {
    "knee_flexion": "knee bend",
    "hip_flexion": "hip bend",
    "trunk_lean": "trunk lean",
    "knee_valgus": "knee falling in",
    "pelvic_drop": "hip drop",
    "ankle_dorsiflexion": "ankle bend",
    "heel_raise_ratio": "heel height",
    "hold_seconds": "hold",
}

#: Bones to draw, so the stick figure is recognisable.
SKELETON = [
    (LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER),
    (LM.LEFT_SHOULDER, LM.LEFT_HIP),
    (LM.RIGHT_SHOULDER, LM.RIGHT_HIP),
    (LM.LEFT_HIP, LM.RIGHT_HIP),
    (LM.LEFT_SHOULDER, LM.LEFT_ELBOW),
    (LM.LEFT_ELBOW, LM.LEFT_WRIST),
    (LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW),
    (LM.RIGHT_ELBOW, LM.RIGHT_WRIST),
    (LM.LEFT_HIP, LM.LEFT_KNEE),
    (LM.LEFT_KNEE, LM.LEFT_ANKLE),
    (LM.LEFT_ANKLE, LM.LEFT_FOOT_INDEX),
    (LM.LEFT_ANKLE, LM.LEFT_HEEL),
    (LM.RIGHT_HIP, LM.RIGHT_KNEE),
    (LM.RIGHT_KNEE, LM.RIGHT_ANKLE),
    (LM.RIGHT_ANKLE, LM.RIGHT_FOOT_INDEX),
    (LM.RIGHT_ANKLE, LM.RIGHT_HEEL),
]

GREEN, RED, GREY, BOLD, OFF = "\033[92m", "\033[91m", "\033[90m", "\033[1m", "\033[0m"


def ensure_model(path: Path) -> Path:
    """Fetch the MediaPipe pose model, but only after you say yes."""
    if path.exists():
        return path
    print(f"\nThe pose model is not here yet:\n  {path}\n")
    print("It can be downloaded from Google's official MediaPipe model host:")
    print(f"  {MODEL_URL}")
    print(f"  about {MODEL_SIZE_MB} MB, one time only\n")
    answer = input("Download it now? [y/N] ").strip().lower()
    if answer not in {"y", "yes"}:
        print("\nSkipped. Download it yourself and pass --model <path> when you have it.")
        sys.exit(1)
    path.parent.mkdir(parents=True, exist_ok=True)
    print("downloading...")
    urllib.request.urlretrieve(MODEL_URL, path)  # noqa: S310 - fixed, audited URL
    print(f"saved to {path}\n")
    return path


def landmark_confidence(landmark) -> float:
    """How sure MediaPipe is about one point.

    The current MediaPipe release does not always fill in `visibility`, so fall
    back to `presence`, and to 1.0 if neither is populated. The report says which
    one was actually used so a confidence score of 1.0 is never mistaken for
    "perfectly tracked" when it really means "not reported".
    """
    for attr in ("visibility", "presence"):
        value = getattr(landmark, attr, None)
        if value is not None and value > 0:
            return float(value)
    return 1.0


def read_video(video_path: Path, model_path: Path, stride: int) -> tuple[list, dict]:
    """Run MediaPipe over every frame and return our own Frame objects."""
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        print(f"{RED}Could not open {video_path}{OFF}")
        sys.exit(1)

    info = {
        "fps": capture.get(cv2.CAP_PROP_FPS) or 30.0,
        "width": int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)),
        "height": int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT)),
        "total": int(capture.get(cv2.CAP_PROP_FRAME_COUNT)),
        "found": 0,
        "read": 0,
        "confidence_source": "none",
    }

    detector = vision.PoseLandmarker.create_from_options(
        vision.PoseLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=str(model_path)),
            running_mode=vision.RunningMode.VIDEO,
            num_poses=1,
            min_pose_detection_confidence=0.5,
            min_pose_presence_confidence=0.5,
            min_tracking_confidence=0.5,
        )
    )

    frames: list[Frame] = []
    raw_landmarks: list[list | None] = []
    index = 0
    with detector:
        while True:
            ok, image = capture.read()
            if not ok:
                break
            info["read"] += 1
            if index % stride:
                index += 1
                raw_landmarks.append(None)
                continue

            timestamp_ms = int(1000 * index / info["fps"])
            rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            result = detector.detect_for_video(
                mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), timestamp_ms
            )

            if not result.pose_landmarks:
                raw_landmarks.append(None)
                index += 1
                continue

            points = result.pose_landmarks[0]
            if len(points) < LANDMARK_COUNT:
                raw_landmarks.append(None)
                index += 1
                continue

            if info["confidence_source"] == "none":
                sample = points[int(LM.LEFT_HIP)]
                if getattr(sample, "visibility", 0):
                    info["confidence_source"] = "visibility"
                elif getattr(sample, "presence", 0):
                    info["confidence_source"] = "presence"
                else:
                    info["confidence_source"] = "not reported by MediaPipe"

            payload = [
                {
                    "x": p.x,
                    "y": p.y,
                    "z": p.z,
                    "visibility": landmark_confidence(p),
                }
                for p in points[:LANDMARK_COUNT]
            ]
            frames.append(
                Frame.from_payload(
                    index / info["fps"], payload, aspect=info["width"] / info["height"]
                )
            )
            raw_landmarks.append(payload)
            info["found"] += 1
            index += 1

    capture.release()
    info["raw"] = raw_landmarks
    return frames, info


def _annotated_frames(video_path: Path, info: dict, analysis, side: Side, use_z: bool):
    """Yield each frame of the source video with the skeleton and live angles burned in."""
    capture = cv2.VideoCapture(str(video_path))
    raw = info["raw"]
    analysed_sides = [Side.LEFT, Side.RIGHT] if side is Side.BILATERAL else [side]

    index = 0
    while True:
        ok, image = capture.read()
        if not ok:
            break
        points = raw[index] if index < len(raw) else None
        if points:
            _draw_skeleton(image, points, info)
            frame = Frame.from_payload(index / info["fps"], points)
            lines = []
            for one_side in analysed_sides:
                metrics = compute_metrics(frame, one_side, use_z=use_z)
                for key in ("knee_flexion", "trunk_lean", "knee_valgus", "pelvic_drop"):
                    if key in metrics:
                        label = FRIENDLY.get(key, key)
                        prefix = f"{one_side.value[0].upper()} " if len(analysed_sides) > 1 else ""
                        lines.append(f"{prefix}{label}: {metrics[key]:.0f}")
            _draw_text_block(image, lines, 10, 30)

            time_s = index / info["fps"]
            for rep in analysis.reps:
                if rep.start_t <= time_s <= rep.end_t:
                    tag = f"REP {rep.index + 1}  {rep.form_score:.0f}/100"
                    colour = (0, 200, 0) if rep.is_valid else (0, 0, 255)
                    if not rep.is_valid:
                        tag += "  NOT COUNTED"
                    cv2.putText(image, tag, (10, info["height"] - 40),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.8, colour, 2, cv2.LINE_AA)
                    if rep.violations:
                        cv2.putText(image, rep.violations[0].code, (10, info["height"] - 15),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, colour, 2, cv2.LINE_AA)
                    break
        yield image
        index += 1

    capture.release()


#: Target frame rate for the .gif path. A GIF has no inter-frame prediction --
#: every frame is close to its own PNG -- so 12s at 30fps would run to tens of
#: megabytes for nothing this needs. 8fps is still smooth enough to see whether
#: a rep was tracked, at a fraction of the size.
GIF_FPS = 8
#: Width the .gif is scaled to. A full 1080p frame costs the same in a GIF
#: whether it is legible or not; text and the skeleton read fine much smaller.
GIF_WIDTH = 480


def draw_overlay(
    video_path: Path,
    out_path: Path,
    info: dict,
    analysis,
    side: Side,
    use_z: bool,
) -> None:
    """Write a copy of the video with the skeleton and live angles burned in.

    .gif has no codec to fail: it plays in a browser, a chat app, an image
    viewer, anything. .mp4 is written with mp4v, which is the only fourcc this
    machine can actually encode with -- and browsers and most phones cannot
    decode it, so the file looks broken to whoever you send it to even though
    it opens fine in something like VLC. Prefer .gif unless you know the mp4
    is going somewhere that plays it.
    """
    frames = _annotated_frames(video_path, info, analysis, side, use_z)

    if out_path.suffix.lower() == ".gif":
        stride = max(1, round(info["fps"] / GIF_FPS))
        scale = GIF_WIDTH / info["width"] if info["width"] > GIF_WIDTH else 1.0
        size = (GIF_WIDTH, round(info["height"] * scale)) if scale < 1.0 else None

        images = []
        for index, image in enumerate(frames):
            if index % stride:
                continue
            rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            pil = Image.fromarray(rgb)
            if size:
                pil = pil.resize(size, Image.LANCZOS)
            images.append(pil)

        if not images:
            print(f"{RED}Nothing to write -- no frames.{OFF}")
            return

        # One palette for every frame, built from the busiest one (the most
        # distinct colours) rather than the first. Reusing a palette is what
        # lets GIF's LZW step compress a static background efficiently instead
        # of re-deriving 256 colours per frame; dithering is off because the
        # speckle it adds defeats that compression for no visible gain here.
        # Real camera footage is not a good match for GIF -- expect low tens
        # of megabytes for a clip this length, not the kilobytes a screen
        # recording would produce.
        richest = max(images, key=lambda im: len(im.quantize(colors=256).getcolors(256) or []))
        palette = richest.quantize(colors=192, dither=Image.Dither.NONE)
        frames_p = [im.quantize(palette=palette, dither=Image.Dither.NONE) for im in images]

        frames_p[0].save(
            out_path,
            save_all=True,
            append_images=frames_p[1:],
            duration=round(1000 / GIF_FPS),
            loop=0,
            optimize=True,
        )
        return

    if out_path.suffix.lower() == ".mp4":
        print(
            f"{RED}Heads up:{OFF} this machine has no H.264 encoder, so the .mp4 is "
            f"written with the mp4v codec. VLC and most desktop players open it fine; "
            f"browsers, phones and chat apps usually cannot decode it and will show "
            f"nothing, even though the file is not corrupt. Use --out something.gif "
            f"for something guaranteed to play wherever you send it."
        )
    writer = cv2.VideoWriter(
        str(out_path),
        cv2.VideoWriter_fourcc(*"mp4v"),
        info["fps"],
        (info["width"], info["height"]),
    )
    for image in frames:
        writer.write(image)
    writer.release()


def _draw_skeleton(image: np.ndarray, points: list[dict], info: dict) -> None:
    h, w = info["height"], info["width"]
    for a, b in SKELETON:
        pa, pb = points[int(a)], points[int(b)]
        if min(pa["visibility"], pb["visibility"]) < 0.3:
            continue
        cv2.line(image, (int(pa["x"] * w), int(pa["y"] * h)),
                 (int(pb["x"] * w), int(pb["y"] * h)), (0, 255, 120), 2, cv2.LINE_AA)
    for point in points:
        if point["visibility"] >= 0.3:
            cv2.circle(image, (int(point["x"] * w), int(point["y"] * h)), 4, (255, 255, 255), -1)


def _draw_text_block(image: np.ndarray, lines: list[str], x: int, y: int) -> None:
    for offset, line in enumerate(lines):
        position = (x, y + offset * 26)
        cv2.putText(image, line, position, cv2.FONT_HERSHEY_SIMPLEX, 0.7,
                    (0, 0, 0), 4, cv2.LINE_AA)
        cv2.putText(image, line, position, cv2.FONT_HERSHEY_SIMPLEX, 0.7,
                    (255, 255, 255), 1, cv2.LINE_AA)


def report(
    video_path: Path,
    info: dict,
    exercise,
    rule,
    side: Side,
    analysis,
    frames: list[Frame],
) -> None:
    seconds = info["read"] / info["fps"] if info["fps"] else 0
    detection_rate = 100 * info["found"] / max(1, info["read"])
    tracked = [LM[n] for n in rule.required_landmarks if n in LM.__members__]
    confidences = [f.quality(tracked) for f in frames]
    mean_confidence = sum(confidences) / len(confidences) if confidences else 0.0

    print(f"\n{BOLD}Video{OFF}")
    print(f"  {video_path.name}   {info['width']}x{info['height']}   "
          f"{info['fps']:.0f} fps   {seconds:.1f}s   {info['read']} frames")
    print(f"  Person found in {info['found']} of {info['read']} frames "
          f"({detection_rate:.0f}%)")
    print(f"  Landmark confidence: {mean_confidence:.2f}  "
          f"{GREY}(from: {info['confidence_source']}){OFF}")

    detected, openness_score = detect_view(frames)
    match = GREEN + "matches" + OFF if detected == rule.view else RED + "MISMATCH" + OFF
    if detected == "unknown":
        match = GREY + "not sure" + OFF

    print(f"\n{BOLD}Exercise{OFF}")
    print(f"  {exercise.name_en}  /  {exercise.name_th}")
    print(f"  Rule expects the camera {BOLD}{rule.view}{OFF} on, "
          f"leg analysed: {GREY}{side.value}{OFF}")
    print(f"  Camera actually looks {BOLD}{detected}{OFF} on "
          f"(score {openness_score:.2f})   {match}"
          if openness_score is not None else "  Camera angle could not be judged")
    print(f"  Uses depth estimate: {GREY}{'yes' if rule.use_z else 'no'}{OFF}")

    print(f"\n{BOLD}What the engine saw{OFF}")
    print(f"  Reps found:  {BOLD}{analysis.completed_reps}{OFF}")
    print(f"  Reps that counted: {BOLD}{analysis.valid_reps}{OFF}")
    if analysis.completed_reps:
        print(f"  Average form score: {BOLD}{analysis.form_score:.0f}/100{OFF}\n")

    for rep in analysis.reps:
        mark = f"{GREEN}ok{OFF}" if rep.is_valid else f"{RED}NOT COUNTED{OFF}"
        readable = "   ".join(
            f"{FRIENDLY.get(k.rsplit('_', 1)[0], k)} {v:.0f}"
            for k, v in list(rep.metrics.items())[:4]
        )
        print(f"  Rep {rep.index + 1}   {rep.duration:.1f}s   "
              f"score {rep.form_score:.0f}/100   {readable}   {mark}")
        for violation in rep.violations:
            print(f"      {RED}-{OFF} {violation.message_en or violation.code}")

    if analysis.emitted:
        print(f"\n{BOLD}Numbers sent to the exit criteria{OFF}")
        for item in analysis.emitted:
            where = f" ({item.side.value})" if item.side else ""
            print(f"  {item.key}{where} = {item.value:g} {item.unit}")

    print(f"\n{BOLD}Problems worth knowing about{OFF}")
    problems = []
    if detection_rate < 90:
        problems.append(
            "MediaPipe lost you in a lot of frames. Usually means poor light, the "
            "camera too close, or part of you out of shot."
        )
    if mean_confidence < 0.6:
        problems.append(
            "Low confidence in the joint positions. Same likely causes, plus "
            "baggy clothing over the knees."
        )
    if info["confidence_source"].startswith("not reported"):
        problems.append(
            "MediaPipe did not report per-joint confidence at all, so the engine's "
            "tracking-quality check is doing nothing on this video. Worth deciding "
            "what the app should do about that."
        )
    if analysis.completed_reps == 0:
        problems.append(
            "No reps detected. Either the camera is on the wrong side for this "
            f"exercise (rule wants '{rule.view}'), or the start/stop thresholds in "
            "app/data/exercises.py do not match how you actually move."
        )
    elif analysis.valid_reps == 0:
        codes = sorted({v.code for rep in analysis.reps for v in rep.violations if v.critical})
        problems.append(
            f"Every rep was rejected ({', '.join(codes) or 'unknown'}). If your form "
            "was actually fine, that limit is set too tight for real footage — it is "
            "the most likely thing to need loosening."
        )
    for warning in analysis.warnings:
        problems.append(f"engine warning: {warning}")
    if not problems:
        print(f"  {GREEN}None.{OFF}")
    for problem in problems:
        print(f"  {RED}-{OFF} {problem}")

    print(f"\n{BOLD}Now check it against what you actually did{OFF}")
    print("  1. Did you do the same number of reps it found?")
    print("  2. Do the angles look about right? A deep squat should read 90 or more.")
    print("  3. Did it flag the reps you did badly on purpose, and leave the good ones alone?")
    print("  4. Watch the --out video: does the skeleton stay stuck to your body?")
    print("\n  If 1-3 are wrong, the thresholds in app/data/exercises.py need adjusting.")
    print("  If 4 is wrong, no threshold will save it — fix the filming first.\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Check the pose engine against a real video.")
    parser.add_argument("video", type=Path)
    parser.add_argument("exercise", help="e.g. single_leg_squat, prone_hamstring_curl")
    parser.add_argument("--side", default="bilateral", choices=[s.value for s in Side])
    parser.add_argument(
        "--out",
        type=Path,
        help="write an annotated copy here -- prefer a .gif, which plays anywhere; "
        ".mp4 only opens in a player with the right codec (see the warning if you use it)",
    )
    parser.add_argument("--model", type=Path, default=MODEL_PATH)
    parser.add_argument("--every", type=int, default=1,
                        help="analyse every Nth frame (use 2 to halve the work)")
    args = parser.parse_args()

    if not args.video.exists():
        print(f"{RED}No such video: {args.video}{OFF}")
        sys.exit(1)

    exercise = EXERCISES_BY_KEY.get(args.exercise)
    if exercise is None:
        print(f"{RED}Unknown exercise '{args.exercise}'.{OFF}\n\nOnes with a camera rule:")
        for key, item in sorted(EXERCISES_BY_KEY.items()):
            if item.rule:
                print(f"  {key:<28} {item.name_en}")
        sys.exit(1)
    if exercise.rule is None:
        print(f"{RED}'{args.exercise}' has no camera rule — it is logged by hand.{OFF}")
        sys.exit(1)

    model_path = ensure_model(args.model)
    side = Side(args.side)

    print(f"reading {args.video.name} ...")
    frames, info = read_video(args.video, model_path, max(1, args.every))
    if len(frames) < 2:
        print(f"{RED}MediaPipe found a person in fewer than 2 frames. "
              f"Nothing to analyse.{OFF}")
        sys.exit(1)

    try:
        analysis = analyze_set(frames, exercise.rule, side)
    except WrongCameraView as exc:
        detected, score = detect_view(frames)
        print(f"\n{RED}{BOLD}Wrong camera angle — nothing was scored.{OFF}")
        print(f"  '{args.exercise}' has to be filmed from the {BOLD}{exc.expected}{OFF}, "
              f"but this video looks {BOLD}{exc.detected}{OFF}-on (score {score:.2f}).")
        print("\n  Angles measured from the wrong side are not slightly off, they are")
        print("  meaningless, so the engine refuses rather than inventing a number.")
        print(f"\n  Either re-film from the {exc.expected}, or try an exercise whose rule")
        print(f"  expects a {exc.detected} view — python scripts/check_video.py "
              f"{args.video.name} <other-exercise>")
        sys.exit(2)

    report(args.video, info, exercise, exercise.rule, side, analysis, frames)

    if args.out:
        print(f"writing {args.out} ...")
        draw_overlay(args.video, args.out, info, analysis, side, bool(exercise.rule.use_z))
        print(f"{GREEN}done — watch it back.{OFF}\n")


if __name__ == "__main__":
    main()
