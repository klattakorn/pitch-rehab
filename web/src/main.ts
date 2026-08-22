/**
 * Pitch Rehab — demo front end.
 *
 * Five tabs once you are signed in (Home, Plan, Progress, Test, Profile), and
 * a linear onboarding before that: welcome → position → injury. Position comes
 * first because it decides the sprint targets a player has to clear, so it
 * cannot be asked for afterwards.
 *
 * Scoring runs here in the browser so the feedback is instant; the same numbers
 * go to the server afterwards, and the server decides whether a phase unlocks.
 */
import "./styles.css";

import * as api from "./api";
import type { Episode, Gate, Phase, Prescription } from "./api";
import { INJURY_SITES, bodyMapHtml } from "./bodymap";
import { barChart, lineChart, meterRow } from "./charts";
import {
  ABSOLUTE,
  TARGET_TYPE_LABELS,
  draftFrom,
  exercisePickerHtml,
  metricPickerHtml,
  preview,
  splitMetric,
  toDraft,
  unitFor,
  windowText,
} from "./criteria";
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
  BACK_ARROW,
  BELL,
  BRAND_MARK,
  CAMERA_ICON,
  CHEVRON,
  CROSS,
  DASH,
  FLIP_ICON,
  PAUSE_ICON,
  PENCIL,
  PLAY_ICON,
  TAB_ICONS,
  TICK_FILLED,
  WORDMARK,
  bar,
  initials,
  progressRing,
  titleCase,
} from "./ui";

const app = document.querySelector<HTMLDivElement>("#app")!;

const POSITIONS = [
  { key: "goalkeeper", label: "Goalkeeper" },
  { key: "centre_back", label: "Centre back" },
  { key: "full_back", label: "Full back" },
  { key: "centre_midfield", label: "Midfielder" },
  { key: "winger", label: "Winger" },
  { key: "striker", label: "Forward" },
];

const PHASE_NAMES: Record<string, { n: number; name: string; weeks: string }> = {
  p1_protect: { n: 1, name: "Protection Phase", weeks: "Weeks 1–4" },
  p2_strength: { n: 2, name: "Strength & Control", weeks: "Weeks 4–8" },
  p3_running: { n: 3, name: "Power & Perform", weeks: "Weeks 8–12" },
  p4_return: { n: 4, name: "Return to Play", weeks: "Weeks 12+" },
};

const PHASE_ORDER = ["p1_protect", "p2_strength", "p3_running", "p4_return"];

type Tab = "home" | "plan" | "progress" | "test" | "profile";

interface State {
  user: api.User | null;
  episode: Episode | null;
  phase: Phase | null;
  gate: Gate | null;
  sessions: api.SessionRow[];
  positions: api.PositionInfo[] | null;
  protocol: api.Protocol | null;
  progress: api.Progress | null;
  catalogue: api.AuthorableCatalogue | null;
  customCriteria: api.CustomCriterion[] | null;
  online: boolean;
}
const state: State = {
  user: null,
  episode: null,
  phase: null,
  gate: null,
  sessions: [],
  positions: null,
  protocol: null,
  progress: null,
  catalogue: null,
  customCriteria: null,
  online: false,
};

// --------------------------------------------------------------------- shell
interface Chrome {
  /** Show the tab bar with this tab lit. Omit for a pushed or onboarding screen. */
  tab?: Tab;
  /** Back arrow and a centred title. */
  title?: string;
  back?: () => void;
  /** Dashboard header: "Welcome back, <name>" and the bell. */
  greeting?: boolean;
  /** Centred logo, for onboarding steps. */
  brand?: boolean;
  /** Extra markup for the right-hand slot of a titled header. */
  right?: string;
}

const TABS: { key: Tab; label: string; go: () => void }[] = [
  { key: "home", label: "Home", go: () => homeScreen() },
  { key: "plan", label: "Plan", go: () => void planScreen() },
  { key: "progress", label: "Progress", go: () => void progressScreen() },
  { key: "test", label: "Test", go: () => testScreen() },
  { key: "profile", label: "Profile", go: () => profileScreen() },
];

function header(chrome: Chrome): string {
  if (chrome.greeting) {
    return `
      <header class="topbar greeting">
        <div>
          <span class="hello">Welcome back,</span>
          <span class="name">${state.user?.full_name ?? "Player"}</span>
        </div>
        <div class="spacer"></div>
        ${state.online ? "" : `<span class="pill bad">offline</span>`}
        <button class="iconbtn ghosted" id="bell" aria-label="Notifications">
          ${BELL}<span class="dot-badge"></span></button>
      </header>`;
  }
  if (chrome.brand) {
    return `
      <header class="topbar brandbar">
        <span class="brand">${BRAND_MARK}${WORDMARK}</span>
      </header>`;
  }
  if (chrome.title) {
    return `
      <header class="topbar titled">
        ${chrome.back ? `<button class="iconbtn ghosted" id="nav-back" aria-label="Back">${BACK_ARROW}</button>` : `<span class="iconbtn ghosted" aria-hidden="true"></span>`}
        <h1>${chrome.title}</h1>
        ${chrome.right ?? `<span class="iconbtn ghosted" aria-hidden="true"></span>`}
      </header>`;
  }
  return "";
}

function tabbar(active: Tab | undefined): string {
  if (!active) return "";
  return `
    <nav class="tabbar" aria-label="Sections">
      ${TABS.map(
        (t) => `<button class="tab${t.key === active ? " on" : ""}" data-tab="${t.key}"
          ${t.key === active ? 'aria-current="page"' : ""}>
          ${TAB_ICONS[t.key]}<span>${t.label}</span></button>`,
      ).join("")}
    </nav>`;
}

function shell(body: string, chrome: Chrome = {}): void {
  app.innerHTML = `
    ${header(chrome)}
    <main class="${chrome.tab ? "with-tabs" : ""}${chrome.brand || chrome.greeting ? "" : ""}">${body}</main>
    ${tabbar(chrome.tab)}`;

  if (chrome.back) on("#nav-back", chrome.back);
  app.querySelectorAll<HTMLButtonElement>(".tab").forEach((button) => {
    button.onclick = () => TABS.find((t) => t.key === button.dataset["tab"])?.go();
  });
  on("#bell", () => notificationsScreen());

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
  shell(
    `<div class="stack">
       <div class="notice">${message}</div>
       <button class="primary" id="home">Back to start</button>
     </div>`,
    { title: "Something went wrong" },
  );
  on("#home", () => void boot());
}

