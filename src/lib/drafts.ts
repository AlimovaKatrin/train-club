import { openDB } from 'idb';
import type { Draft } from './domain';
const db = () =>
  openDB('train-club', 1, {
    upgrade(database) {
      database.createObjectStore('drafts');
    },
  });
// Each session has its own key, so tabs starting different workouts cannot overwrite each other.
export async function saveDraft(draft: Draft) {
  const database = await db();
  try {
    await database.put('drafts', draft, draft.input.id);
  } finally {
    database.close();
  }
}
export async function removeDraft(id: string) {
  const database = await db();
  try {
    await database.delete('drafts', id);
  } finally {
    database.close();
  }
}
export async function readDrafts(): Promise<Draft[]> {
  const database = await db();
  try {
    const rows = await database.getAll('drafts');
    if (
      rows.some(
        (d) =>
          d?.version !== 1 || !d?.input?.id || !['prepare', 'workout', 'finish'].includes(d.stage),
      )
    )
      throw new Error('Unsupported draft');
    // Drafts written before editable duration used an implicit hour.
    return rows.map((draft: Draft) => ({
      ...draft,
      input: {
        ...draft.input,
        durationMinutes:
          draft.input.durationMinutes === undefined
            ? draft.input.activity === 'gym'
              ? null
              : 60
            : draft.input.durationMinutes,
      },
    }));
  } finally {
    database.close();
  }
}
