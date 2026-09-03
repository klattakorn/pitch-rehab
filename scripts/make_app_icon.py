"""Make every icon an operating system shows for this app.

Two sources, for two different jobs.

``design/crest-source.png`` is the club crest, and it is what a launcher or a
home screen shows -- it is the identity people recognise. It is a photograph, so
the code cannot produce it; without the file everything here falls back to the
drawn mark and still works.

That drawn mark lives in ``web/src/ui.ts`` as an SVG, which is the right form
for the app and the wrong form for an icon -- the launcher wants PNGs at a dozen
sizes and there is no rasteriser here. So the same figure is redrawn below from
the same coordinates. It keeps the 32px favicon, where the crest is a smudge.

    python scripts/make_app_icon.py

Writes the icons ``web/public/`` serves: the one iOS uses for Add to Home
Screen, the two the manifest asks for, and the favicon. Re-run it if the mark
changes.

Everything is drawn four times oversized and shrunk at the end: Pillow's lines
have no antialiasing, and a launcher icon with stepped edges is the first thing
anyone notices about an app.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
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


#: The club crest, if it has been put here. Everything an operating system shows
#: as "the app" uses it; the drawn mark stays for the places a photograph cannot
#: survive. See `_crest`.
CREST = ROOT / "design" / "crest-source.png"


def _crest(size: int, scale: float) -> Image.Image | None:
    """The crest, scaled onto its own background so a crop cannot bite it.

    Returns ``None`` when there is no crest to use, and the caller falls back to
    the drawn mark -- which is what happens on a fresh clone, since the artwork
    is not something the code can produce.

    ``scale`` below 1 is not decoration. Android crops a maskable icon to about
    80% of the square and an adaptive launcher icon to about two thirds, and the
    crest's banner runs the full width -- at full bleed the club's name is the
    first thing cut off.
    """
    if not CREST.exists():
        return None
    art = Image.open(CREST).convert("RGB")
    if scale >= 1:
        return art.resize((size, size), Image.LANCZOS)

    inner = max(1, round(size * scale))
    # Pad with the crest's own corner rather than a guess, so the join is
    # invisible on every launcher that rounds the square differently.
    canvas = Image.new("RGB", (size, size), art.getpixel((2, 2)))
    canvas.paste(art.resize((inner, inner), Image.LANCZOS), ((size - inner) // 2,) * 2)
    return canvas


def main() -> None:
    using_crest = CREST.exists()

    # The sizes each platform looks for.
    #
    # iOS reads `apple-touch-icon` and nothing else when you Add to Home Screen;
    # without one it screenshots the page and uses that. 180 is what current
    # iPhones ask for, and it must be opaque -- transparency comes out black
    # behind the rounded corners iOS adds itself. Android and desktop Chrome read
    # the manifest instead, which wants 192 and 512.
    for size, name in (
        (180, "apple-touch-icon.png"),
        (192, "icon-192.png"),
        (512, "icon-512.png"),
        # Chrome pads a non-maskable icon onto a white circle, so this one exists
        # to stop that -- drawn smaller, because it is the one that gets cropped.
        (512, "icon-maskable.png"),
    ):
        art = _crest(size, 0.72 if "maskable" in name else 1.0)
        if art is None:
            art = draw_mark(size, 0.52 if "maskable" in name else 0.68, PAGE)
        art.save(PUBLIC / name)

    # The favicon stays the drawn mark even when there is a crest. At 32px the
    # crest is a dark smudge -- a face, a shield, a ball and a line of Thai
    # lettering cannot survive that, and a browser tab is the one place legible
    # beats faithful. Checked by looking at it, not assumed.
    draw_mark(32, 0.78, PAGE).save(PUBLIC / "favicon.png")

    print(f"Source: {'design/crest-source.png' if using_crest else 'the drawn mark'}\n")

    for path in [
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