// ---------------------------------------------------------------- onboarding
function welcomeScreen(): void {
  shell(
    `<div class="welcome">
       <div class="welcome-art" aria-hidden="true">
         <span class="glow"></span>
         ${BRAND_MARK}
       </div>
       <h2>Smarter Rehab<br><em>Stronger Comeback</em></h2>
       <p class="sub">Rehab plans built around your position and your injury —
         with your camera checking every rep.</p>
       <div class="stack">
         <button class="primary block" id="start">Get Started</button>
         <button class="linkbtn" id="signin">I already have an account</button>
       </div>
     </div>`,
    { brand: true },
  );
  on("#start", () => signInScreen("", true));
  on("#signin", () => signInScreen());
}

function signInScreen(notice = "", isNew = false): void {
  shell(
    `<div class="stack narrow">
       <h2>${isNew ? "Create your account" : "Welcome back"}</h2>
       <p class="sub">${
         isNew
           ? "One email and a password. We ask for your position next."
           : "Sign in to pick up where you left off."
       }</p>
       ${notice ? `<div class="notice">${notice}</div>` : ""}
       <div class="panel">
         <label class="label" for="email">Email</label>
         <input id="email" type="email" value="alex@pitchrehab.app"
           autocomplete="email" autocapitalize="off" autocorrect="off" spellcheck="false" />
         <label class="label" for="password">Password</label>
         <input id="password" type="password" value="correct-horse-battery"
           autocomplete="current-password" />
       </div>
       <button class="primary block" id="go">Continue</button>
       <button class="linkbtn" id="back">Back</button>
     </div>`,
    { brand: true },
  );

  on("#back", () => welcomeScreen());
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
  shell(`<div class="loading">Loading positions…</div>`, { brand: true });
  try {
    state.positions ??= await api.listPositions();
  } catch (error) {
    return fail(error);
  }
  const positions = byDemand(state.positions);
  let chosen = intent.mode === "edit" ? (state.user?.profile?.position ?? null) : null;

  const chrome: Chrome =
    intent.mode === "edit"
      ? { title: "Your position", back: () => profileScreen() }
      : { brand: true };

  shell(
    `${
      intent.mode === "signup"
        ? `<div class="steps"><span class="step on">1 · Position</span>
             <span class="step">2 · Injury</span></div>`
        : ""
    }
     <h2>What's your primary position?</h2>
     <p class="sub">This customises your rehab for your role on the pitch. A winger
       has to sprint faster than a keeper before either is let back on.</p>
     <div class="role-grid">
       ${positions.map((p) => roleCardHtml(p, p.key === chosen)).join("")}
     </div>
     <div id="role-detail" class="role-detail-slot"></div>
     <div class="controls">
       <button class="primary block" id="continue" ${chosen ? "" : "disabled"}>
         ${intent.mode === "edit" ? "Save position" : "Next"}
       </button>
     </div>`,
    chrome,
  );

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
      const isOn = card.dataset["key"] === key;
      card.classList.toggle("on", isOn);
      card.setAttribute("aria-pressed", String(isOn));
    });
    app.querySelector<HTMLButtonElement>("#continue")!.disabled = false;
    showDetail(key);
  };

  if (chosen) showDetail(chosen);
  app.querySelectorAll<HTMLButtonElement>(".role-card").forEach((card) => {
    card.onclick = () => select(card.dataset["key"]!);
  });

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

