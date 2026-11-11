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
import type { Authorable, AuthorableCatalogue } from "./api";
import { preview } from "./criteria";
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
  /** Test results typed in on the phone, waiting for a laptop to count them. */
  tests: Body[];
  criteria: Body[];
  profile: Body | null;
  /** The phase the player said they were in, if they have said. */
  phase: string | null;
  /** An injury chosen on the phone, replacing the recorded one. */
  injury: { injury_site: string; side: string } | null;
  nextId: number;
}

const EMPTY: LocalState = {
  sessions: [],
  painLogs: [],
  tests: [],
  criteria: [],
  profile: null,
  phase: null,
  injury: null,
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
  return local.sessions.length + local.painLogs.length + local.tests.length;
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

/**
 * Every protocol, loaded once and only if it is needed.
 *
 * The snapshot records one player's programme, which is all anybody needs until
 * they change their position or their injury. Then it is the wrong programme --
 * and the app was saying "your plan has been rebuilt for this position" while
 * serving the same one, which is a worse failure than an error message because
 * nothing on screen contradicts it.
 *
 * Six positions times seven injury sites is the whole claim this project makes,
 * so a demo that cannot show it is demonstrating the wrong thing. All 126 are
 * recorded, kept out of the bundle at 1.6 MB, and fetched the first time
 * somebody actually changes something. Most visitors never ask for it.
 */
let library: Record<string, Body & { phases: Body[] }> | null = null;
let loading: Promise<void> | null = null;

export function ready(): Promise<void> {
  if (library || !active()) return Promise.resolve();
  loading ??= fetch("/demo-protocols.json")
    .then((response) => (response.ok ? response.json() : null))
    .then((loaded) => {
      library = loaded;
    })
    .catch(() => {
      // Offline in the other sense -- no network at all. The recorded protocol
      // still works for the player as they were snapshotted.
      library = null;
    });
  return loading;
}

/** What the app currently believes about the player, for choosing a protocol. */
function playerKey(): { base: string; age: string } | null {
  const me = RESPONSES["/auth/me"] as Body | undefined;
  const profile = { ...((me?.["profile"] as Body) ?? {}), ...(local.profile ?? {}) };
  const position = profile["position"];
  const episode = (RESPONSES["/injuries?status_filter=active"] as Body[] | undefined)?.[0];
  const site = local.injury?.injury_site ?? episode?.["injury_site"];
  const age = String(profile["age_group"] ?? profile["effective_age_group"] ?? "adult");
  return position && site ? { base: `${position}|${site}`, age } : null;
}

/**
 * The library's programme for who the player is now, if the library is loaded.
 *
 * Age group only changes phase one, so the library holds the youth and senior
 * variants as that single phase (see `_write_protocols` in
 * scripts/make_snapshot.py). This puts one back into the adult programme it
 * belongs to, which is exactly what the server would have sent.
 */
function fromLibrary(): (Body & { phases: Body[] }) | undefined {
  const key = playerKey();
  if (!key || !library) return undefined;
  const adult = library[key.base];
  if (!adult || key.age === "adult") return adult;
  const variant = library[`${key.base}|${key.age}`] as Body | undefined;
  const stored = variant?.["phase_one"] as Body | undefined;
  if (!variant || !stored) return adult;
  // Stored with exercise keys only; the full exercises are in the catalogue.
  const catalogue = (RESPONSES["/catalog/exercises"] as Body[] | undefined) ?? [];
  const phaseOne: Body = {
    ...stored,
    prescriptions: (stored["prescriptions"] as Body[]).map(({ exercise_key, ...rx }) => ({
      ...rx,
      exercise: catalogue.find((e) => e["key"] === exercise_key) ?? { key: exercise_key },
    })),
  };
  return {
    ...adult,
    id: variant["id"],
    key: variant["key"],
    age_group: variant["age_group"],
    phases: adult.phases.map((p) => (p["phase_key"] === phaseOne["phase_key"] ? phaseOne : p)),
  };
}

/**
 * The programme for who the player is now, falling back to the recorded one.
 *
 * The recorded protocol is the right answer whenever nothing has been changed,
 * and the only answer if the library never loaded.
 */
function protocol(id: number): { phases: Body[] } | undefined {
  const chosen = fromLibrary();
  return chosen ?? (RESPONSES[`/injuries/${id}/protocol`] as { phases: Body[] } | undefined);
}

/**
 * Has the player moved off the programme the snapshot was recorded against?
 *
 * By protocol id, because the library is a second copy of the same data: the
 * entry for the player's own position and injury holds everything the recorded
 * one holds and is still a different object. Comparing the objects said "moved"
 * the moment the library loaded -- which happens before the first request -- and
 * the app answered every screen from a phase nothing had been measured in,
 * throwing away the recorded results it exists to show.
 */
function movedOff(id: number): boolean {
  const chosen = fromLibrary();
  const recorded = RESPONSES[`/injuries/${id}/protocol`] as Body | undefined;
  if (!chosen || !recorded || chosen["id"] === recorded["id"]) return false;

  // A different age group is a different programme by id, but only its
  // tailored phase differs -- everything else is the recorded programme, and
  // the recorded results for it are still this player's results. Treating it as
  // "moved" put a player who is in phase two back at the start of phase one,
  // with the screen above still saying phase two.
  const key = playerKey();
  const sameProgramme =
    key !== null && `${recorded["position"]}|${recorded["injury_site"]}` === key.base;
  if (!sameProgramme) return true;
  const recordedPhase = (
    RESPONSES["/injuries?status_filter=active"] as Body[] | undefined
  )?.[0]?.["current_phase"];
  const phaseNow = local.phase ?? recordedPhase;
  return chosen.phases.some((p) => p["tailoring"] && p["phase_key"] === phaseNow);
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
    detail_en: "Your body heals at its own pace. This is the shortest time, not a goal.",
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
  "This needs the laptop. Right now the app is using a saved copy on your phone, " +
  "so it can't work anything new out until it's connected to the laptop again.";

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
    // An age group changes the plan, and with no library loaded there is no
    // other plan to serve. Saying "rebuilt" while serving the old one is the
    // one thing worse than refusing -- the same rule as choosing an injury.
    if (body["age_group"] && !library) {
      return no(
        503,
        "The plans for other age groups did not load on this phone. Connect to " +
          "the internet once, or use the laptop.",
      );
    }
    local.profile = { ...(local.profile ?? {}), ...body };
    // The server reports the band the plan is built for alongside the one
    // picked; a pick made on the phone is both.
    if (body["age_group"]) local.profile["effective_age_group"] = body["age_group"];
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
  return no(404, "This part of the app doesn't work on the phone on its own. Connect to the laptop to use it.");
}

/** The episode list, with the phase the player chose applied over it. */
function episodes(): Body[] {
  const recorded = (RESPONSES["/injuries?status_filter=active"] as Body[] | undefined) ?? [];
  if (!local.phase && !local.injury) return recorded;
  return recorded.map((e) => ({
    ...e,
    ...(local.injury ?? {}),
    ...(local.phase ? { current_phase: local.phase } : {}),
  }));
}

function get(path: string, id: number): Reply {
  if (path === "/injuries?status_filter=active") return ok(episodes());

  if (path === `/injuries/${id}/protocol`) {
    const chosen = protocol(id);
    return chosen ? ok(chosen) : no(503, NEEDS_LAPTOP);
  }

  // Today's plan for the phase they said they are in. The protocol carries
  // every phase and in exactly the shape this endpoint returns, so this is the
  // same data by another route rather than anything reconstructed.
  // A phase chosen on the phone, or a programme swapped underneath: either way
  // the recorded answers are for a different thing and the protocol is the
  // source instead.
  //
  // Unless the phase chosen is the one the snapshot was recorded against, which
  // happens whenever somebody moves forward and then comes back. The recorded
  // answers are that phase's answers, and discarding them would blank a screen
  // that has real results sitting behind it.
  const snapshotPhase = (RESPONSES["/injuries?status_filter=active"] as Body[] | undefined)?.[0]?.[
    "current_phase"
  ];
  const away = local.phase === snapshotPhase && !movedOff(id) ? null : local.phase;
  const shifted = away ?? (movedOff(id) ? phaseOrder(id)[0] : null);

  if (shifted && path === `/injuries/${id}/today`) {
    const phase = phaseOf(id, shifted);
    if (phase) return ok(phase);
  }

  if (shifted && path === `/injuries/${id}/exit-criteria`) {
    const gate = unmeasuredGate(id, shifted);
    if (gate) {
      return ok({
        ...gate,
        criteria: withMyCriteria(gate),
      });
    }
  }

  if (shifted && path === `/injuries/${id}/progress`) {
    const recorded = RESPONSES[path] as Body | undefined;
    const gate = unmeasuredGate(id, shifted);
    if (recorded && gate) {
      const order = phaseOrder(id);
      const index = order.indexOf(shifted);
      // Counting, not judging. Everything in the new phase is unmeasured, so
      // these are all zero -- the history below them is left exactly as it was,
      // because it happened.
      return ok({
        ...recorded,
        phase_key: shifted,
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
    return ok({ ...gate, criteria: withMyCriteria(gate) });
  }

  if (path === `/injuries/${id}/criteria`) return ok(myCustom(id));

  const recorded = RESPONSES[path];
  if (recorded !== undefined) return ok(recorded);
  return no(503, NEEDS_LAPTOP);
}

function withoutSets(session: LocalSession): Body {
  const { sets, ...row } = session;
  return { ...row, sets_logged: sets.length };
}

/**
 * The sentence a target reads as -- "Wall sit: hold for at least 45 seconds".
 *
 * The server builds this with `authoring.build_label`, so a criterion saved
 * with no laptop had no label at all and the screen showed the word
 * "undefined" where the target should be. It is the same sentence the builder
 * puts under "Your test will read", from the same function, so what a player
 * confirms is exactly what they get.
 */
/* ------------------------------------------------------------ own targets --
 *
 * A test the player writes goes to the server as a *draft*: the metric and the
 * exercise as two separate fields, the number as `value`. The server turns that
 * into two different things -- a stored spec, and a row on the gate -- and the
 * app reads both. Neither of them looks like the draft.
 *
 * So the draft is what is kept here, and both shapes are derived from it on the
 * way out, mirroring `app/services/criteria/authoring.py`. Keeping the draft and
 * serving it unchanged, which is what this did before, produced a target that
 * could not be started with the camera (its metric named no exercise), showed
 * no number to beat (`value` is not `target`), and could not be reopened to
 * edit (no `spec` at all).
 */

const ABSOLUTE = "absolute";
/** `authoring.MAX_KEY`. */
const MAX_KEY = 64;

/** The catalogue entry a draft was built from, and the exercise it names. */
function authored(draft: Body): {
  item: Authorable | undefined;
  exercise: { name_en: string } | undefined;
} {
  const catalogue = RESPONSES["/injuries/criteria/authorable"] as
    | AuthorableCatalogue
    | undefined;
  return {
    item: catalogue?.metrics.find((m) => m.key === draft["metric"]),
    exercise: catalogue?.exercises.find((e) => e.key === draft["exercise_key"]),
  };
}

function labelFor(draft: Body): string {
  const { item, exercise } = authored(draft);
  if (!item) return "Your target";
  return preview(
    item,
    String(draft["target_type"] ?? ABSOLUTE),
    Number(draft["value"] ?? 0),
    exercise?.name_en ?? null,
  );
}

/**
 * `session.reps` and `single_leg_squat`, joined as `build_spec` joins them.
 *
 * This is the field that says what the camera is being asked to score. A target
 * stored with the base metric alone still appears on the gate, and the Test
 * screen offers no way to start it -- there is no exercise in it to start.
 */
function metricFor(draft: Body, item: Authorable | undefined): string {
  const base = String(draft["metric"] ?? "");
  const exercise = draft["exercise_key"];
  return item?.needs_exercise && exercise ? base + "." + String(exercise) : base;
}

/** `authoring.build_key`: deterministic, so editing a test replaces it. */
function keyFor(draft: Body, item: Authorable | undefined): string {
  const slug = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "");
  const targetType = String(draft["target_type"] ?? ABSOLUTE);
  const parts = ["custom", slug(item?.key ?? String(draft["metric"] ?? ""))];
  if (draft["exercise_key"]) parts.push(slug(String(draft["exercise_key"])));
  if (targetType !== ABSOLUTE) parts.push(targetType);
  return parts.join("_").slice(0, MAX_KEY);
}

/** A comparison against a percentage is in percent, whatever the metric counts. */
const unitFor = (item: Authorable | undefined, targetType: string): string | null =>
  targetType === ABSOLUTE ? (item?.unit ?? null) : "%";

/** One target in the shape `GET /injuries/{id}/criteria` returns. */
function asCustom(draft: Body, index: number): Body {
  const { item } = authored(draft);
  const targetType = String(draft["target_type"] ?? ABSOLUTE);
  return {
    // Only ever used to tell rows apart. The real one is a database id, and
    // there is no database here.
    id: index + 1,
    phase_key: draft["phase_key"] ?? null,
    key: draft["key"],
    label_en: labelFor(draft),
    help_en: item?.help_en ?? null,
    required: draft["required"] ?? true,
    spec: {
      metric: metricFor(draft, item),
      source: item?.source ?? "session",
      aggregate: item?.default_aggregate ?? "latest",
      window_days: draft["window_days"] ?? item?.default_window_days ?? null,
      comparator: item?.comparator ?? "gte",
      // An LSI target reads both limbs, exactly as build_spec widens it.
      scope: targetType === "lsi" ? "both" : (item?.scope ?? "any"),
      target: {
        type: targetType,
        value: Number(draft["value"] ?? 0),
        unit: unitFor(item, targetType),
      },
    },
  };
}

/** The same target as a row on the gate: a real rule, no reading behind it. */
function asResult(draft: Body): Body {
  const { item } = authored(draft);
  const targetType = String(draft["target_type"] ?? ABSOLUTE);
  const label = labelFor(draft);
  const detail = "Written on this phone. Nothing measured against it yet.";
  return {
    key: draft["key"],
    label_en: label,
    label_th: label,
    metric: metricFor(draft, item),
    source: item?.source ?? "session",
    required: draft["required"] ?? true,
    status: "no_data",
    comparator: item?.comparator ?? "gte",
    target_type: targetType,
    observed: null,
    target: Number(draft["value"] ?? 0),
    unit: unitFor(item, targetType),
    progress: 0,
    samples: 0,
    baseline: null,
    baseline_origin: null,
    detail_en: detail,
    detail_th: detail,
  };
}

/**
 * The player's own targets: the ones the snapshot recorded, plus the ones
 * written since, with a written one replacing a recorded one of the same key.
 *
 * Replacing rather than appending is what the endpoint is: a PUT, keyed on what
 * is being measured, so setting the same test twice edits it instead of leaving
 * the gate with two rules arguing about the same exercise.
 */
function myCustom(id: number): Body[] {
  const written = new Set(local.criteria.map((c) => c["key"]));
  const kept = ((RESPONSES[`/injuries/${id}/criteria`] as Body[] | undefined) ?? []).filter(
    (c) => !written.has(c["key"]),
  );
  return [...kept, ...local.criteria.map(asCustom)];
}

/**
 * One phase's gate, with the player's own targets folded into it.
 *
 * Two things happen here, and both are what the server does. A written target
 * *replaces* the criterion it shares a key with, rather than joining it -- that
 * covers tightening a standard test as well as editing your own, which is why
 * the filter runs over the whole list. And a target belongs to the phase it was
 * written in, so it does not follow the player into the next one.
 */
function withMyCriteria(gate: Body): Body[] {
  const phase = gate["phase_key"];
  const mine = local.criteria.filter((c) => (c["phase_key"] ?? phase) === phase);
  const written = new Set(mine.map((c) => c["key"]));
  const recorded = (gate["criteria"] as Body[] | undefined) ?? [];
  return [...recorded.filter((c) => !written.has(c["key"])), ...mine.map(asResult)];
}

function putCriterion(draft: Body): Reply {
  const { item } = authored(draft);
  // The builder sends a key only when it is editing something that exists.
  // Otherwise it is derived, so adding the same test twice edits it rather than
  // leaving two rules on the gate disagreeing about the same exercise.
  const key = String(draft["key"] ?? keyFor(draft, item));
  const stored: Body = { ...draft, key };
  local.criteria = [...local.criteria.filter((c) => c["key"] !== key), stored];
  save(local);
  return ok(asCustom(stored, local.criteria.length - 1));
}

function post(path: string, body: Body, id: number): Reply {
  if (path === "/auth/login") return ok({ access_token: "standalone" });

  // Choosing an injury. Every protocol is recorded, so this is a real change of
  // programme rather than a promise the demo cannot keep -- the plan, the
  // exercises and the gate all move to the one written for this position and
  // this injury. What it is not is a second episode: the demo has one player,
  // and this replaces what they are being treated for.
  if (path === "/injuries") {
    const site = String(body["injury_site"] ?? "");
    const side = String(body["side"] ?? "left");
    local.injury = { injury_site: site, side };
    local.phase = null;
    if (!fromLibrary()) {
      local.injury = null;
      return no(
        503,
        "That plan isn't in the demo. The full app has 126 plans, " +
          "but this demo only has a few of them.",
      );
    }
    // A new injury starts at the beginning, the way the real one does.
    local.phase = phaseOrder(id)[0] ?? null;
    save(local);
    return ok({ ...(episodes()[0] ?? {}), injury_site: site, side, current_phase: local.phase });
  }

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
      warnings: ["Saved on this phone. It gets its final score when you connect to the laptop."],
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

  if (path === `/injuries/${id}/tests`) {
    // Stored, not judged: the comparison between legs, and whether it clears
    // the test, is the engine's job, and the engine is on the laptop.
    local.tests = [{ ...body, at: new Date().toISOString() }, ...local.tests];
    save(local);
    return ok({ recorded: true });
  }

  if (path === `/injuries/${id}/pain-logs`) {
    local.painLogs = [{ ...body, at: new Date().toISOString() }, ...local.painLogs];
    save(local);
    return ok({ recorded: true });
  }

  if (path === `/injuries/${id}/advance`) {
    // The gate the player is looking at, asked for by the same route the app
    // uses. Nothing is judged here: it is either the recorded verdict of the
    // real engine, or a phase with nothing measured in it yet.
    const gate = get(`/injuries/${id}/exit-criteria`, id);
    if (!gate.ok || !(gate.body as Body)["passed"]) {
      return no(
        503,
        "To move to the next phase, your tests need checking again, and that " +
          "happens on the laptop. The results you can see are from when this " +
          "copy was saved.",
      );
    }

    const order = phaseOrder(id);
    const next = order[order.indexOf(String(episodes()[0]?.["current_phase"] ?? "")) + 1];
    if (!next) return no(422, "This is the last phase of the programme.");
    local.phase = next;
    save(local);
    return ok({ ...(episodes()[0] ?? {}), current_phase: next });
  }

  return no(503, NEEDS_LAPTOP);
}
