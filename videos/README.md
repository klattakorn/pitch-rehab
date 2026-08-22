# Filming brief

Put the clips in this folder. **The videos themselves are not in git** — they are too
big. Keep the shared copy in the team Drive folder and sync it down to here.

Once clips are in, anyone can run:

```bash
python scripts/batch_check.py videos/
```

That writes `docs/video-results.md` — a table of every clip and, more importantly, a
verdict per exercise: **did the engine score the deliberately bad reps worse than the
good ones?** That table is the evidence the whole project rests on.

---

## Naming

The filename carries the information, so nobody has to keep a spreadsheet in sync.

```
<exercise_key>__<person>__<good|bad>[__<left|right|bilateral>].mp4
```

```
split_squat__ana__good__left.mp4
split_squat__ana__bad__left.mp4
wall_sit__ben__good.mp4
```

Use the exact exercise keys from the tables below — the script looks them up. Use short
names or initials for people. Leave the side off for two-legged exercises.

## Filming

| | |
|---|---|
| Camera | A phone is fine. 1080p, 30 fps. Landscape or portrait, just be consistent. |
| Distance | About 2 m back, whole body in frame including feet, with a little headroom. |
| Height | Front-view shots: roughly knee height. Side-view shots: roughly hip height. |
| Steady | Prop the phone up. Do not hand-hold — a moving camera breaks the angles. |
| Light | Bright, even, light from in front. Avoid a bright window behind the person. |
| Clothing | Fitted shorts and a fitted top. Baggy trousers over the knees are the single most common reason tracking goes wrong. |
| Background | Plain, and nobody else in frame. MediaPipe tracks one person — a second body in shot makes it jump. |
| Each clip | 5 clean reps, pause for 2 seconds, then 5 reps done wrong on purpose. Or shoot them as two separate clips, which is easier to name. |

**Exaggerate the bad reps.** The point is not to look realistic, it is to give the
engine something unmistakable to catch. If it misses an obvious fault, it will
certainly miss a subtle one.

**Film all three of you.** The engine has only ever been tested on one body. Different
heights, builds and clothing are the most valuable variable here — that is a real
finding for the write-up either way.

---

## Priority 1 — knee falling inward (front-on camera)

These eight are the most important clips in the project. Knee collapsing inward is the
ACL mechanism, it is the headline thing the camera claims to catch, and **it has never
once been checked against a real body.** Do these first.

Camera **front-on**, knee height.

| Exercise key | What it measures | Do it wrong by |
|---|---|---|
| `split_squat` | knee bend, **knee inward**, trunk lean | letting the front knee dive inward over the big toe |
| `single_leg_squat` | knee bend, **knee inward**, hip drop, trunk lean | knee inward, and letting the free hip sag |
| `step_down` | knee bend, **knee inward**, hip drop, trunk lean | knee inward as you lower, hip dropping on the free side |
| `single_leg_balance` | **knee inward**, hip drop, trunk lean | letting the standing knee drift in and the hip sag |
| `single_leg_hop_landing` | knee bend, **knee inward**, trunk lean | landing stiff-legged with the knee falling in |
| `lateral_bound` | knee bend, **knee inward**, hip drop | landing on a collapsed knee with the hip dropping |
| `pogo_hops` | knee bend, **knee inward** | landing with the knees knocking together |
| `heading_jump` | knee bend, **knee inward** | knees together on landing |

## Priority 2 — the rest of the front-on set

Camera **front-on**, hip height for the plank variations.

| Exercise key | What it measures | Do it wrong by |
|---|---|---|
| `copenhagen_plank` | hip bend, hold time, trunk lean | letting the hips sag toward the floor |
| `side_plank` | hip bend | letting the hips drop |
| `side_lying_hip_abduction` | hip bend | rolling the hip backward and swinging the leg forward |

## Priority 3 — the side-on set

Camera **side-on**, hip height, filming the working leg.

| Exercise key | What it measures | Do it wrong by |
|---|---|---|
| `wall_sit` | knee bend | sitting too high — thighs above parallel |
| `spanish_squat` | hold time, knee bend, trunk lean | standing too upright and not sitting back far enough |
| `isometric_quad_set` | knee bend | letting the knee bend instead of pressing it straight |
| `decline_squat` | knee bend, trunk lean | going shallow with the chest folded forward |
| `glute_bridge` | hip bend | not lifting the hips all the way up |
| `heel_slide` | knee bend | sliding only halfway |
| `prone_hamstring_curl` | hip bend, knee bend | letting the hip lift off the bed, short range |
| `nordic_hamstring_curl` | hip bend, trunk lean | breaking at the hips instead of staying straight |
| `single_leg_rdl` | hip bend, knee bend | rounding the back and bending the knee too much |
| `double_leg_calf_raise` | heel height, knee bend | half height, knees bending |
| `single_leg_calf_raise` | heel height, knee bend | half height |
| `ankle_knee_to_wall` | ankle bend, heel lift | letting the heel come off the floor |

---

## Priority 4 — the break-it set

A separate, short list of clips designed to make the engine fail. Name these
`break__<what>__<person>.mp4` — the batch script will list them as skipped, which is
fine; run these through `check_video.py` one at a time and write down what happened.

The app has two safety nets that have **never been tested against real hostile
footage**: it refuses to score when the camera is on the wrong side, and it throws away
frames where the skeleton has collapsed. Prove they work.

| Clip | What should happen |
|---|---|
| A front-view exercise filmed side-on | Refuses to score. Says the camera is on the wrong side. |
| A side-view exercise filmed front-on | Same. |
| Person half out of frame | Drops those frames, or says tracking was poor. |
| Two people in shot | Something sensible. Genuinely unknown — worth finding out. |
| Very dim room | Low detection rate, flagged as a problem. |
| Hand-held, moving camera | Noisy angles, ideally flagged. |
| Someone sitting still doing nothing | Zero reps. Not a crash, not a phantom rep. |
| Baggy black trousers against a dark wall | Low confidence, flagged. |

Whatever it actually does, write it down. "We tried to break it in eight ways and here
is what happened" is a much stronger thing to present than "it worked when we tested
it".