// -------------------------------------------------------- where is the injury
function injuryScreen(): void {
  const position = POSITIONS.find((p) => p.key === state.user?.profile?.position);
  let chosen: string | null = null;
  let side = "left";

  const render = (): void => {
    shell(
      `<div class="steps"><span class="step done">1 · Position</span>
         <span class="step on">2 · Injury</span></div>
       <h2>Where is your injury?</h2>
       <p class="sub">${
         position
           ? `Tap the area, or pick from the list. Your plan is built for this injury
              <b>and</b> for playing ${position.label.toLowerCase()}.`
           : "Tap the area, or pick from the list."
       }</p>
       ${bodyMapHtml(chosen)}
       <div class="grid tight">
         ${INJURY_SITES.map(
           (site) => `<button class="card site${site.key === chosen ? " on" : ""}"
             data-key="${site.key}" aria-pressed="${site.key === chosen}">
             <span class="tick-slot"></span>
             ${site.label}<span class="note">${site.note}</span></button>`,
         ).join("")}
       </div>
       <h3>Which side</h3>
       <div class="segmented" role="group" aria-label="Injured side">
         <button class="seg${side === "left" ? " on" : ""}" id="side-left">Left</button>
         <button class="seg${side === "right" ? " on" : ""}" id="side-right">Right</button>
       </div>
       <div class="controls">
         <button class="primary block" id="next" ${chosen ? "" : "disabled"}>Next</button>
       </div>`,
      { brand: true },
    );

    const pick = (key: string): void => {
      chosen = key;
      render();
    };
    app.querySelectorAll<HTMLElement>(".site").forEach((card) => {
      card.onclick = () => pick(card.dataset["key"]!);
    });
    app.querySelectorAll<SVGGElement>(".hotspot").forEach((spot) => {
      const key = spot.dataset["key"]!;
      spot.onclick = () => pick(key);
      spot.onkeydown = (event: KeyboardEvent) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          pick(key);
        }
      };
    });
    on("#side-left", () => {
      side = "left";
      render();
    });
    on("#side-right", () => {
      side = "right";
      render();
    });

    on("#next", () => {
      if (!chosen) return;
      const button = app.querySelector<HTMLButtonElement>("#next")!;
      button.disabled = true;
      button.textContent = "Building your plan…";
      void (async () => {
        try {
          const injuredOn = new Date(Date.now() - 12 * 864e5).toISOString().slice(0, 10);
          const started = new Date(Date.now() - 8 * 864e5).toISOString();
          await api.createEpisode({
            injury_site: chosen!,
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
  };

  render();
}

// -------------------------------------------------------------------- home
function homeScreen(): void {
  const { episode, phase, gate } = state;
  if (!episode || !phase) return injuryScreen();

  const info = PHASE_NAMES[episode.current_phase] ?? {
    n: 1,
    name: titleCase(episode.current_phase),
    weeks: "",
  };
  const percent = Math.round((gate?.progress ?? 0) * 100);
  const injury = INJURY_SITES.find((i) => i.key === episode.injury_site)?.label ?? "";
  const scored = phase.prescriptions.filter((rx) => rx.exercise.pose_rule).length;
  const progress = state.progress;

  const week =
    progress && progress.week_of <= progress.weeks_total
      ? `Week ${progress.week_of} of ${progress.weeks_total}`
      : progress
        ? `Week ${progress.week_of}`
        : "";

  shell(
    `<div class="dash">
       <section class="panel accent">
         <span class="label">Current plan</span>
         <div class="headline">${injury}</div>
         <div class="caption">${episode.side} side · Phase ${info.n} — ${info.name}</div>
         <div class="bar-row top"><span>Progress</span><b>${percent}%</b></div>
         ${bar(percent)}
         ${week ? `<div class="caption week">${week}</div>` : ""}
       </section>

       <section class="panel">
         <span class="label">Today's plan</span>
         <div class="row-between">
           <div>
             <div class="headline">${phase.title_en}</div>
             <div class="caption">${phase.prescriptions.length} exercises</div>
           </div>
           ${progressRing(percent, "phase", "sm")}
         </div>
         ${
           scored
             ? `<div class="camera-note">${CAMERA_ICON}
                  <span><b>${scored} of ${phase.prescriptions.length}</b> checked live by
                  your camera<small>Form scored rep by rep as you move</small></span>
                </div>`
             : ""
         }
         <button class="primary block" id="start">Start Session</button>
       </section>

       <section class="panel">
         <span class="label">Weekly overview</span>
         ${weekStrip()}
       </section>

       <div class="tiles">
         <div class="tile"><div class="n">${tileValue(progress?.sessions_completed ?? 0)}</div>
           <div class="k">Sessions</div></div>
         <div class="tile"><div class="n">${tileValue(progress?.exercises_completed ?? 0)}</div>
           <div class="k">Exercises</div></div>
         <div class="tile"><div class="n">${
           progress?.mean_form_score == null
             ? "—"
             : tileValue(Math.round(progress.mean_form_score), "%")
         }</div>
           <div class="k">Accuracy</div></div>
       </div>
     </div>`,
    { tab: "home", greeting: true },
  );

  on("#start", () => void planScreen());
}

/** A tile counts up to a real figure, or shows a dash. It never counts up to nothing. */
function tileValue(value: number, suffix = ""): string {
  return `<span data-count="${value}" data-suffix="${suffix}">0${suffix}</span>`;
}

/** Which days this week already have a completed session on them. */
function weekStrip(): string {
  const done = new Set(
    state.sessions
      .filter((s) => s.status === "completed")
      .map((s) => new Date(s.started_at).toDateString()),
  );
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));

  const letters = ["M", "T", "W", "T", "F", "S", "S"];
  const cells = letters.map((letter, index) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + index);
    const isToday = day.toDateString() === today.toDateString();
    const isDone = done.has(day.toDateString());
    return `<span class="day${isDone ? " done" : ""}${isToday ? " today" : ""}"
      title="${day.toDateString()}">${letter}</span>`;
  });
  return `<div class="weekstrip">${cells.join("")}</div>`;
}

// -------------------------------------------------------------------- plan
async function planScreen(shown?: string): Promise<void> {
  if (!state.episode) return injuryScreen();
  if (!state.protocol) {
    shell(`<div class="loading">Loading your plan…</div>`, { tab: "plan", title: "Your Rehab Plan" });
    try {
      state.protocol = await api.protocolFor(state.episode.id);
    } catch (error) {
      return fail(error);
    }
  }
  const protocol = state.protocol;
  const current = state.episode.current_phase;
  const active = shown ?? current;
  const phase = protocol.phases.find((p) => p.phase_key === active) ?? protocol.phases[0]!;
  const info = PHASE_NAMES[phase.phase_key] ?? {
    n: phase.order_index + 1,
    name: titleCase(phase.phase_key),
    weeks: "",
  };
  const currentIndex = PHASE_ORDER.indexOf(current);
  const shownIndex = PHASE_ORDER.indexOf(phase.phase_key);
  const isCurrent = phase.phase_key === current;

  const doneCount = state.sessions.filter((s) => s.status === "completed").length;

  shell(
    `<div class="phasetabs" role="tablist">
       ${protocol.phases
         .map((p, i) => {
           const cls =
             p.phase_key === active ? "on" : i < currentIndex ? "done" : "";
           return `<button class="phasetab ${cls}" data-phase="${p.phase_key}"
             role="tab" aria-selected="${p.phase_key === active}">Phase ${i + 1}</button>`;
         })
         .join("")}
     </div>

     <section class="panel">
       <div class="row-between">
         <div>
           <div class="headline">Phase ${info.n}: ${info.name}</div>
           <div class="caption">${phase.min_days} days minimum ·
             ${phase.sessions_per_week}× a week</div>
         </div>
         ${
           shownIndex < currentIndex
             ? `<span class="chip done">Cleared</span>`
             : isCurrent
               ? `<span class="chip on">Current</span>`
               : `<span class="chip">Locked</span>`
         }
       </div>
     </section>

     <h3>Exercises</h3>
     <div class="stack">
       ${phase.prescriptions
         .map((rx, index) => {
           const dose = rx.reps
             ? `${rx.sets} × ${rx.reps}`
             : `${rx.sets} × ${rx.hold_seconds}s`;
           const camera = rx.exercise.pose_rule
             ? `${titleCase(rx.exercise.pose_rule.view)} camera`
             : "Logged by hand";
           const complete = isCurrent && index < doneCount;
           return `<button class="rowcard" data-key="${rx.exercise.key}"
             ${isCurrent ? "" : "disabled"}>
             <span class="rowmark">${complete ? TICK_FILLED : DASH}</span>
             <span class="rowbody"><b>${rx.exercise.name_en}</b>
               <small>${dose} · ${camera}</small></span>
             ${isCurrent ? CHEVRON : ""}
           </button>`;
         })
         .join("")}
     </div>

     <section class="panel goal">
       <span class="label">Goal of this phase</span>
       <p>${phase.goal_en ?? "Progress toward the next phase."}</p>
     </section>

     ${
       isCurrent
         ? ""
         : `<div class="notice">${
             shownIndex < currentIndex
               ? "You have already cleared this phase."
               : "This phase unlocks when you pass the current one's testing."
           }</div>`
     }`,
    { tab: "plan", title: "Your Rehab Plan", back: () => homeScreen() },
  );

  app.querySelectorAll<HTMLButtonElement>(".phasetab").forEach((button) => {
    button.onclick = () => void planScreen(button.dataset["phase"]!);
  });
  app.querySelectorAll<HTMLButtonElement>(".rowcard").forEach((card) => {
    card.onclick = () => {
      const rx = phase.prescriptions.find((p) => p.exercise.key === card.dataset["key"]);
      if (!rx) return;
      if (!rx.exercise.pose_rule) return manualScreen(rx);
      howToScreen(rx);
    };
  });
}

function manualScreen(rx: Prescription): void {
  shell(
    `<div class="stack">
       <p class="sub">${rx.exercise.cue_en ?? ""}</p>
       <div class="notice">This drill has no camera rule — run it, then log that it
         is done.</div>
       <button class="primary block" id="done">Mark complete</button>
     </div>`,
    { title: rx.exercise.name_en, back: () => void planScreen() },
  );
  on("#done", () => void planScreen());
}

// ------------------------------------------------------------------ how to
function howToScreen(rx: Prescription): void {
  const exercise = rx.exercise;
  shell(
    `<p class="sub">${rx.sets} sets ${
      rx.reps ? `× ${rx.reps} reps` : `× ${rx.hold_seconds}s hold`
    }</p>
     ${demoPanelHtml(exercise)}
     <div class="controls">
       <button class="primary block" id="go">I'm ready — start camera</button>
     </div>`,
    { title: exercise.name_en, back: () => void planScreen() },
  );

  const animation = runDemoAnimation(exercise);
  const leave = (go: () => void) => {
    animation.stop();
    go();
  };
  on("#nav-back", () => leave(() => void planScreen()));
  on("#go", () => leave(() => void cameraScreen(rx).catch(fail)));
}

// ------------------------------------------------------------------ camera
async function cameraScreen(rx: Prescription, facing: Facing = "user"): Promise<void> {
  const exercise = rx.exercise;
  const rule = exercise.pose_rule!;
  const side: Side = rx.side_mode === "bilateral" ? "bilateral" : (rx.side_mode as Side);
  const twoCameras = await hasMultipleCameras();

  shell(
    `<div class="stage">
       <video id="cam" playsinline muted autoplay></video>
       <canvas id="overlay"></canvas>
       <div class="hud">
         <div class="hud-top">
           <div class="form-badge" id="badge">Getting ready…</div>
           ${
             twoCameras
               ? `<button class="iconbtn" id="flip" title="Switch camera"
                    aria-label="Switch camera">${FLIP_ICON}</button>`
               : ""
           }
         </div>
         <div id="centre"></div>
         <div class="hud-bottom">
           <div class="repdial">
             <svg viewBox="0 0 88 88" aria-hidden="true">
               <circle cx="44" cy="44" r="39" fill="none" stroke="rgba(9,14,11,.75)"
                 stroke-width="6"/>
               <circle id="repring" cx="44" cy="44" r="39" fill="none" stroke="var(--green)"
                 stroke-width="6" stroke-linecap="round" stroke-dasharray="0 245"
                 transform="rotate(-90 44 44)"/>
             </svg>
             <span class="repnum" id="count">0</span>
             <span class="replabel">REPS</span>
           </div>
           <div class="readout" id="readout">Starting…</div>
         </div>
       </div>
     </div>

     <div class="setbar">
       <div class="setstat"><span>Target</span><b>${rx.sets} × ${
         rx.reps ?? `${rx.hold_seconds}s`
       }</b></div>
       <button class="roundbtn" id="pause" aria-label="Pause">${PAUSE_ICON}</button>
       <div class="setstat right"><span>Rest</span><b>${rx.rest_seconds ?? 30}s</b></div>
     </div>
     <div class="controls">
       <button class="primary block" id="finish">End Set</button>
     </div>`,
    { title: exercise.name_en, back: () => stop(() => void planScreen()) },
  );

  const video = app.querySelector<HTMLVideoElement>("#cam")!;
  const canvas = app.querySelector<HTMLCanvasElement>("#overlay")!;
  const readout = app.querySelector<HTMLDivElement>("#readout")!;
  const centre = app.querySelector<HTMLDivElement>("#centre")!;
  const countEl = app.querySelector<HTMLSpanElement>("#count")!;
  const badge = app.querySelector<HTMLDivElement>("#badge")!;
  const repring = app.querySelector<SVGCircleElement>("#repring")!;
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
  const target = rx.reps ?? 10;
  const CIRCUMFERENCE = 2 * Math.PI * 39;

  let running = true;
  let paused = false;
  let lastTime = -1;
  let cueUntil = 0;
  let shownReps = 0;
  const started = performance.now();

  function stop(then: () => void): void {
    running = false;
    releaseWakeLock();
    camera.stop();
    landmarker.close();
    then();
  }

  on("#nav-back", () => stop(() => void planScreen()));
  on("#finish", () => {
    const outcome = session.finish();
    stop(() =>
      summaryScreen(rx, outcome, camera.width, camera.height, side, camera.facing),
    );
  });
  on("#flip", () => {
    // Reopening is the only reliable way to change camera: swapping the track
    // in place leaves Safari showing the old one.
    stop(() =>
      void cameraScreen(rx, camera.facing === "user" ? "environment" : "user").catch(fail),
    );
  });
  on("#pause", () => {
    paused = !paused;
    const button = app.querySelector<HTMLButtonElement>("#pause")!;
    button.innerHTML = paused ? PLAY_ICON : PAUSE_ICON;
    button.setAttribute("aria-label", paused ? "Resume" : "Pause");
    stage.classList.toggle("paused", paused);
  });

  const loop = (): void => {
    if (!running) return;
    if (!paused && video.currentTime !== lastTime && video.readyState >= 2) {
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
          const filled = CIRCUMFERENCE * Math.min(1, shownReps / Math.max(1, target));
          repring.setAttribute("stroke-dasharray", `${filled} ${CIRCUMFERENCE}`);
          // The rep landing is the moment the camera proves itself. Give it one.
          pulse(countEl, "tick-up");
        }

        const blocker = result.problems.find((p) => p.code !== "warming_up");
        if (blocker) {
          badge.className = "form-badge bad";
          badge.textContent = "Check your setup";
          centre.innerHTML = `<div class="blocker">${blocker.message_en}</div>`;
        } else if (result.activeCues.length) {
          badge.className = "form-badge warn";
          badge.textContent = "Fix your form";
          centre.innerHTML = `<div class="cue">${result.activeCues[0]!.message_en}</div>`;
          cueUntil = performance.now() + 900;
        } else if (performance.now() > cueUntil) {
          badge.className = "form-badge good";
          badge.textContent = "Good form!";
          centre.innerHTML = "";
        }
      } else {
        badge.className = "form-badge bad";
        badge.textContent = "No player detected";
        readout.innerHTML = `<span class="warn">no reading</span>`;
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
  const accuracy = Math.round(outcome.formScore);
  const rows = outcome.reps
    .map(
      (rep) => `<div class="row">
        <span class="${rep.isValid ? "ok" : "no"}">${rep.isValid ? "✔" : "✘"}</span>
        <span>Rep ${rep.index + 1}</span>
        <span class="grow">${
          rep.violations.map((v) => v.message_en).join(" · ") || "Good form"
        }</span>
        <span>${rep.formScore.toFixed(0)}</span>
      </div>`,
    )
    .join("");

  shell(
    `<div class="result">
       ${progressRing(accuracy, outcome.validReps ? "accuracy" : "no reps")}
       <div class="verdict">
         <div class="big ${accuracy >= 80 ? "pass" : "fail"}">
           ${outcome.validReps} of ${outcome.completedReps} reps counted
         </div>
         <p>${
           outcome.validReps
             ? "Saved reps feed straight into your return-to-play testing."
             : "Nothing counted. Check the camera angle and try again."
         }</p>
       </div>
     </div>
     ${outcome.warnings.length ? `<div class="notice">${outcome.warnings.join(", ")}</div>` : ""}
     <h3>Rep by rep</h3>
     <div class="reps">${rows || '<div class="row">No reps detected</div>'}</div>
     <div class="controls stackable">
       <button class="primary block" id="save">Save to my record</button>
       <button class="ghost block" id="again">Do another set</button>
     </div>
     <p class="sub center" id="savestate"></p>`,
    { title: rx.exercise.name_en, back: () => void planScreen() },
  );

  on("#again", () => cameraScreen(rx, facing).catch(fail));
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
        note.textContent = "Saved. Your testing has been updated.";
      } catch (error) {
        note.textContent =
          error instanceof api.ApiError ? String(error.detail) : String(error);
      }
    })();
  });
}

