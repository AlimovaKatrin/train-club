import 'server-only';
import { createHash } from 'node:crypto';
import { AppError, pool, transaction, type Db } from './db';
import {
  nextPosition,
  sessionSchema,
  validateSets,
  type ExerciseOption,
  type Workout,
  type SessionInput,
  type SessionRecord,
  type SetResult,
} from '../domain';
function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
const numberOrNull = (n: unknown) => (n === null ? null : Number(n));
// Explicit mapping keeps PostgreSQL numeric strings and calendar dates out of client calculations.
function mapSet(r: Record<string, unknown>): SetResult {
  return {
    position: Number(r.position),
    type: r.set_type as SetResult['type'],
    weight: numberOrNull(r.weight_kg),
    reps: numberOrNull(r.reps),
    seconds: numberOrNull(r.duration_seconds),
    done: r.status === 'done',
  };
}
export async function loadWorkout(db: Db, templateId?: string): Promise<Workout | null> {
  const { rows: templates } = await db.query(
    `SELECT t.*,p.revision,p.version AS program_version,p.workout_count,p.repeat_from,p.name AS program_name FROM workout_templates t JOIN programs p ON p.id=t.program_id WHERE ${templateId ? 't.id=$1' : "p.is_active AND p.status='published' AND t.position=p.next_position"}`,
    templateId ? [templateId] : [],
  );
  const t = templates[0];
  if (!t) return null;
  const { rows } = await db.query(
    `SELECT o.*, e.name,e.equipment,e.measurement_type,e.weight_type,e.per_side,e.instructions FROM workout_exercise_options o JOIN exercises e ON e.id=o.exercise_id WHERE o.workout_template_id=$1 ORDER BY o.position,o.is_primary DESC,o.id`,
    [t.id],
  );
  const options: ExerciseOption[] = [];
  for (const o of rows) {
    const { rows: plans } = await db.query(
      'SELECT * FROM workout_planned_sets WHERE exercise_option_id=$1 ORDER BY position',
      [o.id],
    );
    const { rows: previous } = await db.query(
      `SELECT se.id,s.performed_on::text AS date FROM session_exercises se JOIN sessions s ON s.id=se.session_id WHERE se.exercise_id=$1 ORDER BY s.performed_on DESC,s.created_at DESC LIMIT 1`,
      [o.exercise_id],
    );
    const prior = previous[0];
    options.push({
      id: o.id,
      exerciseId: o.exercise_id,
      position: o.position,
      primary: o.is_primary,
      name: o.name,
      equipment: o.equipment,
      measurement: o.measurement_type,
      weightType: o.weight_type,
      perSide: o.per_side,
      instructions: [o.instructions, o.notes].filter(Boolean).join(' '),
      plan: plans.map((p) => ({
        position: p.position,
        repsMin: p.target_reps_min,
        repsMax: p.target_reps_max,
        seconds: p.target_duration_seconds,
        ...(p.target_duration_seconds_max != null
          ? { secondsMax: p.target_duration_seconds_max }
          : {}),
      })),
      previous: prior
        ? {
            date: prior.date,
            sets: (
              await db.query(
                "SELECT * FROM session_sets WHERE session_exercise_id=$1 AND set_type='working' ORDER BY position",
                [prior.id],
              )
            ).rows.map(mapSet),
          }
        : null,
    });
  }
  const token = hash(options.map(({ previous: _previous, ...option }) => option));
  return {
    templateId: t.id,
    notes: t.notes,
    totalWorkouts: t.workout_count,
    repeatFrom: t.repeat_from,
    programId: t.program_id,
    programVersion: t.program_version,
    revision: t.revision,
    position: t.position,
    name: t.name,
    programName: t.program_name,
    token,
    options,
  };
}
export async function loadSession(db: Db, id: string): Promise<SessionRecord | null> {
  const { rows } = await db.query('SELECT *,performed_on::text AS date FROM sessions WHERE id=$1', [
    id,
  ]);
  const s = rows[0];
  if (!s) return null;
  const { rows: es } = await db.query(
    'SELECT * FROM session_exercises WHERE session_id=$1 ORDER BY position',
    [id],
  );
  const options: ExerciseOption[] = [];
  const exercises: SessionInput['exercises'] = [];
  for (const e of es) {
    const { rows: sets } = await db.query(
      "SELECT * FROM session_sets WHERE session_exercise_id=$1 ORDER BY CASE WHEN set_type='warmup' THEN 0 ELSE 1 END,position",
      [e.id],
    );
    options.push({
      id: e.exercise_option_id,
      exerciseId: e.exercise_id,
      position: e.position,
      primary: true,
      name: e.name,
      equipment: e.equipment,
      measurement: e.measurement_type,
      weightType: e.weight_type,
      perSide: e.per_side,
      instructions: e.instructions,
      previous: null,
      plan: sets
        .filter((p) => p.set_type === 'working')
        .map((p) => ({
          position: p.position,
          repsMin: p.target_reps_min,
          repsMax: p.target_reps_max,
          seconds: p.target_duration_seconds,
          ...(p.target_duration_seconds_max != null
            ? { secondsMax: p.target_duration_seconds_max }
            : {}),
        })),
    });
    exercises.push({
      optionId: e.exercise_option_id,
      equipmentNote: e.equipment_note,
      sets: sets.map(mapSet),
    });
  }
  // Historical exercise metadata and plans come exclusively from snapshots, never the catalog.
  const { rows: ts } = s.workout_template_id
    ? await db.query(
        'SELECT t.*,p.version AS program_version,p.workout_count,p.repeat_from,p.name AS program_name FROM workout_templates t JOIN programs p ON p.id=t.program_id WHERE t.id=$1',
        [s.workout_template_id],
      )
    : { rows: [] };
  const t = ts[0];
  const workout: Workout | null = t
    ? {
        templateId: t.id,
        totalWorkouts: t.workout_count,
        repeatFrom: t.repeat_from,
        programId: t.program_id,
        programVersion: t.program_version,
        revision: 0,
        position: t.position,
        name: t.name,
        programName: t.program_name,
        token: 'history',
        options,
      }
    : null;
  return {
    revision: s.revision,
    workout,
    input: {
      id: s.id,
      activity: s.activity_type,
      date: s.date,
      wellbeing: s.wellbeing,
      sleep: numberOrNull(s.sleep_hours),
      warmup: s.warmup_minutes,
      main: s.main_minutes,
      cardio: s.cardio_minutes,
      durationMinutes: s.fixed_duration_minutes,
      pulseMin: s.heart_rate_min,
      pulseMax: s.heart_rate_max,
      exertion: s.exertion,
      notes: s.notes,
      provenance: s.provenance,
      pulseDevice: s.pulse_device,
      templateId: s.workout_template_id,
      programRevision: t ? 0 : null,
      planToken: t ? 'history' : null,
      exercises,
    },
  };
}
export async function bootstrap() {
  return transaction(async (db) => {
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    const workout = await loadWorkout(db);
    const { rows } = await db.query(
      'SELECT id FROM sessions ORDER BY performed_on DESC,created_at DESC LIMIT 100',
    );
    const history: SessionRecord[] = [];
    for (const row of rows) history.push((await loadSession(db, row.id))!);
    return { workout, history };
  });
}
function validatedOptions(input: SessionInput, workout: Workout | null) {
  if (input.activity !== 'gym') return [];
  if (!workout || input.templateId !== workout.templateId)
    throw new AppError(409, 'План занятия изменился. Черновик сохранён на устройстве.');
  const slots = workout.options.filter((o) => o.primary).map((o) => o.position);
  const selected = input.exercises.map((e) => workout.options.find((o) => o.id === e.optionId));
  if (
    selected.length !== slots.length ||
    selected.some((o) => !o) ||
    new Set(selected.map((o) => o!.position)).size !== slots.length ||
    slots.some((p) => !selected.some((o) => o!.position === p))
  )
    throw new AppError(400, 'Упражнения не соответствуют плану.');
  selected.forEach((o, i) => {
    try {
      validateSets(input.exercises[i].sets, o!);
    } catch (error) {
      throw new AppError(400, (error as Error).message);
    }
  });
  return selected as ExerciseOption[];
}
async function insertExercises(db: Db, input: SessionInput, selected: ExerciseOption[]) {
  for (let i = 0; i < selected.length; i++) {
    const o = selected[i];
    const { rows } = await db.query(
      `INSERT INTO session_exercises(session_id,exercise_option_id,exercise_id,position,name,equipment,measurement_type,weight_type,per_side,instructions,equipment_note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [
        input.id,
        o.id,
        o.exerciseId,
        o.position,
        o.name,
        o.equipment,
        o.measurement,
        o.weightType,
        o.perSide,
        o.instructions,
        input.exercises[i].equipmentNote ?? null,
      ],
    );
    for (const s of input.exercises[i].sets) {
      const plan = s.type === 'working' ? o.plan.find((p) => p.position === s.position) : null;
      await db.query(
        `INSERT INTO session_sets(session_exercise_id,set_type,position,target_reps_min,target_reps_max,target_duration_seconds,weight_kg,reps,duration_seconds,status,target_duration_seconds_max) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          rows[0].id,
          s.type,
          s.position,
          plan?.repsMin ?? null,
          plan?.repsMax ?? null,
          plan?.seconds ?? null,
          s.weight,
          s.reps,
          s.seconds,
          s.done ? 'done' : 'unrecorded',
          plan?.secondsMax ?? null,
        ],
      );
    }
  }
}
export async function saveSession(raw: unknown) {
  const input = sessionSchema.parse(raw);
  const fingerprint = hash(input);
  return transaction(async (db) => {
    // Serialize identical IDs before checking the queue, including non-gym submissions.
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [input.id]);
    const { rows: existing } = await db.query('SELECT request_hash FROM sessions WHERE id=$1', [
      input.id,
    ]);
    if (existing.length) {
      if (existing[0].request_hash !== fingerprint)
        throw new AppError(
          409,
          'Это занятие уже сохранено с другими данными. Открой историю для исправления; локальный ввод сохранён.',
        );
      return loadSession(db, input.id);
    }
    let workout: Workout | null = null;
    if (input.activity === 'gym') {
      const { rows: programs } = await db.query(
        `SELECT p.* FROM programs p JOIN workout_templates t ON t.program_id=p.id WHERE t.id=$1 FOR UPDATE OF p`,
        [input.templateId],
      );
      const p = programs[0];
      workout = await loadWorkout(db, input.templateId!);
      if (
        !p?.is_active ||
        p.status !== 'published' ||
        p.revision !== input.programRevision ||
        p.next_position !== workout?.position ||
        workout?.token !== input.planToken
      )
        throw new AppError(
          409,
          'Очередь или программа изменились в другом окне. Черновик сохранён; проверь историю перед повторной отправкой.',
        );
    }
    const selected = validatedOptions(input, workout);
    await db.query(
      `INSERT INTO sessions(id,activity_type,performed_on,workout_template_id,wellbeing,sleep_hours,warmup_minutes,main_minutes,cardio_minutes,fixed_duration_minutes,heart_rate_min,heart_rate_max,exertion,notes,request_hash,provenance,pulse_device,workout_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        input.id,
        input.activity,
        input.date,
        input.templateId,
        input.wellbeing,
        input.sleep,
        input.warmup,
        input.main,
        input.cardio,
        input.durationMinutes,
        input.pulseMin,
        input.pulseMax,
        input.exertion,
        input.notes,
        fingerprint,
        JSON.stringify(input.provenance ?? {}),
        input.pulseDevice ?? null,
        workout
          ? JSON.stringify({
              ...workout,
              token: undefined,
              options: workout.options.map(({ previous: _previous, ...option }) => option),
            })
          : null,
      ],
    );
    await insertExercises(db, input, selected);
    if (workout)
      await db.query('UPDATE programs SET next_position=$1,revision=revision+1 WHERE id=$2', [
        nextPosition(workout.position, workout.totalWorkouts, workout.repeatFrom),
        workout.programId,
      ]);
    return loadSession(db, input.id);
  });
}
export async function editSession(raw: unknown, revision: number) {
  const input = sessionSchema.parse(raw);
  const fingerprint = hash({ input, revision });
  return transaction(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [input.id]);
    const { rows } = await db.query('SELECT request_hash FROM sessions WHERE id=$1 FOR UPDATE', [
      input.id,
    ]);
    if (!rows.length) throw new AppError(404, 'Занятие не найдено.');
    if (rows[0].request_hash === fingerprint) return loadSession(db, input.id);
    const old = (await loadSession(db, input.id))!;
    if (old.revision !== revision)
      throw new AppError(409, 'Запись уже изменена в другом окне. Твой ввод сохранён в черновике.');
    if (
      input.activity !== old.input.activity ||
      input.templateId !== old.input.templateId ||
      input.exercises.some((e) => !old.input.exercises.some((o) => o.optionId === e.optionId))
    )
      throw new AppError(
        400,
        'В истории можно исправлять результаты, но не менять вид занятия и упражнения.',
      );
    const selected = validatedOptions(input, old.workout);
    await db.query(
      `UPDATE sessions SET performed_on=$2,wellbeing=$3,sleep_hours=$4,warmup_minutes=$5,main_minutes=$6,cardio_minutes=$7,heart_rate_min=$8,heart_rate_max=$9,exertion=$10,notes=$11,revision=revision+1,updated_at=now(),request_hash=$12,fixed_duration_minutes=$13,provenance=$14,pulse_device=$15 WHERE id=$1`,
      [
        input.id,
        input.date,
        input.wellbeing,
        input.sleep,
        input.warmup,
        input.main,
        input.cardio,
        input.pulseMin,
        input.pulseMax,
        input.exertion,
        input.notes,
        fingerprint,
        input.durationMinutes,
        JSON.stringify(input.provenance ?? {}),
        input.pulseDevice ?? null,
      ],
    );
    await db.query(
      'DELETE FROM session_sets WHERE session_exercise_id IN (SELECT id FROM session_exercises WHERE session_id=$1)',
      [input.id],
    );
    await db.query('DELETE FROM session_exercises WHERE session_id=$1', [input.id]);
    await insertExercises(db, input, selected);
    return loadSession(db, input.id);
  });
}
