import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createStringCast } from '../src';
import { StringCastProvider, useT } from '../src/react';
import { BASE, MemoryStorage, PID, fakeServer, manifest } from './helpers';

describe('react binding', () => {
  it('useT translates inside StringCastProvider', async () => {
    const s = fakeServer(manifest(1), { en: { hi: 'Hi {name}', n: { one: '%d one', other: '%d many' } }, es: { hi: 'Hola {name}' } });
    const client = createStringCast({ projectId: PID, sdkKey: 'pk', baseUrl: BASE, fetch: s.fetch as never, storage: new MemoryStorage(), preferredLanguages: ['es'], logger: false });
    await client.ready;
    function Greeting() {
      const t = useT();
      return createElement('p', null, `${t('hi', { name: 'Ana' })} ${t.plural('n', 2)} ${t.language}`);
    }
    const html = renderToString(createElement(StringCastProvider, { client }, createElement(Greeting)));
    expect(html).toContain('Hola Ana 2 many es');
  });

  it('useT throws outside a provider', () => {
    function Bad() {
      useT();
      return null;
    }
    expect(() => renderToString(createElement(Bad))).toThrow(/StringCastProvider/);
  });
});
