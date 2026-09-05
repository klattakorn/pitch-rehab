"""Shrink a filmed exercise clip down to something a phone can stream.

    python scripts/add_demo_video.py ~/Downloads/Calf_raises_example.mp4 double_leg_calf_raise

Straight off a phone these clips are 1080x1920 at about 16 Mbps -- 27 MB for
fourteen seconds. Two problems with shipping that: Cloudflare Pages refuses any
single file over 25 MB, and the panel it plays in is a few hundred pixels wide,
so all but a fraction of those bytes are thrown away by the browser anyway.

This re-encodes to 854 pixels tall with the audio dropped -- nobody needs to
hear the room -- which lands around 2 MB, plays inline on iOS and Android, and
starts without waiting for the whole file (`+faststart`).

There is no ffmpeg on PATH here. CapCut ships one, and its build has no libx264
but does have the GPU encoders, so this uses NVENC and falls back through the
other two. Point --ffmpeg somewhere else if that ever stops being true.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "web" / "public" / "demos"

#: Where to look when ffmpeg is not on PATH, newest first.
FALLBACK_FFMPEG = sorted(
    Path.home().glob("AppData/Local/CapCut/Apps/*/ffmpeg.exe"), reverse=True
)

#: Tried in order. The CapCut build has no libx264, so a software encode is not
#: an option; every one of these is hardware, and which exists depends on the
#: graphics card. h264_mf is Windows' own and is the broadest fallback.
ENCODERS = ("h264_nvenc", "h264_qsv", "h264_amf", "h264_mf")

HEIGHT = 854
MAX_MB = 25.0


def find_ffmpeg(override: str | None) -> Path:
    if override:
        return Path(override)
    found = shutil.which("ffmpeg")
    if found:
        return Path(found)
    if FALLBACK_FFMPEG:
        return FALLBACK_FFMPEG[0]
    sys.exit(
        "No ffmpeg found. Install it, or pass --ffmpeg with the path to one.\n"
        "  winget install Gyan.FFmpeg"
    )


def encode(ffmpeg: Path, src: Path, dest: Path, encoder: str, cq: int) -> bool:
    """One attempt. Returns False if this encoder is not usable on this machine."""
    quality = (
        ["-rc", "vbr", "-cq", str(cq), "-b:v", "0"]
        if encoder in ("h264_nvenc", "h264_qsv")
        else ["-b:v", "1200k"]
    )
    result = subprocess.run(
        [
            str(ffmpeg), "-y", "-hide_banner", "-loglevel", "error",
            "-i", str(src),
            "-an",                              # a silent demonstration
            "-vf", f"scale=-2:{HEIGHT}",        # -2 keeps the aspect, even width
            "-c:v", encoder, *quality,
            "-maxrate", "1400k", "-bufsize", "2800k",
            "-pix_fmt", "yuv420p",              # what every browser can decode
            "-movflags", "+faststart",          # starts before the file is in
            str(dest),
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode == 0 and dest.exists() and dest.stat().st_size > 0:
        return True
    print(f"  {encoder}: not usable here ({result.stderr.strip().splitlines()[-1:]})")
    dest.unlink(missing_ok=True)
    return False


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path)
    parser.add_argument("exercise", help="exercise key, e.g. double_leg_calf_raise")
    parser.add_argument("--ffmpeg", help="path to ffmpeg, if it is not on PATH")
    parser.add_argument("--cq", type=int, default=32, help="lower is better quality")
    args = parser.parse_args()

    if not args.video.exists():
        sys.exit(f"No such video: {args.video}")

    from app.data.exercises import EXERCISES  # noqa: PLC0415  (needs sys.path below)

    known = {e.key for e in EXERCISES}
    if args.exercise not in known:
        listed = "\n  ".join(sorted(known))
        sys.exit(f"{args.exercise!r} is not an exercise. Try one of:\n  {listed}")

    ffmpeg = find_ffmpeg(args.ffmpeg)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    dest = OUT_DIR / f"{args.exercise}.mp4"
    before = args.video.stat().st_size / 1048576

    print(f"ffmpeg: {ffmpeg}")
    print(f"{args.video.name}  {before:.1f} MB  ->  {dest.relative_to(ROOT)}")

    for encoder in ENCODERS:
        if encode(ffmpeg, args.video, dest, encoder, args.cq):
            after = dest.stat().st_size / 1048576
            where = dest.relative_to(ROOT)
            print(f"\n  wrote {where}  {after:.2f} MB  ({encoder}, cq {args.cq})")
            if after > MAX_MB:
                print(
                    f"  WARNING: over Cloudflare's {MAX_MB:.0f} MB limit. "
                    "Re-run with a higher --cq."
                )
            print("\nNow point the exercise at it, in app/data/exercises.py:")
            print(f'    demo_url="/demos/{args.exercise}.mp4",')
            print("then: python scripts/make_fallback_exercises.py")
            print("      python scripts/make_snapshot.py")
            return

    sys.exit(
        "None of the H.264 encoders worked. "
        "Run ffmpeg -encoders to see what this machine has."
    )


if __name__ == "__main__":
    sys.path.insert(0, str(ROOT))
    main()