// ---------------------------------------------------------------- progress
async function progressScreen(): Promise<void> {
  if (!state.episode) return injuryScreen();
  if (!state.progress) {
    shell(`<div class="loading">Working out your progress…</div>`, {
      tab: "progress",
      title: "Progress",
    });
    try {
      state.progress = await api.progress(state.episode.id);
    } catch (error) {
      return fail(error);
    }
  }
  const p = state.progress;
  const info = PHASE_NAMES[p.phase_key] ?? { n: p.phase_order, name: titleCase(p.phase_key) };

  const accuracyPoints = p.trend.map((t) => ({ day: t.day, value: t.mean_form_score }));
  const sessionPoints = p.trend.map((t) => ({ day: t.day, value: t.sessions }));

  shell(
    `<section class="panel accent">
       <span class="label">Overall progress</span>
       <div class="row-between">
         <div>
           <div class="bignum" data-count="${Math.round(p.overall_pct)}"
             data-suffix="%">0%</div>
           <div class="caption">Phase ${info.n} of 4 — ${info.name}</div>
           <div class="caption">${
             p.week_of <= p.weeks_total
               ? `Week ${p.week_of} of ${p.weeks_total}`
               : `Week ${p.week_of} · past the ${p.weeks_total}-week minimum`
           }</div>
         </div>
         ${progressRing(p.phase_pct, "this phase", "sm")}
       </div>
       ${bar(p.overall_pct)}
     </section>

     <div class="tiles">
       <div class="tile"><div class="n">${tileValue(p.sessions_completed)}</div>
         <div class="k">Sessions</div></div>
       <div class="tile"><div class="n">${tileValue(p.exercises_completed)}</div>
         <div class="k">Exercises</div></div>
       <div class="tile"><div class="n">${
         p.mean_form_score == null ? "—" : tileValue(Math.round(p.mean_form_score), "%")
       }</div><div class="k">Avg accuracy</div></div>
     </div>

     ${
       p.symmetry
         ? `<section class="panel">
              <span class="label">Strength balance</span>
              <div class="row-between">
                <div>
                  <div class="headline">${p.symmetry.label_en}</div>
                  <div class="caption">Injured side vs healthy ·
                    ${p.symmetry.samples} readings</div>
                </div>
                ${progressRing(Math.min(100, p.symmetry.value), "symmetry", "sm")}
              </div>
            </section>`
         : ""
     }

     <section class="panel">
       <span class="label">Accuracy over time</span>
       ${lineChart(accuracyPoints)}
     </section>

     <section class="panel">
       <span class="label">Sessions per day</span>
       ${barChart(sessionPoints)}
     </section>

     ${
       p.top_exercises.length
         ? `<section class="panel">
              <span class="label">Top exercises</span>
              <div class="stack tight">
                ${p.top_exercises
                  .map((e) =>
                    meterRow(
                      e.name_en,
                      `${e.sets} ${e.sets === 1 ? "set" : "sets"}`,
                      e.mean_form_score,
                    ),
                  )
                  .join("")}
              </div>
            </section>`
         : ""
     }

     <h3>Milestones</h3>
     <div class="stack">
       ${p.milestones
         .map(
           (m) => `<div class="rowcard static${m.reached ? "" : " muted"}">
             <span class="rowmark">${m.reached ? TICK_FILLED : DASH}</span>
             <span class="rowbody"><b>${m.label_en}</b><small>${m.detail_en}</small></span>
           </div>`,
         )
         .join("")}
     </div>`,
    { tab: "progress", title: "Progress", back: () => homeScreen() },
  );
}

