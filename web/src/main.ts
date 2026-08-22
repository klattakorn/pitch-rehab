/**
 * RehabFootball — demo front end.
 *
 * Screens: sign in, pick your position, pick your injury, home, session, camera,
 * results. Position comes before anything else because it decides the sprint
 * targets a player has to clear, so it cannot be asked for afterwards.
 * Scoring runs here in the browser so the feedback is instant; the same numbers
 * go to the server afterwards, and the server decides whether a phase unlocks.
 */
import "./styles.css";

import * as api from "./api";
import type { Episode, Gate, Phase, Prescription } from "./api";
import { demoPanelHtml, runDemoAnimation } from "./demo/panel";
import type { Facing } from "./mediapipe";
import {
  createPoseLandmarker,
  hasMultipleCameras,
  keepScreenAwake,
  startCamera,
} from "./mediapipe";
import { enterScreen, pulse } from "./motion";
import { Frame } from "./pose/geometry";
import type { Side } from "./pose/landmarks";
import { LiveSession } from "./pose/live";
import { drawSkeleton, metricsToShow, renderReadout } from "./render";
import { byDemand, roleCardHtml, roleDetailHtml } from "./roles";
import {
  BRAND_MARK,
  CAMERA_ICON,
  CROSS,
  DASH,
  FLIP_ICON,
  TICK,
  bar,
  progressRing,
  titleCase,
} from "./ui";

const app = document.querySelector<HTMLDivElement>("#app")!;

const POSITIONS = [
  { key: "striker", label: "Forward" },
  { key: "winger", label: "Winger" },
  { key: "centre_midfield", label: "Midfielder" },
  { key: "centre_back", label: "Centre back" },
  { key: "full_back", label: "Full back" },
  { key: "goalkeeper", label: "Goalkeeper" },
];

const INJURIES = [
  { key: "hamstring", label: "Hamstring strain", note: "Biceps femoris, semitendinosus" },
  { key: "adductor", label: "Adductor strain", note: "Acute groin muscle tear" },
  { key: "acl", label: "ACL reconstruction", note: "Post-surgical knee ligament" },
  { key: "ankle", label: "Ankle sprain", note: "Lateral or medial ligament" },
  { key: "calf", label: "Calf strain", note: "Gastrocnemius, soleus, achilles" },
  { key: "patellar_tendinopathy", label: "Patellar tendinopathy", note: "Jumper's knee" },
  { key: "groin", label: "Groin pain", note: "Long-standing, load-related" },
];

const PHASE_NAMES: Record<string, { n: number; name: string }> = {
  p1_protect: { n: 1, name: "Protect & Restore" },
  p2_strength: { n: 2, name: "Strength & Control" },
  p3_running: { n: 3, name: "Power & Perform" },
  p4_return: { n: 4, name: "Return to Play" },
};

interface State {
  user: api.User | null;
  episode: Episode | null;
  phase: Phase | null;
  gate: Gate | null;
  sessions: api.SessionRow[];
  positions: api.PositionInfo[] | null;
  online: boolean;
}
const state: State = {
  user: null,
  episode: null,
  phase: null,
  gate: null,
  sessions: [],
  positions: null,
  online: false,
};

// --------------------------------------------------------------------- shell
function shell(body: string): void {
  app.innerHTML = `
    <div class="topbar">
      <div class="brand">
        ${BRAND_MARK}
        <div>REHAB<em>FOOTBALL</em><small>Rehab · Return · Perform</small></div>
      </div>
      <div class="spacer"></div>
      ${
        state.online
          ? `<div class="pill ok">connected</div>`
          : `<div class="pill bad">offline</div>`
      }
    </div>
    <main>${body}</main>`;
  // One place for every screen's entrance: children fan in, counters count,
  // bars and rings fill. Screens never have to remember to animate themselves.
  enterScreen(app);
}

const on = (selector: string, handler: () => void): void => {
  const el = app.querySelector<HTMLElement>(selector);
  if (el) el.onclick = handler;
};

