"""Turn a real video into a landmark fixture, so the browser code can be tested
against footage that is known to be difficult.

Only joint coordinates are written out — no image data. A set of 33 numeric
positions is not identifiable, but it is still worth knowing what is in the file
before committing it anywhere public.

    python scripts/make_video_fixture.py <video> <name> [--stride 2]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

os.environ.setdefault("GLOG_minloglevel", "2")
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

import check_video as cvm  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("video", type=Path)
    parser.add_argument("name", help="fixture name, e.g. side-on-split-squat")
    parser.add_argument("--stride", type=int, default=2, help="keep every Nth frame")
    parser.add_argument("--note", default="", help="what makes this clip interesting")
    args = parser.parse_args()

    frames, info = cvm.read_video(args.video, cvm.MODEL_PATH, max(1, args.stride))
    aspect = info["width"] / info["height"]

    out = ROOT / "web" / "src" / "pose" / "__fixtures__" / f"{args.name}.json"
    payload = {
        "_comment": (
            "Real footage, reduced to joint coordinates by "
            "scripts/make_video_fixture.py. No image data."
        ),
        "note": args.note,
        "width": info["width"],
        "height": info["height"],
        "aspect": round(aspect, 9),
        "fps": info["fps"],
        "frames_in_video": info["read"],
        "frames_tracked": len(frames),
        "frames": [
            {
                "t": round(f.t, 4),
                # Stored as the browser would receive them: x still divided by
                # the image width, so the aspect handling gets exercised.
                "landmarks": [
                    {
                        "x": round(float(f.xyz[i][0]) / aspect, 5),
                        "y": round(float(f.xyz[i][1]), 5),
                        "z": round(float(f.xyz[i][2]) / aspect, 5),
                        "visibility": round(float(f.vis[i]), 3),
                    }
                    for i in range(33)
                ],
            }
            for f in frames
        ],
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload), encoding="utf-8")
    print(f"wrote {out.relative_to(ROOT)}  "
          f"({len(frames)} frames, {out.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
