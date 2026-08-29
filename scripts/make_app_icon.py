"""Draw the Android app icon and splash screen from the brand mark.

The mark lives in ``web/src/ui.ts`` as an SVG, which is the right form for the
app and the wrong form for Android -- the launcher wants PNGs at a dozen sizes,
and there is no rasteriser in this project. So the same figure is redrawn here
with the same coordinates, and ``@capacitor/assets`` fans the output out into
every density and shape the launcher asks for.

    python scripts/make_app_icon.py

Writes ``web/assets/icon.png`` (1024) and ``web/assets/splash.png`` (2732), plus
a dark-mode splash. Re-run it if the mark changes.

Everything is drawn four times oversized and shrunk at the end: Pillow's lines
have no antialiasing, and a launcher icon with stepped edges is the first thing
anyone notices about an app.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "assets"
#: The web build serves these directly, so they live where Vite copies from.
PUBLIC = ROOT / "web" / "public"

#: Straight from styles.css. The icon is the one place the accent gets to be
#: the whole subject rather than a signal, because a launcher grid is not an
#: interface -- there is nothing here for it to compete with.
INK = (216, 255, 62)
PAGE = (14, 17, 22)

#: The mark, in the 40x40 space ui.ts draws it in.
STROKE = 3.4
LIMBS = [
    [(23.5, 14.5), (30.0, 17.5), (35.5, 14.0)],  # near arm
    [(23.5, 14.5), (17.0, 20.0), (20.5, 26.5), (15.5, 35.0)],  # spine, far leg
    [(20.5, 26.5), (28.0, 29.0), (30.0, 36.5)],  # near leg
    [(17.0, 20.0), (9.0, 22.5)],  # far arm
]
HEAD = (26.5, 7.5, 4.2)
#: The three speed lines behind the runner, at the opacity the SVG gives them.
SPEED = [((3.0, 13.0), (10.0, 13.0)), ((1.0, 20.0), (6.0, 20.0)), ((4.0, 27.0), (10.0, 27.0))]
SPEED_STROKE = 2.4
SPEED_ALPHA = 0.42


def _blend(colour: tuple[int, int, int], onto: tuple[int, int, int], alpha: float):
    return tuple(round(c * alpha + o * (1 - alpha)) for c, o in zip(colour, onto, strict=True))


def _stroke(draw: ImageDraw.ImageDraw, points, width: float, colour) -> None:
    """A polyline with round caps and joins, which Pillow does not do itself."""
    for (x1, y1), (x2, y2) in zip(points, points[1:], strict=False):
        draw.line((x1, y1, x2, y2), fill=colour, width=max(1, round(width)))
    radius = width / 2
    for x, y in points:
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=colour)


def draw_mark(size: int, scale: float, background) -> Image.Image:
    """The running figure, centred on its own bounding box in a square."""
    big = size * 4
    image = Image.new("RGB", (big, big), background)
    draw = ImageDraw.Draw(image)

    # Fit the drawing to `scale` of the canvas, centred on what is actually
    # drawn rather than on the 40x40 box -- the figure does not fill it, and
    # centring the box instead leaves the runner visibly off to one side.
    xs = [p[0] for limb in LIMBS for p in limb] + [HEAD[0] - HEAD[2], HEAD[0] + HEAD[2]]
    ys = [p[1] for limb in LIMBS for p in limb] + [HEAD[1] - HEAD[2], HEAD[1] + HEAD[2]]
    xs += [p[0] for line in SPEED for p in line]
    ys += [p[1] for line in SPEED for p in line]
    pad = STROKE / 2
    left, right = min(xs) - pad, max(xs) + pad
    top, bottom = min(ys) - pad, max(ys) + pad
    span = max(right - left, bottom - top)
    unit = big * scale / span
    ox = (big - (right - left) * unit) / 2 - left * unit
    oy = (big - (bottom - top) * unit) / 2 - top * unit

    def place(points):
        return [(x * unit + ox, y * unit + oy) for x, y in points]

    faded = _blend(INK, background, SPEED_ALPHA)
    for line in SPEED:
        _stroke(draw, place(line), SPEED_STROKE * unit, faded)
    for limb in LIMBS:
        _stroke(draw, place(limb), STROKE * unit, INK)

    (hx, hy), = place([(HEAD[0], HEAD[1])])
    hr = HEAD[2] * unit
    draw.ellipse((hx - hr, hy - hr, hx + hr, hy + hr), fill=INK)

    return image.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    # 0.52 of the canvas: Android crops an adaptive icon to a circle, a squircle
    # or a rounded square depending on the launcher, and anything drawn past
    # about two thirds loses its edges in at least one of them.
    draw_mark(1024, 0.52, PAGE).save(OUT / "icon.png")

    # The splash is the same figure much smaller, because it shows at full
    # screen and a launcher-sized mark blown up to a tablet reads as a mistake.
    for name in ("splash.png", "splash-dark.png"):
        draw_mark(2732, 0.18, PAGE).save(OUT / name)

    # The same mark for the web build, at the sizes each platform looks for.
    #
    # iOS reads `apple-touch-icon` and nothing else when you Add to Home Screen;
    # without one it screenshots the page and uses that, which looks like a
    # mistake. 180 is what current iPhones ask for, and it must be opaque --
    # transparency comes out black behind the rounded corners iOS adds itself,
    # so the dark background here is doing a job.
    #
    # Android and desktop Chrome read the manifest instead, which wants 192 and
    # 512. The favicon is the same drawing again, small.
    for size, name in (
        (180, "apple-touch-icon.png"),
        (192, "icon-192.png"),
        (512, "icon-512.png"),
        (32, "favicon.png"),
        # Android crops a maskable icon to about 80% of the square, so this one
        # is drawn at the launcher's scale rather than the browser's. Without
        # it, Chrome pads the ordinary icon onto a white circle.
        (512, "icon-maskable.png"),
    ):
        # A little tighter than the launcher icon: iOS and the browser tab crop
        # far less than an Android adaptive icon does, so the same 0.52 would
        # leave the mark swimming in empty space.
        scale = 0.52 if "maskable" in name else 0.68 if size > 64 else 0.78
        draw_mark(size, scale, PAGE).save(PUBLIC / name)

    for path in sorted(OUT.glob("*.png")) + [
        PUBLIC / n
        for n in (
            "apple-touch-icon.png",
            "icon-192.png",
            "icon-512.png",
            "icon-maskable.png",
            "favicon.png",
        )
    ]:
        size = Image.open(path).size
        print(f"{path.relative_to(ROOT)}  {size[0]}x{size[1]}  {path.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