// -------------------------------------------------------------------- test
function testScreen(): void {
  const gate = state.gate;
  if (!gate) return homeScreen();
  // Both are already loaded by `refresh`; the empty fallbacks only matter on the
  // very first paint, where they simply mean "no pencils yet".
  const cat = state.catalogue ?? { groups: [], metrics: [], exercises: [] };
  const yours = new Set((state.customCriteria ?? []).map((c) => c.key));
  const percent = Math.round(gate.progress * 100);
  const info = PHASE_NAMES[gate.phase_key] ?? {
    n: 1,
    name: titleCase(gate.phase_key),
  };

  const mark = (c: api.CriterionResult) =>
    c.status === "pass" ? TICK_FILLED : c.status === "fail" ? CROSS : DASH;
  const value = (c: api.CriterionResult) => {
    if (c.observed == null) return `<span>not measured</span>`;
    const unit = c.unit && c.unit !== "score" ? ` ${c.unit}` : "";
    const target = c.target == null ? "" : ` <span>/ ${round(c.target)}${unit}</span>`;
    return `<b>${round(c.observed)}${unit}</b>${target}`;
  };

  shell(
    `<section class="panel accent">
       <div class="row-between">
         <div>
           <div class="headline">${info.name} test</div>
           <div class="caption">${gate.required_passed} of ${gate.required_total}
             tests completed</div>
         </div>
         ${progressRing(percent, gate.passed ? "pass" : "not yet", "sm")}
       </div>
     </section>

     <h3>Test battery</h3>
     <ul class="criteria">
       ${gate.criteria
         .map((c) => {
           // Editable when the metric is one the builder understands. Clinician
           // sign-off never is, which is the point of it.
           const editable = c.source !== "manual" && splitMetric(c.metric, cat).base !== null;
           const mine = yours.has(c.key);
           return `<li class="${c.required ? "" : "optional"} ${c.status}${
             mine ? " mine" : ""
           }">
             ${mark(c)}
             <span class="what">${c.label_en}
               ${c.source === "pose" ? `<span class="src">${CAMERA_ICON} camera</span>` : ""}
               ${mine ? `<span class="src yours">yours</span>` : ""}
               <small>${c.detail_en}${c.required ? "" : " · optional"}</small></span>
             <span class="val">${value(c)}</span>
             ${
               editable
                 ? `<button class="editbtn" data-edit="${c.key}"
                      aria-label="Change the target for ${c.label_en}">${PENCIL}</button>`
                 : ""
             }
           </li>`;
         })
         .join("")}
     </ul>

     <button class="addbtn" id="add-test">
       <span class="plus" aria-hidden="true">+</span>
       <span class="rowbody"><b>Add your own test</b>
         <small>Set a target that matters to you — reps, speed, pain, anything
           the app can measure</small></span>
     </button>

     <div class="notice ${gate.passed ? "good" : ""}">${
       gate.passed
         ? "All tests passed. Return under coaching staff guidance."
         : "You must pass all required tests to be cleared for return to play."
     }</div>

     ${
       gate.passed
         ? `<div class="controls"><button class="primary block" id="advance">
              Move to next phase</button></div>`
         : ""
     }`,
    { tab: "test", title: "Exit Criteria", back: () => homeScreen() },
  );

  on("#add-test", () => void pickMetricScreen());
  app.querySelectorAll<HTMLButtonElement>("[data-edit]").forEach((button) => {
    button.onclick = (event) => {
      event.stopPropagation();
      void editCriterionScreen(button.dataset["edit"]!);
    };
  });

  on("#advance", () =>
    void (async () => {
      try {
        await api.advancePhase(state.episode!.id);
        state.protocol = null;
        state.progress = null;
        await refresh();
        homeScreen();
      } catch (error) {
        fail(error);
      }
    })(),
  );
}