function fail(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  shell(`<h2>Something went wrong</h2>
    <div class="notice">${message}</div>
    <div class="controls"><button class="ghost" id="home">Back</button></div>`);
  on("#home", () => void boot());
}

// ------------------------------------------------------------------ sign in
function signInScreen(notice = ""): void {
  shell(`
    <h2>Your comeback. Stronger. Smarter.</h2>
    <p class="sub">Personalised rehab paths with data-driven return-to-play testing.</p>
    <div class="dash">
      ${notice ? `<div class="notice">${notice}</div>` : ""}
      <div class="panel">
        <label class="label" for="email">Email</label>
        <input id="email" type="email" value="alex@rehabfootball.app"
          autocomplete="email" autocapitalize="off" autocorrect="off" spellcheck="false" />
        <label class="label" for="password">Password</label>
        <input id="password" type="password" value="correct-horse-battery"
          autocomplete="current-password" />
      </div>
      <button class="primary" id="go">Continue</button>
      <p class="sub" style="text-align:center;margin:0">
        New here? Continuing creates the account.</p>
    </div>`);

  on("#go", () => {
    const email = app.querySelector<HTMLInputElement>("#email")!.value.trim();
    const password = app.querySelector<HTMLInputElement>("#password")!.value;
    void (async () => {
      try {
        await api.login(email, password);
        await boot();
      } catch (error) {
        // Sign-in failed. The server deliberately does not say whether the email
        // exists, so treat this as a new player and ask for a position -- an
        // account cannot be created without one.
        if (error instanceof api.ApiError && error.status === 401) {
          return void roleScreen({ mode: "signup", email, password });
        }
        fail(error);
      }
    })();
  });
}

// ---------------------------------------------------------- pick your role
type RoleIntent =
  | { mode: "signup"; email: string; password: string }
  | { mode: "edit" };

/**
 * Choose a position before rehab starts.
 *
 * This is a real fork, not a profile field: the position sets the sprint gates
 * a player has to clear before they are allowed back and adds drills specific
 * to the job. So the screen shows what each choice changes, sourced from the
 * same profiles the server uses to build the programme.
 */
async function roleScreen(intent: RoleIntent): Promise<void> {
  shell(`<h2>Loading positions…</h2>`);
  try {
    state.positions ??= await api.listPositions();
  } catch (error) {
    return fail(error);
  }
  const positions = byDemand(state.positions);
  let chosen = intent.mode === "edit" ? (state.user?.profile?.position ?? null) : null;

  shell(`
    ${
      intent.mode === "signup"
        ? `<div class="steps">
             <span class="step on">1 · Position</span>
             <span class="step">2 · Injury</span>
           </div>`
        : ""
    }
    <h2>Which position do you play?</h2>
    <p class="sub">Your rehab is built around what your position actually demands.
      A winger has to sprint faster than a keeper before either is let back on.</p>
    <div class="role-grid">
      ${positions.map((position) => roleCardHtml(position, position.key === chosen)).join("")}
    </div>
    <div id="role-detail" class="role-detail-slot"></div>
    <div class="controls">
      ${intent.mode === "edit" ? `<button class="ghost" id="back">Cancel</button>` : ""}
      <button class="primary" id="continue" ${chosen ? "" : "disabled"}>
        ${intent.mode === "edit" ? "Save position" : "Continue"}
      </button>
    </div>`);

  const slot = app.querySelector<HTMLDivElement>("#role-detail")!;
  const showDetail = (key: string): void => {
    const position = positions.find((item) => item.key === key);
    if (!position) return;
    // Replacing the node rather than its text restarts the reveal animation.
    slot.innerHTML = roleDetailHtml(position);
    enterScreen(slot);
  };

  const select = (key: string): void => {
    chosen = key;
    app.querySelectorAll<HTMLButtonElement>(".role-card").forEach((card) => {
      const on = card.dataset["key"] === key;
      card.classList.toggle("on", on);
      card.setAttribute("aria-pressed", String(on));
    });
    app.querySelector<HTMLButtonElement>("#continue")!.disabled = false;
    showDetail(key);
  };

  if (chosen) showDetail(chosen);

  app.querySelectorAll<HTMLButtonElement>(".role-card").forEach((card) => {
    card.onclick = () => select(card.dataset["key"]!);
  });

  on("#back", () => homeScreen());
  on("#continue", () => {
    if (!chosen) return;
    const button = app.querySelector<HTMLButtonElement>("#continue")!;
    button.disabled = true;
    button.textContent = intent.mode === "edit" ? "Saving…" : "Setting up…";
    void (async () => {
      try {
        if (intent.mode === "signup") {
          await api.register({
            email: intent.email,
            password: intent.password,
            full_name: intent.email.split("@")[0]!,
            position: chosen!,
          });
        } else {
          await api.updateProfile({ position: chosen! });
        }
        await boot();
      } catch (error) {
        if (error instanceof api.ApiError && error.status === 409) {
          // The email is already registered, so the sign-in failure was a wrong
          // password rather than a missing account. Say so instead of looping.
          return signInScreen(
            "That email already has an account — check the password and try again.",
          );
        }
        fail(error);
      }
    })();
  });
}

