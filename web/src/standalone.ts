/**
 * Run the whole app with no backend anywhere.
 *
 * Every other fallback in this project assumes there is a laptop to reach: a QR
 * code to shorten the address, a certificate that heals itself, a firewall rule,
 * a hotspot to dodge a hostile network. None of it helps on a machine that will
 * not let you install Python or run a server in the first place, which is the
 * situation in a school computer room. There, the only thing that still exists
 * is the phone with the app already on it.
 *
 * So the app carries the backend's answers with it. `scripts/make_snapshot.py`
 * calls every screen's endpoint against the real API and records the replies
 * into `demo/snapshot.json`; this module replays them.
 *
 * ## What is real
 *
 * More than you would expect. The protocols, the exercise rules, the exit
 * criteria and the progress figures in the snapshot are genuine output from the
 * real criteria engine, not written by hand -- regenerate the file and they
 * change with the code.
 *
 * And **the camera is entirely real**, because it never needed the server. Pose
 * detection, rep counting, angle checks and the coaching word on screen all run
 * in `pose/live.ts` on the phone against rules that came down from the backend
 * and now live in the snapshot. The upload afterwards is persistence, not
 * scoring -- the screen never reads its reply. So the part of this project worth
 * demonstrating works exactly as it always did, with nothing switched on.
 *
 * ## What is not, and is not pretended to be
 *
 * Recomputation. A set logged here is stored on the phone and reported as not
 * yet counted, because the thing that would judge it is a thousand lines of
 * Python in `app/services/criteria/`. Reimplementing that here would mean two
 * copies of the rules that decide whether someone is fit to play football
 * drifting apart, and a demo that quietly disagrees with the real system.
 *
 * For the same reason the progress screen stays exactly as snapshotted rather
 * than half-updating. Some of those numbers are simple counts this file could
 * honestly redo, but a screen mixing fresh arithmetic with frozen judgement is
 * harder to trust than one that is plainly a fixed picture. The app says which
 * it is showing.
 */
import snapshot from "./demo/snapshot.json";

const MODE_KEY = "rf_standalone";
const LOCAL_KEY = "rf_standalone_local";

type Body = Record<string, unknown>;
type Responses = Record<string, unknown>;

const RESPONSES = (snapshot as { responses: Responses }).responses;

/** What the app produced on this phone since the last time it saw a laptop. */
interface LocalSet {
  exercise_key: string;
  side: string;
  /** Frames are deliberately not kept: one set is megabytes of landmarks. */
  frames: number;
  prescribed_reps: number | null;
  at: string;
}

interface LocalSession {
  id: number;
  status: string;
  started_at: string;
  pain_during: number | null;
  pain_after: number | null;
  sets: LocalSet[];
}

interface LocalState {
  sessions: LocalSession[];
  painLogs: Body[];
  criteria: Body[];
  profile: Body | null;
  /** The phase the player said they were in, if they have said. */
  phase: string | null;
  nextId: number;
}

const EMPTY: LocalState = {
  sessions: [],
  painLogs: [],
  criteria: [],
  profile: null,
  phase: null,
  // Well above any id the snapshot contains, so a local session can never be
  // mistaken for a recorded one when the two lists are shown together.
  nextId: 900_001,
};

function load(): LocalState {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as LocalState) } : { ...EMPTY };
  } catch {
    return { ...EMPTY };
  }
}

function save(state: LocalState): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
  } catch {
    // A full quota is not worth losing the demo over. The session stays in
    // memory for as long as the app is open, which is the length of a demo.
  }
}

let local = load();

/** Is there a snapshot to run from at all? */
export const available = (): boolean => Object.keys(RESPONSES).length > 0;

export const active = (): boolean =>
  available() && localStorage.getItem(MODE_KEY) === "1";

export function setActive(on: boolean): void {
  if (on) localStorage.setItem(MODE_KEY, "1");
  else localStorage.removeItem(MODE_KEY);
}

/** How much work is sitting on the phone waiting for a laptop to count it. */
export function pending(): number {
  return local.sessions.length + local.painLogs.length;
}

