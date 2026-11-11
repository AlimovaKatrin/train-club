import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const key = process.env.TRAIN_CLUB_EXPORT_KEY;
test.skip(!key, 'A test-only export key must be configured on the server and test runner.');
test('private export rejects a wrong link and downloads the selected period as JSON', async ({
  page,
  request,
}) => {
  const denied = await request.get('/review/wrong/download?range=all');
  expect(denied.status()).toBe(404);
  expect(denied.headers()['cache-control']).toContain('no-store');
  expect((await request.get('/review/wrong')).status()).toBe(404);
  const response = await page.goto(`/review/${key}`);
  expect(response!.headers()['referrer-policy']).toBe('no-referrer');
  await expect(page.getByLabel('Период выгрузки')).toHaveValue('12weeks');
  const download = async () => {
    const waiting = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Экспорт для разбора', exact: true }).click();
    const file = await waiting;
    expect(file.suggestedFilename()).toMatch(/^train-club-.*\.json$/);
    return JSON.parse(await readFile((await file.path())!, 'utf8'));
  };
  const recent = await download();
  expect(recent.schemaVersion).toBe(1);
  expect(recent.period.mode).toBe('12weeks');
  expect(Date.parse(recent.period.to) - Date.parse(recent.period.from)).toBe(83 * 86400000);
  await page.getByLabel('Период выгрузки').selectOption('all');
  const all = await download();
  expect(all.sessions.length).toBeGreaterThanOrEqual(recent.sessions.length);
  expect(JSON.stringify(all)).not.toContain(key);
  await page.getByLabel('Период выгрузки').selectOption('custom');
  await page.getByLabel('С даты', { exact: true }).fill('2000-01-01');
  await page.getByLabel('По дату', { exact: true }).fill('2000-01-02');
  const empty = await download();
  expect(empty.sessions).toEqual([]);
  await page.getByLabel('С даты', { exact: true }).fill('2000-02-01');
  await page.getByRole('button', { name: 'Экспорт для разбора', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('начало и конец');
});
test('explicit confirmation is saved while untouched defaults remain unverified', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Пилатес', exact: true }).click();
  await page.getByRole('button', { name: 'Начать тренировку →' }).click();
  await page
    .getByRole('group', { name: 'Самочувствие', exact: true })
    .getByRole('button', { name: '4', exact: true })
    .click();
  await expect(page.getByLabel('Сон, часов', { exact: true })).toHaveValue('8');
  await page.getByRole('button', { name: 'Подтвердить сон', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Черновик сохранён' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /Продолжить: Пилатес/ }).click();
  await expect(page.getByRole('button', { name: 'Подтвердить сон', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Начать занятие →' }).click();
  await expect(page.getByLabel('Минимальный пульс', { exact: true })).toHaveValue('');
  await page.getByLabel('Тяжесть тренировки').selectOption('4');
  await page.getByLabel('Заметка · необязательно', { exact: true }).fill('Проверка источников');
  const saving = page.waitForResponse(
    (r) => r.url().endsWith('/api/sessions') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Завершить и сохранить' }).click();
  const saved = await (await saving).json();
  expect(saved.input.provenance.sleep).toBe('user_confirmed');
  expect(saved.input.provenance.durationMinutes).toBe('default');
  const result = await (await request.get(`/review/${key}/download?range=all`)).json();
  const session = result.sessions.find((s: { id: string }) => s.id === saved.input.id);
  expect(session.before.sleepHours).toEqual({ value: 8, source: 'user_confirmed' });
  expect(session.duration.totalMinutes).toEqual({ value: 60, source: 'default' });
  expect(session.pulse.min.value).toBeNull();
});
