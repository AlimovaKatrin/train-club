import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { seedProduction } from '../scripts/seed-production.mjs';
import { seedNextCycle } from '../scripts/seed-next-cycle.mjs';
import { clearHistory } from '../scripts/clear-history.mjs';
import { bootstrap, saveSession, editSession, loadWorkout } from '../src/lib/server/repository';
import { pool } from '../src/lib/server/db';
import { newDraft, formatPlan } from '../src/lib/domain';

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('second cycle and version transition', () => {
  let admin: pg.Client;
  const run = (apply = false) => seedNextCycle({ connectionString: url!, apply });
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
  });
  afterAll(async () => {
    await admin?.end();
    await pool().end();
  });
  async function snapshot() {
    const result: Record<string, unknown[]> = {};
    for (const t of [
      'exercises',
      'programs',
      'workout_templates',
      'workout_exercise_options',
      'workout_planned_sets',
      'sessions',
      'session_exercises',
      'session_sets',
    ])
      result[t] = (await admin.query(`SELECT * FROM ${t} ORDER BY id`)).rows;
    return result;
  }
  async function completed() {
    const workout = (await bootstrap()).workout!;
    const { input } = newDraft('gym', '2026-11-11', workout);
    return {
      ...input,
      wellbeing: 3,
      exertion: 5,
      main: 45,
      exercises: input.exercises.map((e) => {
        const option = workout.options.find((o) => o.id === e.optionId)!;
        return {
          ...e,
          sets: e.sets.map((s) => ({
            ...s,
            done: true,
            reps: option.measurement === 'reps' ? 12 : null,
            seconds: option.measurement === 'time' ? 25 : null,
            weight: option.weightType === 'none' ? null : 10,
          })),
        };
      }),
    };
  }
  it('only previews in check mode, copies 1–8 exactly, preserves historical records and rejects old drafts', async () => {
    const saved = (await saveSession(await completed()))!;
    const stale = await completed();
    const source = (await bootstrap()).workout!;
    const sourceTemplates = (
      await admin.query('SELECT id FROM workout_templates WHERE program_id=$1 ORDER BY position', [
        source.programId,
      ])
    ).rows;
    const originals = [];
    for (const template of sourceTemplates) originals.push(await loadWorkout(admin, template.id));
    const before = await snapshot();
    expect(await run()).toMatchObject({
      action: 'seed',
      nextPosition: 2,
      repeatFrom: 9,
      totalWorkouts: 16,
    });
    expect(await snapshot()).toEqual(before);
    await run(true);
    const current = (await bootstrap()).workout!;
    expect(current).toMatchObject({ position: 2, totalWorkouts: 16, repeatFrom: 9 });
    const copies = (
      await admin.query(
        'SELECT id FROM workout_templates WHERE program_id=$1 AND position<=8 ORDER BY position',
        [current.programId],
      )
    ).rows;
    for (const [i, t] of copies.entries()) {
      const copied = (await loadWorkout(admin, t.id))!;
      const shape = (w: NonNullable<typeof copied>) => ({
        name: w.name,
        notes: w.notes,
        options: w.options
          .map(({ id: _id, ...o }) => o)
          .sort(
            (a, b) =>
              a.position - b.position ||
              Number(b.primary) - Number(a.primary) ||
              a.exerciseId.localeCompare(b.exerciseId),
          ),
      });
      expect(shape(copied)).toEqual(shape(originals[i]!));
    }
    const after = await snapshot();
    for (const table of ['sessions', 'session_exercises', 'session_sets'])
      expect(after[table]).toEqual(before[table]);
    for (const row of before.exercises) expect(after.exercises).toContainEqual(row);
    await expect(saveSession(stale)).rejects.toThrow('Очередь или программа');
    await editSession({ ...saved.input, notes: 'Historical correction' }, saved.revision);
    expect((await bootstrap()).workout!.position).toBe(2);
    const stable = await snapshot();
    expect(await run(true)).toMatchObject({ action: 'already_loaded', nextPosition: 2 });
    expect(await snapshot()).toEqual(stable);
  });
  it('contains eight six-exercise workouts, all specified replacements and no inherited extra replacements', async () => {
    await run(true);
    const programId = (await bootstrap()).workout!.programId;
    const templates = (
      await admin.query(
        'SELECT id FROM workout_templates WHERE program_id=$1 AND position>=9 ORDER BY position',
        [programId],
      )
    ).rows;
    const names = [
      [
        'Жим штанги лёжа',
        'Гакк-присед',
        'Тяга верхнего блока к груди',
        'Сгибание ног сидя',
        'Сгибание рук с гантелями',
        'Мёртвый жук',
      ],
      [
        'Жим ногами',
        'Жим гантелей на наклонной скамье',
        'Тяга гантели одной рукой с опорой',
        'Ягодичный мостик с гантелью',
        'Сгибание рук «молотком»',
        'Тяга каната к лицу — face pull',
      ],
      [
        'Жим штанги лёжа',
        'Гоблет-присед',
        'Румынская тяга с гантелями',
        'Тяга горизонтального блока',
        'Сгибание рук на блоке',
        'Боковая планка с колен',
      ],
      [
        'Гакк-присед',
        'Жим гантелей вверх сидя',
        'Тяга верхнего блока к груди',
        'Ягодичный мостик с гантелью',
        'Сгибание рук с гантелями',
        'Подъём на носки стоя в тренажёре',
      ],
      [
        'Жим штанги лёжа',
        'Гакк-присед',
        'Тяга гантелей с опорой грудью на наклонную скамью',
        'Сгибание ног сидя',
        'Сгибание рук «молотком»',
        'Разведение гантелей в стороны',
      ],
      [
        'Сплит-присед с опорой и одной гантелью',
        'Жим гантелей на наклонной скамье',
        'Румынская тяга с гантелями',
        'Тяга верхнего блока к груди',
        'Сгибание рук на блоке',
        'Мёртвый жук',
      ],
      [
        'Жим штанги лёжа',
        'Жим ногами',
        'Тяга горизонтального блока',
        'Сгибание ног сидя',
        'Сгибание рук с гантелями',
        'Боковая планка с колен',
      ],
      [
        'Гакк-присед',
        'Жим гантелей вверх сидя',
        'Тяга верхнего блока к груди',
        'Ягодичный мостик с гантелью',
        'Сгибание рук «молотком»',
        'Тяга каната к лицу — face pull',
      ],
    ];
    const ranges = [
      ['8–10', '10–12', '10–12', '12–15', '10–15', '6–8'],
      ['10–12', '8–12', '10–12', '12–15', '10–12', '12–15'],
      ['8–10', '10–12', '8–10', '10–12', '10–15', '20–30'],
      ['10–12', '8–12', '10–12', '12–15', '10–15', '15–20'],
      ['8–10', '10–12', '10–12', '12–15', '10–12', '12–15'],
      ['8–10', '8–12', '8–10', '10–12', '10–15', '6–8'],
      ['8–10', '10–12', '10–12', '12–15', '10–15', '20–30'],
      ['10–12', '8–12', '10–12', '12–15', '10–12', '12–15'],
    ];
    const alternatives: Record<string, [string, string]> = {
      'Сгибание ног сидя': ['Сгибание ног лёжа', '12–15'],
      'Гакк-присед': ['Жим ногами', '10–12'],
      'Жим штанги лёжа': ['Жим гантелей на горизонтальной скамье', '8–12'],
      'Румынская тяга с гантелями': ['Сгибание ног сидя', '12–15'],
      'Сгибание рук на блоке': ['Сгибание рук с гантелями', '10–15'],
    };
    expect(templates).toHaveLength(8);
    for (const [i, t] of templates.entries()) {
      const workout = (await loadWorkout(admin, t.id))!;
      const primary = workout.options.filter((o) => o.primary);
      expect(primary.map((o) => o.name)).toEqual(names[i]);
      for (const [j, o] of primary.entries()) {
        expect(o.plan.map(formatPlan)).toEqual(
          [1, 2].map(() => ranges[i][j] + (o.measurement === 'time' ? ' сек' : ' повт.')),
        );
        expect(o.instructions).toContain('около 3 повторений');
        const alts = workout.options.filter((a) => a.position === o.position && !a.primary);
        const expected = alternatives[o.name];
        expect(alts).toHaveLength(expected ? 1 : 0);
        if (expected) {
          expect(alts[0].name).toBe(expected[0]);
          expect(alts[0].plan.map(formatPlan)).toEqual([
            `${expected[1]} повт.`,
            `${expected[1]} повт.`,
          ]);
        }
      }
    }
  });
  it('advances 8→9 and 16→9 and keeps time ranges in historical snapshots and corrections', async () => {
    await run(true);
    await admin.query('UPDATE programs SET next_position=8 WHERE is_active');
    await saveSession(await completed());
    expect((await bootstrap()).workout!.position).toBe(9);
    await admin.query('UPDATE programs SET next_position=11 WHERE is_active');
    const saved = (await saveSession(await completed()))!;
    const side = saved.workout!.options.find((o) => o.name === 'Боковая планка с колен')!;
    expect(side.perSide).toBe(true);
    expect(side.weightType).toBe('none');
    expect(side.plan.map(formatPlan)).toEqual(['20–30 сек', '20–30 сек']);
    await editSession({ ...saved.input, notes: 'Keep time range' }, saved.revision);
    expect(
      (await bootstrap()).history
        .find((s) => s.input.id === saved.input.id)!
        .workout!.options.find((o) => o.exerciseId === side.exerciseId)!.plan,
    ).toEqual(side.plan);
    await admin.query('UPDATE programs SET next_position=16 WHERE is_active');
    await saveSession(await completed());
    expect((await bootstrap()).workout!.position).toBe(9);
    await clearHistory({ connectionString: url!, apply: true });
    expect((await bootstrap()).workout).toMatchObject({
      position: 1,
      totalWorkouts: 16,
      repeatFrom: 9,
    });
  });
  it('starts at 9 when the old queue has just wrapped after workout 8', async () => {
    await admin.query('UPDATE programs SET next_position=8 WHERE is_active');
    await saveSession(await completed());
    expect((await bootstrap()).workout!.position).toBe(1);
    expect(await run(true)).toMatchObject({ nextPosition: 9 });
  });
  it('rejects updates to published cycle length and invalid time ranges', async () => {
    await run(true);
    await expect(admin.query('UPDATE programs SET repeat_from=1 WHERE is_active')).rejects.toThrow(
      'immutable',
    );
    await expect(
      admin.query('UPDATE programs SET workout_count=8 WHERE is_active'),
    ).rejects.toThrow('immutable');
    await admin.query(`INSERT INTO programs(name,version) VALUES('Range test',1)`);
    const t = (
      await admin.query(
        "INSERT INTO workout_templates(program_id,position,name) SELECT id,1,'Test' FROM programs WHERE name='Range test' RETURNING id",
      )
    ).rows[0];
    const o = (
      await admin.query(
        "INSERT INTO workout_exercise_options(workout_template_id,position,exercise_id,is_primary) SELECT $1,1,id,true FROM exercises WHERE name='Боковая планка с колен' RETURNING id",
        [t.id],
      )
    ).rows[0];
    await expect(
      admin.query(
        'INSERT INTO workout_planned_sets(exercise_option_id,position,target_duration_seconds,target_duration_seconds_max) VALUES($1,1,30,20)',
        [o.id],
      ),
    ).rejects.toThrow();
  });
  it('rolls back the entire transition when a new exercise cannot be inserted', async () => {
    const before = await snapshot();
    await admin.query(`CREATE FUNCTION reject_cycle() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Cycle failure'; END $$;
      CREATE TRIGGER reject_cycle BEFORE INSERT ON exercises FOR EACH ROW EXECUTE FUNCTION reject_cycle()`);
    await expect(run(true)).rejects.toThrow('Cycle failure');
    expect(await snapshot()).toEqual(before);
  });
  it('migrates a legacy personal database and leaves its old exercise plans intact', async () => {
    await admin.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    for (const file of ['db/migrations/001_initial.sql', 'db/seeds/personal.sql'])
      await admin.query(await readFile(file, 'utf8'));
    expect(await run()).toMatchObject({
      pendingMigrations: [
        '002_session_duration.sql',
        '003_next_cycle.sql',
        '004_export_provenance.sql',
      ],
    });
    expect(await run(true)).toMatchObject({ action: 'seeded', nextPosition: 1 });
    expect((await bootstrap()).workout!.totalWorkouts).toBe(16);
  });
});
