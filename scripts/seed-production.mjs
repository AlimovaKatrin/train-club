import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';
import pg from 'pg';

const programName = 'Силовые A/B · 8 тренировок';
const demoName = 'Демонстрационная программа · не согласована с тренером';
const tables = [
  'exercises',
  'programs',
  'workout_templates',
  'workout_exercise_options',
  'workout_planned_sets',
  'sessions',
  'session_exercises',
  'session_sets',
];
const migrations = new URL('../db/migrations/', import.meta.url);

// Repository SQL may have its own transaction envelope. The production runner
// owns ONE transaction for all migrations, seeding and postconditions.
function transactionBody(sql) {
  return sql
    .replace(/^BEGIN;\s*/i, '')
    .replace(/\bCOMMIT;\s*$/i, '')
    .replace(/^(--[^\n]*\n)*BEGIN;\s*/i, '$1');
}

async function inspect(client) {
  const { rows } = await client.query(
    "SELECT name,to_regclass('public.'||name) IS NOT NULL AS present FROM unnest($1::text[]) AS name",
    [tables],
  );
  const present = rows.filter((r) => r.present).length;
  if (present && present !== tables.length)
    throw new Error('Неполная схема базы. Автоматическое засеивание остановлено.');
  if (!present) return { schemaExists: false, existingProgram: null, sessions: 0 };
  const programs = (
    await client.query('SELECT id,name,version,status,is_active,next_position FROM programs')
  ).rows;
  const counts = (
    await client.query(
      "SELECT count(*)::int AS total,count(*) FILTER (WHERE activity_type='gym')::int AS gym FROM sessions",
    )
  ).rows[0];
  const personal = programs.find((p) => p.name === programName && p.version === 1);
  if (personal) {
    if (!personal.is_active || personal.status !== 'published')
      throw new Error(
        'Программа A/B уже существует, но не активна или не опубликована. Автоматическое переключение остановлено.',
      );
    await verifyProgram(client, personal.id);
  } else if (counts.gym || programs.some((p) => p.is_active && p.name !== demoName)) {
    throw new Error(
      'В базе есть другая личная программа или силовая история. Нужен отдельный переход на новую программу.',
    );
  }
  return { schemaExists: true, existingProgram: personal ?? null, sessions: counts.total };
}

async function verifyProgram(client, programId) {
  const templates = (
    await client.query(
      'SELECT id,position FROM workout_templates WHERE program_id=$1 ORDER BY position',
      [programId],
    )
  ).rows;
  const options = (
    await client.query(
      `SELECT o.id,o.workout_template_id,o.position,o.is_primary,e.name,e.weight_type,e.per_side
    FROM workout_exercise_options o JOIN exercises e ON e.id=o.exercise_id
    JOIN workout_templates t ON t.id=o.workout_template_id WHERE t.program_id=$1`,
      [programId],
    )
  ).rows;
  const sets = (
    await client.query(
      `SELECT s.* FROM workout_planned_sets s
    JOIN workout_exercise_options o ON o.id=s.exercise_option_id
    JOIN workout_templates t ON t.id=o.workout_template_id WHERE t.program_id=$1`,
      [programId],
    )
  ).rows;
  const fail = () => {
    throw new Error(
      'Программа A/B не соответствует ожидаемым 8 тренировкам и планам сгибания ног. Изменения отменены.',
    );
  };
  if (templates.length !== 8 || options.length !== 72 || sets.length !== 144) fail();
  for (const [index, template] of templates.entries()) {
    const exercises = options.filter((o) => o.workout_template_id === template.id);
    if (template.position !== index + 1 || exercises.filter((o) => o.is_primary).length !== 5)
      fail();
    for (const option of exercises) {
      if (sets.filter((s) => s.exercise_option_id === option.id).length !== 2) fail();
    }
    for (const [name, primary] of [
      ['Сгибание ног сидя', true],
      ['Сгибание ног лёжа', false],
    ]) {
      const curl = exercises.find((o) => o.position === 4 && o.name === name);
      if (!curl || curl.is_primary !== primary || curl.weight_type !== 'machine' || curl.per_side)
        fail();
      if (
        sets
          .filter((s) => s.exercise_option_id === curl.id)
          .some(
            (s) =>
              s.target_reps_min !== 12 ||
              s.target_reps_max !== 15 ||
              s.target_duration_seconds !== null,
          )
      )
        fail();
    }
  }
}

