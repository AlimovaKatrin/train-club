import {
  activityNames,
  fieldSource,
  trustedSource,
  type Activity,
  type SessionInput,
  type SetResult,
  type Workout,
} from '../domain';
import {
  exportPlan,
  exportSet,
  type ExportSession,
  type ExportExercise,
  type ExportExerciseIdentity,
  type Metric,
} from '../training-export';

export type SessionRow = {
  id: string;
  date: string;
  activity_type: Activity;
  revision: number;
  created_at: Date;
  updated_at: Date;
  provenance: SessionInput['provenance'];
  pulse_device: string | null;
  workout_snapshot: Workout | null;
  sleep_hours: string | number | null;
  wellbeing: number;
  exertion: number;
  notes: string;
  warmup_minutes: number | null;
  main_minutes: number | null;
  cardio_minutes: number | null;
  fixed_duration_minutes: number | null;
  heart_rate_min: number | null;
  heart_rate_max: number | null;
  workout_template_id: string | null;
  program_id: string | null;
  program_version: number | null;
  program_name: string;
  workout_position: number;
  workout_name: string;
};
export type ExerciseRow = {
  id: string;
  session_id: string;
  exercise_option_id: string;
  exercise_id: string;
  position: number;
  name: string;
  equipment: string;
  equipment_note: string | null;
  measurement_type: 'reps' | 'time';
  weight_type: ExportExercise['weightType'];
  per_side: boolean;
  instructions: string;
  primary_option_id: string | null;
  primary_exercise_id: string | null;
};
export type SetRow = {
  session_exercise_id: string;
  position: number;
  set_type: 'working' | 'warmup';
  weight_kg: string | number | null;
  reps: number | null;
  duration_seconds: number | null;
  status: string;
  target_reps_min: number | null;
  target_reps_max: number | null;
  target_duration_seconds: number | null;
  seconds_max: string | null;
};
const numberOrNull = (value: number | string | null) => (value === null ? null : Number(value));
function optionIdentity(option: Workout['options'][number]): ExportExerciseIdentity {
  return {
    position: option.position,
    primary: option.primary,
    optionId: option.id,
    exerciseId: option.exerciseId,
    name: option.name,
    equipment: option.equipment,
    measurement: option.measurement,
    weightType: option.weightType,
    perSide: option.perSide,
    instructions: option.instructions,
    plan: option.plan.map(exportPlan),
  };
}
function planFor(set: SetRow) {
  return exportPlan({
    position: set.position,
    repsMin: set.target_reps_min,
    repsMax: set.target_reps_max,
    seconds: set.target_duration_seconds,
    secondsMax: numberOrNull(set.seconds_max),
  });
}

function durationSource(parts: Metric[]): Metric['source'] {
  if (parts.every((part) => part.source === 'device')) return 'device';
  if (parts.every((part) => trustedSource(part.source))) return 'user_confirmed';
  if (parts.some((part) => part.source === 'unknown')) return 'unknown';
  return 'default';
}

export function mapExportExercise(
  exercise: ExerciseRow,
  recordedSets: SetRow[],
  workout: Workout | null,
): ExportExercise {
  const identity: ExportExerciseIdentity = {
    position: exercise.position,
    primary:
      exercise.primary_option_id === null
        ? null
        : exercise.primary_option_id === exercise.exercise_option_id,
    optionId: exercise.exercise_option_id,
    exerciseId: exercise.exercise_id,
    name: exercise.name,
    equipment: exercise.equipment,
    measurement: exercise.measurement_type,
    weightType: exercise.weight_type,
    perSide: exercise.per_side,
    instructions: exercise.instructions,
    plan: recordedSets.filter((p) => p.set_type === 'working').map(planFor),
  };
  const original = workout?.options.find(
    (option) => option.position === exercise.position && option.primary,
  );
  const primaryId = original?.id ?? exercise.primary_option_id;
  const isReplacement = primaryId ? primaryId !== exercise.exercise_option_id : null;
  let originalExercise: ExportExerciseIdentity | null = null;
  let originalMetadataSource: ExportExercise['originalMetadataSource'] = 'unknown';
  if (original) {
    originalExercise = optionIdentity(original);
    originalMetadataSource = 'saved_snapshot';
  } else if (isReplacement === false) {
    originalExercise = identity;
    originalMetadataSource = 'selected_snapshot';
  } else if (primaryId) {
    originalExercise = {
      position: exercise.position,
      primary: true,
      optionId: primaryId,
      exerciseId: exercise.primary_exercise_id!,
      name: null,
      equipment: null,
      measurement: null,
      weightType: null,
      perSide: null,
      instructions: null,
      plan: null,
    };
    originalMetadataSource = 'legacy_identity_only';
  }
  return {
    ...identity,
    position: exercise.position,
    equipmentNote: exercise.equipment_note,
    isReplacement,
    originalExercise,
    originalMetadataSource,
    sets: recordedSets.map((row) => {
      const set: SetResult = {
        position: row.position,
        type: row.set_type,
        weight: numberOrNull(row.weight_kg),
        reps: row.reps,
        seconds: row.duration_seconds,
        done: row.status === 'done',
      };
      return exportSet(set, row.set_type === 'working' ? planFor(row) : null);
    }),
  };
}

