# Pitch Rehab — plan to Sunday 6 September

15 days. One unit of work below = **a half day, about 3 hours.** Some days are one
unit, some are two. If you only get one unit done on a two-unit day, use the buffer
on Sunday 30 August rather than pushing everything back.

---

> **Working with two other people?** See [docs/TEAM.md](docs/TEAM.md) — who owns which
> files, what footage and evidence to ask them for, and a three-lane version of the
> calendar below. This file stays the code lane.

## Where you actually are today (22 August)

Checked just now, not from memory:

| | |
|---|---|
| Backend tests | 73 passing |
| Browser tests | 154 passing |
| Works end to end | sign in → pick injury → today's session → camera scores your reps → exit criteria |
| Verified against a real body | rep counting, knee bend angle, trunk lean, tracking failure, camera-angle detection |
| **Not** verified against a real body | **knee falling inward (valgus)** |
| Not built yet | Progress screen, session scheduling, notifications, coach view, Garmin/WHOOP |

You are further along than the calendar suggests. The risk is not "will it be
finished" — it is "will it work in the room, on the day, in front of people".
The plan is weighted accordingly.

---

## The shape of the 15 days

| Dates | Block | What it is for |
|---|---|---|
| Sat 22 – Tue 25 Aug | **De-risk** | Prove the thing you are selling actually works, and make the demo survive a bad room |
| Wed 26 Aug – Tue 1 Sep | **Build the poster** | The screens on your product poster that do not exist yet |
| Wed 2 – Thu 3 Sep | **Polish and freeze** | Tidy, test, write the demo script |
| Fri 4 – Sun 6 Sep | **Rehearse** | Run it for real, twice, and record a backup |

### The one rule

**No new features after Wednesday 3 September.** From Thursday onward you only fix
things that break during rehearsal. Every school project that dies, dies because
someone added one more feature on the last night.

---

## Day by day

Re-cut on **23 August**. The building ran well ahead of this plan and the
de-risking ran behind it, so the two have swapped places: everything left before
the freeze is now about the demo working, not about the app doing more.

| Date | Day | Task | Units |
|---|---|---|---|
| ~~Sat 22 Aug~~ | | ~~**5a.** Progress endpoint~~ · ~~**7.** Notifications~~ | ✅ |
| ~~Sat 22 Aug~~ | | ~~**5b.** Progress screen~~ · position picker · phone + https · redesign | ✅ |
| Sun 23 Aug | Sun | **1.** Prove the knee-valgus check on a real front-on video | 1 |
| Mon 24 Aug | Mon | **2.** Fix whatever that video exposes | 1 |
| ~~Tue 25 Aug~~ | | ~~**4.** Demo player with three weeks of history~~ | ✅ |
| Wed 26 Aug | Wed | **6a.** Session scheduling — backend + the "Today, 4:30 PM" card | 1 |
| Thu 27 Aug | Thu | **6b.** Calendar screen — the last poster screen with nothing behind it | 1 |
| Fri 28 Aug | Fri | Buffer — the video is the thing most likely to need a second go | — |
| Sat 29 Aug | Sat | **8a.** Coach view — backend, *or* cut it | 1 |
| Sun 30 Aug | Sun | **8b.** Coach view — screen, *or* cut it | 1 |
| Mon 31 Aug | Mon | Buffer | — |
| Tue 1 Sep | Tue | Buffer | — |
| Wed 2 Sep | Wed | **9.** Polish pass | 2 |
| Thu 3 Sep | Thu | **10.** Code freeze + write the demo script | 2 |
| Fri 4 Sep | Fri | **11.** Rehearsal 1 — demo device, wifi off | 1 |
| Sat 5 Sep | Sat | **12.** Rehearsal 2 + record a backup video | 1 |
| Sun 6 Sep | Sun | **Deadline.** Light check only. No code. | — |

### Already done, ahead of schedule

- **Progress screen and endpoint** (was 26–27 Aug) — overall %, accuracy over time,
  sessions per day, strength balance, milestones