/** Throw away everything logged on the phone. The snapshot itself is untouched. */
export function reset(): void {
  local = { ...EMPTY };
  localStorage.removeItem(LOCAL_KEY);
}

/** The episode the snapshot is about. */
function episodeId(): number {
  const recorded = RESPONSES["/injuries?status_filter=active"] as { id: number }[] | undefined;
  return recorded?.[0]?.id ?? 0;
}

/** The programme, which the snapshot carries in full -- all four phases. */
function protocol(id: number): { phases: Body[] } | undefined {
  return RESPONSES[`/injuries/${id}/protocol`] as { phases: Body[] } | undefined;
}

function phaseOf(id: number, key: string): Body | undefined {
  return protocol(id)?.phases.find((p) => p["phase_key"] === key);
}

/** Phase keys in programme order, taken from the protocol rather than assumed. */
function phaseOrder(id: number): string[] {
  return [...(protocol(id)?.phases ?? [])]
    .sort((a, b) => Number(a["order_index"]) - Number(b["order_index"]))
    .map((p) => String(p["phase_key"]));
}

/**
 * The gate for a phase nothing has been measured against.
 *
 * Not an evaluation -- the opposite of one. Every criterion is reported as
 * never measured, which is exactly true: the player has just told the app they
 * are in this phase, and the app has watched them do nothing in it. The labels
 * and targets are the phase's own definitions, read straight from the protocol.
 *
 * This is the honest answer to "what does the gate look like over there", and
 * it is nothing like reimplementing the engine: no reading is judged, because
 * there are no readings.
 */
function unmeasuredGate(id: number, phaseKey: string): Body | null {
  const phase = phaseOf(id, phaseKey);
  if (!phase) return null;

  const criteria = (phase["exit_criteria"] as Body[]).map((definition) => {
    const spec = (definition["spec"] ?? {}) as Body;
    const target = (spec["target"] ?? {}) as Body;
    return {
      key: definition["key"],
      label_en: definition["label_en"],
      label_th: definition["label_th"],
      metric: spec["metric"] ?? "",
      source: spec["source"] ?? "session",
      required: definition["required"],
      status: "no_data",
      comparator: spec["comparator"] ?? "gte",
      target_type: target["type"] ?? "absolute",
      observed: null,
      // A target relative to a baseline needs the baseline, which is a
      // measurement. Absolute targets stand on their own; the rest say nothing
      // rather than guessing a number.
      target: target["type"] === "absolute" ? (target["value"] ?? null) : null,
      unit: target["unit"] ?? null,
      progress: 0,
      samples: 0,
      baseline: null,
      baseline_origin: null,
      detail_en: "Not measured yet",
      detail_th: "Not measured yet",
    } as Body;
  });

  // The clock the real engine appends. Entering the phase is what starts it.
  criteria.push({
    key: "min_days_in_phase",
    label_en: `At least ${phase["min_days"]} days in this phase`,
    label_th: `At least ${phase["min_days"]} days in this phase`,
    metric: "session.days_in_phase",
    source: "session",
    required: true,
    status: "fail",
    comparator: "gte",
    target_type: "absolute",
    observed: 0,
    target: phase["min_days"],
    unit: "days",
    progress: 0,
    samples: 0,
    baseline: null,
    baseline_origin: null,
    detail_en: "Tissue heals on its own schedule. This is a floor, not a target.",
    detail_th: "Tissue heals on its own schedule. This is a floor, not a target.",
  });

  const required = criteria.filter((c) => c["required"]);
  const order = phaseOrder(id);
  const next = order[order.indexOf(phaseKey) + 1] ?? null;
  return {
    episode_id: id,
    phase_key: phaseKey,
    passed: false,
    progress: 0,
    required_total: required.length,
    required_passed: 0,
    next_phase: next,
    criteria,
    blocking: required.map((c) => c["key"]),
    evaluated_at: new Date().toISOString(),
  };
}

type Reply =
  | { ok: true; body: unknown }
  | { ok: false; status: number; detail: string };

