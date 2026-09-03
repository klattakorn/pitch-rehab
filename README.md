# Pitch Rehab — Smart Rehab. Stronger Comeback.

> Renamed twice: คืนสู่สนาม / Return-To-Pitch → RehabFootball → **Pitch Rehab**. The
> interface is English only; the backend still carries `*_th` columns so a Thai edition
> stays possible without a schema change.


Position-specific football rehabilitation. A player logs an injury, gets a programme
built for **their position and their injury site**, does the exercises in front of
their phone camera while MediaPipe scores their form, and only leaves a phase when
every **exit criterion** actually passes — measured, not felt.

```
6 positions  ×  7 injury sites  =  42 protocols  ×  4 phases  ·  33 MediaPipe landmarks
```

Python/FastAPI backend plus a browser front end that runs MediaPipe live.

---

## Running it

**Double-click `start.bat`.**

That is the whole thing. It installs anything missing the first time, opens two
server windows, waits until the app is up, and opens your browser at
<http://localhost:5173>. To stop, close the two server windows.

From a terminal it is the same:

```bash
start.bat
```

If you would rather run the two halves yourself, in two terminals:

```bash
uvicorn app.main:app --reload
```

```bash
cd web && npm run dev
```

First boot creates the SQLite schema and seeds all 42 protocols.

| | |
|---|---|
| App | <https://localhost:5173> |
| API docs | <http://localhost:8000/docs> |
| Health check | <http://localhost:8000/healthz> |

**On a phone**, `start.bat` prints a **QR code**. Point the phone's camera at it and
tap the link — no address to type, and nothing to get wrong. Same wifi as the laptop.
The phone warns about the certificate once (Android: *Advanced → Proceed*; iOS: *Show
Details → visit this website*); tap through and the camera works.

For a bigger code — on a projector, or across a room — open
<https://localhost:5173/phone> on the laptop. Or print one any time with:

```bash
cd web && npm run phone
```

