/** Client for the Pitch Rehab backend. Same-origin via the Vite proxy. */
import * as standalone from "./standalone";
import type { Exercise, ExerciseRule } from "./pose/rules";

const BASE = "/api/v1";
const TOKEN_KEY = "rf_token";
const SERVER_KEY = "rf_server";
const SEEN_KEY = "rf_seen_server";

/**
 * Is this the installed Android app rather than a browser tab?
 *
 * It changes where the API lives. In a browser the front end is served by Vite,
 * which proxies `/api` to the backend, so a relative path is right and nothing
 * needs configuring. Inside the app the front end is served from the package
 * itself, so a relative path points at the phone -- which has no backend on it.
 * There, requests have to be addressed to the laptop by name.
 */
export const isNative = (): boolean =>
  typeof window !== "undefined" &&
  Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
    ?.isNativePlatform?.());

/**
 * Where the backend is, as an origin to put in front of every path.
 *
 * Empty string in a browser, which leaves every URL relative. In the app it is
 * the laptop: baked in when the package was built, and overridable afterwards
 * because the laptop's address is a DHCP lease and moves on its own. Rebuilding
 * an APK to chase an address change would be absurd.
 */
export function serverOrigin(): string {
  if (!isNative()) return "";
  const saved = localStorage.getItem(SERVER_KEY);
  if (saved) return saved;
  return (import.meta.env["VITE_API_ORIGIN"] as string | undefined) ?? "";
}

/** Point the app at a different laptop. Empty clears it back to the built-in one. */
export function setServerOrigin(origin: string): void {
  const trimmed = origin.trim().replace(/\/+$/, "");
  if (trimmed) localStorage.setItem(SERVER_KEY, trimmed);
  else localStorage.removeItem(SERVER_KEY);
}

/** The address built into this package, whether or not it is the one in use. */
export const builtInOrigin = (): string =>
  (import.meta.env["VITE_API_ORIGIN"] as string | undefined) ?? "";

// --------------------------------------------------- running with no server
/**
 * Switch the app to the snapshot in the package, or back to the real backend.
 *
 * The token is set here rather than in standalone.ts so that one module owns
 * signing in. There is nobody to authenticate against, so it is a placeholder --
 * it exists only to make `isSignedIn()` true and skip a sign-in screen that
 * could not do anything.
 */
export function useStandalone(on: boolean): void {
  standalone.setActive(on);
  if (on) {
    token = "standalone";
    localStorage.setItem(TOKEN_KEY, token);
  } else if (token === "standalone") {
    signOut();
  }
}

export const standaloneActive = (): boolean => standalone.active();
export const standaloneAvailable = (): boolean => standalone.available();
/** Sets and pain logs sitting on the phone, waiting for a laptop to count them. */
export const standalonePending = (): number => standalone.pending();
export const standaloneReset = (): void => standalone.reset();

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: unknown,
  ) {
    super(typeof detail === "string" ? detail : `request failed (${status})`);
  }
}

let token: string | null = localStorage.getItem(TOKEN_KEY);

export const isSignedIn = (): boolean => token !== null;

