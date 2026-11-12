import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';
import pg from 'pg';
import { content, insertOption } from './program-data.mjs';

const base = JSON.parse(
  await readFile(new URL('../db/seeds/next-cycle.json', import.meta.url), 'utf8'),
);
const update = JSON.parse(
  await readFile(new URL('../db/seeds/workout-update-v3.json', import.meta.url), 'utf8'),
);
const catalog = { ...base.exercises, ...update.exercises };
const changes = new Map(update.workouts.map((w) => [w.position, w]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const neededKeys = [
  ...new Set(
    update.workouts.flatMap((w) =>
      w.exercises.flatMap((s) => [
        s.exercise,
        ...(base.replacements[s.exercise] ? [base.replacements[s.exercise].exercise] : []),
      ]),
    ),
  ),
];

async function historyFingerprint(client) {
  const result = {};
  for (const table of ['sessions', 'session_exercises', 'session_sets'])
    result[table] = (
      await client.query(
        `SELECT count(*)::int AS count,md5(COALESCE(string_agg(to_jsonb(t)::text,'' ORDER BY id),'')) AS digest FROM ${table} t`,
      )
    ).rows[0];
  return result;
}

async function resolveExercises(client, insertMissing) {
  const result = new Map();
  for (const key of neededKeys) {
    const e = catalog[key];
    const { rows } = await client.query(
      'SELECT * FROM exercises WHERE name=$1 AND archived_at IS NULL',
      [e.name],
    );
    if (rows.length > 1) throw new Error(`Неоднозначное упражнение: ${e.name}`);
    let found = rows[0];
    if (!found && insertMissing)
      found = (
        await client.query(
          `INSERT INTO exercises(name,equipment,measurement_type,weight_type,per_side,instructions)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
          [e.name, e.equipment, e.measurement, e.weightType, e.perSide, e.instructions],
        )
      ).rows[0];
    if (
      found &&
      (found.measurement_type !== e.measurement ||
        found.weight_type !== e.weightType ||
        found.per_side !== e.perSide)
    )
      throw new Error(`Несовместимый способ учёта: ${e.name}`);
    result.set(key, found ?? null);
  }
  return result;
}

function expectedContent(original, exercises) {
  const option = (slot, position, primary) => {
    const e = exercises.get(slot.exercise);
    if (!e) throw new Error(`Не найдено упражнение ${catalog[slot.exercise].name}`);
    return {
      position,
      exerciseId: e.id,
      name: e.name,
      equipment: e.equipment,
      measurement: e.measurement_type,
      weightType: e.weight_type,
      perSide: e.per_side,
      instructions: e.instructions,
      primary,
      notes: [
        slot.condition,
        `Отдых ${catalog[slot.exercise].rest}.`,
        'Запас — около 3 повторений.',
      ]
        .filter(Boolean)
        .join(' '),
      plan: [1, 2].map((position) => ({
        position,
        repsMin: slot.reps?.[0] ?? null,
        repsMax: slot.reps?.[1] ?? null,
        seconds: slot.seconds?.[0] ?? null,
        secondsMax: slot.seconds?.[1] ?? null,
      })),
    };
  };
  return original.map((t) => {
    const w = changes.get(t.position);
    if (!w) return t;
    return {
      position: w.position,
      name: w.name,
      notes: update.notes,
      options: w.exercises.flatMap((slot, i) => [
        option(slot, i + 1, true),
        ...(base.replacements[slot.exercise]
          ? [option(base.replacements[slot.exercise], i + 1, false)]
          : []),
      ]),
    };
  });
}

export async function updateWorkouts({ connectionString, apply = false }) {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    await client.query(apply ? 'BEGIN' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query(
      "SET LOCAL search_path TO public; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s'",
    );
    if (apply) {
      const lock = (await client.query('SELECT pg_try_advisory_xact_lock(824906) AS acquired'))
        .rows[0];
      if (!lock.acquired) throw new Error('Другая операция с базой уже выполняется.');
      await client.query(
        'LOCK TABLE programs,sessions,session_exercises,session_sets,workout_templates,workout_exercise_options,workout_planned_sets,exercises IN SHARE ROW EXCLUSIVE MODE',
      );
    }
    const programs = (await client.query('SELECT * FROM programs')).rows;
    const source = programs.find(
      (p) => p.name === update.name && p.version === update.sourceVersion,
    );
    if (!source || source.status !== 'published' || source.workout_count !== 16)
      throw new Error('Нужна опубликованная версия 2 с тренировками 1–16.');
    const original = await content(client, source.id);
    if (original.length !== 16 || original.some((t, i) => t.position !== i + 1))
      throw new Error('Исходная программа должна содержать все номера 1–16.');
    const existing = programs.find((p) => p.name === update.name && p.version === update.version);
    const before = await historyFingerprint(client);
    const report = {
      mode: apply ? 'apply' : 'check',
      action: existing ? 'already_updated' : apply ? 'updated' : 'update',
      sourceVersion: update.sourceVersion,
      targetVersion: update.version,
      nextPosition: existing?.next_position ?? source.next_position,
      totalWorkouts: source.workout_count,
      repeatFrom: source.repeat_from,
      changedWorkouts: [...changes.keys()],
      historyCounts: Object.fromEntries(
        Object.entries(before).map(([table, v]) => [table, v.count]),
      ),
    };
    if (existing) {
      if (
        !existing.is_active ||
        existing.status !== 'published' ||
        existing.workout_count !== source.workout_count ||
        existing.repeat_from !== source.repeat_from
      )
        throw new Error(
          'Версия 3 уже существует, но не активна или отличается настройками. Автоматическое переключение остановлено.',
        );
      if (
        !same(
          await content(client, existing.id),
          expectedContent(original, await resolveExercises(client, false)),
        )
      )
        throw new Error('Существующая версия 3 отличается от заданного плана.');
      await client.query('ROLLBACK');
      return report;
    }
    if (!source.is_active)
      throw new Error('Активна другая программа. Автоматическое переключение остановлено.');
    const exercises = await resolveExercises(client, apply);
    if (!apply) {
      await client.query('ROLLBACK');
      return report;
    }
    const expected = expectedContent(original, exercises);
    const target = (
      await client.query(
        `INSERT INTO programs(name,version,workout_count,repeat_from,next_position,revision)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
        [
          update.name,
          update.version,
          source.workout_count,
          source.repeat_from,
          source.next_position,
          source.revision + 1,
        ],
      )
    ).rows[0];
    for (const t of expected) {
      const template = (
        await client.query(
          'INSERT INTO workout_templates(program_id,position,name,notes) VALUES($1,$2,$3,$4) RETURNING id',
          [target.id, t.position, t.name, t.notes],
        )
      ).rows[0];
      for (const o of t.options) await insertOption(client, template.id, o);
    }
    if (
      !same(expected, await content(client, target.id)) ||
      !same(original, await content(client, source.id)) ||
      !same(before, await historyFingerprint(client))
    )
      throw new Error(
        'Проверка состава программы или сохранности истории не пройдена. Изменения отменены.',
      );
    await client.query('UPDATE programs SET is_active=false,revision=revision+1 WHERE id=$1', [
      source.id,
    ]);
    await client.query("UPDATE programs SET status='published',is_active=true WHERE id=$1", [
      target.id,
    ]);
    await client.query('COMMIT');
    return report;
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
  const env = parseEnv(await readFile(resolve(values['env-file']), 'utf8'));
  if (!env.DATABASE_URL) throw new Error('В выбранном файле нет DATABASE_URL.');
  const target = new URL(env.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(target.protocol))
    throw new Error('Нужна строка подключения PostgreSQL.');
  console.log(`База: ${target.hostname}:${target.port || '5432'}${target.pathname}`);
  console.log(
    values.apply ? 'Обновление тренировок 3–9 одной транзакцией.' : 'Проверка без записи.',
  );
  console.log(
    JSON.stringify(
      await updateWorkouts({ connectionString: env.DATABASE_URL, apply: !!values.apply }),
      null,
      2,
    ),
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(
      error.code
        ? `Ошибка (${error.code}). Обновление не завершено; транзакция откатилась либо не начиналась.`
        : error.message,
    );
    process.exitCode = 1;
  });
