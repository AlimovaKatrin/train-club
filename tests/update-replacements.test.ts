import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { seedProduction } from '../scripts/seed-production.mjs';
import { seedNextCycle } from '../scripts/seed-next-cycle.mjs';
import { updateReplacements } from '../scripts/update-replacements.mjs';
import { updateWorkouts } from '../scripts/update-workouts.mjs';
import { bootstrap, loadWorkout, saveSession, editSession } from '../src/lib/server/repository';
import { pool } from '../src/lib/server/db';
import { newDraft, formatPlan, type Workout } from '../src/lib/domain';
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('replace alternatives across workouts 1–16', () => {
  let admin: pg.Client;
  const run = (apply = false) => updateReplacements({ connectionString: url!, apply });
  const tables = [
    'programs',
    'exercises',
    'workout_templates',
    'workout_exercise_options',
    'workout_planned_sets',
    'sessions',
    'session_exercises',
    'session_sets',
  ];
  async function snapshot() {
    const s: Record<string, unknown[]> = {};
    for (const t of tables) s[t] = (await admin.query(`SELECT * FROM ${t} ORDER BY id`)).rows;
    return s;
  }
  async function workoutList(id: string) {
    const result: Workout[] = [];
    for (const t of (
      await admin.query('SELECT id FROM workout_templates WHERE program_id=$1 ORDER BY position', [
        id,
      ])
    ).rows)
      result.push((await loadWorkout(admin, t.id))!);
    return result;
  }
  const shape = (w: Workout) => ({
    position: w.position,
    name: w.name,
    notes: w.notes,
    options: w.options
      .map(({ id: _id, previous: _previous, ...o }) => o)
      .sort(
        (a, b) =>
          a.position - b.position ||
          Number(b.primary) - Number(a.primary) ||
          a.exerciseId.localeCompare(b.exerciseId),
      ),
  });
  async function completedGymSession() {
    const workout = (await bootstrap()).workout!;
    const { input } = newDraft('gym', '2026-11-12', workout);
    return {
      ...input,
      wellbeing: 3,
      exertion: 5,
      main: 45,
      exercises: input.exercises.map((exercise) => {
        const option = workout.options.find((option) => option.id === exercise.optionId)!;
        return {
          ...exercise,
          sets: exercise.sets.map((set) => ({
            ...set,
            done: true,
            reps: option.measurement === 'reps' ? 12 : null,
            seconds: option.measurement === 'time' ? 25 : null,
            weight: option.weightType === 'none' ? null : 10,
          })),
        };
      }),
    };
  }
  beforeAll(async () => {
    if (!new URL(url!).pathname.endsWith('_test'))
      throw new Error('Use a disposable _test database');
    process.env.DATABASE_URL = url;
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
  });
  beforeEach(async () => {
    await admin.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await seedProduction({ connectionString: url!, apply: true });
    await seedNextCycle({ connectionString: url!, apply: true });
    await updateWorkouts({ connectionString: url!, apply: true });
    await saveSession(await completedGymSession());
    await saveSession(await completedGymSession());
    await saveSession(await completedGymSession());
    const pilates = newDraft('pilates', '2026-11-14', null).input;
    await saveSession({ ...pilates, durationMinutes: 30, wellbeing: 3, exertion: 5 });
  });
  afterAll(async () => {
    await admin?.end();
    await pool().end();
  });
  it('previews without writes, preserves every primary and history, then stays idempotent', async () => {
    const stale = await completedGymSession();
    const source = (await bootstrap()).workout!;
    const original = await workoutList(source.programId);
    const before = await snapshot();
    expect(await run()).toMatchObject({
      action: 'update',
      nextPosition: 4,
      totalWorkouts: 16,
      repeatFrom: 9,
      changedWorkouts: Array.from({ length: 16 }, (_, i) => i + 1),
      primarySlots: 94,
      historyCounts: { sessions: 4 },
    });
    expect(await snapshot()).toEqual(before);
    await run(true);
    const current = (await bootstrap()).workout!;
    expect(current).toMatchObject({ position: 4, totalWorkouts: 16, repeatFrom: 9 });
    const updated = await workoutList(current.programId);
    const primaries = (workout: Workout) =>
      shape({ ...workout, options: workout.options.filter((option) => option.primary) });
    expect(updated.map(primaries)).toEqual(original.map(primaries));
    expect((await workoutList(source.programId)).map(shape)).toEqual(original.map(shape));
    const after = await snapshot();
    for (const table of ['sessions', 'session_exercises', 'session_sets'])
      expect(after[table]).toEqual(before[table]);
    for (const exercise of before.exercises) expect(after.exercises).toContainEqual(exercise);
    await expect(saveSession(stale)).rejects.toThrow('Очередь или программа');
    const stable = await snapshot();
    expect(await run(true)).toMatchObject({ action: 'already_updated', nextPosition: 4 });
    expect(await snapshot()).toEqual(stable);
    expect(await run()).toMatchObject({ action: 'already_updated' });
    expect(await snapshot()).toEqual(stable);
    const old = (await bootstrap()).history.find((session) => session.input.activity === 'gym')!;
    await editSession({ ...old.input, notes: 'Correction after replacement update' }, old.revision);
    expect((await bootstrap()).workout!.position).toBe(4);
  });

  it('loads exactly the requested replacements and independent ranges in all 94 slots', async () => {
    const rules: Record<string, [string, string][]> = {
      'Гакк-присед': [
        ['Жим ногами', '10–12'],
        ['Гоблет-присед', '10–12'],
      ],
      'Жим ногами': [
        ['Гакк-присед', '10–12'],
        ['Гоблет-присед', '10–12'],
      ],
      'Гоблет-присед': [
        ['Гакк-присед', '10–12'],
        ['Жим ногами', '10–12'],
      ],
      'Сплит-присед с опорой и одной гантелью': [
        ['Сплит-присед с опорой без веса', '8–10'],
        ['Выпады назад с гантелями', '8–10'],
      ],
      'Румынская тяга с гантелями': [['Румынская тяга со штангой', '8–10']],
      'Ягодичный мостик с гантелью': [
        ['Ягодичный мост со штангой на полу', '12–15'],
        ['Хип-траст в тренажёре', '10–15'],
      ],
      'Сгибание ног сидя': [['Сгибание ног лёжа', '12–15']],
      'Подъём на носки стоя в тренажёре': [['Подъём на носки стоя с гантелью у опоры', '12–20']],
      'Жим штанги лёжа': [
        ['Жим гантелей на горизонтальной скамье', '8–12'],
        ['Горизонтальный жим в тренажёре для груди', '8–12'],
      ],
      'Жим гантелей на горизонтальной скамье': [
        ['Жим штанги лёжа', '8–10'],
        ['Горизонтальный жим в тренажёре для груди', '8–12'],
      ],
      'Жим гантелей на наклонной скамье': [['Наклонный жим в тренажёре для груди', '8–12']],
      'Тяга горизонтального блока': [
        ['Тяга гантелей с опорой грудью на наклонную скамью', '10–12'],
        ['Горизонтальная тяга в тренажёре с упором грудью', '10–12'],
      ],
      'Тяга гантелей с опорой грудью на наклонную скамью': [
        ['Тяга горизонтального блока', '10–12'],
        ['Горизонтальная тяга в тренажёре с упором грудью', '10–12'],
      ],
      'Тяга гантели одной рукой с опорой': [
        ['Тяга нижнего блока одной рукой', '10–12'],
        ['Тяга горизонтального блока', '10–12'],
      ],
      'Тяга верхнего блока к груди': [['Вертикальная тяга в рычажном тренажёре', '10–12']],
      'Жим гантелей вверх сидя': [['Жим вверх в тренажёре для плеч', '8–12']],
      'Разведение гантелей в стороны': [
        ['Отведение руки в сторону на нижнем блоке', '12–15'],
        ['Разведение рук в стороны в тренажёре', '12–15'],
      ],
      'Тяга каната к лицу — face pull': [['Обратная «бабочка» в тренажёре', '12–15']],
      'Сгибание рук с гантелями': [
        ['Сгибание рук на блоке', '10–15'],
        ['Сгибание рук с EZ-грифом', '10–15'],
      ],
      'Сгибание рук на блоке': [
        ['Сгибание рук с гантелями', '10–15'],
        ['Сгибание рук с EZ-грифом', '10–15'],
      ],
      'Сгибание рук «молотком»': [['Сгибание рук с канатом на нижнем блоке', '10–12']],
      'Разгибание рук на верхнем блоке': [
        ['Разгибание рук на верхнем блоке с прямой рукоятью', '10–15'],
        ['Разгибание рук на верхнем блоке с V-образной рукоятью', '10–15'],
      ],
      'Мёртвый жук': [['Мёртвый жук с опусканием пятки', '6–10']],
      'Боковая планка с колен': [['Боковая планка на высокой опоре', '20–30']],
      'Жим Палоффа на блоке': [['Жим Палоффа на одном колене', '10–12']],
    };
    await run(true);
    const workouts = await workoutList((await bootstrap()).workout!.programId);
    let slots = 0;
    for (const workout of workouts) {
      for (const primary of workout.options.filter((option) => option.primary)) {
        slots++;
        const alternatives = workout.options.filter(
          (option) => !option.primary && option.position === primary.position,
        );
        const expected = rules[primary.name];
        expect(expected, primary.name).toBeDefined();
        expect(alternatives.map((option) => option.name).sort()).toEqual(
          expected.map(([name]) => name).sort(),
        );
        for (const option of alternatives) {
          const range = expected.find(([name]) => name === option.name)![1];
          const unit = option.measurement === 'time' ? ' сек' : ' повт.';
          expect(option.plan.map(formatPlan)).toEqual([range + unit, range + unit]);
          expect(option.instructions).toContain('около 3 повторений');
        }
      }
    }
    expect(slots).toBe(94);
    const options = workouts.flatMap((workout) =>
      workout.options.filter((option) => !option.primary),
    );
    const find = (name: string) => options.find((option) => option.name === name)!;
    for (const name of [
      'Тяга нижнего блока одной рукой',
      'Отведение руки в сторону на нижнем блоке',
      'Жим Палоффа на одном колене',
    ]) {
      expect(find(name)).toMatchObject({ perSide: true, weightType: 'machine' });
    }
    for (const name of [
      'Мёртвый жук с опусканием пятки',
      'Боковая планка на высокой опоре',
      'Сплит-присед с опорой без веса',
    ]) {
      expect(find(name)).toMatchObject({ perSide: true, weightType: 'none' });
    }
    expect(find('Сгибание ног лёжа')).toMatchObject({ perSide: false, weightType: 'machine' });
    expect(find('Тяга горизонтального блока')).toMatchObject({
      perSide: false,
      weightType: 'machine',
    });
    expect(find('Подъём на носки стоя с гантелью у опоры')).toMatchObject({
      perSide: false,
      weightType: 'dumbbell',
    });
    expect(find('Выпады назад с гантелями')).toMatchObject({
      perSide: true,
      weightType: 'dumbbell',
    });
    expect(find('Румынская тяга со штангой')).toMatchObject({
      perSide: false,
      weightType: 'total',
    });
    expect(find('Обратная «бабочка» в тренажёре').instructions).toContain('Частичная замена');
    expect(find('Ягодичный мост со штангой на полу').exerciseId).not.toBe(
      find('Хип-траст в тренажёре').exerciseId,
    );
  });

  it('saves a new replacement with its own identity and continues the 16→9 queue', async () => {
    await run(true);
    const workout = (await bootstrap()).workout!;
    const alternative = workout.options.find((option) => option.name === 'Хип-траст в тренажёре')!;
    const input = await completedGymSession();
    input.exercises[alternative.position - 1] = {
      optionId: alternative.id,
      sets: alternative.plan.map((set) => ({
        position: set.position,
        type: 'working' as const,
        done: true,
        reps: 13,
        seconds: null,
        weight: 35,
      })),
    };
    const saved = (await saveSession(input))!;
    expect(
      saved.workout!.options.find((option) => option.position === alternative.position)?.exerciseId,
    ).toBe(alternative.exerciseId);
    expect((await bootstrap()).workout!.position).toBe(5);
    expect(await run(true)).toMatchObject({ action: 'already_updated', nextPosition: 5 });
    await admin.query('UPDATE programs SET next_position=16 WHERE is_active');
    await saveSession(await completedGymSession());
    expect((await bootstrap()).workout!.position).toBe(9);
  });

  it('rolls back exercises, templates and activation if publishing fails', async () => {
    await admin.query(
      `CREATE FUNCTION reject_v4() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.version=4 AND NEW.status='published' THEN RAISE EXCEPTION 'Publish failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_v4 BEFORE UPDATE ON programs FOR EACH ROW EXECUTE FUNCTION reject_v4()`,
    );
    const before = await snapshot();
    await expect(run(true)).rejects.toThrow('Publish failure');
    expect(await snapshot()).toEqual(before);
  });

  it('refuses incompatible catalog entries and another active version without writes', async () => {
    await admin.query(
      "INSERT INTO exercises(name,equipment,measurement_type,weight_type,per_side) VALUES('Хип-траст в тренажёре','Wrong','reps','none',false)",
    );
    const before = await snapshot();
    await expect(run()).rejects.toThrow('Несовместимый');
    await expect(run(true)).rejects.toThrow('Несовместимый');
    expect(await snapshot()).toEqual(before);
    await admin.query('UPDATE programs SET is_active=false WHERE is_active');
    const inactive = await snapshot();
    await expect(run(true)).rejects.toThrow('Активна другая');
    expect(await snapshot()).toEqual(inactive);
  });
});
