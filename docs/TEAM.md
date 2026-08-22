# Three people, fifteen days

Companion to [PLAN.md](../PLAN.md), which is the solo version. Nothing in that plan
changes — this says who does what alongside it, and what the other two should hand you.

Two extra people do **not** mean three times the code. Only one person can really own
`app/` and `web/src/` without constant collisions. What they multiply is everything
that is not code: test footage across different bodies, sourcing for the numbers, an
outsider walking the app and finding what is broken, and someone whose whole job is
the talk.

---

## Done already: version control

The folder was not a git repository. Three people editing one shared folder without it
is how a project loses a day's work at 2 a.m. It is now initialised with everything
committed as a baseline, and a `.gitignore` that keeps out the database, `node_modules`
and the generated MediaPipe copies.

What is left is putting it somewhere shared:

```bash
gh repo create pitch-rehab --private --source=. --push
```

Then the other two clone it and work in branches. **Only one person edits a given file
at a time** — that is the real rule, and the lanes below are drawn so it happens
naturally.

Videos do not go in git; they are too big. Keep those in a shared Drive folder and sync
them into `videos/`.

---

## The split

| | Lane | Owns these files | Never touches |
|---|---|---|---|
| **You** | Code | `app/`, `web/src/`, `scripts/`, `tests/` | `docs/`, `videos/` |
| **B** | Footage & testing | `videos/`, `docs/video-results.md`, `docs/bugs.md` | `app/`, `web/src/` |
| **C** | Evidence & the talk | `docs/sources.md`, `DEMO.md`, slides, poster | `app/`, `web/src/` |

No file has two owners. That is the point.

---

## Lane B — footage and testing

**This is the more valuable of the two lanes.** Give it to whoever is more reliable.

The full brief is in **[`videos/README.md`](../videos/README.md)** — naming, camera
setup, and an exercise-by-exercise table of what "do it wrong" means for each of the 23
camera-scored exercises. Hand them that file and they can start today.

### What they produce, in order of value

**1. Front-on knee-valgus clips, all three of you.** Eight exercises, good and bad, each
filmed on each person. This is the single most important dataset in the project. Knee
collapsing inward is the ACL mechanism, it is the headline thing the camera claims to
catch, and it has **never been tested against a real body.** You are one person, so you
could never have tested whether it works on different builds — now you can.

**2. The break-it set.** Eight clips designed to make the engine fail: wrong camera
angle, half out of frame, two people in shot, dim room, baggy dark clothes. The app has
two safety nets — it refuses to score from the wrong angle, and it throws away frames
where the skeleton has collapsed — and neither has ever met real hostile footage.
Whatever happens, write it down. *"We tried to break it eight ways, here is what
happened"* presents far better than *"it worked when we tested it"*.

**3. The remaining exercise clips.** The other fifteen, good and bad.

**4. A bug list.** From day 8 or so, once the new screens land: use the app cold, as a
stranger would, and write findings into `docs/bugs.md` — what you clicked, what you
expected, what happened. Someone who did not build it finds things the builder cannot
see.

### How their work becomes data

```bash
python scripts/batch_check.py videos/
```

I wrote that today. It reads every clip in the folder, runs each through the same
scoring code the API uses, and writes `docs/video-results.md`. The table at the top is
the one that matters: for each exercise and person, **did the engine score the bad reps
worse than the good ones?** PASS, WEAK or FAIL, with the gap in points.

They can run it themselves — no code knowledge needed — and re-run it after you change
anything in `app/services/pose/`. That table is your evidence slide.

---

## Lane C — evidence and the talk

**1. Sources for every threshold.** I generated
**[`docs/sources.md`](sources.md)** today: all **43 exit criteria** and **15 position
reference values**, one row each, with a blank Source column.

This matters more than it sounds. The app stops a player returning to football based on
these numbers, and right now the README says outright that they are defaults, not
clinical truth. The first question anyone sharp asks is *"where did 90% come from?"*
Filling that table in is the difference between a good answer and a shrug. Note that
"we chose this as a placeholder" is a perfectly honest entry — silence is not.

There is a list of likely questions at the bottom of that file. Have answers ready.

**2. The demo script.** `DEMO.md` on 3 September, per the plan. C drafts it, you correct
the technical parts. Exact clicks, exact words.

**3. Slides and poster.** Whatever the submission needs. C owns this entirely so it
does not eat your build days.

**4. Timekeeping.** Someone other than you should watch the calendar and say "it is the
31st, coach view is the cut". Cutting on time is a decision, and it is easier for
someone who did not write the code to make it.

---

## If one of them can code

Swap these in — both are files nobody else touches, so there are no collisions:

| Task | File | Why it is safe |
|---|---|---|
| **The demo seed** (task 4 in the plan) | `scripts/seed_demo.py` | Brand new file. Nothing else imports it. |
| **The sourced numbers** | `app/data/position_norms.py` | Pure data, one owner, and it pairs with lane C. |
| **The notifications panel** (task 7) | a new `web/src/notifications.ts` | Only if they agree to keep it in one new file and hand you a single line to call it. |

Do **not** hand out `web/src/main.ts` or anything in `app/services/pose/`. Both are
things you will be editing every day.

---

## The demo needs two people on the day

The best reason to have three people. In rehearsal and on the day:

- **One drives the laptop** — clicks through, starts the camera, resets the data
- **One is in front of the camera** doing the exercise, including the deliberately bad
  rep
- **One talks**

You have been planning to do all three at once, which is why the camera step is the
riskiest part of the demo. Split it and it becomes the strongest part. Decide who does
what by 3 September and rehearse it that way both times.

---

## Day by day, all three lanes

| Date | You — code | B — footage | C — evidence |
|---|---|---|---|
| Sat 22 | Valgus check (task 1) | **Film with you.** All 3 people, 8 valgus exercises | Read the README, start `sources.md` |
| Sun 23 | Fix what it exposed | Run `batch_check.py`, report | LSI and pain thresholds |
| Mon 24 | Offline safety net | Break-it set, 8 clips | Position norms |
| Tue 25 | Demo seed data | Run break-it clips one by one, write up | Draft poster / slides |
| Wed 26 | Progress endpoint | Side-view clips, first half | Sources, keep going |
| Thu 27 | Progress screen | Side-view clips, second half | Sources, keep going |
| Fri 28 | Scheduling | Re-run the whole batch | Slides |
| Sat 29 | Notifications | **Use the app cold** → `docs/bugs.md` | Slides |
| Sun 30 | Buffer | Buffer | Buffer |
| Mon 31 | Coach view — or cut it | Re-shoot anything that failed | `sources.md` finished |
| Tue 1 | Coach view — or cut it | Bug list, round 2 | Draft `DEMO.md` |
| Wed 2 | Polish | Confirm bugs are fixed | Slides finished |
| Thu 3 | **Freeze.** Full test run | Final `batch_check.py` run | `DEMO.md` finished, roles assigned |
| Fri 4 | Rehearsal 1 — wifi off | On camera | Talking |
| Sat 5 | Rehearsal 2 + record backup | On camera | Talking |
| Sun 6 | Deadline. Light check only. | | |

---

## The short answer to "what should they do"

If you only pass on one thing today, pass on this:

1. **Both of them film with you this weekend.** Eight exercises, good reps and
   deliberately bad reps, all three bodies. Brief is in `videos/README.md`.
2. **One of them owns `docs/sources.md`** — 58 blank cells, and every one is a question
   you would otherwise have to answer live.
