import { bootstrap } from '@/lib/server/repository';
import { errorResponse } from '@/lib/server/http';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    return Response.json(await bootstrap());
  } catch (error) {
    return errorResponse(error);
  }
}
