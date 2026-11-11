import { z } from 'zod';
import {
  activityNames,
  trustedSource,
  type Activity,
  type PlannedSet,
  type SetResult,
  type ValueSource,
  type ExerciseOption,
} from './domain';

export type Metric = { value: number | null; source: ValueSource };
export type ExportPlan = {
  position: number;
  repetitions: { min: number; max: number } | null;
  seconds: { min: number; max: number } | null;
};
export type ExportExerciseIdentity = {
  position: number | null;
  primary: boolean | null;
  optionId: string;
  exerciseId: string;
  name: string | null;
  equipment: string | null;
  measurement: 'reps' | 'time' | null;
  weightType: ExerciseOption['weightType'] | null;
  perSide: boolean | null;
  instructions: string | null;
  plan: ExportPlan[] | null;
};
export type ExportSet = SetResult & {
  plan: ExportPlan | null;
  adherence: 'within' | 'below' | 'above' | 'unknown' | 'not_applicable' | 'not_done';
};
export type ExportExercise = ExportExerciseIdentity & {
  position: number;
  equipmentNote: string | null;
  isReplacement: boolean | null;
  originalExercise: ExportExerciseIdentity | null;
  originalMetadataSource:
    'saved_snapshot' | 'selected_snapshot' | 'legacy_identity_only' | 'unknown';
  sets: ExportSet[];
};
export type ExportSession = {
  id: string;
  date: string;
  activity: Activity;
  activityName: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  program: null | {
    id: string;
    version: number | null;
    name: string;
    queueRevisionAtSave: number | null;
    workoutId: string;
    workoutNumber: number;
    workoutName: string;
    metadataSource: 'saved_snapshot' | 'immutable_catalog';
    savedPlan: {
      source: 'saved_snapshot' | 'legacy_selected_snapshots';
      options: ExportExerciseIdentity[];
    };
  };
  duration: {
    totalMinutes: Metric;
    warmupMinutes: Metric;
    mainMinutes: Metric;
    cardioMinutes: Metric;
    activityMinutes: Metric;
  };
  before: { sleepHours: Metric; wellbeing: { value: number; scale: [0, 5] } };
  after: { exertion: { value: number; scale: [0, 10] }; note: string };
  pulse: {
    min: Metric;
    max: Metric;
    measurementSource: string | null;
    unverifiedValuesOmitted: boolean;
  };
  exercises: ExportExercise[];
};
export const exportQuerySchema = z
  .object({
    range: z.enum(['12weeks', 'all', 'custom']).default('12weeks'),
    timeZone: z
      .string()
      .max(100)
      .default('Europe/Istanbul')
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, 'Неизвестный часовой пояс.'),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.range === 'custom' && (!value.from || !value.to || value.from > value.to))
      ctx.addIssue({
        code: 'custom',
        message: 'Укажи начало и конец периода в правильном порядке.',
      });
  });
