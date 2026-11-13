import 'server-only';
import { AppError, transaction, type Db } from './db';
import { fingerprint as requestFingerprint } from './session-mapping';
import { loadSession, loadWorkout } from './session-reader';
import {
  nextPosition,
  sessionSchema,
  validateSets,
  type ExerciseOption,
  type Workout,
  type SessionInput,
} from '../domain';
export { bootstrap, loadSession, loadWorkout } from './session-reader';
function validatedOptions(input: SessionInput, workout: Workout | null) {
  if (input.activity !== 'gym') return [];
  if (!workout || input.templateId !== workout.templateId)
    throw new AppError(409, 'План занятия изменился. Черновик сохранён на устройстве.');
  const plannedPositions = workout.options
    .filter((option) => option.primary)
    .map((option) => option.position);
  const selected: ExerciseOption[] = [];
  for (const exercise of input.exercises) {
    const option = workout.options.find((option) => option.id === exercise.optionId);
    if (!option) throw new AppError(400, 'Упражнения не соответствуют плану.');
    selected.push(option);
  }
  const selectedPositions = new Set(selected.map((option) => option.position));
  const matchesPlan =
    selected.length === plannedPositions.length &&
    selectedPositions.size === plannedPositions.length &&
    plannedPositions.every((position) => selectedPositions.has(position));
  if (!matchesPlan) throw new AppError(400, 'Упражнения не соответствуют плану.');
  for (const [index, option] of selected.entries()) {
    try {
      validateSets(input.exercises[index].sets, option);
    } catch (error) {
      throw new AppError(400, (error as Error).message);
    }
  }
  return selected;
}
async function insertExercises(db: Db, input: SessionInput, selected: ExerciseOption[]) {
  for (let index = 0; index < selected.length; index++) {
    const option = selected[index];
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO session_exercises(session_id,
          exercise_option_id,
          exercise_id,
          position,
          name,
          equipment,
          measurement_type,
          weight_type,
          per_side,
          instructions,
          equipment_note)
        VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id`,
      [
        input.id,
        option.id,
        option.exerciseId,
        option.position,
        option.name,
        option.equipment,
        option.measurement,
        option.weightType,
        option.perSide,
        option.instructions,
        input.exercises[index].equipmentNote ?? null,
      ],
    );
    for (const set of input.exercises[index].sets) {
      const plan =
        set.type === 'working'
          ? option.plan.find((plannedSet) => plannedSet.position === set.position)
          : null;
      await db.query(
        `INSERT INTO session_sets(session_exercise_id,
            set_type,
            position,
            target_reps_min,
            target_reps_max,
            target_duration_seconds,
            weight_kg,
            reps,
            duration_seconds,
            status,
            target_duration_seconds_max)
          VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          rows[0].id,
          set.type,
          set.position,
          plan?.repsMin ?? null,
          plan?.repsMax ?? null,
          plan?.seconds ?? null,
          set.weight,
          set.reps,
          set.seconds,
          set.done ? 'done' : 'unrecorded',
          plan?.secondsMax ?? null,
        ],
      );
    }
  }
}
export async function saveSession(raw: unknown) {
  const input = sessionSchema.parse(raw);
  const fingerprint = requestFingerprint(input);
  return transaction(async (db) => {
    // Serialize identical IDs before checking the queue, including non-gym submissions.
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [input.id]);
    const { rows: existing } = await db.query<{ request_hash: string }>(
      'SELECT request_hash FROM sessions WHERE id=$1',
      [input.id],
    );
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
      const { rows: programs } = await db.query<{
        is_active: boolean;
        status: string;
        revision: number;
        next_position: number;
      }>(
        `SELECT p.*
          FROM programs p
          JOIN workout_templates t ON t.program_id=p.id
          WHERE t.id=$1
          FOR UPDATE OF p`,
        [input.templateId],
      );
      const program = programs[0];
      workout = await loadWorkout(db, input.templateId!);
      if (
        !program?.is_active ||
        program.status !== 'published' ||
        program.revision !== input.programRevision ||
        program.next_position !== workout?.position ||
        workout?.token !== input.planToken
      )
        throw new AppError(
          409,
          'Очередь или программа изменились в другом окне. Черновик сохранён; проверь историю перед повторной отправкой.',
        );
    }
    const selected = validatedOptions(input, workout);
    await db.query(
      `INSERT INTO sessions(id,
          activity_type,
          performed_on,
          workout_template_id,
          wellbeing,
          sleep_hours,
          warmup_minutes,
          main_minutes,
          cardio_minutes,
          fixed_duration_minutes,
          heart_rate_min,
          heart_rate_max,
          exertion,
          notes,
          request_hash,
          provenance,
          pulse_device,
          workout_snapshot)
        VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
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
  const fingerprint = requestFingerprint({ input, revision });
  return transaction(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [input.id]);
    const { rows } = await db.query<{ request_hash: string }>(
      'SELECT request_hash FROM sessions WHERE id=$1 FOR UPDATE',
      [input.id],
    );
    if (!rows.length) throw new AppError(404, 'Занятие не найдено.');
    if (rows[0].request_hash === fingerprint) return loadSession(db, input.id);
    const existingSession = (await loadSession(db, input.id))!;
    if (existingSession.revision !== revision)
      throw new AppError(409, 'Запись уже изменена в другом окне. Твой ввод сохранён в черновике.');
    if (
      input.activity !== existingSession.input.activity ||
      input.templateId !== existingSession.input.templateId ||
      input.exercises.some(
        (exercise) =>
          !existingSession.input.exercises.some(
            (savedExercise) => savedExercise.optionId === exercise.optionId,
          ),
      )
    )
      throw new AppError(
        400,
        'В истории можно исправлять результаты, но не менять вид занятия и упражнения.',
      );
    const selected = validatedOptions(input, existingSession.workout);
    await db.query(
      `UPDATE sessions
        SET performed_on=$2,
          wellbeing=$3,
          sleep_hours=$4,
          warmup_minutes=$5,
          main_minutes=$6,
          cardio_minutes=$7,
          heart_rate_min=$8,
          heart_rate_max=$9,
          exertion=$10,
          notes=$11,
          revision=revision+1,
          updated_at=now(),
          request_hash=$12,
          fixed_duration_minutes=$13,
          provenance=$14,
          pulse_device=$15
        WHERE id=$1`,
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
      `DELETE FROM session_sets
        WHERE session_exercise_id IN (
          SELECT id FROM session_exercises WHERE session_id=$1
        )`,
      [input.id],
    );
    await db.query('DELETE FROM session_exercises WHERE session_id=$1', [input.id]);
    await insertExercises(db, input, selected);
    return loadSession(db, input.id);
  });
}
