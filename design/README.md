# Source artwork

Full-resolution originals, kept out of `web/public/` so they are not packed into
the 30 MB Android build. Nothing here is loaded at run time.

| File | What it is |
|---|---|
| `player-source.png` | Full-body cut-out, 1042×1510, transparent. The source for the home screen figure. |

## Re-cropping the home screen figure

`web/public/player.png` is the head-to-mid-torso crop the plan card uses. The
card fills its slot with `object-fit: cover` and anchors the top, so the crop
decides how much of the player is seen and the card decides how much of the
crop fits.

```bash
python -c "from PIL import Image; Image.open('design/player-source.png').crop((200, 0, 850, 790)).save('web/public/player.png')"
```

The four numbers are left, top, right, bottom in source pixels. Lower the
fourth to show less of the torso, widen the first and third to leave more air
around the shoulders. On a phone only the middle 60% of the width survives the
crop, so anything near the left or right edge of the file will not be seen.