- **Notifications** (was 29 Aug) — the bell, generated from your real plan and gate
- **Position picker** — registration used to hardcode "striker" for everyone, so most
  players were quietly getting the wrong programme
- **Phone support** — https so the camera works, lite model, front/rear switch, wake lock
- **The Pitch Rehab redesign** — five tabs, body map, new palette
- **Player-authored exit criteria** — set your own targets; overrides replace rather
  than argue with the standard ones
- **Demo player** (was 25 Aug) — `python scripts/seed_demo.py`, three weeks of history
  and the reset button between rehearsals

Four extra days of features. Which is exactly why the two remaining risks matter more
now, not less: **nothing on this list makes the demo work if the camera check is wrong
or the app dies when the backend does.**

**Every day, before you stop:**

```bash
python -m pytest -q && cd web && npx vitest run && npx tsc --noEmit
```

---

## The tasks

### 1. Prove the knee-valgus check — Sat 22 Aug

**Why this is first.** Your whole pitch is "the camera checks whether you are doing
it right". Of everything the camera checks, the knee falling inward matters most —
it is the movement behind ACL injuries. It is also the one thing that has never been
tested against a real body. You already found out the hard way that a side-on camera
physically cannot see it. Nobody has checked that a front-on camera can.

If this is broken, you want to know on day 1, not day 14.

**Do:**

1. Record about 30 seconds. Phone **front-on**, at roughly knee height, ~2 m back,
   whole body in frame, decent light.
2. Split squats: **3 clean reps, then 3 where you deliberately let the front knee
   drop inward.** Exaggerate the bad ones.
3. **Film your two teammates doing the same.** The engine has only ever seen one body;
   different heights and builds are the cheapest useful test you can run. Full brief in
   [videos/README.md](videos/README.md).
4. Run it:

```bash
python scripts/check_video.py valgus_front.mp4 split_squat --side left --out annotated.mp4
```

5. Compare the `knee_valgus` number per rep, and watch `annotated.mp4`. Once you have
   more than a couple of clips, run the whole folder at once instead:

```bash
python scripts/batch_check.py videos/
```

That writes `docs/video-results.md` with a PASS / WEAK / FAIL verdict per exercise —
did the bad reps score worse than the good ones? Someone who cannot code can run it.

**Done when:** the three deliberate reps score clearly worse than the three clean
ones, and the app actually flags them.

**If it does not work,** the two things to look at are the saturation guard
(`abs(ratio) < 0.95` in `app/services/pose/geometry.py`) and the valgus threshold in
the `split_squat` rule in `app/data/exercises.py`. That is what Sunday is for.

---

### 2. Fix what the video exposed — Sun 23 Aug

Fix it, then re-run the same video to confirm. Then regenerate the fixture that keeps
the Python and TypeScript versions of the maths in agreement:

```bash
python scripts/make_crosscheck_fixture.py
```

**Done when:** the video reads correctly and all 227 tests still pass.

If Saturday went perfectly, spend this day on task 3 instead and give yourself a
spare day at the end. You will want it.

---

### 3. Demo safety net — CUT on 23 August

Kept here for the record. `web/src/fallback.ts` holds a copy of every camera-scored
exercise, and nothing imports it, so if the backend dies mid-demo the app dies with it.
The decision was to accept that rather than spend half a day on it. What covers you
instead: both server windows stay open, and you have a full screen recording from
task 12 if anything goes wrong live.

<details><summary>What it would have involved</summary>


**Why.** Two things will be true in the demo room: the wifi will be bad, and
something will go down at the worst moment.

There is already a `web/src/fallback.ts` holding a copy of every camera-scored
exercise — but **nothing imports it except a test.** If the backend dies mid-demo,
the app just breaks.

**Do:**

1. In `web/src/api.ts`, catch a failed exercise fetch and fall back to
   `FALLBACK_EXERCISES` instead of throwing.