export function signOut(): void {
  token = null;
  localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  // Standalone short-circuits before any network call. Same paths, same shapes,
  // answered from the snapshot in the package -- see standalone.ts.
  if (standalone.active()) {
    // Loads the protocol library the first time it is needed, and returns
    // immediately every time after. Awaiting here keeps `handle` synchronous,
    // which is what lets it stay a plain lookup rather than a state machine.
    await standalone.ready();
    const reply = standalone.handle(path, init);
    if (!reply.ok) throw new ApiError(reply.status, reply.detail);
    return reply.body as T;
  }

  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${serverOrigin()}${BASE}${path}`, { ...init, headers });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new ApiError(response.status, body?.detail ?? body);
  return body as T;
}

const post = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body) });

// ---------------------------------------------------------------- types
export interface Profile {
  id: number;
  position: string;
  dominant_foot: string;
}

export interface User {
  id: number;
  email: string;
  full_name: string;
  role: string;
  profile: Profile | null;
}

export interface Episode {
  id: number;
  injury_site: string;
  side: string;
  severity: string;
  injured_on: string;
  status: string;
  current_phase: string;
  protocol_id: number | null;
}

export interface Prescription {
  id: number;
  order_index: number;
  sets: number;
  reps: number | null;
  hold_seconds: number | null;
  rest_seconds: number | null;
  tempo: string | null;
  side_mode: string;
  exercise: Exercise;
}

export interface Phase {
  id: number;
  phase_key: string;
  order_index: number;
  title_en: string;
  goal_en: string | null;
  min_days: number;
  sessions_per_week: number;
  prescriptions: Prescription[];
  exit_criteria: { key: string; label_en: string; required: boolean }[];
}

export interface CriterionResult {
  key: string;
  label_en: string;
  metric: string;
  source: string;
  required: boolean;
  status: "pass" | "fail" | "no_data" | "pending_signoff";
  target_type: string;
  observed: number | null;
  target: number | null;
  unit: string | null;
  progress: number;
  detail_en: string;
  baseline_origin: string | null;
}

export interface Gate {
  episode_id: number;
  phase_key: string;
  passed: boolean;
  progress: number;
  required_total: number;
  required_passed: number;
  next_phase: string | null;
  criteria: CriterionResult[];
  blocking: string[];
}

export interface SetUpload {
  exercise_key: string;
  side: string;
  frames: { t: number; landmarks: unknown[] }[];
  image_width: number;
  image_height: number;
  prescribed_reps?: number | null;
}

export interface SetResult {
  set_id: number;
  completed_reps: number;
  valid_reps: number;
  form_score: number;
  warnings: string[];
  emitted: { key: string; value: number; unit: string; side: string | null }[];
}

// ---------------------------------------------------------------- calls
export async function backendUp(): Promise<boolean> {
  // Nothing to reach, and nothing missing either.
  if (standalone.active()) return true;
  try {
    // Through serverOrigin(), not a bare path. In a browser they are the same
    // thing; in the installed app a bare path asks the phone about itself, and
    // the phone answers with the app's own index.html -- a 200, which reads as
    // "the backend is fine" right up until the first real request fails.
    //
    // The deadline matters as much. An unreachable address on wifi does not
    // refuse the connection, it hangs, so without one the app sits on "Loading"
    // for the best part of a minute before admitting anything is wrong.
    const response = await fetch(`${serverOrigin()}/healthz`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return false;

    // A 200 is not enough. Most static hosts answer an unknown path with
    // index.html rather than a 404, so a build served from one gets a cheerful
    // 200 of HTML here and concludes the backend is fine -- then fails on every
    // call afterwards, with nothing pointing at the cause. Only the API says
    // this, so only the API gets believed.
    const body = (await response.json().catch(() => null)) as { status?: string } | null;
    if (body?.status !== "ok") return false;

    // Remember that a server was once reachable. It changes what a failure
    // means: for someone who has connected before this is a fault to fix, and
    // for someone who was handed the app it is simply how things are.
    localStorage.setItem(SEEN_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

/** Has this install ever reached a backend? */
export const hasEverConnected = (): boolean => localStorage.getItem(SEEN_KEY) === "1";

export async function login(email: string, password: string): Promise<void> {
  const body = await post<{ access_token: string }>("/auth/login", { email, password });
  token = body.access_token;
  localStorage.setItem(TOKEN_KEY, token);
}

export async function register(input: {
  email: string;
  password: string;
  full_name: string;
  position: string;
}): Promise<void> {
  await post("/auth/register", input);
  await login(input.email, input.password);
}

/** One drill or test that a position adds on top of the shared injury plan. */
export interface PositionExtra {
  key: string;
  label_en: string;
  phase_key: string;
  phase_order: number;
}

/** What choosing a role changes. Comes from the same profiles the server uses
 *  to compose the programme, so the picker cannot promise the wrong thing. */
export interface PositionInfo {
  key: string;
  label_en: string;
  label_th: string;
  blurb_en: string;
  extra_exercises: PositionExtra[];
  extra_criteria: PositionExtra[];
}

export const me = () => request<User>("/auth/me");
export const listPositions = () => request<PositionInfo[]>("/catalog/positions");
export const updateProfile = (body: { position?: string; dominant_foot?: string }) =>
  request<Profile>("/players/me/profile", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
export const listExercises = () => request<Exercise[]>("/catalog/exercises");
export const listEpisodes = () => request<Episode[]>("/injuries?status_filter=active");
export const todayPlan = (episodeId: number) => request<Phase>(`/injuries/${episodeId}/today`);
export const exitCriteria = (episodeId: number) =>
  request<Gate>(`/injuries/${episodeId}/exit-criteria`);
export interface SessionRow {
  id: number;
  status: string;
  started_at: string;
  pain_during: number | null;
  pain_after: number | null;
}

export const listSessions = (episodeId: number) =>
  request<SessionRow[]>(`/injuries/${episodeId}/sessions?limit=200`);

export const startSession = (episodeId: number) =>
  post<{ id: number }>(`/injuries/${episodeId}/sessions`, {
    device: "web",
    app_version: "0.1.0",
  });
export const uploadSet = (sessionId: number, payload: SetUpload) =>
  post<SetResult>(`/sessions/${sessionId}/sets`, payload);
export const completeSession = (sessionId: number, body: Record<string, unknown>) =>
  post(`/sessions/${sessionId}/complete`, body);

export const createEpisode = (input: {
  injury_site: string;
  side: string;
  injured_on: string;
  severity?: string;
  phase_started_at?: string;
}) => post<Episode>("/injuries", input);

export const logPain = (episodeId: number, body: Record<string, unknown>) =>
  post(`/injuries/${episodeId}/pain-logs`, body);

/**
 * Put the player in the phase they say they are already in.
 *
 * The server backdates the injury by the minimum length of the phases behind
 * them, so the week counter and the phase agree, and records entering the phase
 * without recording a pass for the ones skipped. Nothing measured is touched.
 */
export const setStartingPhase = (
  episodeId: number,
  phaseKey: string,
  { backdate = true }: { backdate?: boolean } = {},
) =>
  request<Episode>(`/injuries/${episodeId}/starting-phase`, {
    method: "PUT",
    // `backdate` separates the two reasons for changing phase. Saying where you
    // already are, at the start, moves the injury date so the week counter
    // agrees. Moving between phases later must not: the injury happened when it
    // happened.
    body: JSON.stringify({ phase_key: phaseKey, backdate }),
  });

export const advancePhase = (episodeId: number) =>
  post<{ advanced: boolean; gate: Gate }>(`/injuries/${episodeId}/advance`, {});

/** Rules come from the server so the live scoring and the marking cannot diverge. */
export function ruleFor(exercise: Exercise): ExerciseRule | null {
  return exercise.pose_rule;
}

// --------------------------------------------------------------- progress
export interface TrendPoint {
  day: string;
  sessions: number;
  exercises: number;
  mean_form_score: number | null;
}

export interface TopExercise {
  key: string;
  name_en: string;
  sets: number;
  mean_form_score: number;
}

export interface Milestone {
  label_en: string;
  detail_en: string;
  reached: boolean;
}

export interface Symmetry {
  value: number;
  metric: string;
  label_en: string;
  samples: number;
}

/** Derived on read from completed sessions and the live gate — never stored. */
export interface Progress {
  overall_pct: number;
  phase_key: string;
  phase_order: number;
  phase_pct: number;
  criteria_passed: number;
  criteria_total: number;
  week_of: number;
  weeks_total: number;
  sessions_completed: number;
  exercises_completed: number;
  /** null, not 0, when nothing has been scored yet. */
  mean_form_score: number | null;
  symmetry: Symmetry | null;
  trend: TrendPoint[];
  top_exercises: TopExercise[];
  milestones: Milestone[];
}

export const progress = (episodeId: number) =>
  request<Progress>(`/injuries/${episodeId}/progress`);

/** The whole programme: four phases, each with its drills and its gate. */
export interface Protocol {
  id: number;
  key: string;
  position: string;
  injury_site: string;
  title_en: string;
  summary_en: string | null;
  phases: Phase[];
}

export const protocolFor = (episodeId: number) =>
  request<Protocol>(`/injuries/${episodeId}/protocol`);

// ------------------------------------------------- criteria you write yourself
/** One thing a test can be built from, with the defaults that suit its metric. */
export interface Authorable {
  key: string;
  source: string;
  group: string;
  label_en: string;
  unit: string;
  help_en: string;
  /** A sentence with "…" where the number goes. */
  phrase_en: string;
  default_target: number;
  /** Fixed by the metric, not chosen — "pain of at least 8/10" is not a goal. */
  comparator: string;
  /** How several readings become one. Needed to rebuild a spec offline. */
  default_aggregate: string;
  /** Which limb counts. Needed for the same reason. */
  scope: string;
  lower_is_better: boolean;
  default_window_days: number | null;
  target_types: string[];
  step: number;
  needs_exercise: boolean;
}

export interface AuthorableExercise {
  key: string;
  name_en: string;
  category: string;
  /**
   * "reps" or "seconds". Six of the camera-scored movements are holds -- planks,
   * a wall sit, a single-leg balance -- and twenty reps of a side plank is not a
   * thing. Comes from the pose rule the camera scores it with, so the two cannot
   * disagree about whether the movement is counted or timed.
   */
  measure: "reps" | "seconds";
  /** What the programme itself asks for, as a starting number. */
  suggested_target: number | null;
}

export interface AuthorableCatalogue {
  groups: string[];
  metrics: Authorable[];
  exercises: AuthorableExercise[];
}

export interface CriterionSpecJson {
  metric: string;
  source: string;
  aggregate: string;
  window_days: number | null;
  comparator: string;
  scope: string;
  target: { type: string; value: number; unit: string | null };
}

/** A test this player added to their own rehab. */
export interface CustomCriterion {
  id: number;
  phase_key: string;
  key: string;
  label_en: string;
  help_en: string | null;
  required: boolean;
  spec: CriterionSpecJson;
}

export interface CriterionDraft {
  metric: string;
  exercise_key?: string | null;
  target_type?: string;
  value: number;
  window_days?: number | null;
  required?: boolean;
  phase_key?: string;
  /** Set to a library criterion's key to tighten that one instead of adding to it. */
  key?: string;
}

export const authorableCatalogue = () =>
  request<AuthorableCatalogue>("/injuries/criteria/authorable");

export const listCustomCriteria = (episodeId: number) =>
  request<CustomCriterion[]>(`/injuries/${episodeId}/criteria`);

export const saveCriterion = (episodeId: number, draft: CriterionDraft) =>
  request<CustomCriterion>(`/injuries/${episodeId}/criteria`, {
    method: "PUT",
    body: JSON.stringify(draft),
  });

export const deleteCriterion = (episodeId: number, key: string, phaseKey: string) =>
  request<null>(
    `/injuries/${episodeId}/criteria/${encodeURIComponent(key)}?phase_key=${phaseKey}`,
    { method: "DELETE" },
  );
