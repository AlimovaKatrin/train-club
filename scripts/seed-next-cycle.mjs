import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';
import pg from 'pg';

const definition = JSON.parse(
  await readFile(new URL('../db/seeds/next-cycle.json', import.meta.url), 'utf8'),
);
const sourceName = 'Силовые A/B · 8 тренировок';
const migrations = new URL('../db/migrations/', import.meta.url);
const planned = (slot) =>
  Array.from({ length: definition.workingSets }, (_, i) => ({
    position: i + 1,
    repsMin: slot.reps?.[0] ?? null,
    repsMax: slot.reps?.[1] ?? null,
    seconds: slot.seconds?.[0] ?? null,
    secondsMax: slot.seconds?.[1] ?? null,
  }));
const optionNotes = (slot) =>
  [
    slot.condition,
    `Отдых ${definition.exercises[slot.exercise].rest}.`,
    'Запас — около 3 повторений.',
  ]
    .filter(Boolean)
    .join(' ');

async function content(client, programId) {
  const templates = (
    await client.query('SELECT * FROM workout_templates WHERE program_id=$1 ORDER BY position', [
      programId,
    ])
  ).rows;
  const result = [];
  for (const t of templates) {
    const options = (
      await client.query(
        `SELECT o.*,e.name,e.equipment,e.measurement_type,e.weight_type,e.per_side,e.instructions
      FROM workout_exercise_options o JOIN exercises e ON e.id=o.exercise_id WHERE o.workout_template_id=$1
      ORDER BY o.position,o.is_primary DESC,o.exercise_id`,
        [t.id],
      )
    ).rows;
    const items = [];
    for (const o of options) {
      const sets = (
        await client.query(
          'SELECT * FROM workout_planned_sets WHERE exercise_option_id=$1 ORDER BY position',
          [o.id],
        )
      ).rows;
      items.push({
        position: o.position,
        exerciseId: o.exercise_id,
        name: o.name,
        equipment: o.equipment,
        measurement: o.measurement_type,
        weightType: o.weight_type,
        perSide: o.per_side,
        instructions: o.instructions,
        primary: o.is_primary,
        notes: o.notes,
        plan: sets.map((s) => ({
          position: s.position,
          repsMin: s.target_reps_min,
          repsMax: s.target_reps_max,
          seconds: s.target_duration_seconds,
          secondsMax: s.target_duration_seconds_max ?? null,
        })),
      });
    }
    result.push({ position: t.position, name: t.name, notes: t.notes, options: items });
  }
  return result;
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
function verify(program, actual, original) {
  if (
    !program.is_active ||
    program.status !== 'published' ||
    program.workout_count !== 16 ||
    program.repeat_from !== 9
  )
    throw new Error('Версия 9–16 уже существует, но её статус или очередь не соответствуют плану.');
  if (actual.length !== 16 || !same(actual.slice(0, 8), original))
    throw new Error('Тренировки 1–8 должны точно совпадать с исходной программой.');
  for (const expected of definition.workouts) {
    const workout = actual.find((w) => w.position === expected.position);
    const slots = expected.exercises.flatMap((s, i) => [
      { ...s, position: i + 1, primary: true },
      ...(definition.replacements[s.exercise]
        ? [{ ...definition.replacements[s.exercise], position: i + 1, primary: false }]
        : []),
    ]);
    if (
      !workout ||
      workout.name !== expected.name ||
      workout.notes !== definition.notes ||
      workout.options.length !== slots.length
    )
      throw new Error(`Не совпадает состав тренировки ${expected.position}.`);
    for (const slot of slots) {
      const e = definition.exercises[slot.exercise];
      const actualOption = workout.options.find(
        (o) => o.position === slot.position && o.primary === slot.primary,
      );
      if (
        !actualOption ||
        actualOption.name !== e.name ||
        actualOption.measurement !== e.measurement ||
        actualOption.weightType !== e.weightType ||
        actualOption.perSide !== e.perSide ||
        actualOption.notes !== optionNotes(slot) ||
        !same(actualOption.plan, planned(slot))
      )
        throw new Error(
          `Не совпадает упражнение ${slot.position} в тренировке ${expected.position}.`,
        );
    }
  }
}

async function insertOption(client, templateId, option) {
  const { rows } = await client.query(
    `INSERT INTO workout_exercise_options(workout_template_id,position,exercise_id,is_primary,notes)
    VALUES($1,$2,$3,$4,$5) RETURNING id`,
    [templateId, option.position, option.exerciseId, option.primary, option.notes],
  );
  for (const s of option.plan)
    await client.query(
      `INSERT INTO workout_planned_sets(exercise_option_id,position,target_reps_min,target_reps_max,target_duration_seconds,target_duration_seconds_max)
    VALUES($1,$2,$3,$4,$5,$6)`,
      [rows[0].id, s.position, s.repsMin, s.repsMax, s.seconds, s.secondsMax],
    );
}

export async function seedNextCycle({ connectionString, apply = false }) {
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
        'LOCK TABLE programs, sessions, workout_templates, workout_exercise_options, workout_planned_sets, exercises IN SHARE ROW EXCLUSIVE MODE',
      );
    }
    const programs = (await client.query('SELECT * FROM programs')).rows;
    const source = programs.find((p) => p.name === sourceName && p.version === 1);
    if (!source || source.status !== 'published')
      throw new Error('Сначала загрузи исходную персональную программу 1–8.');
    const original = await content(client, source.id);
    if (original.length !== 8 || original.some((t, i) => t.position !== i + 1))
      throw new Error('Исходная программа должна содержать тренировки 1–8.');
    const existing = programs.find(
      (p) => p.name === definition.name && p.version === definition.version,
    );
    if (existing) {
      verify(existing, await content(client, existing.id), original);
      await client.query('ROLLBACK');
      return {
        mode: apply ? 'apply' : 'check',
        action: 'already_loaded',
        nextPosition: existing.next_position,
        repeatFrom: 9,
        totalWorkouts: 16,
        pendingMigrations: [],
      };
    }
    if (!source.is_active)
      throw new Error('Активна другая программа. Автоматическое переключение остановлено.');
    const last = (
      await client.query(
        `SELECT t.position FROM sessions s JOIN workout_templates t ON t.id=s.workout_template_id
      WHERE t.program_id=$1 ORDER BY s.created_at DESC,s.id DESC LIMIT 1`,
        [source.id],
      )
    ).rows[0];
    // An old 8-workout queue has already wrapped to 1 when workout 8 was saved.
    const next = source.next_position === 1 && last?.position === 8 ? 9 : source.next_position;
    const ledger = (await client.query("SELECT to_regclass('public.schema_migrations') AS ledger"))
      .rows[0].ledger;
    const applied = ledger
      ? (await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name)
      : [];
    const pending = (await readdir(migrations))
      .filter((n) => n.endsWith('.sql') && n !== '001_initial.sql' && !applied.includes(n))
      .sort();
    const report = {
      mode: apply ? 'apply' : 'check',
      action: apply ? 'seeded' : 'seed',
      nextPosition: next,
      repeatFrom: 9,
      totalWorkouts: 16,
      pendingMigrations: pending,
    };
    if (!apply) {
      await client.query('ROLLBACK');
      return report;
    }
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY)');
    await client.query(
      "INSERT INTO schema_migrations(name) VALUES ('001_initial.sql') ON CONFLICT DO NOTHING",
    );
    for (const name of pending) {
      await client.query(await readFile(new URL(name, migrations), 'utf8'));
      await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [name]);
    }
    const exercises = new Map();
    for (const [key, e] of Object.entries(definition.exercises)) {
      let matches = (
        await client.query('SELECT * FROM exercises WHERE name=$1 AND archived_at IS NULL', [
          e.name,
        ])
      ).rows;
      if (matches.length > 1) throw new Error(`Неоднозначное упражнение в справочнике: ${e.name}`);
      if (!matches.length)
        matches = (
          await client.query(
            `INSERT INTO exercises(name,equipment,measurement_type,weight_type,per_side,instructions)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
            [e.name, e.equipment, e.measurement, e.weightType, e.perSide, e.instructions],
          )
        ).rows;
      const found = matches[0];
      if (
        found.measurement_type !== e.measurement ||
        found.weight_type !== e.weightType ||
        found.per_side !== e.perSide
      )
        throw new Error(`Способ учёта упражнения не совпадает: ${e.name}`);
      exercises.set(key, found.id);
    }
    const target = (
      await client.query(
        `INSERT INTO programs(name,version,workout_count,repeat_from,next_position)
      VALUES($1,$2,16,9,$3) RETURNING id`,
        [definition.name, definition.version, next],
      )
    ).rows[0];
    for (const t of original) {
      const template = (
        await client.query(
          'INSERT INTO workout_templates(program_id,position,name,notes) VALUES($1,$2,$3,$4) RETURNING id',
          [target.id, t.position, t.name, t.notes],
        )
      ).rows[0];
      for (const option of t.options) await insertOption(client, template.id, option);
    }
    for (const t of definition.workouts) {
      const template = (
        await client.query(
          'INSERT INTO workout_templates(program_id,position,name,notes) VALUES($1,$2,$3,$4) RETURNING id',
          [target.id, t.position, t.name, definition.notes],
        )
      ).rows[0];
      for (const [i, slot] of t.exercises.entries()) {
        await insertOption(client, template.id, {
          position: i + 1,
          exerciseId: exercises.get(slot.exercise),
          primary: true,
          notes: optionNotes(slot),
          plan: planned(slot),
        });
        const alt = definition.replacements[slot.exercise];
        if (alt)
          await insertOption(client, template.id, {
            position: i + 1,
            exerciseId: exercises.get(alt.exercise),
            primary: false,
            notes: optionNotes(alt),
            plan: planned(alt),
          });
      }
    }
    await client.query('UPDATE programs SET is_active=false,revision=revision+1 WHERE id=$1', [
      source.id,
    ]);
    const published = (
      await client.query(
        "UPDATE programs SET status='published',is_active=true WHERE id=$1 RETURNING *",
        [target.id],
      )
    ).rows[0];
    verify(published, await content(client, target.id), original);
    if (!same(original, await content(client, source.id)))
      throw new Error('Исходные тренировки изменились. Загрузка отменена.');
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
  if (!env.DATABASE_URL) throw new Error('В выбранном env-файле отсутствует DATABASE_URL.');
  const target = new URL(env.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(target.protocol))
    throw new Error('Нужна строка подключения PostgreSQL.');
  console.log(`База: ${target.hostname}:${target.port || '5432'}${target.pathname}`);
  console.log(
    values.apply
      ? 'Добавление цикла 9–16 и переключение программы одной транзакцией.'
      : 'Проверка без записи.',
  );
  console.log(
    JSON.stringify(
      await seedNextCycle({ connectionString: env.DATABASE_URL, apply: !!values.apply }),
      null,
      2,
    ),
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(
      error.code
        ? `Ошибка (${error.code}). Загрузка не завершена; транзакция откатилась либо не начиналась.`
        : error.message,
    );
    process.exitCode = 1;
  });