// ----------------------------------------------------------------- profile
function profileScreen(): void {
  const user = state.user;
  const position =
    POSITIONS.find((p) => p.key === user?.profile?.position)?.label ?? "Not set";
  const injury = state.episode
    ? (INJURY_SITES.find((i) => i.key === state.episode!.injury_site)?.label ?? "")
    : "No active injury";

  const row = (id: string, label: string, detail = "") =>
    `<button class="rowcard" id="${id}">
       <span class="rowbody"><b>${label}</b>${detail ? `<small>${detail}</small>` : ""}</span>
       ${CHEVRON}
     </button>`;

  shell(
    `<section class="panel profile-head">
       <span class="avatar">${initials(user?.full_name ?? "Player")}</span>
       <div>
         <div class="headline">${user?.full_name ?? "Player"}</div>
         <div class="caption">${user?.email ?? ""}</div>
       </div>
     </section>

     <div class="stack">
       ${row("edit-role", "Playing position", position)}
       ${row("edit-injury", "Injury profile", `${injury}${
         state.episode ? ` · ${state.episode.side} side` : ""
       }`)}
       ${row("integrations", "Connected apps", "Apple Health, Health Connect")}
       ${row("about", "About Pitch Rehab")}
     </div>

     <div class="controls">
       <button class="danger block" id="signout">Log Out</button>
     </div>`,
    { tab: "profile", title: "Profile" },
  );

  on("#edit-role", () => void roleScreen({ mode: "edit" }));
  on("#edit-injury", () => injuryScreen());
  on("#integrations", () => void integrationsScreen());
  on("#about", () => aboutScreen());
  on("#signout", () => {
    api.signOut();
    state.user = null;
    state.episode = null;
    state.protocol = null;
    state.progress = null;
    welcomeScreen();
  });
}

async function integrationsScreen(): Promise<void> {
  shell(`<div class="loading">Checking what we can read…</div>`, {
    title: "Connected apps",
    back: () => profileScreen(),
  });

  let supported: api.SupportedMetrics;
  try {
    supported = await api.supportedMetrics();
  } catch (error) {
    return fail(error);
  }

  const platform = (name: string, count: number, note: string) => `
    <div class="rowcard static">
      <span class="rowbody"><b>${name}</b><small>${note}</small></span>
      <span class="chip on">${count} metrics</span>
    </div>`;

  shell(
    `<p class="sub">Health data arrives through one ingest path that maps a platform's
       own types onto the metrics your exit criteria use.</p>

     <h3>Wired up</h3>
     <div class="stack">
       ${platform(
         "Apple Health",
         Object.keys(supported.apple_health).length,
         "HealthKit sample types",
       )}
       ${platform(
         "Google Health Connect",
         Object.keys(supported.health_connect).length,
         "Health Connect record types",
       )}
     </div>

     <h3>Not connected</h3>
     <div class="stack">
       ${["Garmin Connect", "WHOOP", "Strava"]
         .map(
           (name) => `<div class="rowcard static muted">
             <span class="rowbody"><b>${name}</b>
               <small>Same mapping table, different names — not wired up yet</small></span>
             <span class="chip">Not connected</span>
           </div>`,
         )
         .join("")}
     </div>

     <div class="notice">${supported.note}</div>`,
    { title: "Connected apps", back: () => profileScreen() },
  );
}

