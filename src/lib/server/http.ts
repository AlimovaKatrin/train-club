import { ZodError } from 'zod';
import { AppError } from './db';
export function errorResponse(error: unknown) {
  if (error instanceof ZodError)
    return Response.json(
      {
        error:
          error.issues.find((i) => i.code === 'custom')?.message ??
          'Проверь дату, показатели и результаты подходов.',
      },
      { status: 400 },
    );
  if (error instanceof AppError)
    return Response.json({ error: error.message }, { status: error.status });
  // Do not expose connection strings, SQL or submitted personal data.
  console.error(
    'Train Club request failed:',
    error instanceof Error ? error.name : 'Unknown error',
  );
  return Response.json(
    {
      error:
        'Не удалось связаться с базой. Данные черновика остаются на устройстве. Попробуй ещё раз.',
    },
    { status: 503 },
  );
}
export function checkOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return;
  // Next.js may use the internal listener address in request.url. Host is the
  // browser's destination and cannot be overridden by a cross-site fetch.
  const destination = request.headers.get('host') ?? new URL(request.url).host;
  let source: URL;
  try {
    source = new URL(origin);
  } catch {
    throw new AppError(403, 'Отправка с другого сайта запрещена.');
  }
  if (!['http:', 'https:'].includes(source.protocol) || source.host !== destination) {
    throw new AppError(403, 'Отправка с другого сайта запрещена.');
  }
}
export async function readBody(request: Request) {
  const body = await request.text();
  if (body.length > 500000) throw new AppError(413, 'Слишком большой запрос.');
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new AppError(400, 'Неверный формат запроса.');
  }
}
