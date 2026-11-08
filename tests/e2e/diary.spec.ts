import { expect, test, type Page } from '@playwright/test';
let browserErrors: Error[] = [];
test.beforeEach(({ page }) => {
  browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error));
});
test.afterEach(() => expect(browserErrors).toEqual([]));
async function prepare(page: Page, kind: string) {
  await page.goto('/');
  await page.getByRole('button', { name: kind, exact: true }).click();
  await page.getByRole('button', { name: 'Начать тренировку →' }).click();
  await page
    .getByRole('group', { name: 'Самочувствие', exact: true })
    .getByRole('button', { name: '4', exact: true })
    .click();
  await page.getByRole('button', { name: 'Начать занятие →' }).click();
}
test('pilates draft survives reload and an offline submission; editing keeps queue unchanged', async ({
  page,
  context,
  request,
}) => {
  const before = await (await request.get('/api/bootstrap')).json();
  await prepare(page, 'Пилатес');
  await expect(page.getByRole('heading', { name: '1 час' })).toBeVisible();
  await page.getByLabel('Минимальный пульс', { exact: true }).fill('92');
  await page.getByLabel('Максимальный пульс', { exact: true }).fill('154');
  await page.getByLabel('Тяжесть тренировки').selectOption('5');
  await expect(page.getByRole('status').filter({ hasText: 'Черновик сохранён' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /Продолжить: Пилатес/ }).click();
  await expect(page.getByLabel('Минимальный пульс', { exact: true })).toHaveValue('92');
  await context.setOffline(true);
  await page.getByLabel('Заметка').fill('Offline note');
  await page.getByRole('button', { name: 'Завершить и сохранить' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Нет связи');
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Завершить и сохранить' }).click();
  await expect(page.getByText('Занятие сохранено в дневнике.')).toBeVisible();
  await page.getByRole('button', { name: 'Открыть дневник →' }).click();
  await page
    .getByRole('button', { name: /Пилатес.*тяжесть 5\/10/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Исправить запись' }).click();
  await page.getByLabel('Сон, часов', { exact: true }).fill('7.5');
  await page.getByRole('button', { name: 'Начать занятие →' }).click();
  await page.getByRole('button', { name: 'Сохранить исправления' }).click();
  await expect(page.getByText('Занятие сохранено в дневнике.')).toBeVisible();
  const after = await (await request.get('/api/bootstrap')).json();
  expect(after.workout.revision).toBe(before.workout.revision);
  expect(after.history[0].input.sleep).toBe(7.5);
});
test('gym replacement, warmup, copy, completion and restoration', async ({ page }) => {
  await prepare(page, 'Зал');
  await page.getByRole('button', { name: 'Заменить упражнение', exact: true }).click();
  await page.getByRole('button', { name: /Тяга гантели с упором/ }).click();
  await expect(page.getByRole('heading', { name: 'Тяга гантели с упором' })).toBeVisible();
  await expect(page.getByLabel('Вес, кг', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: '+ Добавить разминочный подход' }).click();
  await page.getByLabel('Повторения', { exact: true }).fill('8');
  await page.getByRole('button', { name: '✓ Подход выполнен', exact: true }).click();
  await expect(page.getByText('0 из 4 рабочих', { exact: true })).toBeVisible();
  await page.getByLabel('Вес, кг', { exact: true }).fill('7.5');
  await page.getByLabel('Повторения', { exact: true }).fill('12');
  await page.getByRole('button', { name: '✓ Подход выполнен', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Заменить упражнение', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Перейти к итогам →' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Запиши все');
  await page.getByRole('button', { name: 'Скопировать предыдущий подход' }).click();
  await page.getByRole('button', { name: '✓ Подход выполнен', exact: true }).click();
  await page.getByRole('button', { name: /Открыть упражнение 2/ }).click();
  await page.getByLabel('Длительность, сек', { exact: true }).fill('30');
  await page.getByRole('button', { name: '✓ Подход выполнен', exact: true }).click();
  await page.getByLabel('Длительность, сек', { exact: true }).fill('40');
  await page.getByRole('button', { name: '✓ Подход выполнен', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Черновик сохранён' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /Продолжить: Зал/ }).click();
  await expect(page.getByText('4 из 4 рабочих', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Перейти к итогам →' }).click();
  await page.getByLabel('Основная часть', { exact: true }).fill('45');
  await page.getByLabel('Тяжесть тренировки').selectOption('6');
  await page.getByRole('button', { name: 'Завершить и сохранить' }).click();
  await expect(page.getByText('Занятие сохранено в дневнике.')).toBeVisible();
});
test('lost server response retries the same saved session without duplicating it', async ({
  page,
  request,
}) => {
  await prepare(page, 'Бокс');
  await page.getByLabel('Тяжесть тренировки').selectOption('3');
  let submittedId = '';
  await page.route(
    '**/api/sessions',
    async (route) => {
      submittedId = route.request().postDataJSON().id;
      await route.fetch();
      await route.abort('failed');
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: 'Завершить и сохранить' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Завершить и сохранить' }).click();
  await expect(page.getByText('Занятие сохранено в дневнике.')).toBeVisible();
  const state = await (await request.get('/api/bootstrap')).json();
  expect(
    state.history.filter((r: { input: { id: string } }) => r.input.id === submittedId),
  ).toHaveLength(1);
});
test('mobile layout has no horizontal overflow', async ({ page }, testInfo) => {
  for (const width of [320, 375, 402, 440]) {
    await page.setViewportSize({ width, height: 874 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Чем займёмся сегодня?' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Начать тренировку →' })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.screenshot({ path: testInfo.outputPath('home.png'), fullPage: true });
});
