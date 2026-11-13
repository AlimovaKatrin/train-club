import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readDatabaseTarget } from '../scripts/database-target.mjs';

const directories: string[] = [];
async function envFile(contents: string) {
  const directory = await mkdtemp(join(tmpdir(), 'train-club-target-'));
  directories.push(directory);
  const filename = join(directory, '.env.test');
  await writeFile(filename, contents);
  return filename;
}
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe('maintenance database selection', () => {
  it('uses only the explicit env file and excludes credentials from the display label', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://ignored:ignored@localhost/development');
    const filename = await envFile(
      'DATABASE_URL=postgresql://operator:test-only@localhost:55441/disposable_test?sslmode=disable\n',
    );
    expect(await readDatabaseTarget(filename)).toEqual({
      connectionString:
        'postgresql://operator:test-only@localhost:55441/disposable_test?sslmode=disable',
      label: 'localhost:55441/disposable_test',
    });
  });
  it('does not fall back to the shell when the selected file has no URL', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://localhost/development');
    await expect(readDatabaseTarget(await envFile('OTHER=value\n'))).rejects.toThrow(
      'В выбранном env-файле отсутствует DATABASE_URL.',
    );
  });
  it('rejects a missing file instead of loading a default file', async () => {
    const filename = await envFile('');
    await expect(readDatabaseTarget(`${filename}.missing`)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
  it('preserves command-specific protocol errors', async () => {
    const filename = await envFile('DATABASE_URL=https://localhost/not-postgresql\n');
    await expect(
      readDatabaseTarget(filename, { protocolMessage: 'Нужна строка подключения PostgreSQL.' }),
    ).rejects.toThrow('Нужна строка подключения PostgreSQL.');
  });
});
