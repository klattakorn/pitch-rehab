"""Run a whole folder of test videos through the pose engine and score the engine.

`check_video.py` answers "what did the engine see in this one clip?". This
answers the question that actually matters once other people start filming:

    across every clip we shot, does the engine reliably score a deliberately
    bad rep worse than a good one?

That is the whole claim the project makes. One clip cannot prove it. Forty can.

Filming convention -- the filename carries the metadata, so nobody has to keep
a spreadsheet in sync with a folder:

    <exercise_key>__<person>__<good|bad>[__<left|right|bilateral>].mp4

    split_squat__ana__good__left.mp4
    split_squat__ana__bad__left.mp4
    wall_sit__ben__good.mp4

Usage:

    python scripts/batch_check.py videos/
    python scripts/batch_check.py videos/ --out docs/video-results.md
    python scripts/batch_check.py videos/ --every 2      # halve the work, rough pass

Every clip is read once by MediaPipe, which is the slow part -- budget roughly
real-time per clip. `--every 2` roughly halves that at some cost in accuracy.
"""

from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.enums import Side  # noqa: E402
from app.data.exercises import EXERCISES_BY_KEY  # noqa: E402
from app.services.pose.analyzer import WrongCameraView, analyze_set  # noqa: E402
from app.services.pose.geometry import detect_view  # noqa: E402

# check_video owns the MediaPipe plumbing and the model download; reuse it
# rather than keeping a second copy that can drift.
from scripts.check_video import ensure_model, read_video  # noqa: E402

VIDEO_SUFFIXES = {".mp4", ".mov", ".m4v", ".avi", ".mkv"}
SIDE_WORDS = {s.value for s in Side}
LABELS = {"good", "bad"}


@dataclass
class Clip:
    """One video file, plus whatever the engine made of it."""

    path: Path
    exercise: str
    person: str
    label: str
    side: Side

    ok: bool = False
    note: str = ""
    frames_read: int = 0
    detection_pct: float = 0.0
    view_expected: str = ""
    view_detected: str = ""
    reps_found: int = 0
    reps_counted: int = 0
    form_score: float | None = None
    violations: list[str] = field(default_factory=list)

    @property
    def group(self) -> tuple[str, str, str]:
        return (self.exercise, self.person, self.side.value)


def parse_name(path: Path) -> tuple[str, str, str, Side] | None:
    """Pull exercise / person / label / side out of the filename.

    Returns ``None`` for anything that does not follow the convention, so a
    stray clip in the folder is reported rather than silently skipped.
    """
    parts = path.stem.split("__")
    if len(parts) < 3:
        return None

    exercise, person = parts[0].strip(), parts[1].strip()
    rest = [p.strip().lower() for p in parts[2:]]

    label = next((p for p in rest if p in LABELS), None)
    if label is None or not exercise or not person:
        return None

    side_word = next((p for p in rest if p in SIDE_WORDS), "bilateral")
    return exercise, person, label, Side(side_word)


def analyse(clip: Clip, model_path: Path, stride: int) -> Clip:
    exercise = EXERCISES_BY_KEY.get(clip.exercise)
    if exercise is None:
        clip.note = f"unknown exercise '{clip.exercise}'"
        return clip
    if exercise.rule is None:
        clip.note = "exercise has no camera rule (logged by hand)"
        return clip

    rule = exercise.rule
    clip.view_expected = rule.view

    frames, info = read_video(clip.path, model_path, stride)
    clip.frames_read = info["read"]
    clip.detection_pct = 100 * info["found"] / max(1, info["read"])

    if len(frames) < 2:
        clip.note = "person found in fewer than 2 frames"
        return clip

    detected, _ = detect_view(frames)
    clip.view_detected = detected

    try:
        analysis = analyze_set(frames, rule, clip.side)
    except WrongCameraView as exc:
        clip.note = f"refused: filmed {exc.detected}-on, rule wants {exc.expected}-on"
        return clip

    clip.ok = True
    clip.reps_found = analysis.completed_reps
    clip.reps_counted = analysis.valid_reps
    clip.form_score = analysis.form_score if analysis.completed_reps else None
    clip.violations = sorted({v.code for rep in analysis.reps for v in rep.violations})
    if analysis.completed_reps == 0:
        clip.note = "no reps detected"
    return clip


def verdicts(clips: list[Clip]) -> list[tuple[tuple[str, str, str], str, str]]:
    """Pair each good clip with its bad twin and say whether the engine told them apart."""
    by_group: dict[tuple[str, str, str], dict[str, Clip]] = defaultdict(dict)
    for clip in clips:
        if clip.ok and clip.form_score is not None:
            by_group[clip.group][clip.label] = clip

    rows = []
    for group, pair in sorted(by_group.items()):
        good, bad = pair.get("good"), pair.get("bad")
        if good is None or bad is None:
            rows.append((group, "no pair", "only the "
                         f"{'good' if good else 'bad'} clip scored"))
            continue

        gap = good.form_score - bad.form_score  # type: ignore[operator]
        detail = (f"good {good.form_score:.0f} vs bad {bad.form_score:.0f}"
                  f"  (gap {gap:+.0f})")
        if gap >= 15:
            rows.append((group, "PASS", detail))
        elif gap > 0:
            rows.append((group, "WEAK", detail + " — told apart, but not by much"))
        else:
            rows.append((group, "FAIL", detail + " — the bad reps scored as well or better"))
    return rows


