import 'server-only';
import pg from 'pg';
const globalDb = globalThis as unknown as { trainClubPool?: pg.Pool };
export function pool() {
  if (!process.env.DATABASE_URL)
    throw new AppError(
      503,
      'База пока не подключена. Можно подготовить локальный черновик бокса или пилатеса.',
    );
  return (globalDb.trainClubPool ??= new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 4,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
  }));
}
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>) {
  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
export type Db = Pick<pg.PoolClient, 'query'>;
