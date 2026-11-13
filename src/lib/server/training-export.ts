import 'server-only';
import { transaction } from './db';
import { buildTrainingExport, exportPeriod, type ExportQuery } from '../training-export';
import {
  mapExportSession,
  mapExportExercise,
  type SessionRow,
  type ExerciseRow,
  type SetRow,
} from './export-mapping';
function groupBy<T>(rows: T[], key: (row: T) => string) {
  const result = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    result.set(id, [...(result.get(id) ?? []), row]);
  }
  return result;
}
export async function loadTrainingExport(query: ExportQuery, now = new Date()) {
  return transaction(async (db) => {
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    await db.query("SET LOCAL statement_timeout='60s'");
    const period = exportPeriod(query, now);
    const { rows: sessions } = await db.query<SessionRow>(
      `SELECT s.*,
          s.performed_on::text AS date,
          t.program_id,
          t.position AS workout_position,
          t.name AS workout_name,
          p.version AS program_version,
          p.name AS program_name
        FROM sessions s
        LEFT JOIN workout_templates t ON t.id=s.workout_template_id
        LEFT JOIN programs p ON p.id=t.program_id
        WHERE ($1::date IS NULL OR s.performed_on >= $1::date)
          AND ($2::date IS NULL OR s.performed_on <= $2::date)
        ORDER BY s.performed_on, s.created_at, s.id`,
      [period.from, period.to],
    );
    const ids = sessions.map((s) => s.id);
    const { rows: exercises } = await db.query<ExerciseRow>(
      `SELECT e.*, o.id AS primary_option_id, o.exercise_id AS primary_exercise_id
        FROM session_exercises e
        JOIN sessions s ON s.id=e.session_id
        LEFT JOIN workout_exercise_options o ON o.workout_template_id=s.workout_template_id
          AND o.position=e.position
          AND o.is_primary
        WHERE e.session_id=ANY($1::uuid[])
        ORDER BY e.session_id, e.position`,
      [ids],
    );
    const { rows: sets } = await db.query<SetRow>(
      `SELECT ss.*, to_jsonb(ss)->>'target_duration_seconds_max' AS seconds_max
        FROM session_sets ss
        JOIN session_exercises e ON e.id=ss.session_exercise_id
        WHERE e.session_id=ANY($1::uuid[])
        ORDER BY e.session_id,
          e.position,
          CASE WHEN ss.set_type='warmup' THEN 0 ELSE 1 END,
          ss.position`,
      [ids],
    );
    const bySession = groupBy(exercises, (e) => e.session_id);
    const byExercise = groupBy(sets, (s) => s.session_exercise_id);
    const records = sessions.map((session) => {
      const recordedExercises = bySession.get(session.id) ?? [];
      const actual = recordedExercises.map((exercise) =>
        mapExportExercise(exercise, byExercise.get(exercise.id) ?? [], session.workout_snapshot),
      );
      return mapExportSession(session, actual);
    });
    return buildTrainingExport(records, query, now);
  });
}
