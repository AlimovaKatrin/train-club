import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL in .env.local');
const task = process.argv[2];
if (!['migrate', 'demo', 'personal'].includes(task))
  throw new Error('Use migrate, demo or personal');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  await client.query('SELECT pg_advisory_lock(824906)');
  if (task === 'migrate') {
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY)');
    const { rows } = await client.query("SELECT to_regclass('public.sessions') AS existing");
    if (rows[0].existing) console.log('Initial migration already applied.');
    else {
      await client.query(
        await readFile(new URL('../db/migrations/001_initial.sql', import.meta.url), 'utf8'),
      );
      console.log('Applied 001_initial.sql');
    }
    // Adopt databases created before migration tracking was introduced.
    await client.query(
      "INSERT INTO schema_migrations(name) VALUES ('001_initial.sql') ON CONFLICT DO NOTHING",
    );
    const directory = new URL('../db/migrations/', import.meta.url);
    for (const name of (await readdir(directory)).filter((n) => n.endsWith('.sql')).sort()) {
      const applied = await client.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name]);
      if (applied.rowCount) continue;
      await client.query('BEGIN');
      try {
        await client.query(await readFile(new URL(name, directory), 'utf8'));
        await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [name]);
        await client.query('COMMIT');
        console.log(`Applied ${name}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } else if (task === 'personal') {
    await client.query(
      await readFile(new URL('../db/seeds/personal.sql', import.meta.url), 'utf8'),
    );
    console.log('Personal A/B program is loaded (8 workouts).');
  } else {
    await client.query(await readFile(new URL('../db/seeds/demo.sql', import.meta.url), 'utf8'));
    console.log('Loaded DEMO program. Do not use this seed for your personal training plan.');
  }
} finally {
  await client.end();
}
