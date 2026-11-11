import { canExport, exportHeaders } from '@/lib/server/export-access';
import { exportQuerySchema } from '@/lib/training-export';
import { loadTrainingExport } from '@/lib/server/training-export';
import { errorResponse } from '@/lib/server/http';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!canExport(key)) return new Response(null, { status: 404, headers: exportHeaders });
  try {
    const query = exportQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const result = await loadTrainingExport(query);
    return new Response(JSON.stringify(result, null, 2) + '\n', {
      headers: {
        ...exportHeaders,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="train-club-${result.period.from ?? 'empty'}-${result.period.to ?? 'empty'}.json"`,
      },
    });
  } catch (error) {
    const response = errorResponse(error);
    for (const [name, value] of Object.entries(exportHeaders)) response.headers.set(name, value);
    return response;
  }
}