2. Show a small, calm banner: "Offline — using saved exercises." Not a red error.
3. Turn wifi off completely and run the whole demo path: sign in → injury → session →
   camera → summary. Note every place it breaks.
4. Fix those places.

**Done when:** with wifi off and the API window closed, you can still get to the
camera screen and score a rep.

</details>

---

### 4. Demo player with history — Tue 25 Aug

**Why.** The Progress screen you are about to build has nothing to draw. A fresh
account shows an empty chart, which looks broken rather than new. You need a player
who is three weeks into a rehab.

**Do:** write `scripts/seed_demo.py` that creates one player and back-fills roughly
21 days of metric samples — form scores, session completions, pain logs, and left/right
strength values that start lopsided and converge. Make the story readable: week 1
rough, week 3 nearly passing.

**Done when:** `python scripts/seed_demo.py` gives you an account you can sign into
that has a real-looking history, and re-running it does not create duplicates.

This is also your reset button before each rehearsal.

---

### 5a. Progress endpoint — Wed 26 Aug

**Why the backend first.** The ring on your poster is limb symmetry — injured leg
divided by healthy leg. That maths already exists server-side in
`MetricResolver.limb_symmetry` (`app/services/criteria/resolver.py:139`). Do not
rewrite it in the browser; you would end up with two versions that disagree.

**Do:** add `GET /injuries/{episode_id}/progress` returning:

- `symmetry` — the ring number, plus which metric it came from and how many samples
- `trend` — a dated series for the workload chart (sessions and mean form score per day)
- `phase` — where they are, and how many exit criteria are passing out of the total

**Done when:** the endpoint returns sensible numbers for the demo player, and there
is a test in `tests/test_api_flow.py` covering it.

---

### 5b. Progress screen — Thu 27 Aug (2 units)

The second phone mockup on your poster. Add `progressScreen()` to `web/src/main.ts`,
reachable from the home dashboard.

- **Strength balance ring** — one number, big. Green at 90%+, amber below.
- **Workload trend** — a simple line or bar chart of the last three weeks. Plain SVG;
  do not add a chart library two weeks out.
- **Phase progress** — "3 of 5 exit criteria passing".

Handle the empty state explicitly: a new player should see "Not enough data yet —
complete a few sessions", not a blank box.

**Done when:** the demo player's Progress screen looks like the poster, and a brand
new player sees a sensible empty state instead of a crash.

---

### 6. Session scheduling — Fri 28 Aug

The "Today, 4:30 PM" line on your poster. Keep it small: a `scheduled_at` field on
the session, a time picker on the home screen, and the next session shown as a card
with day and time. Nothing recurring, no calendar view.

**Done when:** you can set a time and the home screen shows it.

---

### 7. Notifications — Sat 29 Aug

The bell icon. **Do not use browser push notifications** — they need permissions,
a service worker, and they will not fire in a demo.

Build it as an in-app list instead: a bell in the header with a count, opening a
panel of generated reminders — "Session due today", "Exit criteria ready to
re-check", "Pain logged 3 days running". Generate them from data you already have.

**Done when:** the bell shows a count and the panel lists real reminders for the
demo player.

---

### Sun 30 Aug — Buffer

Do not add anything. Catch up on whatever slipped. If nothing slipped, rest — you
have a week of finishing ahead and tired people make demo-day mistakes.

---

### 8a / 8b. Coach view — Mon 31 Aug, Tue 1 Sep

A staff account that sees a list of players: name, position, injury, phase, exit
criteria passing, last session. Click one to see their Progress screen read-only.

**This is the first thing to cut.** It is the least visible on your poster and the
most work. If you are behind on 31 August, skip it and move everything forward two
days — you will thank yourself in rehearsal.

---

### 9. Polish pass — Wed 2 Sep (2 units)

No new features. Walk the whole app as a stranger would and fix what looks unfinished:

