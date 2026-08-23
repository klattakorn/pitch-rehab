# Pitch Rehab — the design system

Two ideas hold this together. Everything else follows from them.

---

## 1. Colour is rationed

The previous design used one green for the brand, the buttons, the progress bars, the
active tab, the pass ticks and the chips — **72 times in one stylesheet**. When
everything is green, green stops meaning anything. That is a problem in any app and a
serious one here, because this app's entire job is telling a player good from bad.

So **the interface is monochrome.** Every surface, every control, every piece of chrome
is a cool grey. Colour appears only when it carries meaning.

| Token | Means | Never means |
|---|---|---|
| `--volt` `#D8FF3E` | **you can act here** | good, passed, safe |
| `--pass` `#34D77A` | this met its target | an action |
| `--fix` `#FFB020` | correct this | an error |
| `--fail` `#FF6152` | this is wrong / stop | a destructive button label alone |

Volt sits **74° away from pass** on the colour wheel, so the two can never be read as
the same thing. And no state is ever carried by colour alone — there is always an icon
and a word beside it, which is what makes it work for a colourblind viewer and in a
screenshot printed in black and white.

**The test:** count how many elements paint with the accent on one screen. Four is
right. Twelve means it has stopped being a signal.

### Surfaces

```
--page    #07080A    the ground
--card    #12151A    panels, rows
--inset   #1A1E25    inputs, wells, things inside cards
--raised  #242932    tracks behind bars, unfilled states
--edge    #2E343D    decorative separators
--edge-control  #6E747E   the boundary of an actual control
```

Two border tokens, deliberately. A separator between two surfaces is decoration — the
surface step does the grouping. The boundary of an **input, toggle or outlined button
is the affordance**, so it is held at 3:1 against every surface it can sit on.

Every text colour clears **4.5:1 on every surface it can appear on**. Checked, not
assumed.

---

## 2. The app is read from two distances

Every other screen is an ordinary phone app held at arm's length. **The camera screen is
not.** The phone is propped up two or three metres away and the player is mid-set,
sweating, looking up between reps. Ten-pixel labels do not exist at that range.

So there are two type scales.

### Near — in your hand

```
--t-micro  11px   uppercase tracked labels only
--t-small  13px
--t-body   15px
--t-lead   17px
--t-h3     21px
--t-h2     27px
--t-h1     35px
```

Nothing below 11px, and 11px only ever carries uppercase tracked labels, which stay
legible where body text would not. The old design had **16 different sizes between
8.5px and 16px** — a scatter, not a scale.

### Far — across the room

```
--far-label   19px    the "/ 12" beside the rep count
--far-word    30px    one word of coaching
--far-value   64px    a headline figure
--far-hero   104px    the rep count
```

The camera screen uses these and almost nothing else:

- **The rep count is 104px.** It was 30px.
- **Coaching is one word**, 30px — "Good form", "Fix your form", "Move the phone". A
  sentence is a wall at three metres.
- **State fills the frame edge**, not a badge. A 6px band of colour around the whole
  preview can be caught in peripheral vision mid-rep; a 12px badge has to be found.
- **Rep progress is a track along the bottom**, not a ring. A bar filling left to right
  reads without focusing on it.
- Everything that does *not* need reading at distance — sets, rest, the raw joint
  angles — sits **below** the frame at the near scale, for the walk back to the phone.

---

## Type

**Barlow Condensed** for anything numeric or headline. **Barlow** for running text.
**IBM Plex Mono** for labels and data.

Condensed is not decoration here: a rep count can be ~40% larger in the same width,
which is most of what makes the far scale fit on a phone at all.

---

## Motion

One idea: **things rise into place and settle.** Nothing bounces, nothing slides
sideways, nothing spins. One easing curve (`--ease`) for the whole app — a single ease
is what stops an interface feeling assembled from parts.

Entrances are short (300–380ms) because they happen on every screen. Data animations are
slower (850ms) because a bar filling or a number counting is information arriving.

The one piece of overshoot in the entire app is the rep counter when the camera accepts
a rep. That is the moment the project is selling.

Every animation starts from a state that is already laid out and ends on the real value,
so `prefers-reduced-motion` can switch all of it off without hiding anything —
`motion.ts` makes the same check and jumps counters, bars and rings straight to their
values.

---

## Navigation

Five tabs, which is the limit. The tab bar is chrome, so the active tab gets a **volt
rail**, not a filled pill — chrome does not get to use the accent as a background.

**The phone's back gesture means back.** The router is plain function calls, so without
`history.pushState` the Android back button and the iOS edge swipe closed the whole app
from any screen — including mid-set with the camera running. That was one swipe away
from the most destructive thing a gesture can do here.

Only screens that show a back arrow push a history entry, so the tab bar does not fill
history with five sideways moves, and a screen re-rendering itself does not push either.
The gesture runs the same handler the back arrow does, which is what releases the camera
and the wake lock.

---

## The rules that are not negotiable

- **Touch targets ≥ 44px.** Checked across all five tabs: zero violations.
- **Contrast ≥ 4.5:1** for text, **3:1** for control boundaries.
- **No state by colour alone** — always an icon and a word too.
- **Hover behind `@media (hover: hover)`**, or it latches on after a tap.
- **16px form fields**, or iOS zooms in on focus and never zooms back out.
- **Safe-area insets** on everything fixed.
- **Nothing under 11px**, except axis ticks inside a chart.

---

## What this replaced

| | Before | After |
|---|---|---|
| Accent used | 72 times, meant nothing | ~4 per screen, means "act" |
| Type sizes | 16, from 8.5px to 16px | 7 near + 4 far, on a scale |
| Rep count | 30px | 104px |
| Coaching | 12px badge | 30px word + a frame that changes colour |
| Back gesture | quit the app | goes back, releases the camera |
| Typeface | Inter | Barlow Condensed / Barlow |
