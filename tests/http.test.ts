import { expect, it } from 'vitest';
import { checkOrigin } from '../src/lib/server/http';
it('accepts the public Host even when Next uses an internal listener URL', () => {
  expect(() =>
    checkOrigin(
      new Request('http://0.0.0.0:3100/api/sessions', {
        headers: { host: '127.0.0.1:3100', origin: 'http://127.0.0.1:3100' },
      }),
    ),
  ).not.toThrow();
});
it('rejects a foreign site or opaque origin', () => {
  for (const origin of ['https://foreign.test', 'null'])
    expect(() =>
      checkOrigin(
        new Request('https://diary.example/api/sessions', {
          headers: { host: 'diary.example', origin },
        }),
      ),
    ).toThrow();
});
