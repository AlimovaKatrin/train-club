import { expect, test, type Page } from '@playwright/test';
import type { ExerciseOption, Workout } from '../../src/lib/domain';

function option(
  exerciseId: string,
  name: string,
  position: number,
  primary = true,
): ExerciseOption {
  return {
    id: crypto.randomUUID(),
    exerciseId,
    name,
    position,
    primary,
    equipment: 'Гантели',
    measurement: 'reps',
    weightType: 'dumbbell',
    perSide: false,
    instructions: 'Выполняй движение плавно.',
    plan: [{ position: 1, repsMin: 10, repsMax: 12, seconds: null }],
    previous: null,
  };
}

async function prepare(page: Page) {
  const workout: Workout = {
    programId: crypto.randomUUID(),
    programVersion: 2,
    templateId: crypto.randomUUID(),
    revision: 0,
    position: 9,
    totalWorkouts: 16,
    repeatFrom: 9,
    name: 'Тренировка с изображениями',
    programName: 'Силовые',
    token: 'image-ui-fixture',
    options: [
      option('cedf5b70-8b0d-4f73-9402-7e8afef975e6', 'Гоблет-присед', 1),
      option('b9088881-3199-46b7-883a-d68a71ec8d74', 'Жим гантелей лёжа на полу', 1, false),
      option('95781842-6ffc-4d8a-b748-f40e3f440f7c', 'Мёртвый жук', 2),
    ],
  };
  await page.route('**/api/bootstrap', (route) =>
    route.fulfill({ json: { workout, history: [] } }),
  );
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Начать тренировку →' }).click();
  await page
    .getByRole('group', { name: 'Самочувствие', exact: true })
    .getByRole('button', { name: '4', exact: true })
    .click();
  await page.getByRole('button', { name: 'Начать занятие →' }).click();
}

test('technique stays collapsed, opens full-screen, zooms and returns without changing the set', async ({
  page,
}, testInfo) => {
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));
  await prepare(page);
  const preview = page.getByRole('button', { name: 'Открыть технику: Гоблет-присед' });
  await expect(preview).toBeHidden();
  await expect(
    page.getByRole('button', { name: '✓ Подход выполнен', exact: true }),
  ).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(
    true,
  );
  await page.getByLabel('Вес, кг', { exact: true }).fill('8');
  await page.getByLabel('Повторения', { exact: true }).fill('10');
  await page.getByText('Техника и прошлый результат', { exact: true }).click();
  await expect(preview).toBeVisible();
  await expect
    .poll(() => preview.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath('technique-expanded.png'), fullPage: true });
  await preview.click();
  const viewer = page.getByRole('dialog', { name: 'Гоблет-присед', exact: true });
  await expect(viewer).toBeVisible();
  await expect(viewer.getByRole('button', { name: 'Закрыть изображение' })).toBeFocused();
  await expect
    .poll(() => viewer.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await viewer.getByRole('button', { name: 'Увеличить ×2' }).click();
  await expect(viewer.getByRole('button', { name: 'Уместить целиком' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(
    await viewer.locator('img').evaluate((img) => img.clientWidth > img.parentElement!.clientWidth),
  ).toBe(true);
  await viewer.getByRole('button', { name: 'Уместить целиком' }).click();
  await page.screenshot({ path: testInfo.outputPath('technique-fullscreen.png') });
  await viewer.getByRole('button', { name: 'Закрыть изображение' }).click();
  await expect(viewer).toBeHidden();
  await expect(preview).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('');
  await expect(page.getByLabel('Вес, кг', { exact: true })).toHaveValue('8');
  await expect(page.getByLabel('Повторения', { exact: true })).toHaveValue('10');
  await preview.click();
  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();
  await page.getByText('Техника и прошлый результат', { exact: true }).click();
  await expect(preview).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('replacement switches the image by exercise ID and unfinished illustrations stay hidden', async ({
  page,
}) => {
  await prepare(page);
  await page.getByText('Техника и прошлый результат', { exact: true }).click();
  await page.getByRole('button', { name: 'Заменить упражнение', exact: true }).click();
  await page.getByRole('button', { name: /Жим гантелей лёжа на полу/ }).click();
  const preview = page.getByRole('button', { name: 'Открыть технику: Жим гантелей лёжа на полу' });
  await expect(preview).toBeHidden();
  await page.getByText('Техника и прошлый результат', { exact: true }).click();
  await expect(preview.locator('img')).toHaveAttribute('src', /dumbbell-floor-press/);
  await page.getByRole('button', { name: 'Показать список упражнений' }).click();
  await page.getByRole('button', { name: /Открыть упражнение 2:/ }).click();
  await page.getByText('Техника и прошлый результат', { exact: true }).click();
  await expect(page.getByRole('button', { name: /^Открыть технику:/ })).toHaveCount(0);
  await expect(page.getByText('Выполняй движение плавно.')).toBeVisible();
});

test('a failed image does not block workout fields or text instructions', async ({ page }) => {
  await page.route('**/_next/image?**', (route) => route.abort());
  await page.route('**/exercises/*.webp', (route) => route.abort());
  await prepare(page);
  await page.getByText('Техника и прошлый результат', { exact: true }).click();
  await expect(page.getByRole('button', { name: /^Открыть технику:/ })).toHaveCount(0);
  await expect(page.getByText('Выполняй движение плавно.')).toBeVisible();
  await page.getByLabel('Повторения', { exact: true }).fill('10');
  await page.getByRole('button', { name: '✓ Подход выполнен', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Мёртвый жук', exact: true })).toBeVisible();
});
