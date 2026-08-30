/**
 * Tests for running with no backend.
 *
 * Two things matter here beyond "does it return something".
 *
 * **It must not invent.** The whole reason this mode is safe to show a teacher
 * is that it replays the real backend rather than imitating it. So the tests
 * check that anything requiring judgement -- advancing a phase, scoring a set --
 * is refused in plain words rather than answered with a plausible number.
 *
 * **It must not fill the phone.** One set of landmarks is megabytes. If those
 * ever reach localStorage the quota blows partway through a demo, which is the
 * worst possible moment to discover it.
 */
import { beforeEach, describe, expect, it } from "vitest";

// standalone.ts reads storage as it loads, so the stub has to exist first --
// hence the dynamic import below rather than a plain one at the top.
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
  /** Everything written, for the size and content checks. */
  dump(): string {
    return [...this.map.values()].join("");
  }
}

const storage = new MemoryStorage();
(globalThis as unknown as { localStorage: Storage }).localStorage =
  storage as unknown as Storage;

// `ready()` fetches the protocol library over the network in a browser. Here it
// comes off disk, so the switching behaviour is testable rather than assumed.
const protocolsFile = new URL("../public/demo-protocols.json", import.meta.url);
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
  const { readFile } = await import("node:fs/promises");
  if (!String(url).includes("demo-protocols")) return { ok: false };
  return { ok: true, json: async () => JSON.parse(await readFile(protocolsFile, "utf8")) };
};

const standalone = await import("./standalone");
const { splitMetric } = await import("./criteria");
// The same object standalone.ts holds -- a JSON import is one instance per
// module graph, which is what lets a test change what the gate said.
const snapshot = (await import("./demo/snapshot.json")).default;

/** Call an endpoint and insist it worked. */
function body(path: string, init?: RequestInit): any {
  const reply = standalone.handle(path, init);
  if (!reply.ok) throw new Error(`${path} -> ${reply.status} ${reply.detail}`);
  return reply.body;
}

/** Call an endpoint expecting a refusal, and return it. */
function refusal(path: string, init?: RequestInit) {
  const reply = standalone.handle(path, init);
  if (reply.ok) throw new Error(`${path} was answered, but should have been refused`);
  return reply;
}

const episodeId = (): number => body("/injuries?status_filter=active")[0].id;

/** The phase the app believes the player is in, which is what the gate is for. */
const currentPhase = (): string =>
  body("/injuries?status_filter=active")[0].current_phase;

/** Phase keys in programme order. */
const phaseKeysFor = (id: number): string[] =>
  body(`/injuries/${id}/protocol`)
    .phases.sort((a: any, b: any) => a.order_index - b.order_index)
    .map((p: any) => p.phase_key);

beforeEach(() => {
  standalone.reset();
});

describe("the snapshot", () => {
  it("is bundled with the app", () => {
    expect(standalone.available()).toBe(true);
  });

  it("answers every screen the app opens", () => {
    const id = episodeId();
    expect(body("/auth/me").email).toContain("@");
    expect(body("/catalog/positions").length).toBeGreaterThan(0);
    expect(body("/catalog/exercises").length).toBeGreaterThan(0);
    expect(body(`/injuries/${id}/today`).prescriptions.length).toBeGreaterThan(0);
    expect(body(`/injuries/${id}/protocol`).phases.length).toBe(4);
    expect(body(`/injuries/${id}/progress`).sessions_completed).toBeGreaterThan(0);
    expect(body(`/injuries/${id}/exit-criteria`).criteria.length).toBeGreaterThan(0);
    expect(body(`/injuries/${id}/sessions?limit=200`).length).toBeGreaterThan(0);
  });

  it("carries real evaluated criteria, not placeholders", () => {
    const gate = body(`/injuries/${episodeId()}/exit-criteria`);
    // A criterion the engine actually judged has an observed value and a target.
    const judged = gate.criteria.filter(
      (c: any) => c.observed !== null && c.target !== null,
    );
    expect(judged.length).toBeGreaterThan(0);
    expect(["pass", "fail", "no_data", "pending_signoff"]).toContain(gate.criteria[0].status);
  });

  it("says so plainly when asked for something it does not have", () => {
    const reply = refusal("/injuries/999/today");
    expect(reply.status).toBe(503);
    expect(reply.detail).toMatch(/laptop/i);
  });
});

