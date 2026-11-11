import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import {
  exportPeriod,
  exportQuerySchema,
  exportPlan,
  exportSet,
  buildTrainingExport,
  type ExportSession,
} from '../src/lib/training-export';
import { blankSet, fieldSource, newDraft } from '../src/lib/domain';
import { loadTrainingExport } from '../src/lib/server/training-export';
import { bootstrap, saveSession, editSession } from '../src/lib/server/repository';
import { pool } from '../src/lib/server/db';
import { canExport } from '../src/lib/server/export-access';
import { seedProduction } from '../scripts/seed-production.mjs';
import { seedNextCycle } from '../scripts/seed-next-cycle.mjs';
import { GET } from '../src/app/review/[key]/download/route';
const now = new Date('2026-11-11T21:30:00Z');
const all = exportQuerySchema.parse({ range: 'all' });

it('uses an inclusive 84-day period in the chosen timezone and validates custom dates', () => {
  expect(exportPeriod(exportQuerySchema.parse({}), now)).toEqual({
    from: '2026-08-21',
    to: '2026-11-12',
  });
  expect(exportPeriod(exportQuerySchema.parse({ timeZone: 'America/Los_Angeles' }), now)).toEqual({
    from: '2026-08-20',
    to: '2026-11-11',
  });
  expect(exportPeriod(all, now)).toEqual({ from: null, to: null });
  for (const query of [
    { range: 'custom' },
    { range: 'custom', from: '2026-11-12', to: '2026-11-01' },
    { range: 'custom', from: '2026-02-30', to: '2026-03-01' },
    { timeZone: 'No/SuchZone' },
  ])
    expect(exportQuerySchema.safeParse(query).success).toBe(false);
});
it('never infers provenance from a number; new pulse values are unknown and optional', () => {
  const { input } = newDraft('pilates', '2026-11-11', null);
  expect(input.sleep).toBe(8);
  expect(fieldSource(input, 'sleep')).toBe('default');
  expect(input.pulseMin).toBeNull();
  expect(fieldSource(input, 'pulseMin')).toBe('unknown');
  expect(fieldSource({}, 'sleep')).toBe('unknown');
});
it('compares reps and time ranges while distinguishing warmups and missing facts', () => {
  const plan = exportPlan({ position: 1, repsMin: 8, repsMax: 12, seconds: null });
  expect(exportSet({ ...blankSet(1), done: true, reps: 12 }, plan).adherence).toBe('within');
  expect(exportSet({ ...blankSet(1), done: true, reps: 7 }, plan).adherence).toBe('below');
  expect(exportSet({ ...blankSet(1), done: true, reps: 13 }, plan).adherence).toBe('above');
  expect(exportSet(blankSet(1), plan).adherence).toBe('not_done');
  expect(exportSet({ ...blankSet(1), done: true }, plan).adherence).toBe('unknown');
  expect(exportSet({ ...blankSet(1, 'warmup'), done: true, reps: 8 }, null).adherence).toBe(
    'not_applicable',
  );
  const time = exportPlan({
    position: 1,
    repsMin: null,
    repsMax: null,
    seconds: 30,
    secondsMax: 45,
  });
  expect(exportSet({ ...blankSet(1), done: true, seconds: 40 }, time).adherence).toBe('within');
});
it('denies missing and wrong private links before accessing a database', async () => {
  const before = process.env.TRAIN_CLUB_EXPORT_KEY;
  try {
    delete process.env.TRAIN_CLUB_EXPORT_KEY;
    expect(canExport('anything')).toBe(false);
    process.env.TRAIN_CLUB_EXPORT_KEY = 'test-secret-'.repeat(5);
    expect(canExport(process.env.TRAIN_CLUB_EXPORT_KEY)).toBe(true);
    const response = await GET(new Request('https://example.com/review/wrong/download'), {
      params: Promise.resolve({ key: 'wrong' }),
    });
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  } finally {
    if (before === undefined) delete process.env.TRAIN_CLUB_EXPORT_KEY;
    else process.env.TRAIN_CLUB_EXPORT_KEY = before;
  }
});

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('training export with PostgreSQL snapshots', () => {
  let admin: pg.Client;
  beforeAll(async () => {
    if (!new URL(url!).pathname.endsWith('_test')) throw new Error('Test database required');
    process.env.DATABASE_URL = url;
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await admin.query('CREATE TABLE schema_migrations (name text PRIMARY KEY)');
    for (const file of [
      '001_initial.sql',
      '002_session_duration.sql',
      '003_next_cycle.sql',
      '004_export_provenance.sql',
    ]) {
      await admin.query(await readFile(`db/migrations/${file}`, 'utf8'));
      await admin.query('INSERT INTO schema_migrations(name) VALUES ($1)', [file]);
    }
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
  async function gym(date: string, replacement = false) {
    const { workout } = await bootstrap();
    const draft = newDraft('gym', date, workout);
    if (replacement) {
      const alt = workout!.options.find((o) => !o.primary)!;
      draft.input.exercises[0] = {
        optionId: alt.id,
        sets: alt.plan.map((p) => blankSet(p.position)),
      };
    }
    draft.input.wellbeing = 4;
    draft.input.exertion = 6;
    draft.input.main = 45;
    for (const e of draft.input.exercises) {
      const option = workout!.options.find((o) => o.id === e.optionId)!;
      e.sets = e.sets.map((s) => ({
        ...s,
        done: true,
        reps: option.measurement === 'reps' ? 12 : null,
        seconds: option.measurement === 'time' ? 30 : null,
      }));
    }
    return draft.input;
  }
  it('exports over 100 records and exact inclusive boundaries without changing the queue', async () => {
    await admin.query(`INSERT INTO sessions(id,activity_type,performed_on,wellbeing,sleep_hours,fixed_duration_minutes,heart_rate_min,heart_rate_max,exertion,request_hash)
      SELECT gen_random_uuid(),'pilates','2026-07-01'::date+n,3,8,60,100,180,4,'legacy-'||n FROM generate_series(0,104) n`);
    const data = await loadTrainingExport(all, now);
    expect(data.sessions).toHaveLength(105);
    expect(data.summary.sessionCount).toBe(105);
    expect((await bootstrap()).history).toHaveLength(100);
    const period = await loadTrainingExport(
      exportQuerySchema.parse({ range: 'custom', from: '2026-07-02', to: '2026-07-04' }),
      now,
    );
    expect(period.sessions.map((s) => s.date)).toEqual(['2026-07-02', '2026-07-03', '2026-07-04']);
    expect(period.summary.weeks[0].activities.pilates).toMatchObject({
      sessions: 3,
      reportedMinutes: 180,
      confirmedMinutes: 0,
      unverifiedMinutes: 180,
    });
    expect(period.sessions[0].before.sleepHours).toEqual({ value: 8, source: 'unknown' });
    expect(period.sessions[0].pulse).toMatchObject({
      min: { value: null, source: 'unknown' },
      max: { value: null, source: 'unknown' },
      unverifiedValuesOmitted: true,
    });
    expect((await bootstrap()).workout!.position).toBe(1);
  });
  it('preserves full program and replacement snapshots across catalog changes and history edits', async () => {
    const input = await gym('2026-11-01', true);
    input.provenance = {
      sleep: 'user_confirmed',
      warmup: 'user_confirmed',
      main: 'device',
      cardio: 'user_confirmed',
      pulseMin: 'user_confirmed',
      pulseMax: 'device',
    };
    input.pulseMin = 92;
    input.pulseMax = 154;
    input.pulseDevice = 'Часы';
    input.exercises[0].equipmentNote = 'Гантель 7,5 кг';
    input.exercises[0].sets[0].weight = 7.5;
    input.exercises[0].sets.unshift({ ...blankSet(1, 'warmup'), done: true, reps: 8 });
    const saved = (await saveSession(input))!;
    await admin.query(
      "UPDATE exercises SET name='Renamed',equipment='Other machine',weight_type='total'",
    );
    await editSession({ ...saved.input, notes: 'Боль в колене после занятия' }, saved.revision);
    const data = await loadTrainingExport(all, now),
      session = data.sessions[0];
    expect(session.revision).toBe(1);
    expect(session.program).toMatchObject({
      version: 1,
      workoutNumber: 1,
      savedPlan: { source: 'saved_snapshot' },
    });
    expect(session.program!.savedPlan.options).toHaveLength(3);
    const exercise = session.exercises[0];
    expect(exercise).toMatchObject({
      name: 'Тяга гантели с упором',
      weightType: 'dumbbell',
      isReplacement: true,
      equipmentNote: 'Гантель 7,5 кг',
      originalExercise: { name: 'Тяга нижнего блока', weightType: 'machine' },
    });
    expect(exercise.plan).toHaveLength(2);
    expect(exercise.originalExercise!.plan).toHaveLength(3);
    expect(session.duration.totalMinutes).toEqual({ value: 45, source: 'user_confirmed' });
    expect(session.pulse).toMatchObject({
      min: { value: 92, source: 'user_confirmed' },
      max: { value: 154, source: 'device' },
      measurementSource: 'Часы',
      unverifiedValuesOmitted: false,
    });
    expect(data.summary.exercises[0]).toMatchObject({
      completedWorkingSets: 2,
      completedWarmupSets: 1,
    });
    expect(data.summary.notes[0].note).toContain('Боль');
    const encoded = JSON.stringify(data);
    expect(encoded).not.toContain('planToken');
    expect(encoded).not.toContain('request_hash');
  });
  it('does not invent an old replacement snapshot and separates actual equipment and recovery gaps', async () => {
    const a = (await saveSession(await gym('2026-11-01', true)))!;
    await admin.query('UPDATE sessions SET workout_snapshot=NULL,provenance=$1 WHERE id=$2', [
      '{}',
      a.input.id,
    ]);
    const input = await gym('2026-11-04', true);
    input.exercises[0].equipmentNote = 'Другой зал';
    await saveSession(input);
    const data = await loadTrainingExport(all, now);
    expect(data.sessions[0].exercises[0]).toMatchObject({
      originalMetadataSource: 'legacy_identity_only',
      originalExercise: { name: null, plan: null },
    });
    expect(data.summary.dataQuality.sessionsWithLegacyPlan).toBe(1);
    expect(data.summary.gymIntervals[1]).toMatchObject({
      calendarDaysBetween: 3,
      fullCalendarDaysWithoutGymBetween: 2,
    });
    expect(data.summary.exercises.filter((e) => e.name === 'Тяга гантели с упором')).toHaveLength(
      2,
    );
    // Number and version are data, not an eight-workout assumption in the export format.
    const future = structuredClone(data.sessions) as ExportSession[];
    future[1].program!.version = 2;
    future[1].program!.workoutNumber = 16;
    expect(buildTrainingExport(future, all, now).sessions[1].program!.workoutNumber).toBe(16);
  });
  it('exports the real second-cycle version and saved time ranges without mixing programs', async () => {
    await seedProduction({ connectionString: url!, apply: true });
    const old = (await saveSession(await gym('2026-11-01')))!;
    await seedNextCycle({ connectionString: url!, apply: true });
    await admin.query('UPDATE programs SET next_position=11 WHERE is_active');
    await saveSession(await gym('2026-11-11'));
    const exported = await loadTrainingExport(all, now);
    expect(exported.sessions[0].program).toMatchObject({ version: 1, workoutNumber: 1 });
    expect(exported.sessions[1].program).toMatchObject({ version: 2, workoutNumber: 11 });
    expect(exported.sessions[0].program!.id).not.toBe(exported.sessions[1].program!.id);
    const plank = exported.sessions[1].exercises.find((e) => e.name === 'Боковая планка с колен')!;
    expect(plank.perSide).toBe(true);
    expect(plank.sets[0].plan!.seconds).toEqual({ min: 20, max: 30 });
    await editSession({ ...old.input, notes: 'Исправление в старой версии' }, old.revision);
    expect((await loadTrainingExport(all, now)).sessions[0].program!.version).toBe(1);
  });
  it('exports an empty valid document, optional null sleep/pulse and unconfirmed defaults', async () => {
    const empty = await loadTrainingExport(all, now);
    expect(empty.sessions).toEqual([]);
    expect(empty.period.from).toBeNull();
    expect(empty.summary.weeks).toEqual([]);
    const input = newDraft('boxing', '2026-11-11', null).input;
    await saveSession({ ...input, wellbeing: 3, exertion: 4, sleep: null });
    const data = await loadTrainingExport(all, now);
    expect(data.sessions[0].before.sleepHours.value).toBeNull();
    expect(data.sessions[0].pulse.min.value).toBeNull();
    expect(data.summary.weeks[0].activities.boxing).toMatchObject({
      reportedMinutes: 60,
      confirmedMinutes: 0,
      unverifiedMinutes: 60,
      minutesBySource: { default: 60 },
    });
  });
});