// -------------------------------------------------------------- onboarding
function injuryScreen(): void {
  const position = POSITIONS.find((p) => p.key === state.user?.profile?.position);
  shell(`
    <div class="steps">
      <span class="step done">1 · Position</span>
      <span class="step on">2 · Injury</span>
    </div>
    <h2>What are you rehabbing?</h2>
    <p class="sub">${
      position
        ? `Your plan is built for this injury <b>and</b> for playing ${position.label.toLowerCase()}.`
        : "Your plan is built for this injury and your position."
    }</p>
    <div class="grid">
      ${INJURIES.map(
        (i) => `<button class="card" data-key="${i.key}">${i.label}
          <span class="note">${i.note}</span></button>`,
      ).join("")}
    </div>
    <h3>Which side</h3>
    <div class="controls" style="justify-content:flex-start">
      <button class="chip on" id="side-left" style="max-width:120px">Left</button>
      <button class="chip" id="side-right" style="max-width:120px">Right</button>
    </div>`);

  let side = "left";
  const setSide = (value: string) => {
    side = value;
    app.querySelector("#side-left")!.classList.toggle("on", value === "left");
    app.querySelector("#side-right")!.classList.toggle("on", value === "right");
  };
  on("#side-left", () => setSide("left"));
  on("#side-right", () => setSide("right"));

  app.querySelectorAll<HTMLButtonElement>(".card").forEach((card) => {
    card.onclick = () =>
      void (async () => {
        try {
          const injuredOn = new Date(Date.now() - 12 * 864e5).toISOString().slice(0, 10);
          const started = new Date(Date.now() - 8 * 864e5).toISOString();
          await api.createEpisode({
            injury_site: card.dataset.key!,
            side,
            injured_on: injuredOn,
            severity: "grade_2",
            phase_started_at: started,
          });
          await boot();
        } catch (error) {
          fail(error);
        }
      })();
  });
}