describe("a session logged with no laptop", () => {
  it("runs the whole flow and shows up in the list", () => {
    const id = episodeId();
    const before = body(`/injuries/${id}/sessions?limit=200`).length;

    const session = body(`/injuries/${id}/sessions`, { method: "POST", body: "{}" });
    expect(session.id).toBeGreaterThan(0);

    body(`/sessions/${session.id}/sets`, {
      method: "POST",
      body: JSON.stringify({
        exercise_key: "single_leg_squat",
        side: "left",
        prescribed_reps: 10,
        frames: Array.from({ length: 300 }, (_, t) => ({ t, landmarks: [] })),
      }),
    });
    body(`/sessions/${session.id}/complete`, { method: "POST", body: "{}" });

    const after = body(`/injuries/${id}/sessions?limit=200`);
    expect(after.length).toBe(before + 1);
    // Newest first, which is the order the real endpoint returns.
    expect(after[0].id).toBe(session.id);
    expect(after[0].status).toBe("completed");
    expect(after[0].sets_logged).toBe(1);
  });

  it("refuses to score it rather than making a number up", () => {
    const id = episodeId();
    const session = body(`/injuries/${id}/sessions`, { method: "POST", body: "{}" });
    const result = body(`/sessions/${session.id}/sets`, {
      method: "POST",
      body: JSON.stringify({ exercise_key: "single_leg_squat", side: "left", frames: [] }),
    });
    expect(result.form_score).toBeNull();
    expect(result.valid_reps).toBeNull();
    expect(result.warnings.join(" ")).toMatch(/not scored/i);
  });

  it("never writes landmark frames to storage", () => {
    const id = episodeId();
    const session = body(`/injuries/${id}/sessions`, { method: "POST", body: "{}" });
    // A realistic set: 600 frames of 33 landmarks is megabytes as JSON.
    const frames = Array.from({ length: 600 }, (_, t) => ({
      t,
      landmarks: Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0.5, v: 0.9 })),
    }));
    body(`/sessions/${session.id}/sets`, {
      method: "POST",
      body: JSON.stringify({ exercise_key: "split_squat", side: "left", frames }),
    });
    const written = storage.dump();
    expect(written).not.toContain("landmarks");
    // The whole local record stays trivially small.
    expect(written.length).toBeLessThan(2000);
  });

  it("counts what is waiting to be sent", () => {
    const id = episodeId();
    expect(standalone.pending()).toBe(0);
    body(`/injuries/${id}/sessions`, { method: "POST", body: "{}" });
    body(`/injuries/${id}/pain-logs`, { method: "POST", body: JSON.stringify({ score: 3 }) });
    expect(standalone.pending()).toBe(2);
    standalone.reset();
    expect(standalone.pending()).toBe(0);
  });
});