const ok = (body: unknown): Reply => ({ ok: true, body });
const no = (status: number, detail: string): Reply => ({ ok: false, status, detail });

/** Everything the phone cannot decide on its own, refused in the same words. */
const NEEDS_LAPTOP =
  "This needs the laptop. The app is running from a snapshot on the phone, " +
  "so nothing new can be worked out until it can reach the server again.";

/**
 * Answer one request from the snapshot and whatever has happened since.
 *
 * Paths are matched exactly as `api.ts` builds them, which is why the snapshot
 * is keyed by path rather than by some scheme of its own: the two cannot drift
 * without the lookup failing loudly.
 */
export function handle(path: string, init: RequestInit = {}): Reply {
  const method = (init.method ?? "GET").toUpperCase();
  const body: Body = typeof init.body === "string" ? JSON.parse(init.body) : {};
  const id = episodeId();

  if (method === "GET") return get(path, id);
  if (method === "PATCH" && path === "/players/me/profile") {
    local.profile = { ...(local.profile ?? {}), ...body };
    save(local);
    return ok(local.profile);
  }
  if (method === "PUT" && path === `/injuries/${id}/starting-phase`) {
    const key = String(body["phase_key"] ?? "");
    if (!phaseOf(id, key)) return no(422, "this programme has no such phase");
    local.phase = key;
    save(local);
    return ok({ ...(episodes()[0] ?? {}), current_phase: key });
  }
  if (method === "PUT" && path === `/injuries/${id}/criteria`) return putCriterion(body);
  if (method === "DELETE" && path.startsWith(`/injuries/${id}/criteria/`)) {
    const key = decodeURIComponent(path.split("/criteria/")[1]?.split("?")[0] ?? "");
    local.criteria = local.criteria.filter((c) => c["key"] !== key);
    save(local);
    return ok(null);
  }
  if (method === "POST") return post(path, body, id);
  return no(404, `${method} ${path} is not part of the offline snapshot.`);
}

/** The episode list, with the phase the player chose applied over it. */
function episodes(): Body[] {
  const recorded = (RESPONSES["/injuries?status_filter=active"] as Body[] | undefined) ?? [];
  if (!local.phase) return recorded;
  return recorded.map((e) => ({ ...e, current_phase: local.phase }));
}

function get(path: string, id: number): Reply {
  if (path === "/injuries?status_filter=active") return ok(episodes());

  // Today's plan for the phase they said they are in. The protocol carries
  // every phase and in exactly the shape this endpoint returns, so this is the
  // same data by another route rather than anything reconstructed.
  if (local.phase && path === `/injuries/${id}/today`) {
    const phase = phaseOf(id, local.phase);
    if (phase) return ok(phase);
  }

  if (local.phase && path === `/injuries/${id}/exit-criteria`) {
    const gate = unmeasuredGate(id, local.phase);
    if (gate) {
      return ok({
        ...gate,
        criteria: [...(gate["criteria"] as Body[]), ...local.criteria],
      });
    }
  }

  if (local.phase && path === `/injuries/${id}/progress`) {
    const recorded = RESPONSES[path] as Body | undefined;
    const gate = unmeasuredGate(id, local.phase);
    if (recorded && gate) {
      const order = phaseOrder(id);
      const index = order.indexOf(local.phase);
      // Counting, not judging. Everything in the new phase is unmeasured, so
      // these are all zero -- the history below them is left exactly as it was,
      // because it happened.
      return ok({
        ...recorded,
        phase_key: local.phase,
        phase_order: index + 1,
        phase_pct: 0,
        criteria_passed: 0,
        criteria_total: gate["required_total"],
        overall_pct: Math.round((1000 * index) / order.length) / 10,
      });
    }
  }

  if (path === "/auth/me") {
    const me = RESPONSES["/auth/me"] as Body | undefined;
    if (!me) return no(503, NEEDS_LAPTOP);
    if (!local.profile) return ok(me);
    // A position chosen on the phone is remembered, so the role picker behaves.
    return ok({ ...me, profile: { ...(me["profile"] as Body), ...local.profile } });
  }

  if (path === `/injuries/${id}/sessions?limit=200`) {
    const recorded = (RESPONSES[path] as Body[] | undefined) ?? [];
    // Newest first, which is the order the endpoint returns and the screen shows.
    return ok([...local.sessions.map(withoutSets), ...recorded]);
  }

  if (path === `/injuries/${id}/exit-criteria`) {
    const gate = RESPONSES[path] as Body | undefined;
    if (!gate) return no(503, NEEDS_LAPTOP);
    if (local.criteria.length === 0) return ok(gate);
    // A criterion written on the phone joins the list as never measured, which
    // is exactly what it is -- not a pass, not a failure, no data behind it.
    return ok({ ...gate, criteria: [...(gate["criteria"] as Body[]), ...local.criteria] });
  }

  if (path === `/injuries/${id}/criteria`) return ok(local.criteria);

  const recorded = RESPONSES[path];
  if (recorded !== undefined) return ok(recorded);
  return no(503, NEEDS_LAPTOP);
}