// -------------------------------------------------------------------- home
function homeScreen(): void {
  const { user, episode, phase, gate } = state;
  if (!episode || !phase) return injuryScreen();

  const info = PHASE_NAMES[episode.current_phase] ?? { n: 1, name: episode.current_phase };
  const percent = Math.round((gate?.progress ?? 0) * 100);
  const first = phase.prescriptions[0];
  const position =
    POSITIONS.find((p) => p.key === user?.profile?.position)?.label ?? "Player";
  const scored = phase.prescriptions.filter((rx) => rx.exercise.pose_rule).length;
  const injury = INJURIES.find((i) => i.key === episode.injury_site)?.label ?? "";

  // Adherence and movement quality come from the same gate the testing screen
  // reads, so the dashboard can never disagree with it.
  const criterion = (key: string) => gate?.criteria.find((c) => c.key === key);
  const adherence = criterion("adherence")?.observed ?? null;
  const formScore = criterion("form_quality")?.observed ?? null;
  const completed = state.sessions.filter((s) => s.status === "completed").length;
  const painScores = state.sessions
    .map((s) => s.pain_during)
    .filter((p): p is number => p != null);
  const avgPain = painScores.length
    ? painScores.reduce((a, b) => a + b, 0) / painScores.length
    : null;

  // A tile either counts up to a real figure or shows a dash. It never counts
  // up to a number that was not measured.
  const tile = (value: number | null, suffix = ""): string =>
    value == null
      ? "—"
      : `<span data-count="${Math.round(value)}" data-suffix="${suffix}">0${suffix}</span>`;
  const movement =
    formScore != null
      ? tile(formScore)
      : avgPain != null
        ? `<span data-count="${avgPain.toFixed(1)}" data-decimals="1"
             data-suffix="/10">0.0/10</span>`
        : "—";

  shell(`
    <div class="dash">
      <div>
        <p class="hello">Welcome back,</p>
        <p class="name">${user?.full_name ?? "Player"}</p>
        <div class="who">
          <button class="tagbtn" id="change-role" title="Change your position">
            ${position}<em>change</em></button>
          <span>${injury} · ${episode.side} side</span>
        </div>
      </div>

      <div class="panel">
        <span class="label">Current phase</span>
        <div class="headline">${info.name}</div>
        <div class="caption">Phase ${info.n} of 4</div>
        ${bar(percent)}
        <div class="bar-row"><span>${gate?.required_passed ?? 0}/${
          gate?.required_total ?? 0
        } criteria met</span><b>${percent}%</b></div>
      </div>

      <div class="panel">
        <span class="label">Next session</span>
        <div class="headline">${phase.title_en}</div>
        <div class="caption">${phase.prescriptions.length} exercises${
          first ? ` · starting with ${first.exercise.name_en}` : ""
        }</div>
        ${
          scored
            ? `<div class="camera-note">${CAMERA_ICON}
                 <span><b>${scored} of ${phase.prescriptions.length}</b> checked live by
                 your camera<small>Form scored rep by rep as you move</small></span>
               </div>`
            : ""
        }
        <div class="controls" style="margin-top:14px">
          <button class="primary" id="start" style="flex:1">Start Session</button>
        </div>
      </div>

      <div class="tiles">
        <div class="tile"><div class="n">${tile(completed)}</div>
          <div class="k">Sessions<br>completed</div></div>
        <div class="tile"><div class="n">${tile(adherence, "%")}</div>
          <div class="k">Adherence</div></div>
        <div class="tile"><div class="n">${movement}</div>
          <div class="k">Movement<br>quality</div></div>
      </div>

      <div class="controls">
        <button class="ghost" id="criteria" style="flex:1">Return-to-play testing</button>
      </div>
    </div>`);

  on("#start", () => sessionScreen());
  on("#criteria", () => criteriaScreen());
  on("#change-role", () => void roleScreen({ mode: "edit" }));
}

// ----------------------------------------------------------------- session
function sessionScreen(): void {
  const phase = state.phase!;
  const cards = phase.prescriptions
    .map((rx) => {
      const dose = rx.reps ? `${rx.sets} × ${rx.reps}` : `${rx.sets} × ${rx.hold_seconds}s`;
      const camera = rx.exercise.pose_rule
        ? `${titleCase(rx.exercise.pose_rule.view)} camera`
        : "Logged by hand";
      return `<button class="card" data-key="${rx.exercise.key}">${rx.exercise.name_en}
        <span class="note">${rx.exercise.cue_en ?? ""}</span>
        <span class="meta">${dose} · ${camera}</span></button>`;
    })
    .join("");

  shell(`
    <h2>${phase.title_en}</h2>
    <p class="sub">${phase.goal_en ?? ""}</p>
    <div class="grid">${cards}</div>
    <div class="controls"><button class="ghost" id="back">Back</button></div>`);

  on("#back", () => homeScreen());
  app.querySelectorAll<HTMLButtonElement>(".card").forEach((card) => {
    card.onclick = () => {
      const rx = phase.prescriptions.find((p) => p.exercise.key === card.dataset.key)!;
      if (!rx.exercise.pose_rule) return manualScreen(rx);
      howToScreen(rx);
    };
  });
}

