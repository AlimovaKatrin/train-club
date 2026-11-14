import { expect, test } from '@playwright/test';
import type { Workout } from '../../src/lib/domain';

test('an exercise without replacements explains their absence instead of showing a disabled button', async ({
  page,
}) => {
  const workout: Workout = {
    programId: crypto.randomUUID(),
    programVersion: 3,
    templateId: crypto.randomUUID(),
    revision: 0,
    position: 4,
    totalWorkouts: 16,
    repeatFrom: 9,
    name: 'Тренировка 4',
    programName: 'Силовые',
    token: 'replacement-ui-fixture',
    options: [
      {
        id: crypto.randomUUID(),
        exerciseId: 'f31bdae8-bc61-4eaf-84a7-7ff73cb19075',
        position: 1,
        primary: true,
        name: 'Жим ногами',
        equipment: 'Тренажёр',
        measurement: 'reps',
        weightType: 'machine',
        perSide: false,
        instructions: '',
        previous: null,
        plan: [1, 2].map((position) => ({ position, repsMin: 10, repsMax: 12, seconds: null })),
      },
    ],
  };
  await page.route('**/api/bootstrap', (route) =>
    route.fulfill({ json: { workout, history: [] } }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Начать тренировку →' }).click();
  await page
    .getByRole('group', { name: 'Самочувствие', exact: true })
    .getByRole('button', { name: '4', exact: true })
    .click();
  await page.getByRole('button', { name: 'Начать занятие →' }).click();
  await page.getByText('Техника и прошлый результат', { exact: true }).click();
  const explanation = page.getByText('Для этого упражнения в программе пока нет замен.', {
    exact: true,
  });
  await expect(explanation).toBeVisible();
  await expect(page.getByRole('button', { name: 'Заменить упражнение', exact: true })).toHaveCount(
    0,
  );
  await page.getByLabel('Повторения', { exact: true }).fill('12');
  await expect(explanation).toBeVisible();
  await expect(page.getByText('Замена доступна до записи подходов.', { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: '✓ Подход выполнен', exact: true }).click();
  await expect(page.getByRole('button', { name: '2 рабочий', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
