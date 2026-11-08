import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { clearHistory } from '../scripts/clear-history.mjs';

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('history cleanup on a disposable PostgreSQL database', () => {
  let admin: pg.Client;
  const run = (apply = false) => clearHistory({ connectionString: url!, apply });
  const historyTables = ['sessions', 'session_exercises', 'session_sets'];
  const planTables = [
    'programs',
    'exercises',
    'workout_templates',
    'workout_exercise_options',
    'workout_planned_sets',
  ];
  async function snapshot(tables: string[]) {
    const result: Record<string, unknown[]> = {};
    for (const table of tables)
      result[table] = (await admin.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
    return result;
  }
  beforeAll(async () => {
    if (!new URL(url!).pathname.endsWith('_test'))
      throw new Error('Use a disposable _test database');
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
  });
  beforeEach(async () => {
    await admin.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    for (const file of [
      'db/migrations/001_initial.sql',
      'db/migrations/002_session_duration.sql',
      'db/seeds/demo.sql',
    ])
      await admin.query(await readFile(file, 'utf8'));
    await admin.query(`
      UPDATE programs SET next_position=5,revision=7 WHERE is_active;
      INSERT INTO sessions(id,activity_type,performed_on,workout_template_id,wellbeing,sleep_hours,
        warmup_minutes,main_minutes,cardio_minutes,heart_rate_min,heart_rate_max,exertion,request_hash)
      SELECT gen_random_uuid(),'gym','2026-11-01',id,3,8,10,30,0,90,140,4,'gym'
      FROM workout_templates WHERE position=1;
      INSERT INTO sessions(id,activity_type,performed_on,wellbeing,sleep_hours,fixed_duration_minutes,
        heart_rate_min,heart_rate_max,exertion,request_hash)
      VALUES(gen_random_uuid(),'pilates','2026-11-02',3,8,30,90,140,4,'pilates'),
        (gen_random_uuid(),'boxing','2026-11-03',3,8,45,90,140,4,'boxing');
      INSERT INTO session_exercises(session_id,exercise_option_id,exercise_id,position,name,equipment,
        measurement_type,weight_type,per_side,instructions)
      SELECT s.id,o.id,e.id,o.position,e.name,e.equipment,e.measurement_type,e.weight_type,e.per_side,e.instructions
      FROM sessions s JOIN workout_exercise_options o ON o.workout_template_id=s.workout_template_id
      JOIN exercises e ON e.id=o.exercise_id WHERE o.is_primary AND o.position=1;
      INSERT INTO session_sets(session_exercise_id,set_type,position,weight_kg,reps,status)
      SELECT id,'warmup',1,5,8,'done' FROM session_exercises;
      INSERT INTO session_sets(session_exercise_id,set_type,position,weight_kg,reps,status)
      SELECT id,'working',1,10,12,'done' FROM session_exercises;
    `);
  });
  afterAll(async () => {
    await admin?.end();
  });

  it('reports all activity types without deleting or modifying anything by default', async () => {
    const before = await snapshot([...historyTables, ...planTables]);
    expect(await run()).toEqual({
      mode: 'check',
      sessions: 3,
      exercises: 1,
      sets: 2,
      workoutPosition: { before: 5, after: 1 },
      activities: ['boxing', 'gym', 'pilates'].map((activity_type) => ({
        activity_type,
        count: 1,
      })),
    });
    expect(await snapshot([...historyTables, ...planTables])).toEqual(before);
  });

  it('clears history and resets the active queue once while preserving the plans and catalog', async () => {
    const before = await snapshot(planTables);
    expect(await run(true)).toMatchObject({
      mode: 'apply',
      sessions: 3,
      exercises: 1,
      sets: 2,
      workoutPosition: { before: 5, after: 1 },
    });
    expect(await snapshot(historyTables)).toEqual({
      sessions: [],
      session_exercises: [],
      session_sets: [],
    });
    before.programs = before.programs.map((program) => ({
      ...(program as Record<string, unknown>),
      next_position: 1,
      revision: 8,
    }));
    expect(await snapshot(planTables)).toEqual(before);
    expect(await run(true)).toEqual({
      mode: 'apply',
      sessions: 0,
      exercises: 0,
      sets: 0,
      activities: [],
      workoutPosition: { before: 1, after: 1 },
    });
    expect(await snapshot(planTables)).toEqual(before);
  });

  it('resets the queue even when the history is already empty', async () => {
    await run(true);
    await admin.query('UPDATE programs SET next_position=6 WHERE is_active');
    expect(await run(true)).toMatchObject({
      sessions: 0,
      workoutPosition: { before: 6, after: 1 },
    });
    expect(
      (await admin.query('SELECT next_position,revision FROM programs WHERE is_active')).rows[0],
    ).toEqual({ next_position: 1, revision: 9 });
  });

  it('invalidates prior gym drafts when clearing history at position one', async () => {
    await admin.query('UPDATE programs SET next_position=1 WHERE is_active');
    await run(true);
    expect(
      (await admin.query('SELECT next_position,revision FROM programs WHERE is_active')).rows[0],
    ).toEqual({ next_position: 1, revision: 8 });
  });

  it('leaves inactive programs unchanged when there is no active queue', async () => {
    await admin.query('UPDATE programs SET is_active=false');
    const before = await snapshot(planTables);
    expect(await run(true)).toMatchObject({ sessions: 3, workoutPosition: null });
    expect(await snapshot(planTables)).toEqual(before);
  });

  it('restores deleted sets and exercises when deleting sessions fails', async () => {
    const before = await snapshot([...historyTables, ...planTables]);
    await admin.query(`CREATE FUNCTION reject_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Forced cleanup failure'; END $$;
      CREATE TRIGGER reject_cleanup BEFORE DELETE ON sessions FOR EACH ROW EXECUTE FUNCTION reject_cleanup()`);
    await expect(run(true)).rejects.toThrow('Forced cleanup failure');
    expect(await snapshot([...historyTables, ...planTables])).toEqual(before);
  });

  it('refuses to run while another database maintenance operation holds the lock', async () => {
    const before = await snapshot(historyTables);
    await admin.query('SELECT pg_advisory_lock(824906)');
    try {
      await expect(run(true)).rejects.toThrow('Другая операция');
    } finally {
      await admin.query('SELECT pg_advisory_unlock(824906)');
    }
    expect(await snapshot(historyTables)).toEqual(before);
  });
});