describe("saying which phase you are in", () => {
  const phaseKeys = (): string[] => {
    const id = episodeId();
    return body(`/injuries/${id}/protocol`)
      .phases.sort((a: any, b: any) => a.order_index - b.order_index)
      .map((p: any) => p.phase_key);
  };

  const setPhase = (key: string) =>
    body(`/injuries/${episodeId()}/starting-phase`, {
      method: "PUT",
      body: JSON.stringify({ phase_key: key }),
    });

  it("works for every phase, not just the one in the snapshot", () => {
    const id = episodeId();
    const keys = phaseKeys();
    expect(keys).toHaveLength(4);
    for (const key of keys) {
      expect(setPhase(key).current_phase).toBe(key);
      // The three screens that read a phase all have to agree with the answer.
      expect(body("/injuries?status_filter=active")[0].current_phase).toBe(key);
      expect(body(`/injuries/${id}/today`).phase_key).toBe(key);
      expect(body(`/injuries/${id}/exit-criteria`).phase_key).toBe(key);
      expect(body(`/injuries/${id}/progress`).phase_key).toBe(key);
    }
  });

  it("brings that phase's own exercises with it", () => {
    const id = episodeId();
    const [first, , , last] = phaseKeys();
    setPhase(first!);
    const early = body(`/injuries/${id}/today`).prescriptions.map((p: any) => p.exercise.key);
    setPhase(last!);
    const late = body(`/injuries/${id}/today`).prescriptions.map((p: any) => p.exercise.key);
    expect(early.length).toBeGreaterThan(0);
    expect(late.length).toBeGreaterThan(0);
    expect(late).not.toEqual(early);
  });

  it("reports the new phase as unmeasured rather than inventing results", () => {
    const id = episodeId();
    setPhase(phaseKeys()[3]!);
    const gate = body(`/injuries/${id}/exit-criteria`);

    expect(gate.passed).toBe(false);
    expect(gate.required_passed).toBe(0);
    expect(gate.required_total).toBeGreaterThan(0);
    // Nothing has been measured against a phase the player just walked into.
    for (const c of gate.criteria.filter((c: any) => c.key !== "min_days_in_phase")) {
      expect(c.observed, c.key).toBeNull();
      expect(c.progress, c.key).toBe(0);
      expect(["no_data"], c.key).toContain(c.status);
    }
    // And whatever blocks has a row, the same rule the live gate follows.
    const keys = new Set(gate.criteria.map((c: any) => c.key));
    for (const blocked of gate.blocking) expect(keys.has(blocked)).toBe(true);
  });

  it("keeps the labels and targets the programme actually specifies", () => {
    const id = episodeId();
    setPhase(phaseKeys()[3]!);
    const gate = body(`/injuries/${id}/exit-criteria`);
    const definitions = body(`/injuries/${id}/protocol`).phases.find(
      (p: any) => p.phase_key === phaseKeys()[3],
    ).exit_criteria;
    for (const definition of definitions) {
      const shown = gate.criteria.find((c: any) => c.key === definition.key);
      expect(shown, definition.key).toBeDefined();
      expect(shown.label_en).toBe(definition.label_en);
      expect(shown.required).toBe(definition.required);
    }
  });

  it("refuses a phase the programme does not have", () => {
    const reply = standalone.handle(`/injuries/${episodeId()}/starting-phase`, {
      method: "PUT",
      body: JSON.stringify({ phase_key: "p9_invented" }),
    });
    expect(reply.ok).toBe(false);
  });

  it("gets the recorded results back when it returns to the recorded phase", () => {
    /* Forward and back again is a normal thing to do on the Plan screen, and
       the results for the phase the snapshot was taken in did not stop being
       real because somebody looked at the next one. */
    const id = episodeId();
    const before = body(`/injuries/${id}/exit-criteria`);
    expect(before.criteria.some((c: any) => c.status === "pass")).toBe(true);

    const keys = phaseKeys();
    const next = keys[keys.indexOf(before.phase_key) + 1];
    expect(next).toBeDefined();
    setPhase(next!);
    expect(body(`/injuries/${id}/exit-criteria`).required_passed).toBe(0);

    setPhase(before.phase_key);
    const after = body(`/injuries/${id}/exit-criteria`);
    expect(after.required_passed).toBe(before.required_passed);
    expect(after.criteria.some((c: any) => c.status === "pass")).toBe(true);
  });

  it("goes back to the snapshot when the local state is cleared", () => {
    const id = episodeId();
    const original = body(`/injuries/${id}/exit-criteria`).phase_key;
    setPhase(phaseKeys()[3]!);
    expect(body(`/injuries/${id}/exit-criteria`).phase_key).not.toBe(original);
    standalone.reset();
    expect(body(`/injuries/${id}/exit-criteria`).phase_key).toBe(original);
  });
});

