import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { readDatabaseTarget } from './database-target.mjs';
async function counts(client) {
  const totals = (
    await client.query(`SELECT (SELECT count(*)::int
      FROM sessions) AS sessions, (SELECT count(*)::int
      FROM session_exercises) AS exercises, (SELECT count(*)::int
      FROM session_sets) AS sets`)
  ).rows[0];
  const activities = (
    await client.query(`SELECT activity_type, count(*)::int AS count
      FROM sessions
      GROUP BY activity_type
      ORDER BY activity_type`)
  ).rows;
  return { ...totals, activities };
}
export async function clearHistory({ connectionString, apply = false }) {
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
        throw new Error('Другая операция с базой уже выполняется. Повтори запуск позже.');
      // Same parent-first order as seeding; block session writes until commit.
      await client.query(
        'LOCK TABLE programs, sessions, session_exercises, session_sets IN SHARE ROW EXCLUSIVE MODE',
      );
    }
    const before = await counts(client);
    const activeProgram = (
      await client.query('SELECT id,next_position FROM programs WHERE is_active')
    ).rows[0];
    const workoutPosition = activeProgram
      ? { before: activeProgram.next_position, after: 1 }
      : null;
    if (!apply) {
      await client.query('ROLLBACK');
      return { mode: 'check', ...before, workoutPosition };
    }
    if (activeProgram && (before.sessions > 0 || activeProgram.next_position !== 1)) {
      // Invalidate gym drafts from before the reset, even when the queue was
      // already at position 1 after a completed cycle. Empty retries are a no-op.
      await client.query('UPDATE programs SET next_position=1,revision=revision+1 WHERE id=$1', [
        activeProgram.id,
      ]);
    }
    const deletedSets = await client.query('DELETE FROM session_sets');
    const deletedExercises = await client.query('DELETE FROM session_exercises');
    const deletedSessions = await client.query('DELETE FROM sessions');
    const after = await counts(client);
    if (
      after.sessions ||
      after.exercises ||
      after.sets ||
      deletedSets.rowCount !== before.sets ||
      deletedExercises.rowCount !== before.exercises ||
      deletedSessions.rowCount !== before.sessions
    )
      throw new Error('Проверка очистки не пройдена. Изменения отменены.');
    await client.query('COMMIT');
    return { mode: 'apply', ...before, workoutPosition };
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
  // No fallback to a dev shell's DATABASE_URL or .env.local.
  const target = await readDatabaseTarget(values['env-file']);
  console.log(`База: ${target.label}`);
  console.log(
    values.apply
      ? 'Удаление всей истории и возврат активной программы к тренировке №1.'
      : 'Проверка без изменений. Записи для очистки и сброс номера тренировки:',
  );
  const result = await clearHistory({
    connectionString: target.connectionString,
    apply: !!values.apply,
  });
  console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(
      error.code
        ? `Ошибка (${error.code}). Очистка не завершена; транзакция откатилась либо не начиналась.`
        : error.message,
    );
    process.exitCode = 1;
  });
}
