/**
 * The phone's model choice: full unless this phone measurably cannot keep up.
 * A wrong "slow" costs accuracy for nothing; a wrong "ok" costs missed reps.
 */
import { describe, expect, it } from "vitest";

import {
  ModelSpeed,
  SLOW_FRAME_MS,
  SPEED_SAMPLE_FRAMES,
  SPEED_WARMUP_FRAMES,
  preferredModel,
} from "./mediapipe";

const run = (times: number[]) => {
  const speed = new ModelSpeed();
  return times.map((ms) => speed.push(ms));
};

describe("choosing the pose model", () => {
  it("starts every device on the model everything was tuned on", () => {
    expect(preferredModel()).toBe("full");
  });

  it("ignores the slow first frames while the GPU warms up", () => {
    const verdicts = run([
      ...Array(SPEED_WARMUP_FRAMES).fill(400),
      ...Array(SPEED_SAMPLE_FRAMES).fill(25),
    ]);
    expect(verdicts.at(-1)).toBe("ok");
  });

  it("calls a phone slow only once it has seen enough frames", () => {
    const verdicts = run(Array(SPEED_WARMUP_FRAMES + SPEED_SAMPLE_FRAMES).fill(90));
    expect(verdicts.slice(0, -1).every((v) => v === "measuring")).toBe(true);
    expect(verdicts.at(-1)).toBe("slow");
  });

  it("is not tipped over by a few hiccups", () => {
    const sample = Array(SPEED_SAMPLE_FRAMES).fill(30);
    for (let i = 0; i < 8; i++) sample[i * 3] = 500; // a notification, a GC pause
    expect(run([...Array(SPEED_WARMUP_FRAMES).fill(30), ...sample]).at(-1)).toBe("ok");
  });

  it("draws the line at about 18 frames a second", () => {
    const at = (ms: number) =>
      run(Array(SPEED_WARMUP_FRAMES + SPEED_SAMPLE_FRAMES).fill(ms)).at(-1);
    expect(at(SLOW_FRAME_MS)).toBe("ok");
    expect(at(SLOW_FRAME_MS + 5)).toBe("slow");
  });
});
