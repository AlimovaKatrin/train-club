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
  programVersion?: number;
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
export const provenanceFields = [
  'sleep',
  'pulseMin',
  'pulseMax',
  'durationMinutes',
  'warmup',
  'main',
  'cardio',
] as const;
export type ProvenanceField = (typeof provenanceFields)[number];
export const sourceSchema = z.enum(['user_confirmed', 'device', 'default', 'unknown']);
export type ValueSource = z.infer<typeof sourceSchema>;
export const provenanceSchema = z
  .object({
    sleep: sourceSchema.optional(),
    pulseMin: sourceSchema.optional(),
    pulseMax: sourceSchema.optional(),
    durationMinutes: sourceSchema.optional(),
    warmup: sourceSchema.optional(),
    main: sourceSchema.optional(),
    cardio: sourceSchema.optional(),
  })
  .strict();
export const sourceNames: Record<ValueSource, string> = {
  user_confirmed: 'Подтверждено тобой',
  device: 'Получено с устройства',
  default: 'По умолчанию · не подтверждено',
  unknown: 'Источник неизвестен',
};
export function fieldSource(
  input: { provenance?: Partial<Record<ProvenanceField, ValueSource>> },
  field: ProvenanceField,
): ValueSource {
  return input.provenance?.[field] ?? 'unknown';
}
export function trustedSource(source: ValueSource) {
  return source === 'user_confirmed' || source === 'device';
}
export const sessionSchema = z
  .object({
    id: z.uuid(),
    activity: z.enum(['gym', 'pilates', 'boxing']),
    date: z.iso.date(),
    wellbeing: z.number().int().min(0).max(5),
    sleep: z.number().min(0).max(24).nullable(),
    warmup: z.number().int().min(0).max(1440).nullable(),
    main: z.number().int().min(0).max(1440).nullable(),
    cardio: z.number().int().min(0).max(1440).nullable(),
    durationMinutes: z.number().int().min(1).max(1440).nullable(),
    pulseMin: z.number().int().positive().max(400).nullable(),
    pulseMax: z.number().int().positive().max(400).nullable(),
    exertion: z.number().int().min(0).max(10),
    notes: z.string().max(5000),
    provenance: provenanceSchema.optional(),
    pulseDevice: z.string().trim().max(200).nullable().optional(),
    templateId: z.uuid().nullable(),
    programRevision: z.number().int().nonnegative().nullable(),
    planToken: z.string().nullable(),
    exercises: z
      .array(
        z
          .object({
            optionId: z.uuid(),
            equipmentNote: z.string().trim().max(300).nullable().optional(),
            sets: z.array(setSchema).max(101),
          })
          .strict(),
      )
      .max(100),
  })
  .strict()
  .superRefine((session, context) => {
    const fail = (message: string) => context.addIssue({ code: 'custom', message });
    const pulseIsReversed =
      session.pulseMin !== null && session.pulseMax !== null && session.pulseMin > session.pulseMax;
    if (pulseIsReversed) {
      fail('Минимальный пульс не может быть выше максимального.');
    }
    if (session.activity === 'gym') {
      if (session.durationMinutes !== null) {
        fail('Для зала время указывается по частям занятия.');
      }
      const hasPlan =
        session.templateId &&
        session.programRevision !== null &&
        session.planToken &&
        session.exercises.length > 0;
      if (!hasPlan) {
        fail('Не найден план тренировки.');
      }
      const hasAllDurations =
        session.warmup !== null && session.main !== null && session.cardio !== null;
      if (!hasAllDurations || duration(session) <= 0) {
        fail('Укажи время зала: разминка, основная часть и кардио.');
      }
      if (session.exercises.some((exercise) => exercise.sets.some((set) => !set.done))) {
        fail('Запиши все рабочие подходы и добавленную разминку.');
      }
      return;
    }
    const hasGymPlan =
      session.templateId !== null ||
      session.programRevision !== null ||
      session.planToken !== null ||
      session.exercises.length > 0;
    const hasGymDuration =
      session.warmup !== null || session.main !== null || session.cardio !== null;
    if (hasGymPlan || hasGymDuration || session.durationMinutes === null) {
      fail('Для бокса и пилатеса укажи продолжительность в минутах, без упражнений.');
    }
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
  session: Pick<SessionInput, 'activity' | 'warmup' | 'main' | 'cardio' | 'durationMinutes'>,
) {
  return session.activity === 'gym'
    ? (session.warmup ?? 0) + (session.main ?? 0) + (session.cardio ?? 0)
    : (session.durationMinutes ?? 0);
}
export function nextPosition(position: number, totalWorkouts = 8, repeatFrom = 1) {
  return position < totalWorkouts ? position + 1 : repeatFrom;
}
export function blankSet(position: number, type: SetResult['type'] = 'working'): SetResult {
  return { position, type, weight: null, reps: null, seconds: null, done: false };
}
export function workingProgress(sets: SetResult[]) {
  return sets.filter((set) => set.type === 'working' && set.done).length;
}
export function hasResults(sets: SetResult[]) {
  return sets.some(
    (set) => set.done || set.weight !== null || set.reps !== null || set.seconds !== null,
  );
}
export function optionSets(option: ExerciseOption) {
  return option.plan.map((set) => blankSet(set.position));
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
      pulseMin: null,
      pulseMax: null,
      pulseDevice: null,
      provenance: {
        sleep: 'default',
        pulseMin: 'unknown',
        pulseMax: 'unknown',
        durationMinutes: gym ? 'unknown' : 'default',
        warmup: gym ? 'default' : 'unknown',
        main: gym ? 'default' : 'unknown',
        cardio: gym ? 'default' : 'unknown',
      },
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
            .filter((option) => option.primary)
            .map((option) => ({ optionId: option.id, sets: optionSets(option) }))
        : [],
    },
  };
}
export function validateSets(sets: SetResult[], option: ExerciseOption) {
  const workingSets = sets.filter((set) => set.type === 'working');
  const warmupSets = sets.filter((set) => set.type === 'warmup');
  if (warmupSets.length > 1 || warmupSets.some((set) => set.position !== 1)) {
    throw new Error('Допустим только один разминочный подход.');
  }
  const positions = new Set(workingSets.map((set) => set.position));
  const matchesPlan =
    workingSets.length === option.plan.length &&
    positions.size === workingSets.length &&
    option.plan.every((plannedSet) => positions.has(plannedSet.position));
  if (!matchesPlan) {
    throw new Error('Рабочие подходы не соответствуют плану.');
  }
  for (const set of sets) {
    if (!set.done) {
      throw new Error('Запиши все рабочие подходы и добавленную разминку.');
    }
    const hasRepetitionsOnly = set.reps !== null && set.seconds === null;
    const hasSecondsOnly = set.seconds !== null && set.reps === null;
    const matchesMeasurement = option.measurement === 'reps' ? hasRepetitionsOnly : hasSecondsOnly;
    if (!matchesMeasurement) {
      throw new Error('Укажи результат в повторениях или секундах согласно упражнению.');
    }
    if (option.weightType === 'none' && set.weight !== null) {
      throw new Error('Для этого упражнения вес не используется.');
    }
  }
}
export function formatSet(set: SetResult) {
  if (!set.done) return 'Не записан';
  const weight = set.weight === null ? '' : `${set.weight} кг × `;
  const result = set.reps ?? set.seconds;
  const unit = set.reps === null ? 'сек' : 'повт.';
  return `${weight}${result} ${unit}`;
}
export function formatPlan(plan: PlannedSet) {
  if (plan.seconds !== null) {
    const upperBound =
      plan.secondsMax != null && plan.secondsMax !== plan.seconds ? `–${plan.secondsMax}` : '';
    return `${plan.seconds}${upperBound} сек`;
  }
  const upperBound = plan.repsMax !== plan.repsMin ? `–${plan.repsMax}` : '';
  return `${plan.repsMin}${upperBound} повт.`;
}
