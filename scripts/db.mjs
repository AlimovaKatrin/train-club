import { readFile } from 'node:fs/promises';
import pg from 'pg';
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL in .env.local');
const task = process.argv[2];
if (!['migrate', 'demo'].includes(task)) throw new Error('Use migrate or demo');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  await client.query('SELECT pg_advisory_lock(824906)');
  if (task === 'migrate') {
    const { rows } = await client.query("SELECT to_regclass('public.sessions') AS existing");
    if (rows[0].existing) console.log('Initial migration already applied.');
    else {
      await client.query(
        await readFile(new URL('../db/migrations/001_initial.sql', import.meta.url), 'utf8'),
      );
      console.log('Applied 001_initial.sql');
    }
  } else {
    await client.query(await readFile(new URL('../db/seeds/demo.sql', import.meta.url), 'utf8'));
    console.log('Loaded DEMO program. Do not use this seed for your personal training plan.');
  }
} finally {
  await client.end();
}
