import 'server-only';
import { transaction } from './db';
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
  buildTrainingExport,
  exportPeriod,
  exportPlan,
  exportSet,
  type ExportQuery,
  type ExportSession,
  type ExportExercise,
  type ExportExerciseIdentity,
  type Metric,
} from '../training-export';

type SessionRow = {
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
type ExerciseRow = {
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
type SetRow = {
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
function groupBy<T>(rows: T[], key: (row: T) => string) {
  const result = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    result.set(id, [...(result.get(id) ?? []), row]);
  }
  return result;
}
function optionIdentity(o: Workout['options'][number]): ExportExerciseIdentity {
  return {
    position: o.position,
    primary: o.primary,
    optionId: o.id,
    exerciseId: o.exerciseId,
    name: o.name,
    equipment: o.equipment,
    measurement: o.measurement,
    weightType: o.weightType,
    perSide: o.perSide,
    instructions: o.instructions,
    plan: o.plan.map(exportPlan),
  };
}
export async function loadTrainingExport(query: ExportQuery, now = new Date()) {
  return transaction(async (db) => {
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    await db.query("SET LOCAL statement_timeout='60s'");
    const period = exportPeriod(query, now);
    const { rows: sessions } = await db.query<SessionRow>(
      `SELECT s.*,s.performed_on::text AS date,
      t.program_id,t.position AS workout_position,t.name AS workout_name,p.version AS program_version,p.name AS program_name
      FROM sessions s LEFT JOIN workout_templates t ON t.id=s.workout_template_id LEFT JOIN programs p ON p.id=t.program_id
      WHERE ($1::date IS NULL OR s.performed_on >= $1::date) AND ($2::date IS NULL OR s.performed_on <= $2::date)
      ORDER BY s.performed_on,s.created_at,s.id`,
      [period.from, period.to],
    );
    const ids = sessions.map((s) => s.id);
    const { rows: exercises } = await db.query<ExerciseRow>(
      `SELECT e.*,o.id AS primary_option_id,o.exercise_id AS primary_exercise_id
      FROM session_exercises e JOIN sessions s ON s.id=e.session_id
      LEFT JOIN workout_exercise_options o ON o.workout_template_id=s.workout_template_id AND o.position=e.position AND o.is_primary
      WHERE e.session_id=ANY($1::uuid[]) ORDER BY e.session_id,e.position`,
      [ids],
    );
    const { rows: sets } = await db.query<SetRow>(
      `SELECT ss.*,to_jsonb(ss)->>'target_duration_seconds_max' AS seconds_max
      FROM session_sets ss JOIN session_exercises e ON e.id=ss.session_exercise_id
      WHERE e.session_id=ANY($1::uuid[]) ORDER BY e.session_id,e.position,CASE WHEN ss.set_type='warmup' THEN 0 ELSE 1 END,ss.position`,
      [ids],
    );
    const bySession = groupBy(exercises, (e) => e.session_id);
    const byExercise = groupBy(sets, (s) => s.session_exercise_id);
    const records: ExportSession[] = sessions.map((s) => {
      const metric = (
        field: Parameters<typeof fieldSource>[1],
        value: number | string | null,
      ): Metric => ({
        value: numberOrNull(value),
        source: value === null ? 'unknown' : fieldSource(s, field),
      });
      const workout = s.workout_snapshot;
      const actual: ExportExercise[] = (bySession.get(s.id) ?? []).map((e) => {
        const recordedSets = byExercise.get(e.id) ?? [];
        const planFor = (set: SetRow) =>
          exportPlan({
            position: set.position,
            repsMin: set.target_reps_min,
            repsMax: set.target_reps_max,
            seconds: set.target_duration_seconds,
            secondsMax: numberOrNull(set.seconds_max),
          });
        const identity: ExportExerciseIdentity = {
          position: e.position,
          primary:
            e.primary_option_id === null ? null : e.primary_option_id === e.exercise_option_id,
          optionId: e.exercise_option_id,
          exerciseId: e.exercise_id,
          name: e.name,
          equipment: e.equipment,
          measurement: e.measurement_type,
          weightType: e.weight_type,
          perSide: e.per_side,
          instructions: e.instructions,
          plan: recordedSets.filter((p) => p.set_type === 'working').map(planFor),
        };
        const original = workout?.options.find((o) => o.position === e.position && o.primary);
        const primaryId = original?.id ?? e.primary_option_id;
        const isReplacement = primaryId ? primaryId !== e.exercise_option_id : null;
        return {
          ...identity,
          position: e.position,
          equipmentNote: e.equipment_note,
          isReplacement,
          originalExercise: original
            ? optionIdentity(original)
            : isReplacement === false
              ? identity
              : primaryId
                ? {
                    position: e.position,
                    primary: true,
                    optionId: primaryId,
                    exerciseId: e.primary_exercise_id!,
                    name: null,
                    equipment: null,
                    measurement: null,
                    weightType: null,
                    perSide: null,
                    instructions: null,
                    plan: null,
                  }
                : null,
          originalMetadataSource: original
            ? 'saved_snapshot'
            : isReplacement === false
              ? 'selected_snapshot'
              : primaryId
                ? 'legacy_identity_only'
                : 'unknown',
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
      });
      const parts = {
        warmupMinutes: metric('warmup', s.warmup_minutes),
        mainMinutes: metric('main', s.main_minutes),
        cardioMinutes: metric('cardio', s.cardio_minutes),
        activityMinutes: metric('durationMinutes', s.fixed_duration_minutes),
      };
      const used =
        s.activity_type === 'gym'
          ? [parts.warmupMinutes, parts.mainMinutes, parts.cardioMinutes]
          : [parts.activityMinutes];
      const totalMinutes: Metric = {
        value: used.some((v) => v.value === null)
          ? null
          : used.reduce((sum, v) => sum + v.value!, 0),
        source: used.every((v) => v.source === 'device')
          ? 'device'
          : used.every((v) => trustedSource(v.source))
            ? 'user_confirmed'
            : used.some((v) => v.source === 'unknown')
              ? 'unknown'
              : 'default',
      };
      const pulseMin = metric('pulseMin', s.heart_rate_min),
        pulseMax = metric('pulseMax', s.heart_rate_max);
      const pulse = (value: Metric) => ({
        ...value,
        value: trustedSource(value.source) ? value.value : null,
      });
      return {
        id: s.id,
        date: s.date,
        activity: s.activity_type,
        activityName: activityNames[s.activity_type],
        revision: s.revision,
        createdAt: s.created_at.toISOString(),
        updatedAt: s.updated_at.toISOString(),
        program: s.program_id
          ? {
              id: workout?.programId ?? s.program_id,
              version: workout?.programVersion ?? s.program_version,
              name: workout?.programName ?? s.program_name,
              queueRevisionAtSave: workout?.revision ?? null,
              workoutId: workout?.templateId ?? s.workout_template_id!,
              workoutNumber: workout?.position ?? s.workout_position,
              workoutName: workout?.name ?? s.workout_name,
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
          sleepHours: metric('sleep', s.sleep_hours),
          wellbeing: { value: s.wellbeing, scale: [0, 5] },
        },
        after: { exertion: { value: s.exertion, scale: [0, 10] }, note: s.notes },
        pulse: {
          min: pulse(pulseMin),
          max: pulse(pulseMax),
          measurementSource: s.pulse_device,
          unverifiedValuesOmitted: [pulseMin, pulseMax].some(
            (v) => v.value !== null && !trustedSource(v.source),
          ),
        },
        exercises: actual,
      };
    });
    return buildTrainingExport(records, query, now);
  });
}