describe("the recorded snapshot, once the protocol library has loaded", () => {
  /* The library is fetched before the first request, not on demand, so this is
     what every visitor gets rather than an edge case. It used to be treated as
     a programme change the moment it arrived -- same programme, second copy,
     different object -- and the app served a phase with nothing measured in it
     instead of the results it was recording. */
  it("is still what the app serves", async () => {
    const id = episodeId();
    const recorded = (snapshot as any).responses[`/injuries/${id}/exit-criteria`];

    standalone.setActive(true);
    await standalone.ready();

    const gate = body(`/injuries/${id}/exit-criteria`);
    expect(gate.phase_key).toBe(recorded.phase_key);
    expect(gate.required_passed).toBe(recorded.required_passed);
    // The real engine's verdicts, which is the whole reason for the snapshot.
    expect(gate.criteria.some((c: any) => c.status === "pass")).toBe(true);
    expect(body(`/injuries/${id}/today`).phase_key).toBe(recorded.phase_key);
  });
});

describe("changing the programme with no laptop", () => {
  const id = () => episodeId();

  it("serves a different injury's programme, not the recorded one", async () => {
    standalone.setActive(true);
    await standalone.ready();

    const before = body(`/injuries/${id()}/protocol`);
    const beforeExercises = before.phases
      .flatMap((p: any) => p.prescriptions)
      .map((rx: any) => rx.exercise.key);

    const changed = body("/injuries", {
      method: "POST",
      body: JSON.stringify({ injury_site: "hamstring", side: "left" }),
    });
    expect(changed.injury_site).toBe("hamstring");

    const after = body(`/injuries/${id()}/protocol`);
    const afterExercises = after.phases
      .flatMap((p: any) => p.prescriptions)
      .map((rx: any) => rx.exercise.key);

    // The claim the app makes is that the plan is rebuilt. The exercises are
    // what would show that, so they are what is checked.
    expect(afterExercises).not.toEqual(beforeExercises);
    expect(afterExercises.join(" ")).toMatch(/nordic|hamstring/i);
    // And every screen that reads a programme follows it.
    expect(body(`/injuries/${id()}/today`).prescriptions.length).toBeGreaterThan(0);
    expect(body("/injuries?status_filter=active")[0].injury_site).toBe("hamstring");
  });

  it("starts a new injury at the first phase", async () => {
    standalone.setActive(true);
    await standalone.ready();
    body("/injuries", {
      method: "POST",
      body: JSON.stringify({ injury_site: "ankle", side: "right" }),
    });
    const gate = body(`/injuries/${id()}/exit-criteria`);
    const order = body(`/injuries/${id()}/protocol`)
      .phases.sort((a: any, b: any) => a.order_index - b.order_index)
      .map((p: any) => p.phase_key);
    expect(gate.phase_key).toBe(order[0]);
    // Nothing has been measured against a programme just started.
    expect(gate.required_passed).toBe(0);
  });

  it("refuses an injury the library does not carry, and stays where it was", async () => {
    standalone.setActive(true);
    await standalone.ready();
    const before = body("/injuries?status_filter=active")[0].injury_site;
    const reply = standalone.handle("/injuries", {
      method: "POST",
      body: JSON.stringify({ injury_site: "not_a_real_site", side: "left" }),
    });
    expect(reply.ok).toBe(false);
    // The refusal must not leave the player on a programme that does not exist.
    expect(body("/injuries?status_filter=active")[0].injury_site).toBe(before);
  });
});