export async function seedProduction({ connectionString, apply = false }) {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    await client.query(apply ? 'BEGIN' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query(
      "SET LOCAL search_path TO public; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s'",
    );
    if (apply) {
      const { rows } = await client.query('SELECT pg_try_advisory_xact_lock(824906) AS acquired');
      if (!rows[0].acquired)
        throw new Error('Другая миграция или загрузка уже выполняется. Повтори запуск позже.');
      // Block concurrent session writes/program changes until postconditions pass.
      const existing = await client.query(
        "SELECT to_regclass('public.programs') AS programs,to_regclass('public.sessions') AS sessions",
      );
      if (existing.rows[0].programs && existing.rows[0].sessions)
        await client.query('LOCK TABLE programs, sessions IN SHARE ROW EXCLUSIVE MODE');
    }
    const before = await inspect(client);
    const names = (await readdir(migrations)).filter((n) => n.endsWith('.sql')).sort();
    const ledger = (await client.query("SELECT to_regclass('public.schema_migrations') AS ledger"))
      .rows[0].ledger;
    const applied = ledger
      ? (await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name)
      : [];
    const pending = names.filter(
      (n) => !applied.includes(n) && !(n === '001_initial.sql' && before.schemaExists),
    );
    if (!apply) {
      await client.query('ROLLBACK');
      return {
        mode: 'check',
        action: before.existingProgram ? 'already_loaded' : 'seed',
        pendingMigrations: pending,
        sessions: before.sessions,
      };
    }
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY)');
    if (before.schemaExists)
      await client.query(
        "INSERT INTO schema_migrations(name) VALUES ('001_initial.sql') ON CONFLICT DO NOTHING",
      );
    for (const name of pending) {
      await client.query(transactionBody(await readFile(new URL(name, migrations), 'utf8')));
      await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [name]);
    }
    await client.query(
      transactionBody(await readFile(new URL('../db/seeds/personal.sql', import.meta.url), 'utf8')),
    );
    const after = await inspect(client);
    if (!after.existingProgram || after.sessions !== before.sessions)
      throw new Error(
        'Проверка программы или сохранности истории не пройдена. Изменения отменены.',
      );
    const duration = await client.query(
      "SELECT 1 FROM pg_constraint WHERE conrelid='sessions'::regclass AND conname='sessions_duration_check' AND convalidated",
    );
    if (!duration.rowCount)
      throw new Error('Не применена миграция изменяемой длительности. Изменения отменены.');
    await client.query('COMMIT');
    return {
      mode: 'apply',
      action: before.existingProgram ? 'already_loaded' : 'seeded',
      appliedMigrations: pending,
      sessions: after.sessions,
      nextPosition: after.existingProgram.next_position,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      apply: { type: 'boolean' },
      check: { type: 'boolean' },
      'env-file': { type: 'string', default: '.env.production.local' },
    },
  });
  if (values.apply && values.check) throw new Error('Используй либо --check, либо --apply.');
  // Read ONLY the explicitly selected file, never inherit DATABASE_URL from a
  // local dev shell or load .env.local as a fallback. Never print credentials.
  const env = parseEnv(await readFile(resolve(values['env-file']), 'utf8'));
  if (!env.DATABASE_URL) throw new Error('В выбранном env-файле отсутствует DATABASE_URL.');
  const target = new URL(env.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(target.protocol))
    throw new Error('DATABASE_URL должен быть строкой подключения PostgreSQL.');
  console.log(`База: ${target.hostname}:${target.port || '5432'}${target.pathname}`);
  console.log(
    values.apply
      ? 'Применение миграций и программы одной транзакцией.'
      : 'Проверка без записи в базу.',
  );
  const result = await seedProduction({
    connectionString: env.DATABASE_URL,
    apply: !!values.apply,
  });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // PostgreSQL/network errors can include connection details. Expose their
    // codes only; custom preflight errors contain no connection credentials.
    console.error(
      error.code
        ? `Ошибка (${error.code}). Засеивание не завершено; транзакция откатилась либо не начиналась.`
        : error.message,
    );
    process.exitCode = 1;
  });
}