- Every screen's **empty state** and **error state**
- Wording — no debug text, no placeholder copy, no Thai left in the English UI
- The camera screen especially: it is the thing people will stare at
- Make sure MediaPipe is **visible** as the selling point, not buried. Someone
  watching should be able to tell it is doing live analysis without you explaining it
- Sizes and spacing at the resolution you will actually project

---

### 10. Freeze + demo script — Thu 3 Sep (2 units)

**Morning — freeze.**

```bash
python -m pytest -q && ruff check . && cd web && npx vitest run && npx tsc --noEmit
```

Everything green. From here, no new code.

**Afternoon — write `DEMO.md`.** An actual script, not notes:

1. The 30-second opening: what the problem is and who it is for
2. Sign in as the demo player → home → "here is today's session"
3. **The camera.** Do the exercise yourself. Let it count reps and score your form
   live. This is the moment the project wins or loses — give it the most time.
4. Deliberately do one bad rep so it flags you. Rehearsed, not improvised.
5. Progress screen — the ring and the trend
6. Exit criteria — "this is what stops a player going back too early"
7. Close: 6 positions × 7 injuries = 42 programmes, all generated from one library

Write down the exact clicks. Write down what you say. Include the reset command
(`python scripts/seed_demo.py`) so you can rerun it cleanly.

---

### 11. Rehearsal 1 — Fri 4 Sep

On the **actual laptop** you will demo from. **Wifi off.** Full run, start to finish,
out loud, timed. Write down everything that goes wrong. Fix only those things.

Two hard facts to plan around:

- The camera needs a secure origin. `start.bat` now serves the app over https and
  prints a phone address, so a phone works — but **rehearse on whichever device you
  will actually demo from**, and accept the certificate warning on it beforehand, not
  in front of an audience. If the laptop's IP changes, re-run
  `cd web && node scripts/make-cert.mjs --force`.
- Room lighting changes what MediaPipe sees. If you can, rehearse where you will present.

---

### 12. Rehearsal 2 + backup video — Sat 5 Sep

Run it again clean. Then **screen-record the entire demo, with audio, working.**

If the camera fails on the day — bad light, wrong laptop, someone else's dongle — you
play the recording and keep talking. This has saved more presentations than any
amount of extra code.

---

### Sun 6 Sep — Deadline

Boot it once. Confirm it comes up. Confirm the backup video plays. Nothing else.

---

## What to cut, in this order

If you fall behind, cut from the top of this list:

1. **Coach view** (29–30 Aug) — least poster value, most work
2. **The calendar screen** (27 Aug) — the scheduling card on Home carries the idea
   on its own
3. **Session scheduling** (26 Aug) — hardcode "Today, 4:30 PM" on the home screen

**Never cut:** tasks 1, 10, 11 and 12 — proving the camera works, freezing, and
rehearsing twice. Those are the demo working at all.

**Cut on 23 August:** task 3, the offline safety net. `web/src/fallback.ts` stays
generated and tested but unused, so closing the API window still kills the app. That is
a known, accepted risk now rather than an oversight — keep both server windows open,
and the backup recording from task 12 covers the rest.

### Garmin and WHOOP — do not build these

They are on your poster and they are a trap. Each is an OAuth flow against a real
company's API with an approval process, for data you cannot generate on demand.
That is a week you do not have.

Say this instead: *"Health data comes in through one ingest path that maps any
platform's types onto our metrics. Apple Health and Google Health Connect are wired;
Garmin and WHOOP are the same mapping table with different names."* That is true, it
is a better answer than a half-working integration, and it costs you nothing.

---

## Assumptions I made

Tell me if any of these are wrong and I will redo the plan:

- **6 September is the submission date**, and the live demo is on or before it.
- **You have about 3 hours a day**, more at weekends.
- **No written report or slide deck is being asked for.** If there is one, it needs
  its own slot — take Wednesday 2 September for it and move the polish pass into the
  30 August buffer.
- **You are working alone.**
- **You demo from your own laptop** with your own camera.
