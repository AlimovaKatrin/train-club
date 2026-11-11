import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
export function canExport(key: string) {
  const secret = process.env.TRAIN_CLUB_EXPORT_KEY;
  if (!secret || secret.length < 32 || key.length > 256) return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(secret), digest(key));
}
export const exportHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'X-Content-Type-Options': 'nosniff',
};