That warning is unavoidable and expected. A browser will not open a camera unless the
page came from a secure origin — `localhost` is exempt, a plain `http://192.168.x.x`
address is not — so the dev server signs its own certificate, which no phone has any
reason to trust. See [Running it on a phone](#running-it-on-a-phone).

**Sending it to someone with an iPhone, or anyone not on your wifi?** The built
front end runs with no backend at all, so it is hosted.

**Double-click `update-site.bat`.** It re-records the demo data, checks the build,
commits, and pushes; Cloudflare Pages rebuilds the repository and serves it at one
address, on any device, over real https so the camera works without a warning.

By hand, it is `python scripts/make_snapshot.py`, then a commit, then `git push`.
See [docs/WEB.md](docs/WEB.md).

**Want something to look at?** A fresh account is honest and useless to show anyone —
every chart says "nothing measured yet". This builds a player three weeks into an ACL
rehab, with sessions behind them and a gate that has something to say:

```bash
python scripts/seed_demo.py
```

Sign in as `demo@pitchrehab.app` / `correct-horse-battery`. Re-running rebuilds them
from scratch, so it doubles as the reset button between rehearsals — and it only ever
touches that one account. `--blocker none` leaves the phase ready to advance;
`--list` shows the choices.

**Not sure where to start?** With the server running, in a second terminal:

```bash
python scripts/walkthrough.py
```

It creates a winger with a hamstring tear and drives the whole journey — assigns the
protocol, scores a camera session, logs pain, syncs health data, and prints the exit
criteria gate before and after so you can watch it unlock. Every step prints the
endpoint it called, so you can repeat any of it by hand in `/docs`. Safe to re-run.

### Checking the pose engine against a real video

Everything in the test suite runs on skeletons generated in code. To find out
whether it works on an actual body, film yourself doing an exercise and run:

```bash
python scripts/check_video.py squat.mp4 single_leg_squat --side left --out marked.mp4
```

It prints how often MediaPipe found you, how many reps it counted, the angles for
each rep, and why any rep was rejected. `--out` writes a copy of your video with the
skeleton and the live angles drawn on top — watch that back, because it shows
immediately whether the numbers match what your body did.

First run offers to download the MediaPipe pose model (~9 MB, from Google's official
model host) into `models/`. Nothing is fetched until you say yes.

```bash
pytest
```

```bash
ruff check app tests
```

---

## The demo front end

```bash
cd web && npm install && node scripts/vendor-assets.mjs && npm run dev
```

Open <https://localhost:5173> with the backend running in another terminal.

**Five tabs, once you are in.**

| Tab | What it is |
|---|---|
| **Home** | Current plan, today's session, the week at a glance |
| **Plan** | All four phases as tabs — drills, doses, and which need the camera |
| **Progress** | Overall percentage, accuracy over time, sessions per day, milestones |
| **Test** | The exit-criteria gate: what still stands between you and the next phase |
| **Profile** | Position, injury, connected apps, and what this is not |

Before that there is a short linear onboarding — welcome → **position** → **injury** —
because a programme cannot exist until both are known.

**No internet needed.** MediaPipe's wasm and the pose model are copied into
`web/public`, so nothing is fetched from a CDN at run time. Presentation wifi fails;
this removes that risk.

A generated copy of the exercise library also sits in `web/src/fallback.ts` for the day
the *backend* dies mid-demo — but nothing imports it yet, so the app still needs the
API. Parked deliberately, not forgotten.

### Pointing at the injury instead of naming it

Seven medical names in a list is a quiz. The injury step shows a front and a back
silhouette with a marker on each site, and the list beside it stays in step — tap
either. The front/back split does real work: the two most common injuries here sit on
opposite sides of the leg, a hamstring behind the thigh and an ACL in front of the knee.

`bodymap.test.ts` pins the parts that would fail silently — every site the server has a
protocol for has a marker, no two markers overlap enough to catch the wrong tap, and the
hamstring is on the back.

**It works on a phone**, which took more than a media query — see
[Running it on a phone](#running-it-on-a-phone) below.

### Running it on a phone

The app is meant to be used with a phone propped up while you exercise, so it has to
actually work on one. Six things were in the way, and all six are handled by
`start.bat`.

**1. The camera needs https.** A browser will not call `getUserMedia` unless the page
came from a secure origin. `localhost` is exempt by special case; the
`http://192.168.x.x` address a phone has to use is not — so on plain http the pose
detection, which is the entire point of the app, simply cannot run there.

`web/scripts/make-cert.mjs` generates a self-signed certificate covering `localhost`
and every local network address this machine has, and Vite serves https when it finds
one. The phone warns once, because nothing has any reason to trust a certificate this
laptop signed for itself. Tap through it.

**The certificate keeps itself current.** The laptop's address is a DHCP lease, so it
moves on its own — this machine went `.46`, `.47`, `.48` inside three days. Each time,
the certificate still named the old address, the phone refused to connect, and neither
screen said why. So the dev server now checks on every start and rewrites the
certificate when the two disagree. You should never need to think about it; if you
want to anyway:

```bash
cd web && node scripts/make-cert.mjs --force
```

`RTP_HTTPS=0` forces plain http back on for anything that cannot click through the
warning.

Only the browser-facing origin has to be secure. The API stays on plain http and Vite
proxies to it, a hop that never leaves the machine.

**2. The big model is too slow.** `pose_landmarker_full` is what the laptop runs and
what the cross-check fixtures were generated from. On a mid-range phone it is a
slideshow. `pose_landmarker_lite` is a little over half the size and several times
faster, and `mediapipe.ts` picks it on any device with a coarse pointer. This only ever
downgrades on hardware that cannot run the full model well — smooth bad advice is still
bad advice.

**3. Phones have two cameras.** The one you want depends on whether you can see the
screen. A flip button appears when the device reports more than one.

Which one is showing changes more than the picture: a front camera is mirrored so you
see yourself the way a mirror would, and a rear camera is not. The preview is flipped in
CSS and the skeleton is flipped in JavaScript, and if those two ever disagree the
skeleton slides to the wrong side of the screen while every angle it reports stays
correct — which looks exactly like the pose engine failing. `render.test.ts` pins them
together.

**4. The screen turns itself off.** You prop the phone up and walk three metres away.
Without a wake lock the screen sleeps mid-set, the video track stalls and the rep count
stops — again, indistinguishable from the engine breaking. `keepScreenAwake()` holds one
for as long as the camera is running and re-acquires it when you come back to the tab.

**5. Sometimes there is no server to reach.** Not a network problem — a room that
will not let you install Python or start anything. Every other fix here assumes a
laptop is there to be found, so the app carries the backend's answers with it:
`scripts/make_snapshot.py` records what the real API says for every screen, and the
installed app can replay it with nothing running anywhere.

The camera keeps working untouched, because it never needed the server — rep counting
and form scoring run on the phone in `pose/live.ts`. What the app will not do is
recompute: a set logged that way is stored and reported as not yet counted, and a
band on every screen says the app is running from a snapshot.

**6. Nobody can type an IP address.** `https://192.168.0.48:5173` is twenty-five
characters of digits and punctuation on a phone keyboard, and one wrong digit gives you
a timeout that says nothing about which digit. So the server prints a **QR code**
instead — in the terminal when it starts, and at `/phone` as an SVG for a projector.

`web/scripts/qr.mjs` is the encoder: byte mode, error correction level M, versions 1 to
10, about 350 lines. It is written out rather than installed because `start.bat` has to
work on a teammate's laptop with no internet, and a dependency is one failed
`npm install` away from no demo at all.

`phone.mjs` draws it to the terminal in ANSI background colours. Both halves of that
matter: block characters come out as mojibake in a `cmd` window on a Thai-language
Windows, and drawing in the *foreground* colour turns the code into a photographic
negative on a dark terminal theme, which plenty of scanners refuse.

A QR code is either exactly right or it is a grey square, so `qr.test.mjs` **decodes**
every code back out again with a reader written separately from the encoder, checks
each error-correction block against Reed-Solomon syndromes computed with its own copy
of the field arithmetic, and cross-checks the block tables against the published
codeword totals.

Beyond the camera, the usual phone tax: 16px form fields so iOS does not zoom and never
zoom back, safe-area padding for the notch, a portrait 3:4 camera frame (a standing
player in a 4:3 landscape box is cropped at the knees) that turns 16:9 when the phone
does, a sticky **Finish set** button, 44px touch targets, and hover states behind
`@media (hover: hover)` so they do not latch on after a tap.

### Choosing a position, before anything else

The first thing a new player is asked is what they play, because it is not a profile
field — it sets the sprint targets they have to clear before they are allowed back, and
it adds drills specific to the job. A winger has to hit 97% of their own best sprint
speed to be cleared; a goalkeeper, 85%.

So the picker shows what each choice changes rather than asking for it on trust. The
numbers come from `GET /catalog/positions`, which is derived from the same
`POSITION_PROFILES` the protocol composer uses — the promise on the screen and the
programme the player is handed cannot drift apart.

Positions are listed easiest gate first, each with a bar showing where its sprint
target sits. That bar is zoomed to the 70–100% band the gates actually live in, because
on a plain 0–100 scale all six look identical; the real percentage is printed next to
it, and that is the number that means anything.

Changing position later re-points any open episode onto the new programme
(`realign_protocol`). The player keeps their phase, their clock and their history —
only the targets move.

### How it looks, and why

The full system is in **[docs/DESIGN.md](docs/DESIGN.md)**. Two ideas carry it.

**Colour is rationed.** The interface is monochrome — every surface, every control,
every piece of chrome is a cool grey. Colour appears only when it means something:
`volt` says *you can act here*, and green, amber and red say *passed*, *fix this*,
*stop*. The previous design used one green seventy-two times for the brand, the buttons,
the bars, the ticks and the tabs, which left green meaning nothing in an app whose whole
job is telling you good from bad. Volt sits 74° from the pass green so the two can never
be confused, and no state is ever carried by colour alone.

**The app is read from two distances.** Every screen but one is held at arm's length.
The camera screen is propped up three metres away while you exercise, so it has its own
type scale: the rep count is 104px, coaching is one 30px word, and state fills the frame
edge rather than sitting in a badge you have to find. Everything that does not need
reading at that range — sets, rest, raw angles — sits below the frame at normal size.

### How it moves

One idea, everywhere: things rise into place and settle. Nothing bounces, nothing
slides sideways, nothing spins. Screens fade up as they arrive; cards, criteria and rep
rows fan in behind them; bars, rings and numbers fill from zero because a figure
arriving is information, not decoration.

Two rules keep it from getting in the way, both enforced in `web/src/motion.ts`:

- **Motion never gates meaning.** Every animation starts from a layout that is already
  correct and ends on the real value. Drop the frames, kill the animation, hide the
  tab — you lose polish and nothing else. A hidden tab never runs
  `requestAnimationFrame`, so values are applied immediately there rather than being
  queued for a frame that will not come.
- **`prefers-reduced-motion` is honoured in JavaScript as well as CSS.** The stylesheet
  switches the keyframes off; the helpers jump counters, bars and rings straight to
  their values instead of easing toward them.

The one place with any overshoot is the rep counter on the camera screen, when a rep is
accepted. That is the moment the whole project is selling.

### Showing the player what "correct" looks like

Before the camera starts, each exercise demonstrates itself: an animated figure, a
diagram of where to put the phone, the coaching cue, and the list
of what will actually be measured. There is also a "common mistake" toggle, so the
fault the app is about to flag can be seen before it happens.

The animation is **generated from the exercise's own scoring rule** — `web/src/demo/`
reads `pose_rule`, takes the movement from `detection.signal` and the depth from the
target threshold, and animates a figure that hits exactly that. So the demonstration
cannot drift from the marking: change `knee_flexion ≥ 60` in `app/data/exercises.py`
and the figure squats deeper. That also means no video needs filming for 24 exercises,
and nothing is copied from anyone.

If a real clip is ever recorded, `Exercise.demo_url` is already on the model and takes
precedence.

**One library, two runtimes.** The browser does not have its own copy of the
thresholds: it fetches each `pose_rule` from `GET /catalog/exercises` and scores against
that. The maths, though, is implemented twice — Python on the server, TypeScript in the
browser — because live feedback cannot wait for a round trip. Two implementations is a
real risk, so `web/src/pose/crosscheck.test.ts` pins them together against a fixture
generated from the Python: identical joint angles on every frame, identical rep counts,
identical fault codes. Regenerate it whenever `app/services/pose` changes:

```bash
python scripts/make_crosscheck_fixture.py
```

The live guards in `web/src/pose/live.ts` are the streaming version of the server's
batch checks — the server compares each frame against the median of the whole set,
which is not available at frame thirty, so the browser compares against a rolling
three-second window instead.

## How the pieces fit

```
              phone (MediaPipe Pose, 33 landmarks)
                            │  landmark frames
                            ▼
                    POST /sessions/{id}/sets
                            │
                   ┌────────▼─────────┐
                   │  pose engine     │
                   │  angles, reps,   │
                   │  form score      │
                   └────────┬─────────┘
                            │
                            ▼
                       metric_sample
                          ▲   ▲
          pain logs / PROs┘   └field tests (hop, sprint, dyno)
                            │
                ┌───────────▼────────────┐
                │  exit-criteria engine  │  ← per-position targets
                └───────────┬────────────┘
                            ▼
                    phase gate: pass / fail
```

Everything measurable lands in one table (`metric_sample`) under a namespaced key,
and the criteria engine only ever reads from there. That is why a criterion can be
written once and satisfied by a phone camera, a stopwatch, or a dynamometer
without the engine caring which.

---

## The two engines

### 1. Pose — `app/services/pose/`

MediaPipe runs **on the device** (real-time coaching, works offline, no video leaves
the phone). The app streams landmarks; the server **recomputes every angle from those
landmarks** rather than trusting numbers the client calculated.

| File | What it does |
|---|---|
| `landmarks.py` | The 33 MediaPipe landmarks, and `sided("knee", Side.LEFT)` lookups |
| `geometry.py` | Joint angles, trunk lean, pelvic drop, knee valgus, heel raise, weight shift |
| `rules.py` | `ExerciseRule` — what "good form" means for one movement |
| `analyzer.py` | Rep segmentation, per-rep scoring, violations, form score, metric emission |

An `ExerciseRule` is data, stored as JSON on `exercise.pose_rule`, so the app can
fetch it and run the *same* thresholds live on-device:

```jsonc
{
  "mode": "rep",
  "view": "front",
  "detection": { "signal": "knee_flexion", "enter": 30, "exit": 15, "min_amplitude": 20 },
  "targets": [
    { "metric": "knee_flexion", "aggregate": "peak", "min": 60, "code": "depth_insufficient" },
    { "metric": "knee_valgus",  "aggregate": "peak", "max": 8, "critical": true,
      "code": "knee_valgus", "message_th": "เข่าบิดเข้าด้านใน ดันเข่าออกให้อยู่แนวนิ้วเท้ากลาง" }
  ],
  "emit": [ { "metric": "knee_flexion", "as_key": "pose.slsq_knee_flexion" } ]
}
```

Two things worth knowing:

- **`critical: true` invalidates the rep** (it does not count toward the prescribed
  reps). Non-critical targets only cost form-score points — depth is coaching, knee
  collapse is a safety stop.
- **Rep detection uses hysteresis** (`enter` above `exit`), so a signal hovering at the
  threshold cannot produce a burst of phantom reps.

**Camera placement matters, and the rule says which.** From the front, knee flexion
happens along the camera axis and is invisible in 2D, so front-view rules use
MediaPipe's depth estimate (`use_z` defaults to `view == "front"`). Knee valgus is the
opposite — it is measured strictly as horizontal deviation from the hip–ankle line,
never as a 3-point angle, because in a 2D projection that angle is just knee flexion
in disguise.

### What real footage taught us

The first video ever put through this engine produced garbage: one 15-second "rep",
90° of knee collapse, a trunk leaning 175°. Three separate defects, all now fixed and
covered by tests:

**1. Normalized coordinates are not square.** MediaPipe divides x by the image width
and y by the image height *separately*, so on a 1080×1920 phone video one x unit is a
much shorter distance than one y unit. Every angle computed from raw coordinates is
skewed — knee flexion read 21° too high. `Frame.from_payload` now takes an `aspect`,
and `POST /sessions/{id}/sets` takes `image_width` / `image_height`. **Send them.**
Without them the server assumes a square image and quietly gets everything wrong.

**2. The camera was in the wrong place.** The clip was filmed side-on; the split-squat
rule expects head-on. Angles measured from the wrong plane are not slightly off, they
are meaningless, so `analyze_set` now detects the view (from how wide the shoulders and
hips look — side-on measured 0.17, head-on 0.64) and raises `WrongCameraView`. The API
turns that into a `422` with a bilingual "move the phone" message rather than a bad
score. Those two things mean different things to a player and must not be blurred.

**3. MediaPipe lies with total confidence.** When the player's head left the top of the
shot, it returned a scrambled skeleton — body shrunk to 4% of normal height, shoulders
below hips — while reporting 0.99 confidence on every landmark. Confidence scores
cannot catch this. `implausible_frames` compares each frame against the rest of the set
on apparent body size and torso direction, and drops the ones that disagree. Comparing
against the set rather than against an anatomical rule keeps it working for lying-down
exercises.

**4. Some faults are invisible to the wrong camera, and the number is worse than
nothing.** The player had deliberately let the back knee fall inward on the last two
reps. Measured from the side, those reps showed +1.9° more valgus on one leg and 11°
*less* on the other — no signal at all. Meanwhile the figure itself sat at a confident
+24° to +40° on every rep, good and bad alike, because a leg swinging forward gets
misread as a knee drifting inward. `ExerciseRule` now refuses to build a `view="side"`
rule that asks for `knee_valgus`, `pelvic_drop` or `weight_shift_ratio`. That guard
immediately caught two exercises in this library — the glute bridge and the single-leg
RDL — which had been scoring players on something their camera could not see.

After the fixes, the same video reads 5 reps, 86–100° of knee bend, 12–19° of trunk
lean — all plausible, with a `frequent_tracking_loss` warning telling the player to
re-film. Reproduce with `scripts/check_video.py`.

**Still unverified:** valgus detection has never been tested against a real body. It
needs a front-on video of someone letting the knee collapse on purpose.

### 2. Exit criteria — `app/services/criteria/`

A criterion is declarative JSON. This is the whole vocabulary:

```jsonc
{
  "metric": "test.yo_yo_ir1",
  "source": "health",
  "aggregate": "max",          // latest | max | min | mean | median | p95 | sum | count
  "window_days": 14,           // null = "any time during this injury episode"
  "comparator": "gte",         // gte | gt | lte | lt | eq | between
  "target": { "type": "percent_of_baseline", "value": 90 },
  "scope": "any",              // any | injured | uninjured | both
  "min_samples": 1             // stops one lucky rep clearing a gate
}
```

Four target types:

| Type | Means | Example |
|---|---|---|
| `absolute` | A raw threshold | pain ≤ 2/10 |
| `percent_of_baseline` | % of *this player's own* number | max speed ≥ 90% of pre-injury |
| `lsi` | Limb symmetry index, injured ÷ healthy × 100 | triple hop ≥ 90% |
| `delta` | Baseline ± a raw amount | — |

**Baseline resolution order** — stored personal baseline (healthy limb first) →
90 days of pre-injury history (90th percentile) → position norm → `no_data`. The
result reports which one it used, in `baseline_origin`, so nothing is silently
invented.

Evaluation returns per-criterion `status` (`pass` / `fail` / `no_data` /
`pending_signoff`), the observed value, the target, and a **0–1 progress** number so
the app can draw the poster's progress bars. `no_data` never counts as a pass, and
optional criteria never block a phase.

Two things the engine will not let you skip:

- `min_days` per phase is a tissue-healing constraint, enforced regardless of how
  good the numbers look.
- Phase 4 always ends in a `manual.rtp_clearance` criterion. The app measures; a
  human signs the release.

Every gate evaluation that changes a phase is frozen into `phase_attempt.snapshot`,
so a clinician can always answer *"why was this player cleared?"*.

### Writing your own exit criteria

The 42 protocols ship with a gate per phase. A player can add to it — *"do 20 single-leg
calf raises in one set"*, *"run at 7.8 m/s"*, *"triple hop within 95% of the other leg"* —
and those tests join the battery like any other, blocking the phase until they pass.

**Two decisions, not eight.** A `CriterionSpec` has eight fields and most have exactly
one sensible value for a given metric. The screen asks what to measure and the number;
`app/data/authorable.py` supplies the rest — the aggregate, the window, the direction of
the comparison.

The direction is deliberately not a choice. Nobody sets out to require pain of *at
least* 8/10, so the metric decides and the screen states it. What the player sees while
they type is the finished sentence:

> **Single-leg calf raise: do at least 20 reps in one set**

which is checkable in a way `{"comparator": "gte", "value": 20}` is not.

**Why a catalogue and not a text field.** The engine can gate on any metric key at all.
Left open, someone types `pose.kneeflexion`, nothing ever writes that key, and they
have built a test that can never pass and no error to explain why. The API refuses
anything outside the catalogue for the same reason it refuses reps on a hand-logged
drill: nothing counts reps for an exercise the camera never sees.

**Same key means replace, not argue.** *"The standard hop test, but 95%"* is a change
to an existing rule, not a second rule sitting beside it disagreeing. A custom criterion
whose key matches a library one takes its place; deleting it brings the standard target
back. A new key is simply an extra test, and it lands after the standard battery so the
two stay legible as two.

**One thing cannot be redefined.** Phase 4 requires a clinician to sign the player off.
It is the only check in the app that is not self-assessed, so it is the one the API
refuses to swap for a number.

Player-authored criteria live on the **episode**, not the phase — the library's criteria
are shared by every player on that protocol, so a personal target stored there would
appear in forty-one other people's rehab.

Two metrics exist only for this: `session.reps.<exercise>` and
`session.form.<exercise>`, derived from completed sets. Reps read the **best single
set**, never the sum — "do 20" means twenty in a row, and summing would let someone
clear the gate with two sets of ten a fortnight apart, having never once done the thing
the gate is about.

---

## Metric namespaces

| Prefix | Written by | Examples |
|---|---|---|
| `pose.*` | The pose engine, on set upload | `pose.slsq_knee_flexion`, `pose.knee_flexion_rom`, `pose.landing_knee_valgus`, `pose.copenhagen_hold` |
| `test.*` | `POST /injuries/{id}/tests` | `test.hop_triple`, `test.sprint_30m`, `test.iso_hamstring`, `test.heel_raise_reps` |
| `pro.*` | Pain logs and session completion | `pro.pain_rest`, `pro.pain_activity`, `pro.confidence`, `pro.rpe` |
| `session.*` | Computed on the fly, never stored | `session.days_in_phase`, `session.adherence_pct`, `session.pain_free_days`, `session.mean_form_score` |
| `manual.*` | Clinician sign-off | `manual.rtp_clearance` |

A criterion's `metric` **must** be namespaced with its own `source` — the schema
rejects mismatches, so a typo cannot silently create a gate that never fires.

---

## The protocol library

42 protocols are **composed**, not hand-written:

```
injury template (what the tissue needs)  +  position profile (what the job needs)
```

Edit these three files and re-seed — never the database by hand:

| File | Holds |
|---|---|
| `app/data/exercises.py` | 27 exercises with their MediaPipe rules and Thai/English cues |
| `app/data/protocols.py` | 7 injury templates × 4 phases, 6 position profiles, and the composer |
| `app/data/position_norms.py` | Fallback reference values per position |

The position profile is what makes the poster's claim real. Same hamstring tear:

| Position | Speed to leave phase 3 | Speed to be cleared | Extra work |
|---|---:|---:|---|
| Winger | 90% | 97% | lateral bounds, repeated sprint, sprint-decrement gate |
| Full back | 88% | 96% | repeated sprint, weekly distance gate |
| Striker | 88% | 95% | heading jumps, CMJ symmetry |
| Centre midfield | 85% | 93% | weekly distance gate |
| Centre back | 85% | 92% | heading jumps, CMJ symmetry ≥ 92% |
| Goalkeeper | 75% | 85% | dive landings, lateral landing-control gate |

All percentages are of the **player's own** baseline, so the same rule means something
different for every player as well as every position.

Re-seeding replaces protocols wholesale (phases, prescriptions and criteria cascade),
so the data files stay the single source of truth.

---

## API

Everything is under `/api/v1`. Auth is a bearer JWT from `/auth/login`.

**Auth & player**

| Method | Path | |
|---|---|---|
| `POST` | `/auth/register` | Players must pick a position — it decides their protocol |
| `POST` | `/auth/login` | Same 401 for unknown email and wrong password |
| `GET` | `/auth/me` | |
| `PATCH` | `/players/me/profile` | Changing position re-points open episodes at the new programme |
| `GET` `PUT` | `/players/me/baselines` | Personal reference values for `percent_of_baseline` |
| `GET` | `/players/me/reference-values` | What the engine would use with no baseline stored |

**Catalog**

| Method | Path | |
|---|---|---|
| `GET` | `/catalog/positions` | The six roles and what each one changes — powers the role picker |
| `GET` | `/injuries/{id}/progress` | The Progress tab, derived on read — never stored |
| `GET` | `/catalog/exercises` | Includes each `pose_rule` for on-device scoring |
| `GET` | `/catalog/protocols` | All 30, filterable by position / injury site |
| `GET` | `/catalog/protocols/{position}/{injury_site}` | Full 4-phase programme |
| `GET` | `/catalog/phases` | |

**Injury episode**

| Method | Path | |
|---|---|---|
| `POST` | `/injuries` | Opens an episode and auto-assigns the position × injury protocol |
| `GET` | `/injuries` · `/injuries/{id}` | |
| `GET` | `/injuries/{id}/today` | The exercises for the current phase |
| `GET` | `/injuries/{id}/protocol` | |
| `GET` | `/injuries/{id}/exit-criteria` | **The pass/fail screen.** `?phase=` to preview another |
| `GET` | `/injuries/criteria/authorable` | What a player can build their own tests from |
| `GET` `PUT` | `/injuries/{id}/criteria` | Their own tests. PUT is an upsert on the key |
| `DELETE` | `/injuries/{id}/criteria/{key}` | Removing an override restores the standard target |
| `POST` | `/injuries/{id}/advance` | Moves on only if every required gate passed |
| `GET` | `/injuries/{id}/attempts` | Frozen audit trail of every gate decision |
| `POST` | `/injuries/{id}/signoff` | Clinician only (403 for players) |
| `POST` `GET` | `/injuries/{id}/pain-logs` | |
| `POST` | `/injuries/{id}/tests` | Field test results — send `side` for symmetry gates |
| `GET` | `/injuries/{id}/metrics` | Raw samples |

**Sessions**

| Method | Path | |
|---|---|---|
| `POST` | `/injuries/{id}/sessions` | |
| `POST` | `/sessions/{id}/sets` | Landmark frames in, scored reps + violations out |
| `POST` | `/sessions/{id}/complete` | |

**Health**

| Method | Path | |
|---|---|---|

### Uploading a set

```jsonc
POST /api/v1/sessions/12/sets
{
  "exercise_key": "single_leg_squat",
  "side": "left",
  "prescribed_reps": 10,
  "space": "image",              // or "world" for pose_world_landmarks
  "keep_frames": false,          // true stores a downsampled trace for the physio
  "frames": [
    { "t": 0.000, "landmarks": [ {"x":0.51,"y":0.22,"z":-0.10,"visibility":0.99}, /* ×33 */ ] },
    { "t": 0.033, "landmarks": [ /* ×33 */ ] }
  ]
}
```

Response gives per-rep validity, form score, the violations with **bilingual coaching
cues**, and the metrics that were pushed to the criteria engine. Drills with no camera
rule (running, agility) send `completed_reps` instead of frames.

Raw frames are **not** stored by default — the phone streams them, the server scores
them, only derived numbers persist.

---

## Tests

**91 on the server, 229 in the browser.** They cover what actually matters rather than
line count:

- `test_pose.py` — angles match the pose they were built from; depth failures coach but
  still count the rep while knee collapse invalidates it; hysteresis rejects threshold
  chatter; low visibility is reported, not silently scored; front-view flexion genuinely
  needs depth.
- `test_criteria.py` — absolute / percent-of-baseline / LSI targets; injured-limb scope
  ignores a great number on the healthy side; the same injury gets a different speed
  target per position; `min_samples`; sign-off gating; `min_days` blocks even with
  perfect numbers; clearing the last phase closes the episode.
  are reported not swallowed, HSR derivation, pre-injury baseline derivation.
- `test_api_flow.py` — the whole journey the app will make, plus authorisation edges
  (players cannot sign themselves off, cannot read another player's episode), and the
  role picker: the numbers it shows are the ones the protocol really enforces, and
  changing position moves the targets without losing the player's progress.

In `web/`:

- `crosscheck.test.ts` — the Python and TypeScript pose maths agree, pinned by a
  generated fixture.
- `live.test.ts` — the streaming rep state machine and its rolling-window guards.
- `demo.test.ts` — every exercise has a distinct "wrong" pose to demonstrate.
- `roles.test.ts` — what a position changes, and the attribute hooks the animations
  find their work by. Motion that quietly stops working breaks nothing else, so the
  contract is pinned in a test rather than left to a visual check.
- `render.test.ts` — the skeleton lands on the body whichever camera is in use, and the
  live readout is in English. Both are failures you would only catch by looking.
- `bodymap.test.ts` — every injury the server has a protocol for has a marker on the
  body, markers do not overlap, and the hamstring is on the back.
- `charts.test.ts` — a day with no session is a gap in the line, never a zero. A chart
  that plots "did not train" as 0% accuracy tells a player they failed.
- `criteria.test.ts` — the sentence the builder shows while you type, and the draft it
  sends. That sentence is the only thing between a player and a target they did not
  mean to set.

`tests/factories.py` builds synthetic 33-landmark traces, so the pose engine is tested
without a camera.

---

## Read this before it touches a real player

- **This is a training aid, not a medical device.** Nothing here diagnoses. Phase 4
  always requires a human sign-off, deliberately.
- **The thresholds are defaults, not clinical truth.** The exit criteria follow common
  return-to-sport practice (LSI ≥ 90%, pain ≤ 2/10, staged speed exposure), but a
  physio should review and adjust every one for your setting before use.
- **Players can now set their own targets, including looser ones.** That is the point of
  the feature and also its risk: a player who moves their pain ceiling from 2/10 to 6/10
  has not got better, they have moved the goalposts. Overrides are marked as theirs on
  the gate and the standard target is one tap away, but nothing stops them. In any real
  setting this should be a clinician's screen, not a player's.
- **`app/data/position_norms.py` is configuration.** Those numbers exist only so a
  first-time user with no history gets a concrete target instead of a wall. Replace
  them with your own testing data.
- **The Thai copy is a first pass.** Have a Thai-speaking physio review the wording —
  exercise names and coaching cues especially.
- **MediaPipe's depth estimate is rough.** It is good enough for the flexion thresholds
  used here; it is not motion capture. Camera placement per `rule.view` matters more
  than any of the maths.

## Not done yet

- **Alembic.** `create_all` is fine while the schema moves; add migrations before the
  first real deployment.
- **Refresh tokens, rate limiting, password reset, email verification.** Auth is a
  single long-lived access token today.
- **Postgres.** Everything is Postgres-ready (`RTP_DATABASE_URL`), but it has only been
  run on SQLite.
- **`RTP_SECRET_KEY` must be set in production** — the app refuses to boot with the dev
  key when `RTP_ENV=prod`.
- **Session scheduling**, and the calendar screen that would sit on top of it. The only
  screen from the product poster with nothing behind it.
- **A coach or medical-staff view.** Clinician sign-off exists as an endpoint; there is
  no screen listing a squad.
- **The offline fallback.** `web/src/fallback.ts` is generated and tested but nothing
  imports it, so the app still needs the API. Deliberately parked.

## Layout

```
app/
  core/        config, enums, JWT + password hashing
  db/          engine, session, base types, seeding
  models/      SQLAlchemy tables
  schemas/     Pydantic request/response models
  services/
    pose/      landmarks, geometry, rules, analyzer
    criteria/  spec, resolver, engine
    health/    platform mapping, ingest
    progression.py
    progress.py  what the Progress tab draws, derived from completed sessions
  data/        exercises, protocols, position norms   ← edit the library here
    authorable.py what a player may build their own tests from
  api/routers/ auth, players, catalog, injuries, sessions, health
tests/
web/src/
  main.ts      the shell and every screen: onboarding, then five tabs
  roles.ts     the role picker: what choosing a position changes
  bodymap.ts   front/back silhouettes with a marker per injury site
  charts.ts    the accuracy line and the sessions bars, as plain SVG
  criteria.ts  building your own exit criterion: wording, units, the draft
  styles.css   the design system — see docs/DESIGN.md for why
  mediapipe.ts model choice, camera (front/rear, mirroring), screen wake lock
  motion.ts    entrances, counters, bars and rings — all reduced-motion aware
  ui.ts        the mark, the icon set, the ring and bar
  pose/        the browser copy of the pose maths
  demo/        the animated how-to figure
  styles.css   palette, components, one motion language, and the phone rules
web/scripts/
  make-cert.mjs     self-signed https, kept current as the laptop's address moves
  qr.mjs            a QR encoder, so nothing has to be installed to draw one
  phone.mjs         the code to scan, in the terminal and at /phone
  vendor-assets.mjs copies the wasm and both pose models into public/
```
