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
test('a legacy pilates draft keeps its implicit hour after upgrade', async ({ page }) => {
  await prepare(page, 'Пилатес');
  await expect(page.getByRole('status').filter({ hasText: 'Черновик сохранён' })).toBeVisible();
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('train-club', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction('drafts', 'readwrite');
        const store = transaction.objectStore('drafts');
        const cursor = store.openCursor();
        cursor.onsuccess = () => {
          if (!cursor.result) return;
          const draft = cursor.result.value;
          delete draft.input.durationMinutes;
          cursor.result.update(draft);
          cursor.result.continue();
        };
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onerror = () => {
          db.close();
          reject(transaction.error);
        };
      };
    });
  });
  await page.reload();
  await page.getByRole('button', { name: /Продолжить: Пилатес/ }).click();
  await expect(page.getByLabel('Продолжительность, мин', { exact: true })).toHaveValue('60');
});
test('pilates draft survives reload and an offline submission; editing keeps queue unchanged', async ({
  page,
  context,
  request,
}) => {
  const before = await (await request.get('/api/bootstrap')).json();
  await prepare(page, 'Пилатес');
  await page.getByLabel('Продолжительность, мин', { exact: true }).fill('30');
  await page.getByLabel('Минимальный пульс', { exact: true }).fill('92');
  await page.getByLabel('Максимальный пульс', { exact: true }).fill('154');
  await page.getByLabel('Тяжесть тренировки').selectOption('5');
  await expect(page.getByRole('status').filter({ hasText: 'Черновик сохранён' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /Продолжить: Пилатес/ }).click();
  await expect(page.getByLabel('Минимальный пульс', { exact: true })).toHaveValue('92');
  await expect(page.getByLabel('Продолжительность, мин', { exact: true })).toHaveValue('30');
  await context.setOffline(true);
  await page.getByLabel('Заметка').fill('Offline note');
  await page.getByRole('button', { name: 'Завершить и сохранить' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Нет связи');
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Завершить и сохранить' }).click();
  await expect(page.getByText('Занятие сохранено в дневнике.')).toBeVisible();
  await page.getByRole('button', { name: 'Открыть дневник →' }).click();
  await expect(
    page.getByRole('button', { name: /Пилатес.*30 мин.*тяжесть 5\/10/ }).first(),
  ).toBeVisible();
  await page
    .getByRole('button', { name: /Пилатес.*тяжесть 5\/10/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Исправить запись' }).click();
  await page.getByLabel('Сон, часов', { exact: true }).fill('7.5');
  await page.getByRole('button', { name: 'Начать занятие →' }).click();
  await expect(page.getByLabel('Продолжительность, мин', { exact: true })).toHaveValue('30');
  await page.getByLabel('Продолжительность, мин', { exact: true }).fill('35');
  await page.getByRole('button', { name: 'Сохранить исправления' }).click();
  await expect(page.getByText('Занятие сохранено в дневнике.')).toBeVisible();
  const after = await (await request.get('/api/bootstrap')).json();
  expect(after.workout.revision).toBe(before.workout.revision);
  expect(after.history[0].input.sleep).toBe(7.5);
  expect(after.history[0].input.durationMinutes).toBe(35);
});
test('gym replacement, warmup, copy, completion and restoration', async ({ page }) => {
  await prepare(page, 'Зал');
  await page.getByText('Техника и прошлый результат', { exact: true }).click();
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
  await page.getByText('Техника и прошлый результат', { exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Заменить упражнение', exact: true }),
  ).toBeDisabled();
  await page.getByText('Техника и прошлый результат', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Перейти к итогам →' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Скопировать предыдущий подход' }).click();
  await page.getByRole('button', { name: '✓ Подход выполнен', exact: true }).click();
  await expect(page.getByText('Упражнение 2 из 2', { exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Черновик сохранён' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /Продолжить: Зал/ }).click();
  await expect(page.getByText('Упражнение 2 из 2', { exact: true })).toBeVisible();
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
test('exercise navigation waits for skipped sets and supports an already completed draft', async ({
  page,
}) => {
  await prepare(page, 'Зал');
  await page
    .getByRole('group', { name: 'Подходы', exact: true })
    .getByRole('button', { name: '3 рабочий', exact: true })
    .click();
  await page.getByLabel('Повторения', { exact: true }).fill('12');
  await page.getByRole('button', { name: '✓ Подход выполнен', exact: true }).click();
  await expect(page.getByText('Упражнение 1 из 2', { exact: true })).toBeVisible();
  await expect(
    page
      .getByRole('group', { name: 'Подходы', exact: true })
      .getByRole('button', { name: '1 рабочий', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Повторения', { exact: true }).fill('10');
  await page.getByRole('button', { name: '✓ Подход выполнен', exact: true }).click();
  await expect(page.getByText('Упражнение 1 из 2', { exact: true })).toBeVisible();
  await page.getByLabel('Повторения', { exact: true }).fill('12');
  await page.getByRole('button', { name: '✓ Подход выполнен', exact: true }).click();
  await expect(page.getByText('Упражнение 2 из 2', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Показать список упражнений' }).click();
  await page.getByRole('button', { name: /Открыть упражнение 1/ }).click();
  await expect(page.getByLabel('Повторения', { exact: true })).toHaveValue('10');
  await expect(page.getByRole('status').filter({ hasText: 'Черновик сохранён' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /Продолжить: Зал/ }).click();
  await page.getByRole('button', { name: 'Следующее упражнение →', exact: true }).click();
  await expect(page.getByText('Упражнение 2 из 2', { exact: true })).toBeVisible();
});
test('the active set and contextual actions fit a small phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await prepare(page, 'Зал');
  const actions = page.getByRole('group', { name: 'Действия подхода', exact: true });
  const finish = page.getByRole('button', { name: 'Перейти к итогам →' });
  const mark = actions.getByRole('button', { name: '✓ Подход выполнен', exact: true });
  const fits = async () => {
    const geometry = await page.evaluate(() => ({
      height: window.innerHeight,
      width: window.innerWidth,
      contentHeight: document.documentElement.scrollHeight,
      contentWidth: document.documentElement.scrollWidth,
      scrollY: window.scrollY,
    }));
    expect(geometry.scrollY).toBe(0);
    expect(geometry.contentHeight).toBeLessThanOrEqual(geometry.height);
    expect(geometry.contentWidth).toBeLessThanOrEqual(geometry.width);
    const fields = await page.getByLabel('Повторения', { exact: true }).boundingBox();
    const footer = await actions.boundingBox();
    expect(fields!.y + fields!.height).toBeLessThanOrEqual(footer!.y);
    await expect(mark).toBeInViewport();
  };
  await expect(finish).toHaveCount(0);
  await expect(actions.getByRole('button', { name: 'Скопировать предыдущий подход' })).toHaveCount(
    0,
  );
  await fits();
  const list = page.getByRole('navigation', { name: 'Упражнения тренировки' });
  await expect(list.getByRole('button', { name: /Открыть упражнение/ })).toHaveCount(0);
  await list.getByRole('button', { name: 'Показать список упражнений' }).click();
  await expect(list.getByRole('button', { name: 'Скрыть список упражнений' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(list.getByRole('button', { name: /Открыть упражнение 2/ })).toContainText(
    'Планка на предплечьях',
  );
  await expect(list.getByRole('button', { name: /Открыть упражнение 2/ })).toContainText('Впереди');
  await list.getByRole('button', { name: 'Скрыть список упражнений' }).click();
  await expect(list.getByRole('button', { name: 'Показать список упражнений' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(list.getByRole('button', { name: /Открыть упражнение/ })).toHaveCount(0);
  await fits();
  await mark.click();
  await expect(actions.getByRole('alert')).toContainText('Укажи целое положительное');
  await page.getByLabel('Повторения', { exact: true }).fill('12');
  await mark.click();
  const copy = actions.getByRole('button', { name: 'Скопировать предыдущий подход' });
  await expect(copy).toBeInViewport();
  await fits();
  await copy.click();
  await expect(page.getByLabel('Повторения', { exact: true })).toHaveValue('12');
  await mark.click();
  await copy.click();
  await mark.click();
  await expect(page.getByText('Упражнение 2 из 2', { exact: true })).toBeVisible();
  await expect(finish).toHaveCount(0);
  for (let i = 0; i < 2; i++) {
    await page.getByLabel('Длительность, сек', { exact: true }).fill('30');
    await mark.click();
  }
  await expect(finish).toBeInViewport();
  await expect(mark).toHaveCount(0);
  await expect(copy).toHaveCount(0);
  // Correcting a completed result requires confirming it again before finishing.
  await page.getByLabel('Длительность, сек', { exact: true }).fill('40');
  await expect(finish).toHaveCount(0);
  await mark.click();
  await finish.click();
  await expect(page.getByRole('button', { name: 'Завершить и сохранить' })).toBeVisible();
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