describe("moving to the next phase", () => {
  const advance = (id: number) =>
    standalone.handle(`/injuries/${id}/advance`, { method: "POST", body: "{}" });

  /** Make the recorded gate say it passed, and put it back afterwards. */
  const withPassingGate = (id: number, run: () => void) => {
    const gate = (snapshot as any).responses[`/injuries/${id}/exit-criteria`];
    const was = gate.passed;
    gate.passed = true;
    try {
      run();
    } finally {
      gate.passed = was;
    }
  };

  it("is refused while the gate has not been cleared", () => {
    const reply = advance(episodeId());
    expect(reply.ok).toBe(false);
    expect(reply.ok === false && reply.status).toBe(503);
    expect(reply.ok === false && reply.detail).toMatch(/exit criteria|laptop/i);
  });

  it("goes through when the recorded gate says every test was passed", () => {
    const id = episodeId();
    withPassingGate(id, () => {
      const order = body(`/injuries/${id}/protocol`)
        .phases.sort((a: any, b: any) => a.order_index - b.order_index)
        .map((p: any) => p.phase_key);
      const before = body("/injuries?status_filter=active")[0].current_phase;

      const reply = advance(id);

      expect(reply.ok).toBe(true);
      const after = body("/injuries?status_filter=active")[0].current_phase;
      expect(after).toBe(order[order.indexOf(before) + 1]);
      // The new phase has had nothing measured in it, and must say so rather
      // than carrying the passing gate forward.
      expect(body(`/injuries/${id}/exit-criteria`).passed).toBe(false);
    });
  });

  it("stops at the end of the programme instead of walking off it", () => {
    const id = episodeId();
    const order = body(`/injuries/${id}/protocol`)
      .phases.sort((a: any, b: any) => a.order_index - b.order_index)
      .map((p: any) => p.phase_key);
    body(`/injuries/${id}/starting-phase`, {
      method: "PUT",
      body: JSON.stringify({ phase_key: order[order.length - 1] }),
    });
    withPassingGate(id, () => {
      const reply = advance(id);
      expect(reply.ok).toBe(false);
      expect(body("/injuries?status_filter=active")[0].current_phase).toBe(
        order[order.length - 1],
      );
    });
  });
});

describe("what needs the laptop", () => {

  it("will not start a new injury episode", () => {
    expect(refusal("/injuries", { method: "POST", body: "{}" }).status).toBe(503);
  });
});