export type ExportQuery = z.infer<typeof exportQuerySchema>;
export function shiftDate(date: string, days: number) {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}
export function calendarDate(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (key: string) => parts.find((p) => p.type === key)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function exportPeriod(query: ExportQuery, now: Date) {
  const today = calendarDate(now, query.timeZone);
  return query.range === 'all'
    ? { from: null, to: null }
    : query.range === 'custom'
      ? { from: query.from!, to: query.to! }
      : { from: shiftDate(today, -83), to: today };
}
export function exportPlan(p: PlannedSet): ExportPlan {
  return {
    position: p.position,
    repetitions:
      p.repsMin === null || p.repsMax === null ? null : { min: p.repsMin, max: p.repsMax },
    seconds: p.seconds === null ? null : { min: p.seconds, max: p.secondsMax ?? p.seconds },
  };
}
export function exportSet(s: SetResult, plan: ExportPlan | null): ExportSet {
  const range = plan?.repetitions ?? plan?.seconds;
  const actual = plan?.repetitions ? s.reps : s.seconds;
  const adherence =
    s.type !== 'working'
      ? 'not_applicable'
      : !s.done
        ? 'not_done'
        : !range || actual === null
          ? 'unknown'
          : actual < range.min
            ? 'below'
            : actual > range.max
              ? 'above'
              : 'within';
  return { ...s, plan, adherence };
}
function weekStart(date: string) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return shiftDate(date, -((day + 6) % 7));
}
const activities = Object.keys(activityNames) as Activity[];
function weeklyActivity() {
  return {
    sessions: 0,
    reportedMinutes: 0,
    confirmedMinutes: 0,
    unverifiedMinutes: 0,
    minutesBySource: { user_confirmed: 0, device: 0, default: 0, unknown: 0 },
    sessionsWithUnverifiedDuration: 0,
    sessionsWithMissingDuration: 0,
  };
}
export function buildTrainingExport(sessions: ExportSession[], query: ExportQuery, now: Date) {
  const requested = exportPeriod(query, now);
  const sorted = [...sessions].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  );
  const from = requested.from ?? sorted[0]?.date ?? null;
  const to = requested.to ?? sorted.at(-1)?.date ?? null;
  const weeks: {
    weekStart: string;
    weekEnd: string;
    coverageFrom: string;
    coverageTo: string;
    activities: Record<Activity, ReturnType<typeof weeklyActivity>>;
  }[] = [];
  if (from && to)
    for (let date = weekStart(from); date <= to; date = shiftDate(date, 7)) {
      const end = shiftDate(date, 6);
      weeks.push({
        weekStart: date,
        weekEnd: end,
        coverageFrom: date < from ? from : date,
        coverageTo: end > to ? to : end,
        activities: { gym: weeklyActivity(), boxing: weeklyActivity(), pilates: weeklyActivity() },
      });
    }
  const byWeek = new Map(weeks.map((w) => [w.weekStart, w]));
  const groups = new Map<
    string,
    {
      comparisonKey: string;
      exerciseId: string;
      name: string | null;
      equipment: string | null;
      equipmentNote: string | null;
      measurement: ExportExercise['measurement'];
      weightType: ExportExercise['weightType'];
      perSide: boolean | null;
      completedWorkingSets: number;
      completedWarmupSets: number;
      adherence: Record<ExportSet['adherence'], number>;
      latestResults: {
        sessionId: string;
        date: string;
        revision: number;
        exercisePosition: number;
        sets: ExportSet[];
      }[];
    }
  >();
  for (const s of sorted) {
    const weekly = byWeek.get(weekStart(s.date))!.activities[s.activity];
    weekly.sessions++;
    const minutes = s.duration.totalMinutes;
    if (minutes.value === null) weekly.sessionsWithMissingDuration++;
    else {
      weekly.reportedMinutes += minutes.value;
      weekly.minutesBySource[minutes.source] += minutes.value;
      if (trustedSource(minutes.source)) weekly.confirmedMinutes += minutes.value;
      else {
        weekly.unverifiedMinutes += minutes.value;
        weekly.sessionsWithUnverifiedDuration++;
      }
    }
    for (const e of s.exercises) {
      const key = JSON.stringify([
        e.exerciseId,
        e.equipment,
        e.equipmentNote,
        e.measurement,
        e.weightType,
        e.perSide,
      ]);
      const group = groups.get(key) ?? {
        comparisonKey: key,
        exerciseId: e.exerciseId,
        name: e.name,
        equipment: e.equipment,
        equipmentNote: e.equipmentNote,
        measurement: e.measurement,
        weightType: e.weightType,
        perSide: e.perSide,
        completedWorkingSets: 0,
        completedWarmupSets: 0,
        adherence: { within: 0, below: 0, above: 0, unknown: 0, not_applicable: 0, not_done: 0 },
        latestResults: [],
      };
      group.name = e.name;
      for (const set of e.sets) {
        if (set.done) {
          if (set.type === 'working') group.completedWorkingSets++;
          else group.completedWarmupSets++;
        }
        if (set.type === 'working') group.adherence[set.adherence]++;
      }
      group.latestResults.unshift({
        exercisePosition: e.position,
        sessionId: s.id,
        date: s.date,
        revision: s.revision,
        sets: e.sets,
      });
      group.latestResults = group.latestResults.slice(0, 3);
      groups.set(key, group);
    }
  }
  let previousGym: ExportSession | null = null;
  const gymIntervals = sorted
    .filter((s) => s.activity === 'gym')
    .map((s) => {
      const days = previousGym
        ? (Date.parse(`${s.date}T00:00:00Z`) - Date.parse(`${previousGym.date}T00:00:00Z`)) /
          86400000
        : null;
      const result = {
        sessionId: s.id,
        date: s.date,
        previousGymSessionId: previousGym?.id ?? null,
        previousGymDate: previousGym?.date ?? null,
        calendarDaysBetween: days,
        fullCalendarDaysWithoutGymBetween: days === null ? null : Math.max(0, days - 1),
      };
      previousGym = s;
      return result;
    });
  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    exportDate: calendarDate(now, query.timeZone),
    timeZone: query.timeZone,
    period: {
      mode: query.range,
      from,
      to,
      boundariesInclusive: true,
      requestedFrom: requested.from,
      requestedTo: requested.to,
    },
    units: {
      weight: 'kg',
      sleep: 'hours',
      sessionDuration: 'minutes',
      setDuration: 'seconds',
      repetitions: 'count',
    },
    rules: {
      dates:
        'Даты занятий — календарные даты дневника без сдвига часового пояса; недели с понедельника. 12 недель = 84 дня включая сегодня.',
      revisions:
        'Повторные выгрузки объединять по ID занятия, оставляя наибольшую revision. Не складывать одинаковые ID.',
      volume:
        'Объём — только выполненные рабочие подходы. Разминка считается отдельно. Тоннаж и мышечные группы не рассчитываются.',
      provenance:
        'user_confirmed — подтверждено пользователем; device — получено с устройства; default — оставлено по умолчанию; unknown — источник неизвестен. Числа не определяют источник.',
      duration:
        'reportedMinutes включает все записанные значения. confirmedMinutes — только подтверждённые или с устройства. Смешанные источники частей зала консервативно считаются непроверенными.',
      pulse:
        'Неподтверждённый пульс (default/unknown) заменён на null. Отсутствие измерения не означает нулевой пульс.',
      comparison:
        'Группировка по ID упражнения, оборудованию, заметке о нём, единице учёта, способу записи веса и признаку стороны. При неизвестной модели тренажёра сопоставимость машин не гарантируется.',
      load: 'Вес одной гантели не удваивается; повторения/секунды на сторону не суммируются. null не заменяется нулём; смысл отсутствия внешнего веса задан weightType=none.',
      recovery:
        'Интервалы между залом считаются только внутри выгрузки по календарным датам; это не часы восстановления и не дни полного отдыха от бокса/пилатеса.',
      history:
        'Экспорт включает весь выбранный период, без ограничения интерфейса в 100 записей. Старые записи не получают вымышленное подтверждение или утраченный снимок исходной замены.',
    },
    summary: {
      sessionCount: sorted.length,
      countsByActivity: Object.fromEntries(
        activities.map((a) => [a, sorted.filter((s) => s.activity === a).length]),
      ),
      weeks,
      sessionDates: sorted.map((s) => ({ id: s.id, date: s.date, activity: s.activity })),
      gymIntervals,
      exercises: [...groups.values()],
      recoveryTimeline: sorted.map((s) => ({
        sessionId: s.id,
        date: s.date,
        activity: s.activity,
        sleepHours: s.before.sleepHours,
        wellbeing: s.before.wellbeing,
        exertion: s.after.exertion,
      })),
      notes: sorted
        .filter(
          (s) => s.after.note.trim() || s.exercises.some((e) => e.isReplacement || e.equipmentNote),
        )
        .map((s) => ({
          sessionId: s.id,
          date: s.date,
          note: s.after.note,
          replacements: s.exercises
            .filter((e) => e.isReplacement)
            .map((e) => ({
              position: e.position,
              original: e.originalExercise,
              actualExerciseId: e.exerciseId,
              actualName: e.name,
            })),
          equipmentNotes: s.exercises
            .filter((e) => e.equipmentNote)
            .map((e) => ({ exerciseId: e.exerciseId, name: e.name, note: e.equipmentNote })),
        })),
      dataQuality: {
        sessionsWithUnverifiedSleep: sorted.filter(
          (s) => s.before.sleepHours.value !== null && !trustedSource(s.before.sleepHours.source),
        ).length,
        sessionsWithOmittedPulse: sorted.filter((s) => s.pulse.unverifiedValuesOmitted).length,
        sessionsWithLegacyPlan: sorted.filter(
          (s) => s.program?.savedPlan.source === 'legacy_selected_snapshots',
        ).length,
      },
    },
    sessions: sorted,
  };
}