def render(clips: list[Clip], skipped: list[Path]) -> str:
    lines: list[str] = []
    add = lines.append

    add("# Test footage results")
    add("")
    add(f"{len(clips)} clips analysed"
        + (f", {len(skipped)} skipped" if skipped else "") + ".")
    add("")
    add("Generated by `python scripts/batch_check.py videos/` — do not hand-edit;")
    add("re-run it after any change to `app/services/pose/` or `app/data/exercises.py`.")
    add("")

    add("## Does the engine tell good reps from bad ones?")
    add("")
    add("This is the table that matters. Everything below it is supporting detail.")
    add("")
    add("| Exercise | Person | Side | Verdict | Detail |")
    add("|---|---|---|---|---|")
    rows = verdicts(clips)
    for (exercise, person, side), verdict, detail in rows:
        add(f"| `{exercise}` | {person} | {side} | **{verdict}** | {detail} |")
    if not rows:
        add("| — | — | — | — | no good/bad pairs found yet |")
    add("")

    tally = defaultdict(int)
    for _, verdict, _ in rows:
        tally[verdict] += 1
    if tally:
        summary = ", ".join(f"{n} {v.lower()}" for v, n in sorted(tally.items()))
        add(f"**Summary:** {summary}.")
        add("")

    add("## Every clip")
    add("")
    add("| Clip | View wanted | View seen | Detected | Reps | Counted | Score | Flags | Note |")
    add("|---|---|---|---|---|---|---|---|---|")
    for clip in sorted(clips, key=lambda c: (c.exercise, c.person, c.label)):
        score = f"{clip.form_score:.0f}" if clip.form_score is not None else "—"
        flags = ", ".join(clip.violations) or "—"
        seen = clip.view_detected or "—"
        mark = "" if not clip.view_expected else (
            "" if seen in (clip.view_expected, "unknown", "—") else " ⚠"
        )
        add(f"| `{clip.path.name}` | {clip.view_expected or '—'} | {seen}{mark} "
            f"| {clip.detection_pct:.0f}% | {clip.reps_found} | {clip.reps_counted} "
            f"| {score} | {flags} | {clip.note or '—'} |")
    add("")

    if skipped:
        add("## Skipped")
        add("")
        add("Filenames that do not follow "
            "`exercise__person__good|bad[__side].mp4`:")
        add("")
        for path in sorted(skipped):
            add(f"- `{path.name}`")
        add("")

    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Score the pose engine against a folder of test videos."
    )
    parser.add_argument("folder", type=Path, nargs="?", default=Path("videos"))
    parser.add_argument("--out", type=Path, default=Path("docs/video-results.md"),
                        help="where to write the results table")
    parser.add_argument("--every", type=int, default=1,
                        help="analyse every Nth frame (2 halves the work)")
    parser.add_argument("--model", type=Path, default=None)
    args = parser.parse_args()

    if not args.folder.is_dir():
        print(f"No such folder: {args.folder}")
        print("Put the clips in videos/ and name them "
              "exercise__person__good.mp4 — see videos/README.md")
        sys.exit(1)

    files = sorted(
        p for p in args.folder.rglob("*")
        if p.is_file() and p.suffix.lower() in VIDEO_SUFFIXES
    )
    if not files:
        print(f"No video files under {args.folder}/")
        sys.exit(1)

    from scripts.check_video import MODEL_PATH
    model_path = ensure_model(args.model or MODEL_PATH)

    clips: list[Clip] = []
    skipped: list[Path] = []
    for index, path in enumerate(files, start=1):
        parsed = parse_name(path)
        if parsed is None:
            skipped.append(path)
            print(f"[{index}/{len(files)}] skip  {path.name}  (name does not parse)")
            continue

        exercise, person, label, side = parsed
        print(f"[{index}/{len(files)}] {path.name} ...", flush=True)
        clip = analyse(
            Clip(path=path, exercise=exercise, person=person, label=label, side=side),
            model_path,
            max(1, args.every),
        )
        clips.append(clip)

    text = render(clips, skipped)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(text, encoding="utf-8")

    print()
    for (exercise, person, side), verdict, detail in verdicts(clips):
        print(f"  {verdict:8} {exercise} / {person} / {side}   {detail}")
    print(f"\nWritten to {args.out}")


if __name__ == "__main__":
    main()
