/** Client for the Pitch Rehab backend. Same-origin via the Vite proxy. */
import type { Exercise, ExerciseRule } from "./pose/rules";

const BASE = "/api/v1";
const TOKEN_KEY = "rf_token";

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
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${BASE}${path}`, { ...init, headers });
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
  try {
    return (await fetch("/healthz")).ok;
  } catch {
    return false;
  }
}

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
  speed_p3: number;
  speed_p4: number;
  hsr_p4: number;
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

/** What the health-sync path can actually take in, per platform. */
export interface SupportedMetrics {
  apple_health: Record<string, string>;
  health_connect: Record<string, string>;
  canonical_units: Record<string, string>;
  derived: string[];
  note: string;
}

export const supportedMetrics = () =>
  request<SupportedMetrics>("/health/supported-metrics");

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
