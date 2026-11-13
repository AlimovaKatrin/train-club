import 'server-only';
import { transaction, type Db } from './db';
import {
  fingerprint,
  mapSet,
  mapPlan,
  numberOrNull,
  type TemplateRow,
  type OptionRow,
  type PlannedSetRow,
  type SetRow,
  type SessionRow,
  type SessionExerciseRow,
} from './session-mapping';
import type { ExerciseOption, Workout, SessionInput, SessionRecord } from '../domain';
export async function loadWorkout(db: Db, templateId?: string): Promise<Workout | null> {
  const { rows: templates } = await db.query<TemplateRow>(
    `SELECT t.*,
  p.revision,
  p.version AS program_version,
  p.workout_count,
  p.repeat_from,
  p.name AS program_name
FROM workout_templates t
JOIN programs p ON p.id=t.program_id
WHERE ${templateId ? 't.id=$1' : "p.is_active AND p.status='published' AND t.position=p.next_position"}`,
    templateId ? [templateId] : [],
  );
  const template = templates[0];
  if (!template) return null;
  const { rows } = await db.query<OptionRow>(
    `SELECT o.*, e.name, e.equipment, e.measurement_type, e.weight_type, e.per_side, e.instructions
FROM workout_exercise_options o
JOIN exercises e ON e.id=o.exercise_id
WHERE o.workout_template_id=$1
ORDER BY o.position, o.is_primary DESC, o.id`,
    [template.id],
  );
  const options: ExerciseOption[] = [];
  for (const option of rows) {
    const { rows: plans } = await db.query<PlannedSetRow>(
      'SELECT * FROM workout_planned_sets WHERE exercise_option_id=$1 ORDER BY position',
      [option.id],
    );
    const { rows: previous } = await db.query<{
      id: string;
      date: string;
    }>(
      `SELECT se.id, s.performed_on::text AS date
FROM session_exercises se
JOIN sessions s ON s.id=se.session_id
WHERE se.exercise_id=$1
ORDER BY s.performed_on DESC, s.created_at DESC
LIMIT 1`,
      [option.exercise_id],
    );
    const prior = previous[0];
    options.push({
      id: option.id,
      exerciseId: option.exercise_id,
      position: option.position,
      primary: option.is_primary,
      name: option.name,
      equipment: option.equipment,
      measurement: option.measurement_type,
      weightType: option.weight_type,
      perSide: option.per_side,
      instructions: [option.instructions, option.notes].filter(Boolean).join(' '),
      plan: plans.map(mapPlan),
      previous: prior
        ? {
            date: prior.date,
            sets: (
              await db.query<SetRow>(
                "SELECT * FROM session_sets WHERE session_exercise_id=$1 AND set_type='working' ORDER BY position",
                [prior.id],
              )
            ).rows.map(mapSet),
          }
        : null,
    });
  }
  const token = fingerprint(options.map(({ previous: _previous, ...option }) => option));
  return {
    templateId: template.id,
    notes: template.notes,
    totalWorkouts: template.workout_count,
    repeatFrom: template.repeat_from,
    programId: template.program_id,
    programVersion: template.program_version,
    revision: template.revision,
    position: template.position,
    name: template.name,
    programName: template.program_name,
    token,
    options,
  };
}
export async function loadSession(db: Db, id: string): Promise<SessionRecord | null> {
  const { rows } = await db.query<SessionRow>(
    'SELECT *,performed_on::text AS date FROM sessions WHERE id=$1',
    [id],
  );
  const session = rows[0];
  if (!session) return null;
  const { rows: exerciseRows } = await db.query<SessionExerciseRow>(
    'SELECT * FROM session_exercises WHERE session_id=$1 ORDER BY position',
    [id],
  );
  const options: ExerciseOption[] = [];
  const exercises: SessionInput['exercises'] = [];
  for (const recordedExercise of exerciseRows) {
    const { rows: sets } = await db.query<SetRow>(
      `SELECT *
FROM session_sets
WHERE session_exercise_id=$1
ORDER BY CASE WHEN set_type='warmup' THEN 0 ELSE 1 END, position`,
      [recordedExercise.id],
    );
    options.push({
      id: recordedExercise.exercise_option_id,
      exerciseId: recordedExercise.exercise_id,
      position: recordedExercise.position,
      primary: true,
      name: recordedExercise.name,
      equipment: recordedExercise.equipment,
      measurement: recordedExercise.measurement_type,
      weightType: recordedExercise.weight_type,
      perSide: recordedExercise.per_side,
      instructions: recordedExercise.instructions,
      previous: null,
      plan: sets.filter((set) => set.set_type === 'working').map(mapPlan),
    });
    exercises.push({
      optionId: recordedExercise.exercise_option_id,
      equipmentNote: recordedExercise.equipment_note,
      sets: sets.map(mapSet),
    });
  }
  // Historical exercise metadata and plans come exclusively from snapshots, never the catalog.
  const { rows: templateRows } = session.workout_template_id
    ? await db.query<TemplateRow>(
        `SELECT t.*, p.version AS program_version, p.workout_count, p.repeat_from, p.name AS program_name
FROM workout_templates t
JOIN programs p ON p.id=t.program_id
WHERE t.id=$1`,
        [session.workout_template_id],
      )
    : {
        rows: [],
      };
  const template = templateRows[0];
  const workout: Workout | null = template
    ? {
        templateId: template.id,
        totalWorkouts: template.workout_count,
        repeatFrom: template.repeat_from,
        programId: template.program_id,
        programVersion: template.program_version,
        revision: 0,
        position: template.position,
        name: template.name,
        programName: template.program_name,
        token: 'history',
        options,
      }
    : null;
  return {
    revision: session.revision,
    workout,
    input: {
      id: session.id,
      activity: session.activity_type,
      date: session.date,
      wellbeing: session.wellbeing,
      sleep: numberOrNull(session.sleep_hours),
      warmup: session.warmup_minutes,
      main: session.main_minutes,
      cardio: session.cardio_minutes,
      durationMinutes: session.fixed_duration_minutes,
      pulseMin: session.heart_rate_min,
      pulseMax: session.heart_rate_max,
      exertion: session.exertion,
      notes: session.notes,
      provenance: session.provenance,
      pulseDevice: session.pulse_device,
      templateId: session.workout_template_id,
      programRevision: template ? 0 : null,
      planToken: template ? 'history' : null,
      exercises,
    },
  };
}
export async function bootstrap() {
  return transaction(async (db) => {
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    const workout = await loadWorkout(db);
    const { rows } = await db.query<{
      id: string;
    }>('SELECT id FROM sessions ORDER BY performed_on DESC,created_at DESC LIMIT 100');
    const history: SessionRecord[] = [];
    for (const row of rows) history.push((await loadSession(db, row.id))!);
    return {
      workout,
      history,
    };
  });
}
