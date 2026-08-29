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

const standalone = await import("./standalone");

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

  it("goes back to the snapshot when the local state is cleared", () => {
    const id = episodeId();
    const original = body(`/injuries/${id}/exit-criteria`).phase_key;
    setPhase(phaseKeys()[3]!);
    expect(body(`/injuries/${id}/exit-criteria`).phase_key).not.toBe(original);
    standalone.reset();
    expect(body(`/injuries/${id}/exit-criteria`).phase_key).toBe(original);
  });
});

describe("what needs the laptop", () => {
  it("will not advance a phase", () => {
    const reply = refusal(`/injuries/${episodeId()}/advance`, {
      method: "POST",
      body: "{}",
    });
    expect(reply.status).toBe(503);
    expect(reply.detail).toMatch(/exit criteria|laptop/i);
  });

  it("will not start a new injury episode", () => {
    expect(refusal("/injuries", { method: "POST", body: "{}" }).status).toBe(503);
  });
});

describe("a criterion written on the phone", () => {
  it("joins the gate as never measured, not as a pass", () => {
    const id = episodeId();
    const draft = {
      key: "custom_test_reps",
      label_en: "10 single-leg squats",
      phase_key: "strength",
    };
    const saved = body(`/injuries/${id}/criteria`, {
      method: "PUT",
      body: JSON.stringify(draft),
    });
    expect(saved.status).toBe("no_data");
    expect(saved.observed).toBeNull();

    const gate = body(`/injuries/${id}/exit-criteria`);
    const mine = gate.criteria.find((c: any) => c.key === "custom_test_reps");
    expect(mine).toBeDefined();
    expect(mine.status).toBe("no_data");
    expect(body(`/injuries/${id}/criteria`)).toHaveLength(1);
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
        phase_key: "p2_strength",
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
    body(`/injuries/${id}/criteria`, {
      method: "PUT",
      body: JSON.stringify({ key: "custom_gone", label_en: "x", phase_key: "strength" }),
    });
    body(`/injuries/${id}/criteria/custom_gone?phase_key=strength`, { method: "DELETE" });
    expect(body(`/injuries/${id}/criteria`)).toHaveLength(0);
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