describe("a criterion written on the phone", () => {
  /** What the builder sends: two fields for the metric, the number as `value`. */
  const squatDraft = (value = 20) => ({
    metric: "session.reps",
    exercise_key: "single_leg_squat",
    target_type: "absolute",
    value,
    required: true,
    phase_key: currentPhase(),
  });

  it("joins the gate as never measured, not as a pass", () => {
    const id = episodeId();
    const saved = body(`/injuries/${id}/criteria`, {
      method: "PUT",
      body: JSON.stringify(squatDraft()),
    });
    // The endpoint returns the stored rule, which is a spec -- not a result.
    // Inventing a `status` here would have been describing a reading that does
    // not exist.
    expect(saved.spec.metric).toBe("session.reps.single_leg_squat");
    expect(saved.spec.target.value).toBe(20);

    const gate = body(`/injuries/${id}/exit-criteria`);
    const mine = gate.criteria.find((c: any) => c.key === saved.key);
    expect(mine).toBeDefined();
    expect(mine.status).toBe("no_data");
    expect(mine.observed).toBeNull();
    // The number to beat, and its unit, both have to reach the row -- without
    // them the gate shows a dash and nothing to aim at.
    expect(mine.target).toBe(20);
    expect(mine.unit).toBe("reps");
  });

  it("can be started with the camera, which is the point of writing one", () => {
    /* The Test screen offers a session only for a target whose metric names an
       exercise. The builder sends the metric and the exercise separately and
       the server joins them; nothing did that here, so a target written on the
       phone sat on the gate with no way to start it -- the screen had an Add
       button and nothing else. */
    const id = episodeId();
    const saved = body(`/injuries/${id}/criteria`, {
      method: "PUT",
      body: JSON.stringify(squatDraft()),
    });
    const catalogue = body("/injuries/criteria/authorable");
    const row = body(`/injuries/${id}/exit-criteria`).criteria.find(
      (c: any) => c.key === saved.key,
    );

    const { base, exerciseKey } = splitMetric(row.metric, catalogue);
    expect(exerciseKey).toBe("single_leg_squat");
    expect(base?.key).toBe("session.reps");
    // And the exercise it names has to be one the camera has a rule for.
    const exercise = body("/catalog/exercises").find((e: any) => e.key === exerciseKey);
    expect(exercise?.pose_rule).toBeTruthy();
  });

  it("replaces the same test rather than leaving two of them", () => {
    const id = episodeId();
    const first = body(`/injuries/${id}/criteria`, {
      method: "PUT",
      body: JSON.stringify(squatDraft(20)),
    });
    const second = body(`/injuries/${id}/criteria`, {
      method: "PUT",
      body: JSON.stringify(squatDraft(25)),
    });
    // The key is derived from what is measured, exactly as authoring.build_key
    // does it, so the second save is an edit.
    expect(second.key).toBe(first.key);
    expect(second.key).toBe("custom_session_reps_single_leg_squat");

    const rows = body(`/injuries/${id}/exit-criteria`).criteria.filter(
      (c: any) => c.key === first.key,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].target).toBe(25);
  });

  it("shows the targets the snapshot recorded, not only the new ones", () => {
    /* The demo player has targets of their own already. Serving only what was
       written on the phone left a fresh demo saying "Nothing yet" on a screen
       that had two real ones behind it. */
    const id = episodeId();
    const recorded = (snapshot as any).responses[`/injuries/${id}/criteria`];
    expect(recorded.length).toBeGreaterThan(0);

    const listed = body(`/injuries/${id}/criteria`);
    for (const one of recorded) {
      expect(listed.some((c: any) => c.key === one.key)).toBe(true);
    }
  });

  it("stays in the phase it was written for", () => {
    const id = episodeId();
    const written = body(`/injuries/${id}/criteria`, {
      method: "PUT",
      body: JSON.stringify(squatDraft()),
    });
    const keys = phaseKeysFor(id);
    const elsewhere = keys.find((k) => k !== currentPhase())!;
    body(`/injuries/${id}/starting-phase`, {
      method: "PUT",
      body: JSON.stringify({ phase_key: elsewhere }),
    });
    const gate = body(`/injuries/${id}/exit-criteria`);
    expect(gate.criteria.some((c: any) => c.key === written.key)).toBe(false);
    // Not lost, though -- it is still the player's, filed where they wrote it.
    expect(body(`/injuries/${id}/criteria`).some((c: any) => c.key === written.key)).toBe(
      true,
    );
  });

  it("reads as the sentence the builder showed, not as undefined", () => {
    const id = episodeId();
    // What the builder actually sends: no label. The server computes it, and
    // with no server this used to leave the screen showing the word
    // "undefined" where the player's own target should be.
    const saved = body(`/injuries/${id}/criteria`, {
      method: "PUT",
      body: JSON.stringify({
        metric: "session.hold",
        exercise_key: "wall_sit",
        target_type: "absolute",
        value: 45,
        required: true,
        phase_key: currentPhase(),
      }),
    });
    expect(saved.label_en).toBeTruthy();
    expect(saved.label_en).not.toMatch(/undefined/i);
    // The exercise and the number both have to survive into it.
    expect(saved.label_en).toMatch(/wall sit/i);
    expect(saved.label_en).toContain("45");

    // And it is the same sentence once it is read back on the gate.
    const shown = body(`/injuries/${id}/exit-criteria`).criteria.find(
      (c: any) => c.key === saved.key,
    );
    expect(shown.label_en).toBe(saved.label_en);
  });

  it("can be taken away again", () => {
    const id = episodeId();
    const phase = currentPhase();
    body(`/injuries/${id}/criteria`, {
      method: "PUT",
      body: JSON.stringify({ key: "custom_gone", label_en: "x", phase_key: phase }),
    });
    expect(body(`/injuries/${id}/criteria`).some((c: any) => c.key === "custom_gone")).toBe(
      true,
    );
    body(`/injuries/${id}/criteria/custom_gone?phase_key=${phase}`, { method: "DELETE" });
    expect(body(`/injuries/${id}/criteria`).some((c: any) => c.key === "custom_gone")).toBe(
      false,
    );
  });
});

describe("the mode switch", () => {
  it("is off until it is turned on, and survives a reload", () => {
    standalone.setActive(false);
    expect(standalone.active()).toBe(false);
    standalone.setActive(true);
    expect(standalone.active()).toBe(true);
    standalone.setActive(false);
    expect(standalone.active()).toBe(false);
  });
});
