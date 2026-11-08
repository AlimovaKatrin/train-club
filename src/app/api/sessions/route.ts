import { saveSession } from '@/lib/server/repository';
import { checkOrigin, errorResponse, readBody } from '@/lib/server/http';
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    return Response.json(await saveSession(await readBody(request)), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
