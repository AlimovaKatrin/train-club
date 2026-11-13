import { describe, expect, it } from 'vitest';
import { newDraft, type Draft, type ExerciseOption, type Workout } from '../src/lib/domain';
import { completeCurrentSet, nextPendingExercise } from '../src/lib/workout-draft';

function workoutDraft(): Draft {
  const options: ExerciseOption[] = [1, 2].map((position) => ({
    id: crypto.randomUUID(),
    exerciseId: crypto.randomUUID(),
    position,
    primary: true,
    name: `Exercise ${position}`,
    equipment: 'Dumbbells',
    measurement: 'reps',
    weightType: 'dumbbell',
    perSide: false,
    instructions: '',
    previous: null,
    plan: [1, 2, 3].map((position) => ({ position, repsMin: 10, repsMax: 12, seconds: null })),
  }));
  const workout: Workout = {
    programId: crypto.randomUUID(),
    templateId: crypto.randomUUID(),
    revision: 1,
    position: 1,
    totalWorkouts: 8,
    repeatFrom: 1,
    name: 'Workout',
    programName: 'Program',
    token: 'plan',
    options,
  };
  const draft = newDraft('gym', '2026-11-13', workout);
  draft.stage = 'workout';
  for (const exercise of draft.input.exercises) {
    exercise.sets = exercise.sets.map((set) => ({ ...set, reps: 10 }));
  }
  return draft;
}

describe('workout draft navigation', () => {
  it('records the active set without mutating the source and advances to the next unfinished set', () => {
    const draft = workoutDraft();
    draft.input.exercises[0].sets[1].done = true;
    const next = completeCurrentSet(draft);
    expect(next.setIndex).toBe(2);
    expect(next.exerciseIndex).toBe(0);
    expect(next.input.exercises[0].sets[0].done).toBe(true);
    expect(draft.input.exercises[0].sets[0].done).toBe(false);
  });
  it('returns to an earlier skipped set before moving to another exercise', () => {
    const draft = workoutDraft();
    draft.setIndex = 2;
    draft.input.exercises[0].sets[1].done = true;
    const next = completeCurrentSet(draft);
    expect([next.exerciseIndex, next.setIndex]).toEqual([0, 0]);
  });
  it('updates the completed exercise and opens the next exercise at its first unfinished set', () => {
    const draft = workoutDraft();
    draft.setIndex = 2;
    draft.input.exercises[0].sets.forEach((set, index) => {
      set.done = index < 2;
    });
    draft.input.exercises[1].sets[0].done = true;
    const next = completeCurrentSet(draft);
    expect([next.exerciseIndex, next.setIndex]).toEqual([1, 1]);
    expect(next.input.exercises[0].sets.every((set) => set.done)).toBe(true);
    expect(next.input.exercises[1]).toEqual(draft.input.exercises[1]);
  });
  it('keeps history editing within the current exercise', () => {
    const draft = workoutDraft();
    draft.editingRevision = 2;
    draft.setIndex = 2;
    draft.input.exercises[0].sets.forEach((set) => {
      set.done = true;
    });
    expect(completeCurrentSet(draft).exerciseIndex).toBe(0);
    expect(completeCurrentSet(draft).setIndex).toBe(2);
  });
  it('wraps exercise navigation to earlier incomplete work and leaves a finished workout unchanged', () => {
    const draft = workoutDraft();
    draft.exerciseIndex = 1;
    draft.input.exercises[0].sets[0].done = true;
    expect(nextPendingExercise(draft).exerciseIndex).toBe(0);
    expect(nextPendingExercise(draft).setIndex).toBe(1);
    draft.input.exercises.forEach((exercise) =>
      exercise.sets.forEach((set) => {
        set.done = true;
      }),
    );
    expect(nextPendingExercise(draft)).toBe(draft);
    const next = completeCurrentSet({ ...draft, setIndex: 2 });
    expect([next.exerciseIndex, next.setIndex]).toEqual([1, 2]);
  });
  it('requires the matching measurement but allows unknown weight', () => {
    const draft = workoutDraft();
    draft.input.exercises[0].sets[0].reps = null;
    expect(() => completeCurrentSet(draft)).toThrow('Укажи целое положительное число');
    draft.workout!.options[0].measurement = 'time';
    draft.input.exercises[0].sets[0].seconds = 30;
    expect(completeCurrentSet(draft).input.exercises[0].sets[0]).toMatchObject({
      done: true,
      weight: null,
      seconds: 30,
    });
  });
});
