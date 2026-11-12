import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { seedProduction } from '../scripts/seed-production.mjs';
import { seedNextCycle } from '../scripts/seed-next-cycle.mjs';
import { updateWorkouts } from '../scripts/update-workouts.mjs';
import { bootstrap, loadWorkout, saveSession, editSession } from '../src/lib/server/repository';
import { pool } from '../src/lib/server/db';
import { newDraft, formatPlan, type Workout } from '../src/lib/domain';
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('update workouts 3–9 without losing production history', () => {
  let admin: pg.Client;
  const run = (apply = false) => updateWorkouts({ connectionString: url!, apply });
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
  async function completed() {
    const w = (await bootstrap()).workout!;
    const { input } = newDraft('gym', '2026-11-12', w);
    return {
      ...input,
      wellbeing: 3,
      exertion: 5,
      main: 45,
      exercises: input.exercises.map((e) => {
        const o = w.options.find((o) => o.id === e.optionId)!;
        return {
          ...e,
          sets: e.sets.map((s) => ({
            ...s,
            done: true,
            reps: o.measurement === 'reps' ? 12 : null,
            seconds: o.measurement === 'time' ? 25 : null,
            weight: o.weightType === 'none' ? null : 10,
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
    await saveSession(await completed());
    await saveSession(await completed());
  });
  afterAll(async () => {
    await admin?.end();
    await pool().end();
  });
  it('previews without writes, preserves both sessions and the current step, and is idempotent', async () => {
    const stale = await completed();
    const source = (await bootstrap()).workout!;
    const originals = await workoutList(source.programId);
    const before = await snapshot();
    expect(await run()).toMatchObject({
      action: 'update',
      nextPosition: 3,
      repeatFrom: 9,
      totalWorkouts: 16,
      changedWorkouts: [3, 4, 5, 6, 7, 8, 9],
      historyCounts: { sessions: 2 },
    });
    expect(await snapshot()).toEqual(before);
    await run(true);
    const current = (await bootstrap()).workout!;
    expect(current).toMatchObject({ position: 3, totalWorkouts: 16, repeatFrom: 9 });
    const updated = await workoutList(current.programId);
    for (const position of [1, 2, 10, 11, 12, 13, 14, 15, 16])
      expect(shape(updated[position - 1])).toEqual(shape(originals[position - 1]));
    expect((await workoutList(source.programId)).map(shape)).toEqual(originals.map(shape));
    const after = await snapshot();
    for (const t of ['sessions', 'session_exercises', 'session_sets'])
      expect(after[t]).toEqual(before[t]);
    for (const row of before.exercises) expect(after.exercises).toContainEqual(row);
    expect(after.exercises.length - before.exercises.length).toBe(2);
    await expect(saveSession(stale)).rejects.toThrow('Очередь или программа');
    const stable = await snapshot();
    expect(await run(true)).toMatchObject({ action: 'already_updated', nextPosition: 3 });
    expect(await snapshot()).toEqual(stable);
    const old = (await bootstrap()).history[0];
    await editSession({ ...old.input, notes: 'Correct old session' }, old.revision);
    expect((await bootstrap()).workout!.position).toBe(3);
  });
  it('loads the exact ordered primary plans, replacements, side flags and resting times', async () => {
    await run(true);
    const current = (await bootstrap()).workout!;
    const workouts = (await workoutList(current.programId)).slice(2, 9);
    const names = [
      [
        'Жим штанги лёжа',
        'Гакк-присед',
        'Тяга горизонтального блока',
        'Сгибание ног сидя',
        'Сгибание рук с гантелями',
        'Мёртвый жук',
      ],
      [
        'Жим ногами',
        'Жим гантелей на горизонтальной скамье',
        'Тяга гантелей с опорой грудью на наклонную скамью',
        'Ягодичный мостик с гантелью',
        'Разгибание рук на верхнем блоке',
        'Разведение гантелей в стороны',
      ],
      [
        'Жим штанги лёжа',
        'Гоблет-присед',
        'Румынская тяга с гантелями',
        'Тяга верхнего блока к груди',
        'Сгибание рук на блоке',
        'Боковая планка с колен',
      ],
      [
        'Гакк-присед',
        'Жим гантелей вверх сидя',
        'Тяга гантели одной рукой с опорой',
        'Сгибание ног сидя',
        'Жим Палоффа на блоке',
        'Подъём на носки стоя в тренажёре',
      ],
      [
        'Жим штанги лёжа',
        'Жим ногами',
        'Тяга горизонтального блока',
        'Ягодичный мостик с гантелью',
        'Сгибание рук «молотком»',
        'Тяга каната к лицу — face pull',
      ],
      [
        'Сплит-присед с опорой и одной гантелью',
        'Жим гантелей на наклонной скамье',
        'Тяга верхнего блока к груди',
        'Сгибание ног сидя',
        'Подъём на носки стоя в тренажёре',
        'Мёртвый жук',
      ],
      [
        'Жим штанги лёжа',
        'Гакк-присед',
        'Румынская тяга с гантелями',
        'Тяга гантелей с опорой грудью на наклонную скамью',
        'Сгибание рук с гантелями',
        'Боковая планка с колен',
      ],
    ];
    const ranges = [
      ['8–10', '10–12', '10–12', '12–15', '10–15', '6–8'],
      ['10–12', '8–12', '10–12', '12–15', '10–15', '12–15'],
      ['8–10', '10–12', '8–10', '10–12', '10–15', '20–30'],
      ['10–12', '8–12', '10–12', '12–15', '10–12', '15–20'],
      ['8–10', '10–12', '10–12', '12–15', '10–12', '12–15'],
      ['8–10', '8–12', '10–12', '12–15', '15–20', '6–8'],
      ['8–10', '10–12', '8–10', '10–12', '10–15', '20–30'],
    ];
    for (const [i, w] of workouts.entries()) {
      const main = w.options.filter((o) => o.primary);
      expect(main.map((o) => o.name)).toEqual(names[i]);
      for (const [j, o] of main.entries()) {
        expect(o.plan.map(formatPlan)).toEqual(
          [1, 2].map(() => ranges[i][j] + (o.measurement === 'time' ? ' сек' : ' повт.')),
        );
        expect(o.instructions).toContain('около 3 повторений');
      }
    }
    const pallof = workouts[3].options.find((o) => o.name === 'Жим Палоффа на блоке')!;
    expect(pallof).toMatchObject({ perSide: true, weightType: 'machine' });
    expect(pallof.instructions).toContain('60–90 секунд');
    expect(
      workouts[1].options.find((o) => o.name === 'Разгибание рук на верхнем блоке'),
    ).toMatchObject({ perSide: false, weightType: 'machine' });
    expect(
      workouts[4].options.find((o) => o.name === 'Тяга каната к лицу — face pull')!.instructions,
    ).toContain('60–90 секунд');
    const alternatives: Record<string, [string, string]> = {
      'Сгибание ног сидя': ['Сгибание ног лёжа', '12–15'],
      'Гакк-присед': ['Жим ногами', '10–12'],
      'Жим штанги лёжа': ['Жим гантелей на горизонтальной скамье', '8–12'],
      'Румынская тяга с гантелями': ['Сгибание ног сидя', '12–15'],
      'Сгибание рук на блоке': ['Сгибание рук с гантелями', '10–15'],
    };
    for (const w of workouts)
      for (const o of w.options.filter((o) => o.primary)) {
        const alt = w.options.filter((a) => a.position === o.position && !a.primary);
        const expected = alternatives[o.name];
        expect(alt).toHaveLength(expected ? 1 : 0);
        if (expected) {
          expect(alt[0].name).toBe(expected[0]);
          expect(alt[0].plan.map(formatPlan)).toEqual([
            `${expected[1]} повт.`,
            `${expected[1]} повт.`,
          ]);
        }
      }
  });
  it('saves the new program and continues 16→9', async () => {
    await run(true);
    const saved = (await saveSession(await completed()))!;
    expect(saved.workout!.options).toHaveLength(6);
    expect((await bootstrap()).workout!.position).toBe(4);
    await admin.query('UPDATE programs SET next_position=16 WHERE is_active');
    await saveSession(await completed());
    expect((await bootstrap()).workout!.position).toBe(9);
  });
  it('rolls back new exercises and plans if publishing fails', async () => {
    const before = await snapshot();
    await admin.query(
      `CREATE FUNCTION reject_v3() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.version=3 AND NEW.status='published' THEN RAISE EXCEPTION 'Publish failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_v3 BEFORE UPDATE ON programs FOR EACH ROW EXECUTE FUNCTION reject_v3()`,
    );
    await expect(run(true)).rejects.toThrow('Publish failure');
    expect(await snapshot()).toEqual(before);
  });
  it('refuses an incompatible exercise or another active program without changing the database', async () => {
    await admin.query(
      "INSERT INTO exercises(name,equipment,measurement_type,weight_type,per_side) VALUES('Жим Палоффа на блоке','Wrong','reps','none',false)",
    );
    let before = await snapshot();
    await expect(run(true)).rejects.toThrow('Несовместимый');
    expect(await snapshot()).toEqual(before);
    await admin.query('UPDATE programs SET is_active=false WHERE is_active');
    before = await snapshot();
    await expect(run(true)).rejects.toThrow('Активна другая');
    expect(await snapshot()).toEqual(before);
  });
});
