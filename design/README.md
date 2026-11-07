# Source artwork

Full-resolution originals, kept out of `web/public/` so they are not packed into
the 30 MB Android build. Nothing here is loaded at run time.

| File | What it is |
|---|---|
| `max rtp.png` | The photo of Max, 1086×1448, on a plain wall. The original. |
| `max-rtp-2.png` | The second photo of Max, 1086×1448, on pure black. |
| `max-rtp-2-cutout.png` | That photo with the black removed, transparent. **The source for the home screen figure.** |
| `max-rtp-cutout.png` | The first photo, cut out. No longer used. |
| `player-source.png` | The previous home screen figure. No longer used. |
| `crest-source.png` | The club crest, 1254×1254, opaque. Every icon an operating system shows. |

## Icons

```bash
python scripts/make_app_icon.py
npx capacitor-assets generate --android   # only if the Android launcher changed
```

Everything a launcher or a home screen shows comes from `crest-source.png`.
Replace that file and re-run, and the whole set follows. Without it the script
falls back to the drawn running mark, so a fresh clone still builds.

Two sizes are deliberately not full-bleed. The Android launcher icon is inset to
two thirds and the maskable web icon to about three quarters, because both get
cropped — at full bleed the club's name across the banner is the first thing
cut off.

The 32px favicon stays the drawn mark whatever else changes. At that size the
crest is a dark smudge: a face, a shield, a ball and a line of Thai lettering
cannot survive it, and a browser tab is the one place legible beats faithful.

## Re-cropping the home screen figure

The current cut-out came on pure black, so the background is just the near-black
area connected to the edge of the picture. That keeps the black stripes on the
shoulders, which a colour-based cutter mistakes for background.

`web/public/player.png` is the head-to-mid-torso crop the plan card uses. The
card fills its slot with `object-fit: cover` and anchors the top, so the crop
decides how much of the player is seen and the card decides how much of the
crop fits.

```bash
python -c "from PIL import Image; Image.open('design/max-rtp-2-cutout.png').crop((217, 366, 877, 1166)).save('web/public/player.png')"
```

The four numbers are left, top, right, bottom in source pixels. Lower the
fourth to show less of the torso, widen the first and third to leave more air
around the shoulders. On a phone only the middle 60% of the width survives the
crop, so anything near the left or right edge of the file will not be seen.
