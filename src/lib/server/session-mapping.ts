import { createHash } from 'node:crypto';
import type { ExerciseOption, PlannedSet, SessionInput, SetResult } from '../domain';

type Numeric = string | number | null;

export type PlannedSetRow = {
  position: number;
  target_reps_min: number | null;
  target_reps_max: number | null;
  target_duration_seconds: number | null;
  target_duration_seconds_max?: number | null;
};
export type SetRow = PlannedSetRow & {
  set_type: SetResult['type'];
  weight_kg: Numeric;
  reps: number | null;
  duration_seconds: number | null;
  status: string;
};
export type TemplateRow = {
  id: string;
  program_id: string;
  program_version: number;
  revision: number;
  workout_count: number;
  repeat_from: number;
  position: number;
  name: string;
  notes: string;
  program_name: string;
};
type ExerciseMetadataRow = {
  exercise_id: string;
  position: number;
  name: string;
  equipment: string;
  measurement_type: ExerciseOption['measurement'];
  weight_type: ExerciseOption['weightType'];
  per_side: boolean;
  instructions: string;
};
export type OptionRow = ExerciseMetadataRow & { id: string; is_primary: boolean; notes: string };
export type SessionExerciseRow = ExerciseMetadataRow & {
  id: string;
  exercise_option_id: string;
  equipment_note: string | null;
};
export type SessionRow = {
  id: string;
  activity_type: SessionInput['activity'];
  date: string;
  revision: number;
  wellbeing: number;
  sleep_hours: Numeric;
  warmup_minutes: number | null;
  main_minutes: number | null;
  cardio_minutes: number | null;
  fixed_duration_minutes: number | null;
  heart_rate_min: number | null;
  heart_rate_max: number | null;
  exertion: number;
  notes: string;
  provenance: SessionInput['provenance'];
  pulse_device: string | null;
  workout_template_id: string | null;
};

// Property order is part of existing plan tokens and retry fingerprints.
export function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export const numberOrNull = (value: Numeric) => (value === null ? null : Number(value));

// Keep PostgreSQL numeric strings out of client calculations.
export function mapSet(row: SetRow): SetResult {
  return {
    position: Number(row.position),
    type: row.set_type,
    weight: numberOrNull(row.weight_kg),
    reps: numberOrNull(row.reps),
    seconds: numberOrNull(row.duration_seconds),
    done: row.status === 'done',
  };
}
export function mapPlan(row: PlannedSetRow): PlannedSet {
  const plan: PlannedSet = {
    position: row.position,
    repsMin: row.target_reps_min,
    repsMax: row.target_reps_max,
    seconds: row.target_duration_seconds,
  };
  if (row.target_duration_seconds_max != null) {
    plan.secondsMax = row.target_duration_seconds_max;
  }
  return plan;
}
