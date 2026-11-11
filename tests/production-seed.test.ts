import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { seedProduction } from '../scripts/seed-production.mjs';

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('production seed on a disposable PostgreSQL database', () => {
  let admin: pg.Client;
  const run = (apply = false) => seedProduction({ connectionString: url!, apply });
  const initial = async () => admin.query(await readFile('db/migrations/001_initial.sql', 'utf8'));
  beforeAll(async () => {
    if (!new URL(url!).pathname.endsWith('_test'))
      throw new Error('Use a disposable _test database');
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
  });
  beforeEach(async () => {
    await admin.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  });
  afterAll(async () => {
    await admin?.end();
  });

  it('checks an empty database without creating tables', async () => {
    expect(await run()).toMatchObject({
      mode: 'check',
      action: 'seed',
      pendingMigrations: [
        '001_initial.sql',
        '002_session_duration.sql',
        '003_next_cycle.sql',
        '004_export_provenance.sql',
      ],
    });
    expect(
      (await admin.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'"))
        .rows[0].n,
    ).toBe(0);
  });

  it('initializes an empty database and preserves queue and thirty-minute history on retries', async () => {
    expect(await run(true)).toMatchObject({ action: 'seeded', nextPosition: 1 });
    await admin.query('UPDATE programs SET next_position=5,revision=4 WHERE is_active');
    await admin.query(`INSERT INTO sessions(id,activity_type,performed_on,wellbeing,sleep_hours,fixed_duration_minutes,
      heart_rate_min,heart_rate_max,exertion,request_hash,notes)
      VALUES(gen_random_uuid(),'pilates','2026-11-01',3,8,30,90,140,4,'original','Keep me')`);
    const before = (await admin.query('SELECT * FROM sessions')).rows;
    expect(await run(true)).toMatchObject({
      action: 'already_loaded',
      nextPosition: 5,
      sessions: 1,
      appliedMigrations: [],
    });
    expect(await run()).toMatchObject({ action: 'already_loaded', pendingMigrations: [] });
    expect((await admin.query('SELECT * FROM sessions')).rows).toMatchObject(before);
    expect((await admin.query('SELECT count(*)::int AS n FROM exercises')).rows[0].n).toBe(11);
    expect(
      (await admin.query('SELECT revision FROM programs WHERE is_active')).rows[0].revision,
    ).toBe(4);
  });

  it('upgrades a legacy demo without losing existing sixty-minute pilates', async () => {
    await initial();
    await admin.query(await readFile('db/seeds/demo.sql', 'utf8'));
    await admin.query(`INSERT INTO sessions(id,activity_type,performed_on,wellbeing,sleep_hours,fixed_duration_minutes,
      heart_rate_min,heart_rate_max,exertion,request_hash)
      VALUES(gen_random_uuid(),'pilates','2026-11-01',3,8,60,90,140,4,'legacy')`);
    const before = (await admin.query('SELECT * FROM sessions')).rows;
    expect(await run(true)).toMatchObject({
      action: 'seeded',
      appliedMigrations: [
        '002_session_duration.sql',
        '003_next_cycle.sql',
        '004_export_provenance.sql',
      ],
      sessions: 1,
    });
    expect((await admin.query('SELECT * FROM sessions')).rows).toMatchObject(before);
    expect((await admin.query('SELECT count(*)::int AS n FROM programs')).rows[0].n).toBe(2);
  });

  it('refuses to replace a different active program', async () => {
    await initial();
    await admin.query(await readFile('db/seeds/demo.sql', 'utf8'));
    // A distinct published identity, created while the immutability trigger is disabled for this fixture only.
    await admin.query(
      "ALTER TABLE programs DISABLE TRIGGER validate_program; UPDATE programs SET name='Existing personal plan'; ALTER TABLE programs ENABLE TRIGGER validate_program",
    );
    for (const apply of [false, true])
      await expect(run(apply)).rejects.toThrow('другая личная программа');
    expect(
      (await admin.query("SELECT to_regclass('schema_migrations') AS t")).rows[0].t,
    ).toBeNull();
    expect((await admin.query('SELECT name FROM programs WHERE is_active')).rows[0].name).toBe(
      'Existing personal plan',
    );
  });

  it('refuses to switch a demo with gym history', async () => {
    await initial();
    await admin.query(await readFile('db/seeds/demo.sql', 'utf8'));
    await admin.query(`INSERT INTO sessions(id,activity_type,performed_on,workout_template_id,wellbeing,sleep_hours,
      warmup_minutes,main_minutes,cardio_minutes,heart_rate_min,heart_rate_max,exertion,request_hash)
      SELECT gen_random_uuid(),'gym','2026-11-01',id,3,8,10,30,0,90,140,4,'gym' FROM workout_templates LIMIT 1`);
    await expect(run(true)).rejects.toThrow('силовая история');
    expect((await admin.query('SELECT count(*)::int AS n FROM sessions')).rows[0].n).toBe(1);
  });

  it('rolls back migrations as well as data if seeding fails', async () => {
    await initial();
    await admin.query(`CREATE FUNCTION reject_seed() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Forced seed failure'; END $$;
      CREATE TRIGGER reject_seed BEFORE INSERT ON exercises FOR EACH ROW EXECUTE FUNCTION reject_seed()`);
    await expect(run(true)).rejects.toThrow('Forced seed failure');
    expect(
      (await admin.query("SELECT to_regclass('schema_migrations') AS t")).rows[0].t,
    ).toBeNull();
    expect(
      (
        await admin.query(
          "SELECT conname FROM pg_constraint WHERE conrelid='sessions'::regclass AND conname='sessions_check1'",
        )
      ).rowCount,
    ).toBe(1);
    expect((await admin.query('SELECT count(*)::int AS n FROM exercises')).rows[0].n).toBe(0);
  });

  it('refuses partial schemas and an inactive existing personal program', async () => {
    await admin.query('CREATE TABLE exercises(id uuid)');
    await expect(run(true)).rejects.toThrow('Неполная схема');
    await admin.query('DROP TABLE exercises');
    await run(true);
    await admin.query('UPDATE programs SET is_active=false');
    await expect(run(true)).rejects.toThrow('не активна');
  });
});
