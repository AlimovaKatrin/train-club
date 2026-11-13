import type { Bootstrap, Draft, SessionRecord } from './domain';

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error ?? 'Не удалось сохранить занятие. Черновик остаётся на устройстве.');
  return body;
}

export function loadDiary(): Promise<Bootstrap> {
  return api<Bootstrap>('/api/bootstrap');
}

export function saveSessionDraft(draft: Draft): Promise<SessionRecord> {
  if (draft.editingRevision === null) {
    return api<SessionRecord>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify(draft.input),
    });
  }
  return api<SessionRecord>(`/api/sessions/${draft.input.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ input: draft.input, revision: draft.editingRevision }),
  });
}