function manualScreen(rx: Prescription): void {
  shell(`
    <h2>${rx.exercise.name_en}</h2>
    <p class="sub">${rx.exercise.cue_en ?? ""}</p>
    <div class="notice">This drill has no camera rule — run it, then log that it is done.</div>
    <div class="controls">
      <button class="primary" id="done">Mark complete</button>
      <button class="ghost" id="back">Back</button>
    </div>`);
  on("#back", () => sessionScreen());
  on("#done", () => sessionScreen());
}

// ------------------------------------------------------------------ how to
function howToScreen(rx: Prescription): void {
  const exercise = rx.exercise;
  shell(`
    <h2>${exercise.name_en}</h2>
    <p class="sub">${rx.sets} sets ${
      rx.reps ? `× ${rx.reps} reps` : `× ${rx.hold_seconds}s hold`
    }</p>
    ${demoPanelHtml(exercise)}
    <div class="controls">
      <button class="ghost" id="back">Back</button>
      <button class="primary" id="go">I'm ready — start camera</button>
    </div>`);

  const animation = runDemoAnimation(exercise);
  on("#back", () => {
    animation.stop();
    sessionScreen();
  });
  on("#go", () => {
    animation.stop();
    cameraScreen(rx).catch(fail);
  });
}

// ------------------------------------------------------------------ camera
async function cameraScreen(rx: Prescription, facing: Facing = "user"): Promise<void> {
  const exercise = rx.exercise;
  const rule = exercise.pose_rule!;
  const side: Side = rx.side_mode === "bilateral" ? "bilateral" : (rx.side_mode as Side);
  const twoCameras = await hasMultipleCameras();

  shell(`
    <h2 class="tight">${exercise.name_en}</h2>
    <p class="sub tight">${exercise.cue_en ?? ""}</p>
    <div class="stage">
      <video id="cam" playsinline muted autoplay></video>
      <canvas id="overlay"></canvas>
      <div class="hud">
        <div class="hud-top">
          <div class="readout" id="readout">Starting…</div>
          ${
            twoCameras
              ? `<button class="iconbtn" id="flip" title="Switch camera"
                   aria-label="Switch camera">${FLIP_ICON}</button>`
              : ""
          }
        </div>
        <div id="centre"></div>
        <div class="repbox"><div class="count" id="count">0</div>
          <div class="of">of ${rx.reps ?? "—"} reps</div></div>
      </div>
    </div>
    <div class="controls sticky">
      <button class="ghost" id="back">Back</button>
      <button class="primary" id="finish">Finish set</button>
    </div>`);

  const video = app.querySelector<HTMLVideoElement>("#cam")!;
  const canvas = app.querySelector<HTMLCanvasElement>("#overlay")!;
  const readout = app.querySelector<HTMLDivElement>("#readout")!;
  const centre = app.querySelector<HTMLDivElement>("#centre")!;
  const countEl = app.querySelector<HTMLDivElement>("#count")!;
  const stage = app.querySelector<HTMLDivElement>(".stage")!;
  const ctx = canvas.getContext("2d")!;

  const camera = await startCamera(video, facing);
  // A rear camera is already the right way round; flipping it would put the
  // player's left leg on the right of the screen.
  stage.classList.toggle("mirrored", camera.mirrored);
  // The phone is propped up and the player is three metres away. Without this
  // the screen sleeps mid-set and the rep count simply stops.
  const releaseWakeLock = keepScreenAwake();
  const landmarker = await createPoseLandmarker();
  canvas.width = camera.width;
  canvas.height = camera.height;

  const session = new LiveSession(rule, side);
  const show = metricsToShow(rule.targets.map((t) => t.metric));
  const aspect = camera.width / camera.height;
  let running = true;
  let lastTime = -1;
  let cueUntil = 0;
  let shownReps = 0;
  const started = performance.now();

  const stop = () => {
    running = false;
    releaseWakeLock();
    camera.stop();
    landmarker.close();
  };

  on("#back", () => {
    stop();
    sessionScreen();
  });
  on("#flip", () => {
    stop();
    // Reopening is the only reliable way to change camera: swapping the track
    // in place leaves Safari showing the old one.
    void cameraScreen(rx, camera.facing === "user" ? "environment" : "user").catch(fail);
  });
  on("#finish", () => {
    const outcome = session.finish();
    stop();
    summaryScreen(rx, outcome, camera.width, camera.height, side, camera.facing);
  });

  const loop = (): void => {
    if (!running) return;
    if (video.currentTime !== lastTime && video.readyState >= 2) {
      lastTime = video.currentTime;
      const points = landmarker.detectForVideo(video, performance.now()).landmarks?.[0];
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (points && points.length >= 33) {
        const frame = Frame.from((performance.now() - started) / 1000, points, aspect);
        const result = session.push(frame);
        drawSkeleton(ctx, frame, result.accepted, camera.mirrored);
        renderReadout(readout, result, show);
        if (result.validRepCount !== shownReps) {
          shownReps = result.validRepCount;
          countEl.textContent = String(shownReps);
          // The rep landing is the moment the camera proves itself. Give it one.
          pulse(countEl, "tick-up");
        }

        const blocker = result.problems.find((p) => p.code !== "warming_up");
        if (blocker) {
          centre.innerHTML = `<div class="blocker">${blocker.message_en}</div>`;
        } else if (result.activeCues.length) {
          centre.innerHTML = `<div class="cue">${result.activeCues[0]!.message_en}</div>`;
          cueUntil = performance.now() + 900;
        } else if (performance.now() > cueUntil) {
          centre.innerHTML = "";
        }
      } else {
        readout.innerHTML = `<span style="color:var(--red)">no player detected</span>`;
        centre.innerHTML = `<div class="blocker">Stand so your whole body is in shot</div>`;
      }
    }
    requestAnimationFrame(loop);
  };
  loop();
}

