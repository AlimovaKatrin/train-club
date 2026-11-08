import { z } from 'zod';
import { editSession } from '@/lib/server/repository';
import { checkOrigin, errorResponse, readBody } from '@/lib/server/http';
import { AppError } from '@/lib/server/db';
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    checkOrigin(request);
    const { id } = await context.params;
    const body = z
      .object({
        input: z.object({ id: z.uuid() }).passthrough(),
        revision: z.number().int().nonnegative(),
      })
      .strict()
      .parse(await readBody(request));
    if (body.input.id !== id) throw new AppError(400, 'Идентификатор записи не совпадает.');
    return Response.json(await editSession(body.input, body.revision));
  } catch (error) {
    return errorResponse(error);
  }
}
