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
  const get = (key: string) => parts.find((plan) => plan.type === key)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function exportPeriod(query: ExportQuery, now: Date) {
  const today = calendarDate(now, query.timeZone);
  if (query.range === 'all') return { from: null, to: null };
  if (query.range === 'custom') return { from: query.from!, to: query.to! };
  return { from: shiftDate(today, -83), to: today };
}
export function exportPlan(plan: PlannedSet): ExportPlan {
  return {
    position: plan.position,
    repetitions:
      plan.repsMin === null || plan.repsMax === null
        ? null
        : { min: plan.repsMin, max: plan.repsMax },
    seconds:
      plan.seconds === null ? null : { min: plan.seconds, max: plan.secondsMax ?? plan.seconds },
  };
}
export function exportSet(set: SetResult, plan: ExportPlan | null): ExportSet {
  return { ...set, plan, adherence: setAdherence(set, plan) };
}
function setAdherence(set: SetResult, plan: ExportPlan | null): ExportSet['adherence'] {
  if (set.type !== 'working') return 'not_applicable';
  if (!set.done) return 'not_done';
  const range = plan?.repetitions ?? plan?.seconds;
  const actual = plan?.repetitions ? set.reps : set.seconds;
  if (!range || actual === null) return 'unknown';
  if (actual < range.min) return 'below';
  if (actual > range.max) return 'above';
  return 'within';
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
function summarizeWeeks(sorted: ExportSession[], from: string | null, to: string | null) {
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
  const byWeek = new Map(weeks.map((week) => [week.weekStart, week]));
  for (const session of sorted) {
    const weekly = byWeek.get(weekStart(session.date))!.activities[session.activity];
    weekly.sessions++;
    const minutes = session.duration.totalMinutes;
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
  }
  return weeks;
}

function summarizeExercises(sorted: ExportSession[]) {
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
  for (const session of sorted) {
    for (const exercise of session.exercises) {
      const key = JSON.stringify([
        exercise.exerciseId,
        exercise.equipment,
        exercise.equipmentNote,
        exercise.measurement,
        exercise.weightType,
        exercise.perSide,
      ]);
      const group = groups.get(key) ?? {
        comparisonKey: key,
        exerciseId: exercise.exerciseId,
        name: exercise.name,
        equipment: exercise.equipment,
        equipmentNote: exercise.equipmentNote,
        measurement: exercise.measurement,
        weightType: exercise.weightType,
        perSide: exercise.perSide,
        completedWorkingSets: 0,
        completedWarmupSets: 0,
        adherence: { within: 0, below: 0, above: 0, unknown: 0, not_applicable: 0, not_done: 0 },
        latestResults: [],
      };
      group.name = exercise.name;
      for (const set of exercise.sets) {
        if (set.done) {
          if (set.type === 'working') group.completedWorkingSets++;
          else group.completedWarmupSets++;
        }
        if (set.type === 'working') group.adherence[set.adherence]++;
      }
      group.latestResults.unshift({
        exercisePosition: exercise.position,
        sessionId: session.id,
        date: session.date,
        revision: session.revision,
        sets: exercise.sets,
      });
      group.latestResults = group.latestResults.slice(0, 3);
      groups.set(key, group);
    }
  }
  return [...groups.values()];
}

function gymIntervals(sorted: ExportSession[]) {
  const intervals: {
    sessionId: string;
    date: string;
    previousGymSessionId: string | null;
    previousGymDate: string | null;
    calendarDaysBetween: number | null;
    fullCalendarDaysWithoutGymBetween: number | null;
  }[] = [];
  let previousGym: ExportSession | null = null;
  for (const session of sorted) {
    if (session.activity !== 'gym') continue;
    const days = previousGym
      ? (Date.parse(`${session.date}T00:00:00Z`) - Date.parse(`${previousGym.date}T00:00:00Z`)) /
        86400000
      : null;
    intervals.push({
      sessionId: session.id,
      date: session.date,
      previousGymSessionId: previousGym?.id ?? null,
      previousGymDate: previousGym?.date ?? null,
      calendarDaysBetween: days,
      fullCalendarDaysWithoutGymBetween: days === null ? null : Math.max(0, days - 1),
    });
    previousGym = session;
  }
  return intervals;
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
        activities.map((a) => [a, sorted.filter((session) => session.activity === a).length]),
      ),
      weeks: summarizeWeeks(sorted, from, to),
      sessionDates: sorted.map((session) => ({
        id: session.id,
        date: session.date,
        activity: session.activity,
      })),
      gymIntervals: gymIntervals(sorted),
      exercises: summarizeExercises(sorted),
      recoveryTimeline: sorted.map((session) => ({
        sessionId: session.id,
        date: session.date,
        activity: session.activity,
        sleepHours: session.before.sleepHours,
        wellbeing: session.before.wellbeing,
        exertion: session.after.exertion,
      })),
      notes: sorted
        .filter(
          (session) =>
            session.after.note.trim() ||
            session.exercises.some((exercise) => exercise.isReplacement || exercise.equipmentNote),
        )
        .map((session) => ({
          sessionId: session.id,
          date: session.date,
          note: session.after.note,
          replacements: session.exercises
            .filter((exercise) => exercise.isReplacement)
            .map((exercise) => ({
              position: exercise.position,
              original: exercise.originalExercise,
              actualExerciseId: exercise.exerciseId,
              actualName: exercise.name,
            })),
          equipmentNotes: session.exercises
            .filter((exercise) => exercise.equipmentNote)
            .map((exercise) => ({
              exerciseId: exercise.exerciseId,
              name: exercise.name,
              note: exercise.equipmentNote,
            })),
        })),
      dataQuality: {
        sessionsWithUnverifiedSleep: sorted.filter(
          (session) =>
            session.before.sleepHours.value !== null &&
            !trustedSource(session.before.sleepHours.source),
        ).length,
        sessionsWithOmittedPulse: sorted.filter((session) => session.pulse.unverifiedValuesOmitted)
          .length,
        sessionsWithLegacyPlan: sorted.filter(
          (session) => session.program?.savedPlan.source === 'legacy_selected_snapshots',
        ).length,
      },
    },
    sessions: sorted,
  };
}
