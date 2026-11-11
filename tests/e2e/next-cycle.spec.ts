import { expect, test } from '@playwright/test';
import definition from '../../db/seeds/next-cycle.json' with { type: 'json' };
import type { ExerciseOption, Workout } from '../../src/lib/domain';

test('six-exercise cycle shows time ranges and all sixteen positions on mobile', async ({
  page,
}, testInfo) => {
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));
  const spec = definition.workouts.find((w) => w.position === 11)!;
  const catalog = definition.exercises as Record<
    string,
    {
      name: string;
      equipment: string;
      measurement: ExerciseOption['measurement'];
      weightType: ExerciseOption['weightType'];
      perSide: boolean;
      instructions: string;
    }
  >;
  const options: ExerciseOption[] = spec.exercises.map((slot, i) => ({
    id: crypto.randomUUID(),
    exerciseId: crypto.randomUUID(),
    position: i + 1,
    primary: true,
    ...catalog[slot.exercise],
    previous: null,
    plan: [1, 2].map((position) => ({
      position,
      repsMin: slot.reps?.[0] ?? null,
      repsMax: slot.reps?.[1] ?? null,
      seconds: slot.seconds?.[0] ?? null,
      ...(slot.seconds ? { secondsMax: slot.seconds[1] } : {}),
    })),
  }));
  const workout: Workout = {
    programId: crypto.randomUUID(),
    templateId: crypto.randomUUID(),
    revision: 0,
    position: 11,
    totalWorkouts: 16,
    repeatFrom: 9,
    name: spec.name,
    programName: definition.name,
    notes: definition.notes,
    token: 'ui-fixture',
    options,
  };
  await page.route('**/api/bootstrap', (route) =>
    route.fulfill({ json: { workout, history: [] } }),
  );
  for (const width of [320, 375, 402, 440]) {
    await page.setViewportSize({ width, height: 874 });
    await page.goto('/');
    const sequence = page.getByLabel('Следующая тренировка 11 из 16');
    await expect(sequence.locator('span')).toHaveCount(16);
    await expect(page.getByText('После №16 — снова №9. Без спешки.')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.screenshot({ path: testInfo.outputPath('sixteen-workouts.png'), fullPage: true });
  await page.getByRole('button', { name: 'Начать тренировку →' }).click();
  await expect(page.getByText('Зал · тренировка 11 из 16')).toBeVisible();
  await page
    .getByRole('group', { name: 'Самочувствие', exact: true })
    .getByRole('button', { name: '4', exact: true })
    .click();
  await page.getByRole('button', { name: 'Начать занятие →' }).click();
  await expect(page.getByText('Упражнение 1 из 6')).toBeVisible();
  await page.getByRole('button', { name: /Показать список упражнений/ }).click();
  await page.getByRole('button', { name: /Открыть упражнение 6:/ }).click();
  await expect(page.getByRole('heading', { name: 'Боковая планка с колен' })).toBeVisible();
  await expect(page.getByText(/План: 20–30 сек на каждую сторону/)).toBeVisible();
  await expect(page.getByLabel('Вес, кг', { exact: true })).toHaveCount(0);
  await page.getByLabel('Длительность, сек', { exact: true }).fill('25');
  await expect(page.getByRole('status').filter({ hasText: 'Черновик сохранён' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /Продолжить: Зал/ }).click();
  await expect(page.getByLabel('Длительность, сек', { exact: true })).toHaveValue('25');
  await expect(page.getByText(/План: 20–30 сек на каждую сторону/)).toBeVisible();
  expect(errors).toEqual([]);
});