function aboutScreen(): void {
  shell(
    `<div class="stack">
       <section class="panel">
         <span class="brand big">${BRAND_MARK}${WORDMARK}</span>
         <p class="sub">Rehab plans built around your position and your injury, with
           MediaPipe pose detection checking every rep.</p>
       </section>
       <div class="notice">
         <b>A training aid, not a medical device.</b> Nothing here diagnoses. The exit
         criteria follow common return-to-sport practice, but a physio should review
         every threshold before this is used with a real player. Phase 4 always
         requires a human sign-off, deliberately.
       </div>
       <section class="panel">
         <span class="label">Under the hood</span>
         <ul class="facts">
           <li><b>6 positions × 7 injury sites</b> = 42 programmes, 4 phases each</li>
           <li><b>33 landmarks</b> per frame, scored in the browser and again on the server</li>
           <li><b>Every angle recomputed</b> server-side — the phone is never trusted</li>
         </ul>
       </section>
     </div>`,
    { title: "About", back: () => profileScreen() },
  );
}

function notificationsScreen(): void {
  const items: { label: string; detail: string; kind: string }[] = [];
  const gate = state.gate;
  const progress = state.progress;

  if (state.phase) {
    items.push({
      label: "Today's session is ready",
      detail: `${state.phase.prescriptions.length} exercises · ${state.phase.title_en}`,
      kind: "on",
    });
  }
  if (gate?.passed) {
    items.push({
      label: "You can move to the next phase",
      detail: "All required tests passed — open the Test tab to advance",
      kind: "good",
    });
  } else if (gate && gate.required_total) {
    items.push({
      label: `${gate.required_total - gate.required_passed} tests still to pass`,
      detail: "Open the Test tab to see what is blocking you",
      kind: "",
    });
  }
  if (progress && progress.week_of > progress.weeks_total) {
    items.push({
      label: "Past the programme's minimum length",
      detail: `Week ${progress.week_of} of a ${progress.weeks_total}-week minimum`,
      kind: "warn",
    });
  }

  shell(
    `<p class="sub">Generated from your plan and your testing — nothing here is a push
       notification, so nothing can arrive at the wrong moment.</p>
     <div class="stack">
       ${
         items.length
           ? items
               .map(
                 (item) => `<div class="rowcard static">
                   <span class="rowbody"><b>${item.label}</b>
                     <small>${item.detail}</small></span>
                   ${item.kind ? `<span class="chip ${item.kind}"></span>` : ""}
                 </div>`,
               )
               .join("")
           : `<div class="notice">Nothing needs your attention.</div>`
       }
     </div>`,
    { title: "Notifications", back: () => homeScreen() },
  );
}

// -------------------------------------------------- write your own criterion
/** Cached because the catalogue never changes inside a session. */
async function catalogue(): Promise<api.AuthorableCatalogue> {
  state.catalogue ??= await api.authorableCatalogue();
  return state.catalogue;
}

/** Step one: what do you want to measure? */
async function pickMetricScreen(): Promise<void> {
  shell(`<div class="loading">Loading what you can measure…</div>`, {
    title: "Add a test",
    back: () => testScreen(),
  });
  let cat: api.AuthorableCatalogue;
  try {
    cat = await catalogue();
  } catch (error) {
    return fail(error);
  }

  shell(
    `<p class="sub">Pick what to measure. You set the number on the next screen,
       and it joins your testing for this phase like any other.</p>
     ${metricPickerHtml(cat)}`,
    { title: "Add a test", back: () => testScreen() },
  );

  app.querySelectorAll<HTMLButtonElement>("[data-metric]").forEach((row) => {
    row.onclick = () => {
      const item = cat.metrics.find((m) => m.key === row.dataset["metric"]);
      if (item) void buildCriterionScreen({ item });
    };
  });
}

interface BuilderState {
  item: api.Authorable;
  exerciseKey?: string | null;
  targetType?: string;
  value?: number;
  required?: boolean;
  /** Set when tightening a library criterion rather than adding a new one. */
  overrideKey?: string | null;
  /** Set when editing something already saved, so Remove can be offered. */
  existingKey?: string | null;
}

