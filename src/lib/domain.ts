import { z } from 'zod';
export const activityNames = { gym: 'Зал', pilates: 'Пилатес', boxing: 'Бокс' } as const;
export type Activity = keyof typeof activityNames;
export const weightNames = {
  dumbbell: 'Вес одной гантели',
  total: 'Общий внешний вес',
  machine: 'Вес на тренажёре',
  none: 'Без внешнего веса',
} as const;
export type PlannedSet = {
  position: number;
  repsMin: number | null;
  repsMax: number | null;
  seconds: number | null;
  secondsMax?: number | null;
};
export type ExerciseOption = {
  id: string;
  exerciseId: string;
  position: number;
  primary: boolean;
  name: string;
  equipment: string;
  measurement: 'reps' | 'time';
  weightType: keyof typeof weightNames;
  perSide: boolean;
  instructions: string;
  plan: PlannedSet[];
  previous: { date: string; sets: SetResult[] } | null;
};
export type Workout = {
  notes?: string;
  totalWorkouts: number;
  repeatFrom: number;
  programId: string;
  revision: number;
  templateId: string;
  position: number;
  name: string;
  programName: string;
  token: string;
  options: ExerciseOption[];
};
const nullablePositive = z.number().int().positive().max(100000).nullable();
export const setSchema = z
  .object({
    position: z.number().int().positive().max(100),
    type: z.enum(['working', 'warmup']),
    weight: z.number().min(0).max(10000).nullable(),
    reps: nullablePositive,
    seconds: nullablePositive,
    done: z.boolean(),
  })
  .strict();
export type SetResult = z.infer<typeof setSchema>;
export const sessionSchema = z
  .object({
    id: z.uuid(),
    activity: z.enum(['gym', 'pilates', 'boxing']),
    date: z.iso.date(),
    wellbeing: z.number().int().min(0).max(5),
    sleep: z.number().min(0).max(24),
    warmup: z.number().int().min(0).max(1440).nullable(),
    main: z.number().int().min(0).max(1440).nullable(),
    cardio: z.number().int().min(0).max(1440).nullable(),
    durationMinutes: z.number().int().min(1).max(1440).nullable(),
    pulseMin: z.number().int().positive().max(400),
    pulseMax: z.number().int().positive().max(400),
    exertion: z.number().int().min(0).max(10),
    notes: z.string().max(5000),
    templateId: z.uuid().nullable(),
    programRevision: z.number().int().nonnegative().nullable(),
    planToken: z.string().nullable(),
    exercises: z
      .array(z.object({ optionId: z.uuid(), sets: z.array(setSchema).max(101) }).strict())
      .max(100),
  })
  .strict()
  .superRefine((s, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (s.pulseMin > s.pulseMax) fail('Минимальный пульс не может быть выше максимального.');
    if (s.activity === 'gym') {
      if (s.durationMinutes !== null) fail('Для зала время указывается по частям занятия.');
      if (!s.templateId || s.programRevision === null || !s.planToken || !s.exercises.length)
        fail('Не найден план тренировки.');
      if (s.warmup === null || s.main === null || s.cardio === null || duration(s) <= 0)
        fail('Укажи время зала: разминка, основная часть и кардио.');
      if (s.exercises.some((e) => e.sets.some((set) => !set.done)))
        fail('Запиши все рабочие подходы и добавленную разминку.');
    } else if (
      s.templateId !== null ||
      s.programRevision !== null ||
      s.planToken !== null ||
      s.exercises.length ||
      s.warmup !== null ||
      s.main !== null ||
      s.cardio !== null ||
      s.durationMinutes === null
    )
      fail('Для бокса и пилатеса укажи продолжительность в минутах, без упражнений.');
  });
