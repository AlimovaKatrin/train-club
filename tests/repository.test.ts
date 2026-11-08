import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { bootstrap, editSession, saveSession } from '../src/lib/server/repository';
import { pool } from '../src/lib/server/db';
import { blankSet, newDraft, type SessionInput } from '../src/lib/domain';
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('real PostgreSQL transactions', () => {
  let admin: pg.Client;
  beforeAll(async () => {
    if (!new URL(url!).pathname.endsWith('_test'))
      throw new Error('Integration tests require a database name ending in _test');
    process.env.DATABASE_URL = url;
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await admin.query(await readFile('db/migrations/001_initial.sql', 'utf8'));
  });
  beforeEach(async () => {
    await admin.query(
      'TRUNCATE sessions,session_sets,session_exercises,workout_planned_sets,workout_exercise_options,workout_templates,programs,exercises',
    );
    await admin.query(await readFile('db/seeds/demo.sql', 'utf8'));
  });
  afterAll(async () => {
    await admin?.end();
    await pool().end();
  });
  async function gym(): Promise<SessionInput> {
    const { workout } = await bootstrap();
    const { input } = newDraft('gym', '2026-11-08', workout);
    return {
      ...input,
      wellbeing: 3,
      exertion: 5,
      main: 45,
      exercises: input.exercises.map((e) => ({
        ...e,
        sets: e.sets.map((s) => ({
          ...s,
          done: true,
          weight: null,
          reps:
            workout!.options.find((o) => o.id === e.optionId)!.measurement === 'reps' ? 12 : null,
          seconds:
            workout!.options.find((o) => o.id === e.optionId)!.measurement === 'time' ? 30 : null,
        })),
      })),
    };
  }
  it('stores warmup separately and idempotently advances once, including concurrent retries', async () => {
    const input = await gym();
    input.exercises[0].sets.unshift({ ...blankSet(1, 'warmup'), done: true, reps: 8 });
    const results = await Promise.all([saveSession(input), saveSession(input)]);
    expect(results[0]!.input.id).toBe(results[1]!.input.id);
    const state = await bootstrap();
    expect(state.workout!.position).toBe(2);
    expect(state.history).toHaveLength(1);
    expect(state.history[0].input.exercises[0].sets).toHaveLength(4);
    await expect(saveSession({ ...input, notes: 'changed' })).rejects.toThrow('другими данными');
  });
  it('rejects two different workouts completing the same queue step', async () => {
    const a = await gym(),
      b = { ...a, id: crypto.randomUUID() };
    const results = await Promise.allSettled([saveSession(a), saveSession(b)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await bootstrap()).history).toHaveLength(1);
  });
  it('wraps eight to one', async () => {
    await admin.query('UPDATE programs SET next_position=8');
    await saveSession(await gym());
    expect((await bootstrap()).workout!.position).toBe(1);
  });
  it('boxing and pilates never advance gym queue, editing does not either', async () => {
    for (const kind of ['boxing', 'pilates'] as const) {
      const { input } = newDraft(kind, '2026-11-08', null);
      await saveSession({ ...input, wellbeing: 0, exertion: 0 });
    }
    let state = await bootstrap();
    expect(state.workout!.position).toBe(1);
    expect(state.history).toHaveLength(2);
    const r = state.history[0];
    const input = { ...r.input, notes: 'Edited', date: '2026-11-07' };
    await editSession(input, r.revision);
    await editSession(input, r.revision);
    state = await bootstrap();
    expect(state.workout!.position).toBe(1);
    expect(state.history.find((s) => s.input.id === r.input.id)!.revision).toBe(1);
    await expect(editSession({ ...input, notes: 'Conflict' }, r.revision)).rejects.toThrow(
      'другом окне',
    );
  });
  it('uses the replacement plan, exercise identity and its own previous results', async () => {
    const input = await gym();
    const state = await bootstrap();
    const alt = state.workout!.options.find((o) => !o.primary)!;
    input.exercises[0] = {
      optionId: alt.id,
      sets: alt.plan.map((p) => ({ ...blankSet(p.position), done: true, reps: 12, weight: 7.5 })),
    };
    const saved = (await saveSession(input))!;
    expect(saved.workout!.options[0].name).toBe(alt.name);
    expect(saved.input.exercises[0].sets).toHaveLength(2);
    const next = (await bootstrap()).workout!;
    expect(
      next.options.find((o) => o.exerciseId === alt.exerciseId)!.previous!.sets[0].weight,
    ).toBe(7.5);
    expect(next.options.find((o) => o.primary && o.position === 1)!.previous).toBeNull();
  });
  it('preserves snapshots after catalog updates and history edits', async () => {
    const saved = (await saveSession(await gym()))!;
    const name = saved.workout!.options[0].name;
    await admin.query("UPDATE exercises SET name='Renamed',weight_type='total'");
    await editSession({ ...saved.input, notes: 'Correction' }, saved.revision);
    const after = (await bootstrap()).history[0];
    expect(after.workout!.options[0].name).toBe(name);
    expect(after.workout!.options[0].weightType).toBe('machine');
    expect((await bootstrap()).workout!.position).toBe(2);
  });
  it('rejects incomplete/foreign sets without leaving partial rows or changing queue', async () => {
    const input = await gym();
    input.exercises[0].sets.pop();
    await expect(saveSession(input)).rejects.toThrow();
    expect((await bootstrap()).history).toHaveLength(0);
    expect((await bootstrap()).workout!.position).toBe(1);
  });
  it('guards published plans and rejects stale drafts after catalog changes', async () => {
    const input = await gym();
    await expect(admin.query('UPDATE workout_planned_sets SET target_reps_min=1')).rejects.toThrow(
      'immutable',
    );
    await admin.query("UPDATE exercises SET name=name||' revised'");
    await expect(saveSession(input)).rejects.toThrow('программа');
    expect((await bootstrap()).history).toHaveLength(0);
  });
  it('does not allow a published program without eight workouts', async () => {
    await expect(
      admin.query("INSERT INTO programs(name,version,status) VALUES('Invalid',1,'published')"),
    ).rejects.toThrow('Eight workouts');
  });
});