/** Step two: the number. */
async function buildCriterionScreen(initial: BuilderState): Promise<void> {
  const cat = await catalogue();
  const item = initial.item;
  const phaseKey = state.episode?.current_phase ?? "p1_protect";

  let exerciseKey =
    initial.exerciseKey ?? (item.needs_exercise ? (cat.exercises[0]?.key ?? null) : null);
  let targetType = initial.targetType ?? item.target_types[0] ?? ABSOLUTE;
  let value = initial.value ?? item.default_target;
  let required = initial.required ?? true;

  const exerciseName = (): string | null =>
    item.needs_exercise
      ? (cat.exercises.find((e) => e.key === exerciseKey)?.name_en ?? null)
      : null;

  const render = (): void => {
    const back = () =>
      initial.existingKey || initial.overrideKey ? testScreen() : void pickMetricScreen();

    shell(
      `<section class="panel accent">
         <span class="label">Your test will read</span>
         <div class="headline" id="preview">${preview(
           item,
           targetType,
           value,
           exerciseName(),
         )}</div>
         <div class="caption">${windowText(item, null)}</div>
       </section>

       ${item.needs_exercise ? `<section class="panel">${exercisePickerHtml(cat, exerciseKey)}</section>` : ""}

       ${
         item.target_types.length > 1
           ? `<h3>Compare against</h3>
              <div class="segmented" role="group" aria-label="What to compare against">
                ${item.target_types
                  .map(
                    (t) => `<button class="seg${t === targetType ? " on" : ""}"
                      data-target-type="${t}">${TARGET_TYPE_LABELS[t] ?? t}</button>`,
                  )
                  .join("")}
              </div>`
           : ""
       }

       <h3>The number</h3>
       <section class="panel">
         <div class="numberrow">
           <button class="stepbtn" id="minus" aria-label="Less">−</button>
           <div class="numberbox">
             <input id="value" type="number" inputmode="decimal"
               step="${item.step}" min="0" value="${value}" />
             <span class="unit">${unitFor(item, targetType)}</span>
           </div>
           <button class="stepbtn" id="plus" aria-label="More">+</button>
         </div>
         <p class="sub tiny">${item.help_en}</p>
         <div class="rowcard static">
           <span class="rowbody"><b>Must pass to advance</b>
             <small>Turn off to track it without it blocking the phase</small></span>
           <button class="switch${required ? " on" : ""}" id="required"
             role="switch" aria-checked="${required}" aria-label="Must pass to advance">
             <span></span></button>
         </div>
       </section>

       <div class="controls stackable">
         <button class="primary block" id="save">
           ${initial.existingKey ? "Save changes" : "Add this test"}</button>
         ${
           initial.existingKey
             ? `<button class="danger block" id="remove">${
                 initial.overrideKey ? "Restore the standard target" : "Remove this test"
               }</button>`
             : ""
         }
       </div>
       <p class="sub center" id="saved"></p>`,
      {
        title: initial.existingKey ? "Edit test" : "Set the target",
        back,
      },
    );

    const input = app.querySelector<HTMLInputElement>("#value")!;
    const previewEl = app.querySelector<HTMLDivElement>("#preview")!;
    const repaint = (): void => {
      previewEl.textContent = preview(item, targetType, value, exerciseName());
    };
    const setValue = (next: number): void => {
      value = Math.max(0, Number(next.toFixed(3)));
      input.value = String(value);
      repaint();
    };

    input.oninput = () => {
      value = Number(input.value);
      repaint();
    };
    on("#minus", () => setValue(value - item.step));
    on("#plus", () => setValue(value + item.step));

    const select = app.querySelector<HTMLSelectElement>("#ex");
    if (select) {
      select.onchange = () => {
        exerciseKey = select.value;
        repaint();
      };
    }

    app.querySelectorAll<HTMLButtonElement>("[data-target-type]").forEach((button) => {
      button.onclick = () => {
        targetType = button.dataset["targetType"]!;
        // The unit changes with the comparison, so the whole panel is redrawn.
        render();
      };
    });

    on("#required", () => {
      required = !required;
      const toggle = app.querySelector<HTMLButtonElement>("#required")!;
      toggle.classList.toggle("on", required);
      toggle.setAttribute("aria-checked", String(required));
    });

    on("#save", () => {
      const note = app.querySelector<HTMLElement>("#saved")!;
      const button = app.querySelector<HTMLButtonElement>("#save")!;
      button.disabled = true;
      note.textContent = "Saving…";
      void (async () => {
        try {
          await api.saveCriterion(
            state.episode!.id,
            toDraft({
              item,
              exerciseKey,
              targetType,
              value,
              required,
              phaseKey,
              overrideKey: initial.overrideKey ?? initial.existingKey ?? null,
            }),
          );
          state.customCriteria = null;
          await refresh();
          testScreen();
        } catch (error) {
          button.disabled = false;
          note.textContent =
            error instanceof api.ApiError ? String(error.detail) : String(error);
        }
      })();
    });

    on("#remove", () => {
      void (async () => {
        try {
          await api.deleteCriterion(state.episode!.id, initial.existingKey!, phaseKey);
          state.customCriteria = null;
          await refresh();
          testScreen();
        } catch (error) {
          fail(error);
        }
      })();
    });
  };

  render();
}

/** Reopen a criterion in the builder — one the player wrote, or a standard one. */
async function editCriterionScreen(key: string): Promise<void> {
  const cat = await catalogue();
  const mine = (state.customCriteria ?? []).find((c) => c.key === key);

  if (mine) {
    const parsed = draftFrom(mine, cat);
    if (!parsed) return testScreen();
    return buildCriterionScreen({
      ...parsed,
      required: mine.required,
      existingKey: key,
      overrideKey: isOverride(key) ? key : null,
    });
  }

  // A standard criterion: open the builder pointed at the same metric, so
  // saving writes an override rather than a second rule beside it.
  const row = state.gate?.criteria.find((c) => c.key === key);
  if (!row) return testScreen();
  const { base, exerciseKey } = splitMetric(row.metric, cat);
  if (!base) return testScreen();
  return buildCriterionScreen({
    item: base,
    exerciseKey,
    targetType: base.target_types.includes(row.target_type) ? row.target_type : ABSOLUTE,
    value: row.target ?? base.default_target,
    required: row.required,
    overrideKey: key,
    existingKey: null,
  });
}

/**
 * Is this saved criterion replacing a standard one, or a test of the player's own?
 *
 * The builder always generates keys prefixed `custom_`, so anything else the
 * player has saved took its key from the library and is therefore an override.
 * Used only to word the Remove button -- taking away an override restores the
 * standard target, while taking away an invented test removes it outright.
 */
function isOverride(key: string): boolean {
  return !key.startsWith("custom_");
}

const round = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

// -------------------------------------------------------------------- boot
async function refresh(): Promise<void> {
  if (!state.episode) return;
  const [phase, gate, sessions, progress, custom, cat] = await Promise.all([
    api.todayPlan(state.episode.id),
    api.exitCriteria(state.episode.id),
    api.listSessions(state.episode.id),
    api.progress(state.episode.id),
    api.listCustomCriteria(state.episode.id),
    state.catalogue ? Promise.resolve(state.catalogue) : api.authorableCatalogue(),
  ]);
  state.phase = phase;
  state.gate = gate;
  state.sessions = sessions;
  state.progress = progress;
  state.customCriteria = custom;
  state.catalogue = cat;
}

async function boot(): Promise<void> {
  shell(`<div class="loading">Loading…</div>`, { brand: true });
  state.online = await api.backendUp();
  if (!state.online) {
    shell(
      `<div class="stack">
         <div class="notice">The API is not running. Start it with
           <code>start.bat</code>, or <code>uvicorn app.main:app --reload</code>,
           then reload this page.</div>
       </div>`,
      { title: "Backend not running" },
    );
    return;
  }
  if (!api.isSignedIn()) return welcomeScreen();

  try {
    state.user = await api.me();
    // A player with no position cannot be given a programme -- the sprint gates
    // come from it. Ask before anything else.
    if (state.user.role === "player" && !state.user.profile?.position) {
      return void roleScreen({ mode: "edit" });
    }
    const episodes = await api.listEpisodes();
    state.episode = episodes[0] ?? null;
    state.protocol = null;
    state.progress = null;
    if (!state.episode) return injuryScreen();
    await refresh();
    homeScreen();
  } catch (error) {
    if (error instanceof api.ApiError && error.status === 401) {
      api.signOut();
      return welcomeScreen();
    }
    fail(error);
  }
}

void boot();