// ----------------------------------------------------------------- summary
function summaryScreen(
  rx: Prescription,
  outcome: ReturnType<LiveSession["finish"]>,
  width: number,
  height: number,
  side: Side,
  facing: Facing,
): void {
  const rows = outcome.reps
    .map(
      (rep) => `<div class="row">
        <span class="${rep.isValid ? "ok" : "no"}">${rep.isValid ? "✔" : "✘"}</span>
        <span>Rep ${rep.index + 1}</span>
        <span class="grow">${
          rep.violations.map((v) => v.message_en).join(" · ") || "Good form"
        }</span>
        <span>${rep.formScore.toFixed(0)}/100</span>
      </div>`,
    )
    .join("");

  shell(`
    <h2>${rx.exercise.name_en}</h2>
    <p class="sub">${outcome.validReps} of ${outcome.completedReps} reps counted ·
      average form ${outcome.formScore.toFixed(0)}/100</p>
    ${outcome.warnings.length ? `<div class="notice">${outcome.warnings.join(", ")}</div>` : ""}
    <div class="reps">${rows || '<div class="row">No reps detected</div>'}</div>
    <div class="controls">
      <button class="primary" id="save">Save to my record</button>
      <button class="ghost" id="again">Do another set</button>
      <button class="ghost" id="back">Back to session</button>
    </div>
    <p class="sub" id="savestate" style="text-align:center;margin-top:12px"></p>`);

  on("#again", () => cameraScreen(rx, facing).catch(fail));
  on("#back", () => sessionScreen());
  on("#save", () => {
    const note = app.querySelector<HTMLElement>("#savestate")!;
    note.textContent = "Saving…";
    void (async () => {
      try {
        const session = await api.startSession(state.episode!.id);
        await api.uploadSet(session.id, {
          exercise_key: rx.exercise.key,
          side,
          image_width: width,
          image_height: height,
          prescribed_reps: rx.reps,
          frames: outcome.frames.map((f) => f.toPayload()),
        });
        await api.completeSession(session.id, { rpe: 5 });
        await refresh();
        note.textContent = "Saved. Your criteria have been updated.";
      } catch (error) {
        note.textContent =
          error instanceof api.ApiError ? String(error.detail) : String(error);
      }
    })();
  });
}

