import { notFound } from 'next/navigation';
import { canExport } from '@/lib/server/export-access';
import { ExportForm } from '@/components/ExportForm';
export const dynamic = 'force-dynamic';
export default async function ReviewPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!canExport(key)) notFound();
  return <ExportForm />;
}