export type SessionInput = z.infer<typeof sessionSchema>;
export type SessionRecord = { input: SessionInput; revision: number; workout: Workout | null };
export type Draft = {
  version: 1;
  input: SessionInput;
  workout: Workout | null;
  stage: 'prepare' | 'workout' | 'finish';
  exerciseIndex: number;
  setIndex: number;
  editingRevision: number | null;
};
export type Bootstrap = { workout: Workout | null; history: SessionRecord[] };
export function duration(
  s: Pick<SessionInput, 'activity' | 'warmup' | 'main' | 'cardio' | 'durationMinutes'>,
) {
  return s.activity === 'gym'
    ? (s.warmup ?? 0) + (s.main ?? 0) + (s.cardio ?? 0)
    : (s.durationMinutes ?? 0);
}
export function nextPosition(position: number, totalWorkouts = 8, repeatFrom = 1) {
  return position < totalWorkouts ? position + 1 : repeatFrom;
}
export function blankSet(position: number, type: SetResult['type'] = 'working'): SetResult {
  return { position, type, weight: null, reps: null, seconds: null, done: false };
}
export function workingProgress(sets: SetResult[]) {
  return sets.filter((s) => s.type === 'working' && s.done).length;
}
export function hasResults(sets: SetResult[]) {
  return sets.some((s) => s.done || s.weight !== null || s.reps !== null || s.seconds !== null);
}
export function optionSets(option: ExerciseOption) {
  return option.plan.map((s) => blankSet(s.position));
}
export function newDraft(activity: Activity, date: string, workout: Workout | null): Draft {
  const gym = activity === 'gym';
  return {
    version: 1,
    stage: 'prepare',
    exerciseIndex: 0,
    setIndex: 0,
    editingRevision: null,
    workout: gym ? workout : null,
    input: {
      id: crypto.randomUUID(),
      activity,
      date,
      wellbeing: -1,
      sleep: 8,
      pulseMin: 100,
      pulseMax: 180,
      exertion: -1,
      notes: '',
      warmup: gym ? 0 : null,
      main: gym ? 0 : null,
      cardio: gym ? 0 : null,
      durationMinutes: gym ? null : 60,
      templateId: gym ? workout!.templateId : null,
      programRevision: gym ? workout!.revision : null,
      planToken: gym ? workout!.token : null,
      exercises: gym
        ? workout!.options
            .filter((o) => o.primary)
            .map((o) => ({ optionId: o.id, sets: optionSets(o) }))
        : [],
    },
  };
}
export function validateSets(sets: SetResult[], option: ExerciseOption) {
  const working = sets.filter((s) => s.type === 'working');
  const warmups = sets.filter((s) => s.type === 'warmup');
  if (warmups.length > 1 || warmups.some((s) => s.position !== 1))
    throw new Error('Допустим только один разминочный подход.');
  if (
    working.length !== option.plan.length ||
    new Set(working.map((s) => s.position)).size !== working.length ||
    option.plan.some((p) => !working.some((s) => s.position === p.position))
  )
    throw new Error('Рабочие подходы не соответствуют плану.');
  for (const s of sets) {
    if (!s.done) throw new Error('Запиши все рабочие подходы и добавленную разминку.');
    if (
      option.measurement === 'reps'
        ? s.reps === null || s.seconds !== null
        : s.seconds === null || s.reps !== null
    )
      throw new Error('Укажи результат в повторениях или секундах согласно упражнению.');
    if (option.weightType === 'none' && s.weight !== null)
      throw new Error('Для этого упражнения вес не используется.');
  }
}
export function formatSet(s: SetResult) {
  return s.done
    ? `${s.weight === null ? '' : `${s.weight} кг × `}${s.reps ?? s.seconds} ${s.reps === null ? 'сек' : 'повт.'}`
    : 'Не записан';
}
export function formatPlan(p: PlannedSet) {
  return p.seconds !== null
    ? `${p.seconds}${p.secondsMax != null && p.secondsMax !== p.seconds ? `–${p.secondsMax}` : ''} сек`
    : `${p.repsMin}${p.repsMax !== p.repsMin ? `–${p.repsMax}` : ''} повт.`;
}
