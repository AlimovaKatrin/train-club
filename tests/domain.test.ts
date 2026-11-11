import { describe, expect, it } from 'vitest';
import {
  blankSet,
  duration,
  hasResults,
  nextPosition,
  newDraft,
  optionSets,
  sessionSchema,
  validateSets,
  workingProgress,
  type ExerciseOption,
} from '../src/lib/domain';
const option: ExerciseOption = {
  id: crypto.randomUUID(),
  exerciseId: crypto.randomUUID(),
  position: 1,
  primary: true,
  name: 'Test',
  equipment: 'Test',
  measurement: 'reps',
  weightType: 'dumbbell',
  perSide: true,
  instructions: '',
  previous: null,
  plan: [
    { position: 1, repsMin: 12, repsMax: 12, seconds: null },
    { position: 2, repsMin: 10, repsMax: 12, seconds: null },
  ],
};
describe('workout rules', () => {
  it('wraps the queue from eight to one', () => expect(nextPosition(8)).toBe(1));
  it('warmup does not replace or count as a working set', () => {
    const sets = [{ ...blankSet(1, 'warmup'), done: true, reps: 12 }, ...optionSets(option)];
    expect(workingProgress(sets)).toBe(0);
    expect(sets.filter((s) => s.type === 'working')).toHaveLength(2);
    sets[1] = { ...sets[1], reps: 12, done: true };
    expect(workingProgress(sets)).toBe(1);
  });
  it('rejects incomplete and duplicate working sets', () => {
    expect(() => validateSets(optionSets(option), option)).toThrow();
    expect(() =>
      validateSets(
        [
          { ...blankSet(1), done: true, reps: 12 },
          { ...blankSet(1), done: true, reps: 12 },
        ],
        option,
      ),
    ).toThrow();
  });
  it('permits unknown weight but requires measured repetitions', () => {
    expect(() =>
      validateSets(
        optionSets(option).map((s) => ({ ...s, done: true, reps: 12 })),
        option,
      ),
    ).not.toThrow();
    expect(() =>
      validateSets(
        optionSets(option).map((s) => ({ ...s, done: true, seconds: 30 })),
        option,
      ),
    ).toThrow();
  });
  it('blocks replacement even if entered results are not marked done', () =>
    expect(hasResults([{ ...blankSet(1), weight: 2.5 }])).toBe(true));
  it('boxing/pilates default to sixty minutes and accept an actual thirty-minute duration', () => {
    for (const type of ['boxing', 'pilates'] as const) {
      const { input } = newDraft(type, '2026-11-08', null);
      expect(duration(input)).toBe(60);
      expect(input.sleep).toBe(8);
      expect(input.pulseMin).toBeNull();
      expect(input.pulseMax).toBeNull();
      expect(input.exercises).toEqual([]);
      expect(sessionSchema.safeParse({ ...input, wellbeing: 0, exertion: 0 }).success).toBe(true);
      const shorter = { ...input, wellbeing: 0, exertion: 0, durationMinutes: 30 };
      expect(sessionSchema.safeParse(shorter).success).toBe(true);
      expect(duration(shorter)).toBe(30);
      for (const durationMinutes of [null, 0, -1, 1.5, 1441, undefined]) {
        expect(sessionSchema.safeParse({ ...shorter, durationMinutes }).success).toBe(false);
      }
    }
  });
  it('rejects impossible dates, inverted pulse and missing scales', () => {
    const { input } = newDraft('boxing', '2026-11-08', null);
    expect(sessionSchema.safeParse(input).success).toBe(false);
    expect(
      sessionSchema.safeParse({ ...input, wellbeing: 3, exertion: 5, pulseMin: 181, pulseMax: 180 })
        .success,
    ).toBe(false);
    expect(
      sessionSchema.safeParse({ ...input, wellbeing: 3, exertion: 5, date: '2026-02-30' }).success,
    ).toBe(false);
  });
});
