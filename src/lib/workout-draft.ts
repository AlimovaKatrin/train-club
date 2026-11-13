import { setSchema, type Draft, type SetResult } from './domain';

/** Update the active exercise before moving the cursor, including moves to another exercise. */
export function updateExerciseSets(
  draft: Draft,
  sets: SetResult[],
  setIndex = draft.setIndex,
  exerciseIndex = draft.exerciseIndex,
): Draft {
  return {
    ...draft,
    exerciseIndex,
    setIndex,
    input: {
      ...draft.input,
      exercises: draft.input.exercises.map((exercise, index) =>
        index === draft.exerciseIndex ? { ...exercise, sets } : exercise,
      ),
    },
  };
}

export function completeCurrentSet(draft: Draft): Draft {
  const exercise = draft.input.exercises[draft.exerciseIndex];
  const option = draft.workout!.options.find((option) => option.id === exercise.optionId)!;
  const currentSet = exercise.sets[draft.setIndex];
  const result = setSchema.safeParse({ ...currentSet, done: true });
  const measurementMissing =
    option.measurement === 'reps' ? currentSet.reps === null : currentSet.seconds === null;
  if (!result.success || measurementMissing) {
    throw new Error(
      'Укажи целое положительное число повторений или секунд. Вес можно оставить неизвестным.',
    );
  }

  const sets = exercise.sets.map((set, index) =>
    index === draft.setIndex ? { ...set, done: true } : set,
  );
  if (draft.editingRevision !== null) {
    const nextSetIndex = Math.min(draft.setIndex + 1, sets.length - 1);
    return updateExerciseSets(draft, sets, nextSetIndex);
  }

  const firstPendingIndex = sets.findIndex((set) => !set.done);
  if (firstPendingIndex !== -1) {
    const nextPendingIndex = sets.findIndex((set, index) => index > draft.setIndex && !set.done);
    const nextSetIndex = nextPendingIndex !== -1 ? nextPendingIndex : firstPendingIndex;
    return updateExerciseSets(draft, sets, nextSetIndex);
  }

  const nextExerciseIndex = draft.exerciseIndex + 1;
  const nextExercise = draft.input.exercises[nextExerciseIndex];
  if (nextExercise) {
    const nextSetIndex = Math.max(
      0,
      nextExercise.sets.findIndex((set) => !set.done),
    );
    return updateExerciseSets(draft, sets, nextSetIndex, nextExerciseIndex);
  }
  return updateExerciseSets(draft, sets);
}

export function nextPendingExercise(draft: Draft): Draft {
  const exercises = draft.input.exercises;
  let exerciseIndex = exercises.findIndex(
    (exercise, index) => index > draft.exerciseIndex && exercise.sets.some((set) => !set.done),
  );
  if (exerciseIndex === -1) {
    exerciseIndex = exercises.findIndex((exercise) => exercise.sets.some((set) => !set.done));
  }
  if (exerciseIndex === -1) return draft;
  const setIndex = exercises[exerciseIndex].sets.findIndex((set) => !set.done);
  return { ...draft, exerciseIndex, setIndex };
}
