import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

/** Maintenance commands read only the selected file, never a development shell's DATABASE_URL. */
export async function readDatabaseTarget(
  envFile,
  {
    missingUrlMessage = 'В выбранном env-файле отсутствует DATABASE_URL.',
    protocolMessage = 'DATABASE_URL должен быть строкой подключения PostgreSQL.',
  } = {},
) {
  const env = parseEnv(await readFile(resolve(envFile), 'utf8'));
  if (!env.DATABASE_URL) throw new Error(missingUrlMessage);
  const target = new URL(env.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(target.protocol)) {
    throw new Error(protocolMessage);
  }
  return {
    connectionString: env.DATABASE_URL,
    // The display label must never contain credentials or query parameters.
    label: `${target.hostname}:${target.port || '5432'}${target.pathname}`,
  };
}
