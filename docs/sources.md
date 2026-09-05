# Where every number comes from

The app gates a player's return to play on the numbers in this file. Right now they
are **defaults drawn from common return-to-sport practice, not from a clinician's
review** — the README says so plainly, and so should the presentation.

This file is where that gets fixed. One row per threshold. Fill in a source, or
write "our choice" and say why. Both are honest answers; silence is not.

A good source is a named guideline, a consensus statement, or a published study,
with enough detail that someone could go and read it. A blog post is not.

The rows were generated from the live protocol library, but this file is yours to
edit — if you add a criterion in `app/data/protocols.py`, add its row here too.

**36 thresholds to account for.**

## Exit criteria

| Criterion | Requires | Compared how | Phases | Injuries | Source | Notes |
|---|---|---|---|---|---|---|
| `adductor_lsi`<br><small>Adductor squeeze strength symmetry ≥ 90%</small> | at least 90 % | injured vs healthy leg | P2 | adductor, groin |  |  |
| `adherence`<br><small>Completed ≥ 70% of prescribed sessions</small> | at least 70 % | a fixed number | P1, P2 | all 7 |  |  |
| `balance_control`<br><small>Pelvis stays level in single-leg stance (drop ≤ 5°)</small> | at most 5 deg | a fixed number | P2 | ankle |  |  |
| `calf_raise_height`<br><small>Full single-leg calf raise height</small> | at least 0.45 ratio | a fixed number | P2 | calf |  |  |
| `calf_raise_reps`<br><small>12 double-leg calf raises in one set</small> | at least 12 reps | a fixed number | P1 | all 7 |  |  |
| `calf_raise_reps_lsi`<br><small>Single-leg calf raise repetitions ≥ 90% of the other side</small> | at least 90 % | injured vs healthy leg | P2 | ankle, calf |  |  |
| `change_of_direction`<br><small>Change of direction at least 90% of your best</small> | at least 90 % | a fixed number | P3, P4 | all 7 |  |  |
| `clinician_clearance`<br><small>Cleared by a physio or clinician</small> | at least 1 | a fixed number | P4 | all 7 |  |  |
| `cmj_lsi`<br><small>Jump height symmetry ≥ 90%</small> | at least 90 % | injured vs healthy leg | P4 | all 7 |  |  |
| `cmj_lsi_tendon`<br><small>Jump height symmetry at least 90%</small> | at least 90 % | injured vs healthy leg | P3 | patellar_tendinopathy |  |  |
| `confidence`<br><small>Self-reported readiness ≥ 80/100</small> | at least 80 score | a fixed number | P4 | all 7 |  |  |
| `copenhagen_hold`<br><small>Copenhagen plank hold ≥ 20s each side</small> | at least 20 s | a fixed number | P2 | adductor, groin |  |  |
| `copenhagen_hold_p3`<br><small>Copenhagen plank hold ≥ 30s each side</small> | at least 30 s | a fixed number | P3 | adductor, groin |  |  |
| `decline_depth`<br><small>Single-leg decline squat to at least 55 degrees</small> | at least 55 deg | a fixed number | P2 | patellar_tendinopathy |  |  |
| `form_quality`<br><small>Mean movement quality ≥ 80/100</small> | at least 80 score | a fixed number | P2, P3 | all 7 |  |  |
| `groin_pain_rest`<br><small>Pain at rest at most 3/10</small> | at most 3 NPRS | a fixed number | P1 | groin |  |  |
| `hamstring_lsi`<br><small>Hamstring strength symmetry ≥ 90%</small> | at least 90 % | injured vs healthy leg | P2 | hamstring |  |  |
| `hop_lsi`<br><small>Triple hop symmetry ≥ 90%</small> | at least 90 % | injured vs healthy leg | P3 | acl, ankle, calf, hamstring |  |  |
| `hop_triple_lsi`<br><small>Triple hop symmetry ≥ 95%</small> | at least 95 % | injured vs healthy leg | P4 | acl |  |  |
| `landing_control`<br><small>Lands softly (knee bend at least 45 degrees)</small> | at least 45 deg | a fixed number | P3 | patellar_tendinopathy |  |  |
| `landing_valgus`<br><small>Landing knee valgus ≤ 8°</small> | at most 8 deg | a fixed number | P3 | acl |  |  |
| `lateral_landing_valgus`<br><small>Lateral landing stays controlled (valgus ≤ 8°)</small> | at most 8 deg | a fixed number | P3 | all 7 |  |  |
| `morning_pain`<br><small>No worse the next morning (at most 3/10)</small> | at most 3 NPRS | a fixed number | P1 | patellar_tendinopathy |  |  |
| `morning_pain_p4`<br><small>No morning pain for 7 days (at most 1/10)</small> | at most 1 NPRS | a fixed number | P4 | patellar_tendinopathy |  |  |
| `nordic_break_angle`<br><small>Nordic break angle ≥ 55°</small> | at least 55 deg | a fixed number | P2 | hamstring |  |  |
| `pain_at_rest`<br><small>Pain at rest ≤ 2/10</small> | at most 2 NPRS | a fixed number | P1 | acl, adductor, ankle, calf, hamstring |  |  |
| `pain_free_days`<br><small>3 consecutive pain-free days</small> | at least 3 days | a fixed number | P1, P4 | acl, adductor, ankle, calf, groin, hamstring |  |  |
| `pain_on_activity`<br><small>Pain during activity ≤ 2/10</small> | at most 2 NPRS | a fixed number | P2, P3 | all 7 |  |  |
| `quad_lsi`<br><small>Quadriceps strength symmetry ≥ 80%</small> | at least 80 % | injured vs healthy leg | P2 | acl |  |  |
| `quad_lsi_tendon`<br><small>Quadriceps strength symmetry at least 90%</small> | at least 90 % | injured vs healthy leg | P2 | patellar_tendinopathy |  |  |
| `repeated_sprint_decrement`<br><small>Repeated-sprint drop-off ≤ 5%</small> | at most 5 % | a fixed number | P4 | all 7 |  |  |
| `slsq_depth`<br><small>Single-leg squat to ≥ 60° knee flexion</small> | at least 60 deg | a fixed number | P2 | acl |  |  |
| `slsq_valgus`<br><small>Knee stays out of valgus (≤ 8°)</small> | at most 8 deg | a fixed number | P2 | acl |  |  |
| `tendon_pain_during`<br><small>Pain during loading at most 4/10</small> | at most 4 NPRS | a fixed number | P1 | patellar_tendinopathy |  |  |
| `tendon_pain_during_p2`<br><small>Pain during loading at most 3/10</small> | at most 3 NPRS | a fixed number | P2 | patellar_tendinopathy |  |  |
| `wall_sit_hold`<br><small>Hold a wall sit for 30 seconds</small> | at least 30 s | a fixed number | P1 | all 7 |  |  |

## Position reference values

`app/data/position_norms.py`. These are only used when a player has no history of
their own, so a first-time user gets a real target instead of a wall. Each one needs
a source, or an honest "placeholder, we chose it".

| Metric | Default | Source | Notes |
|---|---|---|---|
| `test.cmj_height` | 0.34 |  |  |
| `test.heel_raise_reps` | 25 |  |  |
| `test.hop_single` | 1.45 |  |  |
| `test.hop_triple` | 4.6 |  |  |
| `test.iso_adductor` | 2.6 |  |  |
| `test.iso_hamstring` | 3 |  |  |
| `test.iso_quadriceps` | 3.2 |  |  |
| `test.sprint_30m` | 4.45 |  |  |
| `test.yo_yo_ir1` | 1400 |  |  |

## Questions to have an answer ready for

- Why 90% for limb symmetry, and not 85% or 100%?
- Why does patellar tendinopathy allow pain up to 4/10 during exercise when every
  other injury caps it at 2/10?
- Why do the four phases have those minimum day counts?
- What stops a player simply lying about the self-reported numbers?
- Who is accountable if someone follows this and gets hurt?
