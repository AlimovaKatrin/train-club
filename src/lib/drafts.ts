import { openDB } from 'idb';
import type { Draft } from './domain';
const openDraftDatabase = () =>
  openDB('train-club', 1, {
    upgrade(database) {
      database.createObjectStore('drafts');
    },
  });
// Each session has its own key, so tabs starting different workouts cannot overwrite each other.
export async function saveDraft(draft: Draft) {
  const database = await openDraftDatabase();
  try {
    await database.put('drafts', draft, draft.input.id);
  } finally {
    database.close();
  }
}
export async function removeDraft(id: string) {
  const database = await openDraftDatabase();
  try {
    await database.delete('drafts', id);
  } finally {
    database.close();
  }
}
export async function readDrafts(): Promise<Draft[]> {
  const database = await openDraftDatabase();
  try {
    const rows = await database.getAll('drafts');
    if (
      rows.some(
        (d) =>
          d?.version !== 1 || !d?.input?.id || !['prepare', 'workout', 'finish'].includes(d.stage),
      )
    )
      throw new Error('Unsupported draft');
    return rows.map(restoreLegacyDraft);
  } finally {
    database.close();
  }
}

function restoreLegacyDraft(draft: Draft): Draft {
  // Drafts written before editable duration used an implicit hour.
  let durationMinutes = draft.input.durationMinutes;
  if (durationMinutes === undefined) {
    durationMinutes = draft.input.activity === 'gym' ? null : 60;
  }
  const workout = draft.workout
    ? {
        ...draft.workout,
        totalWorkouts: draft.workout.totalWorkouts ?? 8,
        repeatFrom: draft.workout.repeatFrom ?? 1,
      }
    : null;
  return { ...draft, workout, input: { ...draft.input, durationMinutes } };
}
