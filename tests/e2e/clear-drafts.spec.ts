import { expect, test, type Page } from '@playwright/test';
import { newDraft, type SessionRecord } from '../../src/lib/domain';

const savedSession: SessionRecord = {
  input: { ...newDraft('boxing', '2026-11-01', null).input, wellbeing: 3, exertion: 4 },
  revision: 0,
  workout: null,
};

test.beforeEach(async ({ page }) => {
  await page.route('**/api/bootstrap', (route) =>
    route.fulfill({ json: { workout: null, history: [savedSession] } }),
  );
  await page.goto('/');
});

async function startDraft(page: Page, activity: string) {
  await page.getByRole('button', { name: activity, exact: true }).click();
  await page.getByRole('button', { name: 'Начать тренировку →' }).click();
}
async function goHome(page: Page) {
  await page
    .getByRole('navigation', { name: 'Основная навигация' })
    .getByRole('button', { name: /Сегодня/ })
    .click();
}
const clearButton = (page: Page) => page.getByRole('button', { name: 'Очистить', exact: true });

test('clears all displayed drafts after confirmation, preserves history and stays cleared after reload', async ({
  page,
}) => {
  const mutations: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/') && request.method() !== 'GET')
      mutations.push(request.url());
  });
  await expect(clearButton(page)).toHaveCount(0);
  for (const activity of ['Бокс', 'Пилатес']) {
    await startDraft(page, activity);
    await goHome(page);
  }
  await expect(page.getByRole('button', { name: /Продолжить:/ })).toHaveCount(2);
  page.once('dialog', (dialog) => dialog.dismiss());
  await clearButton(page).click();
  await expect(page.getByRole('button', { name: /Продолжить:/ })).toHaveCount(2);
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Сохранённая история останется');
    await dialog.accept();
  });
  await clearButton(page).click();
  await expect(page.getByRole('heading', { name: 'Незавершённые занятия' })).toHaveCount(0);
  await expect(
    page.getByText('Незавершённые занятия удалены с устройства.', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Бокс', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Начать тренировку →' })).toBeEnabled();
  await expect(page.getByRole('button', { name: /Продолжить:/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Бокс.*60 мин.*тяжесть 4\/10/ })).toBeVisible();
  expect(mutations).toEqual([]);
});

test('a failed deletion rolls back the whole batch and allows a retry', async ({ page }) => {
  for (const activity of ['Бокс', 'Пилатес']) {
    await startDraft(page, activity);
    await expect(page.getByRole('status').filter({ hasText: 'Черновик сохранён' })).toBeVisible();
    await goHome(page);
  }
  await page.evaluate(() => {
    const originalDelete = IDBObjectStore.prototype.delete;
    let deletions = 0;
    IDBObjectStore.prototype.delete = function (key) {
      if (++deletions === 2) {
        IDBObjectStore.prototype.delete = originalDelete;
        throw new DOMException('Deletion failed', 'UnknownError');
      }
      return originalDelete.call(this, key);
    };
  });
  page.once('dialog', (dialog) => dialog.accept());
  await clearButton(page).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Не удалось очистить');
  await expect(page.getByRole('button', { name: /Продолжить:/ })).toHaveCount(2);
  await page.reload();
  await expect(page.getByRole('button', { name: /Продолжить:/ })).toHaveCount(2);
  page.once('dialog', (dialog) => dialog.accept());
  await clearButton(page).click();
  await expect(clearButton(page)).toHaveCount(0);
});

test('waits for an in-flight autosave before deleting so the draft cannot reappear', async ({
  page,
}) => {
  await startDraft(page, 'Бокс');
  await expect(page.getByRole('status').filter({ hasText: 'Черновик сохранён' })).toBeVisible();
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('train-club', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('drafts', 'readwrite');
        const store = transaction.objectStore('drafts');
        let locked = true;
        (window as typeof window & { releaseDraftLock: () => void }).releaseDraftLock = () => {
          locked = false;
        };
        const holdLock = () => {
          const read = store.get('test-lock');
          read.onsuccess = () => {
            if (locked) holdLock();
          };
        };
        transaction.oncomplete = () => database.close();
        holdLock();
        resolve();
      };
    });
  });
  await page.getByLabel('Сон, часов', { exact: true }).fill('6');
  await goHome(page);
  page.once('dialog', (dialog) => dialog.accept());
  await clearButton(page).click();
  await expect(clearButton(page)).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Начать тренировку →' })).toBeDisabled();
  await page.evaluate(() =>
    (window as typeof window & { releaseDraftLock: () => void }).releaseDraftLock(),
  );
  await expect(clearButton(page)).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Бокс', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Начать тренировку →' })).toBeEnabled();
  await expect(page.getByRole('button', { name: /Продолжить:/ })).toHaveCount(0);
});