function withoutSets(session: LocalSession): Body {
  const { sets, ...row } = session;
  return { ...row, sets_logged: sets.length };
}

function putCriterion(draft: Body): Reply {
  const key = String(draft["key"] ?? `custom_${Date.now()}`);
  const criterion: Body = {
    ...draft,
    key,
    status: "no_data",
    observed: null,
    progress: 0,
    samples: 0,
    source: "custom",
    detail_en: "Written on this phone. Nothing measured against it yet.",
    detail_th: "Written on this phone. Nothing measured against it yet.",
  };
  local.criteria = [...local.criteria.filter((c) => c["key"] !== key), criterion];
  save(local);
  return ok(criterion);
}

function post(path: string, body: Body, id: number): Reply {
  if (path === "/auth/login") return ok({ access_token: "standalone" });

  if (path === `/injuries/${id}/sessions`) {
    const session: LocalSession = {
      id: local.nextId++,
      status: "in_progress",
      started_at: new Date().toISOString(),
      pain_during: null,
      pain_after: null,
      sets: [],
    };
    local.sessions = [session, ...local.sessions];
    save(local);
    return ok({ id: session.id });
  }

  const setMatch = /^\/sessions\/(\d+)\/sets$/.exec(path);
  if (setMatch) {
    const session = local.sessions.find((s) => String(s.id) === setMatch[1]);
    if (!session) return no(404, NEEDS_LAPTOP);
    const frames = (body["frames"] as unknown[] | undefined) ?? [];
    session.sets.push({
      exercise_key: String(body["exercise_key"] ?? ""),
      side: String(body["side"] ?? ""),
      frames: frames.length,
      prescribed_reps: (body["prescribed_reps"] as number | null) ?? null,
      at: new Date().toISOString(),
    });
    save(local);
    // The screen does not read this -- the rep count and the form score it shows
    // were worked out on the phone while you were moving. What it must not do is
    // invent a score here, so the counts stay null and the warning says why.
    return ok({
      set_id: session.sets.length,
      completed_reps: null,
      valid_reps: null,
      form_score: null,
      warnings: ["Stored on this phone. The server has not scored it yet."],
      emitted: [],
    });
  }

  const completeMatch = /^\/sessions\/(\d+)\/complete$/.exec(path);
  if (completeMatch) {
    const session = local.sessions.find((s) => String(s.id) === completeMatch[1]);
    if (session) {
      session.status = "completed";
      save(local);
    }
    return ok({ id: session?.id ?? 0, status: "completed" });
  }

  if (path === `/injuries/${id}/pain-logs`) {
    local.painLogs = [{ ...body, at: new Date().toISOString() }, ...local.painLogs];
    save(local);
    return ok({ recorded: true });
  }

  if (path === `/injuries/${id}/advance`) {
    return no(
      503,
      "Moving to the next phase means re-running the exit criteria, and that " +
        "happens on the laptop. The gate you can see is the one from when this " +
        "snapshot was taken.",
    );
  }

  return no(503, NEEDS_LAPTOP);
}
