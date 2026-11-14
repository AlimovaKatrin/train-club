import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { readDatabaseTarget } from './database-target.mjs';
import { content, insertOption } from './program-data.mjs';
const base = JSON.parse(
  await readFile(new URL('../db/seeds/next-cycle.json', import.meta.url), 'utf8'),
);
const previousUpdate = JSON.parse(
  await readFile(new URL('../db/seeds/workout-update-v3.json', import.meta.url), 'utf8'),
);
const update = JSON.parse(
  await readFile(new URL('../db/seeds/replacements-v4.json', import.meta.url), 'utf8'),
);
const catalog = { ...base.exercises, ...previousUpdate.exercises, ...update.exercises };
const primaryKeys = new Map(Object.entries(catalog).map(([key, exercise]) => [exercise.name, key]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function replacementRules(primary) {
  const key = primaryKeys.get(primary.name);
  const rules = update.replacements[key];
  if (!rules?.length) throw new Error(`Нет справочника замен: ${primary.name}`);
  return rules;
}

function neededExerciseKeys(original) {
  const keys = new Set();
  for (const workout of original) {
    for (const primary of workout.options.filter((option) => option.primary)) {
      const slotKeys = new Set();
      for (const rule of replacementRules(primary)) {
        const definition = catalog[rule.exercise];
        if (!definition || definition.name === primary.name || slotKeys.has(rule.exercise))
          throw new Error(`Некорректная замена: ${primary.name}`);
        const range = definition.measurement === 'reps' ? rule.reps : rule.seconds;
        if (
          !range ||
          range.length !== 2 ||
          !range.every(Number.isInteger) ||
          range[0] <= 0 ||
          range[1] < range[0] ||
          Boolean(rule.reps) === Boolean(rule.seconds)
        )
          throw new Error(`Некорректный план замены: ${definition.name}`);
        slotKeys.add(rule.exercise);
        keys.add(rule.exercise);
      }
    }
  }
  return keys;
}

async function historyFingerprint(client) {
  const result = {};
  for (const table of ['sessions', 'session_exercises', 'session_sets'])
    result[table] = (
      await client.query(`SELECT count(*)::int AS count,
        md5(COALESCE(string_agg(to_jsonb(t)::text, '' ORDER BY id), '')) AS digest
      FROM ${table} t`)
    ).rows[0];
  return result;
}
async function resolveExercises(client, neededKeys, insertMissing) {
  const result = new Map();
  for (const key of neededKeys) {
    const exerciseDefinition = catalog[key];
    const { rows } = await client.query(
      'SELECT * FROM exercises WHERE name=$1 AND archived_at IS NULL',
      [exerciseDefinition.name],
    );
    if (rows.length > 1) throw new Error(`Неоднозначное упражнение: ${exerciseDefinition.name}`);
    let found = rows[0];
    if (!found && insertMissing)
      found = (
        await client.query(
          `INSERT INTO exercises(name, equipment, measurement_type, weight_type, per_side, instructions)
            VALUES($1, $2, $3, $4, $5, $6)
            RETURNING *`,
          [
            exerciseDefinition.name,
            exerciseDefinition.equipment,
            exerciseDefinition.measurement,
            exerciseDefinition.weightType,
            exerciseDefinition.perSide,
            exerciseDefinition.instructions,
          ],
        )
      ).rows[0];
    if (
      found &&
      (found.measurement_type !== exerciseDefinition.measurement ||
        found.weight_type !== exerciseDefinition.weightType ||
        found.per_side !== exerciseDefinition.perSide)
    )
      throw new Error(`Несовместимый способ учёта: ${exerciseDefinition.name}`);
    result.set(key, found ?? null);
  }
  return result;
}
function expectedContent(original, exercises) {
  return original.map((workout) => {
    const options = [];
    for (const primary of workout.options.filter((option) => option.primary)) {
      options.push(primary);
      const alternatives = [];
      for (const rule of replacementRules(primary)) {
        const definition = catalog[rule.exercise];
        const exercise = exercises.get(rule.exercise);
        if (!exercise) throw new Error(`Не найдено упражнение ${definition.name}`);
        alternatives.push({
          position: primary.position,
          exerciseId: exercise.id,
          name: exercise.name,
          equipment: exercise.equipment,
          measurement: exercise.measurement_type,
          weightType: exercise.weight_type,
          perSide: exercise.per_side,
          instructions: exercise.instructions,
          primary: false,
          notes: [rule.condition, `Отдых ${definition.rest}.`, update.notes]
            .filter(Boolean)
            .join(' '),
          plan: Array.from({ length: update.workingSets }, (_, index) => ({
            position: index + 1,
            repsMin: rule.reps?.[0] ?? null,
            repsMax: rule.reps?.[1] ?? null,
            seconds: rule.seconds?.[0] ?? null,
            secondsMax: rule.seconds?.[1] ?? null,
          })),
        });
      }
      alternatives.sort((a, b) => a.exerciseId.localeCompare(b.exerciseId));
      options.push(...alternatives);
    }
    return { ...workout, options };
  });
}

export async function updateReplacements({ connectionString, apply = false }) {
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
      await client.query(`LOCK TABLE programs,
          sessions,
          session_exercises,
          session_sets,
          workout_templates,
          workout_exercise_options,
          workout_planned_sets,
          exercises IN SHARE ROW EXCLUSIVE MODE`);
    }
    const programs = (await client.query('SELECT * FROM programs')).rows;
    const source = programs.find(
      (program) => program.name === update.name && program.version === update.sourceVersion,
    );
    if (!source || source.status !== 'published' || source.workout_count !== 16)
      throw new Error('Нужна опубликованная версия 3 с тренировками 1–16.');
    const original = await content(client, source.id);
    if (
      original.length !== 16 ||
      original.some((templateDefinition, index) => templateDefinition.position !== index + 1)
    )
      throw new Error('Исходная программа должна содержать все номера 1–16.');
    const neededKeys = neededExerciseKeys(original);
    const existing = programs.find(
      (program) => program.name === update.name && program.version === update.version,
    );
    let primarySlots = 0;
    let replacementOptions = 0;
    for (const workout of original) {
      const primaries = workout.options.filter((option) => option.primary);
      if (!primaries.length) throw new Error(`Нет основных упражнений: ${workout.name}`);
      primarySlots += primaries.length;
      for (const primary of primaries) replacementOptions += replacementRules(primary).length;
    }
    const before = await historyFingerprint(client);
    let action = apply ? 'updated' : 'update';
    if (existing) action = 'already_updated';
    const report = {
      mode: apply ? 'apply' : 'check',
      action,
      sourceVersion: update.sourceVersion,
      targetVersion: update.version,
      nextPosition: existing?.next_position ?? source.next_position,
      totalWorkouts: source.workout_count,
      repeatFrom: source.repeat_from,
      changedWorkouts: original.map((workout) => workout.position),
      primarySlots,
      replacementOptions,
      historyCounts: Object.fromEntries(
        Object.entries(before).map(([table, tableFingerprint]) => [table, tableFingerprint.count]),
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
          'Версия 4 уже существует, но не активна или отличается настройками. Автоматическое переключение остановлено.',
        );
      if (
        !same(
          await content(client, existing.id),
          expectedContent(original, await resolveExercises(client, neededKeys, false)),
        )
      )
        throw new Error('Существующая версия 4 отличается от заданного плана.');
      await client.query('ROLLBACK');
      return report;
    }
    if (!source.is_active)
      throw new Error('Активна другая программа. Автоматическое переключение остановлено.');
    const exercises = await resolveExercises(client, neededKeys, apply);
    if (!apply) {
      await client.query('ROLLBACK');
      return report;
    }
    const expected = expectedContent(original, exercises);
    const target = (
      await client.query(
        `INSERT INTO programs(name, version, workout_count, repeat_from, next_position, revision)
          VALUES($1, $2, $3, $4, $5, $6)
          RETURNING id`,
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
    for (const templateDefinition of expected) {
      const template = (
        await client.query(
          'INSERT INTO workout_templates(program_id,position,name,notes) VALUES($1,$2,$3,$4) RETURNING id',
          [
            target.id,
            templateDefinition.position,
            templateDefinition.name,
            templateDefinition.notes,
          ],
        )
      ).rows[0];
      for (const option of templateDefinition.options)
        await insertOption(client, template.id, option);
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
  const target = await readDatabaseTarget(values['env-file'], {
    missingUrlMessage: 'В выбранном файле нет DATABASE_URL.',
    protocolMessage: 'Нужна строка подключения PostgreSQL.',
  });
  console.log(`База: ${target.label}`);
  console.log(
    values.apply
      ? 'Обновление замен во всех тренировках 1–16 одной транзакцией.'
      : 'Проверка без записи.',
  );
  console.log(
    JSON.stringify(
      await updateReplacements({
        connectionString: target.connectionString,
        apply: !!values.apply,
      }),
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