export function mapExportSession(session: SessionRow, actual: ExportExercise[]): ExportSession {
  const metric = (
    field: Parameters<typeof fieldSource>[1],
    value: number | string | null,
  ): Metric => ({
    value: numberOrNull(value),
    source: value === null ? 'unknown' : fieldSource(session, field),
  });
  const workout = session.workout_snapshot;
  const parts = {
    warmupMinutes: metric('warmup', session.warmup_minutes),
    mainMinutes: metric('main', session.main_minutes),
    cardioMinutes: metric('cardio', session.cardio_minutes),
    activityMinutes: metric('durationMinutes', session.fixed_duration_minutes),
  };
  const used =
    session.activity_type === 'gym'
      ? [parts.warmupMinutes, parts.mainMinutes, parts.cardioMinutes]
      : [parts.activityMinutes];
  const totalMinutes: Metric = {
    value: used.some((metricPart) => metricPart.value === null)
      ? null
      : used.reduce((sum, metricPart) => sum + metricPart.value!, 0),
    source: durationSource(used),
  };
  const pulseMin = metric('pulseMin', session.heart_rate_min);
  const pulseMax = metric('pulseMax', session.heart_rate_max);
  const pulse = (value: Metric) => ({
    ...value,
    value: trustedSource(value.source) ? value.value : null,
  });
  return {
    id: session.id,
    date: session.date,
    activity: session.activity_type,
    activityName: activityNames[session.activity_type],
    revision: session.revision,
    createdAt: session.created_at.toISOString(),
    updatedAt: session.updated_at.toISOString(),
    program: session.program_id
      ? {
          id: workout?.programId ?? session.program_id,
          version: workout?.programVersion ?? session.program_version,
          name: workout?.programName ?? session.program_name,
          queueRevisionAtSave: workout?.revision ?? null,
          workoutId: workout?.templateId ?? session.workout_template_id!,
          workoutNumber: workout?.position ?? session.workout_position,
          workoutName: workout?.name ?? session.workout_name,
          metadataSource: workout ? 'saved_snapshot' : 'immutable_catalog',
          savedPlan: {
            source: workout ? 'saved_snapshot' : 'legacy_selected_snapshots',
            options: workout
              ? workout.options.map(optionIdentity)
              : actual.map(
                  ({
                    position,
                    primary,
                    optionId,
                    exerciseId,
                    name,
                    equipment,
                    measurement,
                    weightType,
                    perSide,
                    instructions,
                    plan,
                  }) => ({
                    position,
                    primary,
                    optionId,
                    exerciseId,
                    name,
                    equipment,
                    measurement,
                    weightType,
                    perSide,
                    instructions,
                    plan,
                  }),
                ),
          },
        }
      : null,
    duration: { totalMinutes, ...parts },
    before: {
      sleepHours: metric('sleep', session.sleep_hours),
      wellbeing: { value: session.wellbeing, scale: [0, 5] },
    },
    after: { exertion: { value: session.exertion, scale: [0, 10] }, note: session.notes },
    pulse: {
      min: pulse(pulseMin),
      max: pulse(pulseMax),
      measurementSource: session.pulse_device,
      unverifiedValuesOmitted: [pulseMin, pulseMax].some(
        (metricPart) => metricPart.value !== null && !trustedSource(metricPart.source),
      ),
    },
    exercises: actual,
  };
}