// ---------------------------------------------------------------- criteria
function criteriaScreen(): void {
  const gate = state.gate;
  if (!gate) return homeScreen();
  const percent = Math.round(gate.progress * 100);
  const info = PHASE_NAMES[gate.phase_key] ?? { n: 1, name: gate.phase_key };

  const mark = (c: api.CriterionResult) =>
    c.status === "pass" ? TICK : c.status === "fail" ? CROSS : DASH;
  const value = (c: api.CriterionResult) => {
    if (c.observed == null) return `<span>not measured</span>`;
    const unit = c.unit && c.unit !== "score" ? ` ${c.unit}` : "";
    const target = c.target == null ? "" : ` <span>/ ${round(c.target)}${unit}</span>`;
    return `<b>${round(c.observed)}${unit}</b>${target}`;
  };

  shell(`
    <h2>Return-to-play testing</h2>
    <p class="sub">Phase ${info.n} of 4 — ${info.name}</p>

    <div class="result">
      ${progressRing(percent, gate.passed ? "pass" : "in progress")}
      <div class="verdict">
        <div class="big ${gate.passed ? "pass" : "fail"}">
          ${gate.passed ? "PASS" : "NOT YET"}
        </div>
        <p>${
          gate.passed
            ? "All criteria met. Gradual return under coaching staff guidance."
            : `${gate.required_passed} of ${gate.required_total} required criteria met. ` +
              `Each one below shows where you are against its target.`
        }</p>
      </div>
    </div>

    <h3>Test battery</h3>
    <ul class="criteria">
      ${gate.criteria
        .map(
          (c) => `<li class="${c.required ? "" : "optional"}">
            ${mark(c)}
            <span class="what">${c.label_en}
              ${c.source === "pose" ? `<span class="src">${CAMERA_ICON} camera</span>` : ""}
              <small>${c.detail_en}${c.required ? "" : " · optional"}</small></span>
            <span class="val">${value(c)}</span>
          </li>`,
        )
        .join("")}
    </ul>

    <div class="controls">
      ${gate.passed ? `<button class="primary" id="advance">Move to next phase</button>` : ""}
      <button class="ghost" id="back">Back</button>
    </div>`);

  on("#back", () => homeScreen());
  on("#advance", () =>
    void (async () => {
      try {
        await api.advancePhase(state.episode!.id);
        await refresh();
        homeScreen();
      } catch (error) {
        fail(error);
      }
    })(),
  );
}

const round = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

// -------------------------------------------------------------------- boot
async function refresh(): Promise<void> {
  if (!state.episode) return;
  const [phase, gate, sessions] = await Promise.all([
    api.todayPlan(state.episode.id),
    api.exitCriteria(state.episode.id),
    api.listSessions(state.episode.id),
  ]);
  state.phase = phase;
  state.gate = gate;
  state.sessions = sessions;
}

async function boot(): Promise<void> {
  shell(`<h2>Loading…</h2>`);
  state.online = await api.backendUp();
  if (!state.online) {
    shell(`<h2>Backend not running</h2>
      <div class="notice">Start it with <code>uvicorn app.main:app --reload</code>,
        then reload this page.</div>`);
    return;
  }
  if (!api.isSignedIn()) return signInScreen();

  try {
    state.user = await api.me();
    // A player with no position cannot be given a programme -- the sprint gates
    // come from it. Ask before anything else.
    if (state.user.role === "player" && !state.user.profile?.position) {
      return void roleScreen({ mode: "edit" });
    }
    const episodes = await api.listEpisodes();
    state.episode = episodes[0] ?? null;
    if (!state.episode) return injuryScreen();
    await refresh();
    homeScreen();
  } catch (error) {
    if (error instanceof api.ApiError && error.status === 401) {
      api.signOut();
      return signInScreen();
    }
    fail(error);
  }
}

void boot();
