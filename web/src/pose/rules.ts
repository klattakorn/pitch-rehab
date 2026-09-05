/**
 * The shape of an exercise rule exactly as the backend serialises it.
 *
 * These come down the wire from GET /api/v1/catalog/exercises — they are not
 * duplicated here. That is the point: the thresholds shown live on screen are
 * the same ones the server will later check the set against, so the app can
 * never coach a player toward something the server would reject.
 */
import type { AggregateHow } from "./geometry";

export interface MetricTarget {
  metric: string;
  aggregate: AggregateHow;
  min: number | null;
  max: number | null;
  tolerance: number;
  weight: number;
  /** A critical violation means the rep does not count, not just a lower score. */
  critical: boolean;
  /**
   * Which leg to judge, when the movement is scored on both. `worst` is right
   * almost everywhere. `best` is for movements whose two legs do different
   * jobs -- a split squat bends the front knee twice as far as the rear one by
   * design, so a depth target reading the worse side reads the rear leg.
   */
  judge: "worst" | "best";
  code: string;
  message_en: string;
  message_th: string;
}

export interface RepDetection {
  signal: string;
  enter: number;
  exit: number;
  min_duration_s: number;
  max_duration_s: number;
  min_amplitude: number;
}

export interface EmitMetric {
  metric: string;
  as_key: string;
  rep_aggregate: AggregateHow;
  set_aggregate: "max" | "min" | "mean" | "median";
  unit: string;
}

export interface ExerciseRule {
  mode: "rep" | "hold";
  view: "front" | "side" | "any";
  space: "image" | "world";
  use_z: boolean;
  enforce_view: boolean;
  detection: RepDetection | null;
  targets: MetricTarget[];
  required_landmarks: string[];
  min_visibility: number;
  min_tracking_quality: number;
  smoothing_window: number;
  tempo_min_s: number | null;
  tempo_max_s: number | null;
  hold_target_s: number | null;
  emit: EmitMetric[];
}

export interface Exercise {
  id: number;
  key: string;
  name_en: string;
  name_th: string;
  category: string;
  cue_en: string | null;
  cue_th: string | null;
  equipment: string | null;
  demo_url: string | null;
  pose_rule: ExerciseRule | null;
}

export interface Violation {
  code: string;
  metric: string;
  observed: number;
  limit: number;
  bound: "min" | "max";
  severity: number;
  critical: boolean;
  message_en: string;
  message_th: string;
}

/** How far past a limit counts as completely wrong. Mirrors the Python. */
export function penaltyScale(limit: number, tolerance: number): number {
  const base = limit ? Math.abs(limit) * 0.5 : 1.0;
  return Math.max(base, tolerance, 1e-6);
}

export function evaluateTarget(target: MetricTarget, observed: number): Violation | null {
  if (target.max !== null && observed > target.max + target.tolerance) {
    const over = observed - target.max;
    return {
      code: target.code,
      metric: target.metric,
      observed: Math.round(observed * 1000) / 1000,
      limit: target.max,
      bound: "max",
      severity: Math.min(1, over / penaltyScale(target.max, target.tolerance)),
      critical: target.critical,
      message_en: target.message_en,
      message_th: target.message_th,
    };
  }
  if (target.min !== null && observed < target.min - target.tolerance) {
    const under = target.min - observed;
    return {
      code: target.code,
      metric: target.metric,
      observed: Math.round(observed * 1000) / 1000,
      limit: target.min,
      bound: "min",
      severity: Math.min(1, under / penaltyScale(target.min, target.tolerance)),
      critical: target.critical,
      message_en: target.message_en,
      message_th: target.message_th,
    };
  }
  return null;
}
