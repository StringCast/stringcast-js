import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStringCast, DEFAULT_BASE_URL, SDK_VERSION } from '../src';
import { asciiHeaderValue } from '../src/client';
import { BASE, MemoryStorage, PID, bundleBody, callsTo, fakeServer, manifest, sriHash } from './helpers';

const EN = {
  welcome: 'Welcome {name}',
  only_base: 'Base only',
  items: { one: '%d item', other: '%d items' },
  planets: ['Mercury', 'Venus'],
  greet: 'Hello %1$s, from %2$s',
};
const ES = {
  welcome: 'Bienvenido {name}',
  items: { one: '%d artículo', other: '%d artículos' },
  planets: ['Mercurio', 'Venus'],
};

function make(opts: Partial<Parameters<typeof createStringCast>[0]> = {}) {
  return createStringCast({ projectId: PID, sdkKey: 'pk_test', baseUrl: BASE, preferredLanguages: ['es-MX'], logger: false, ...opts });
}

describe('createStringCast – network & lookup', () => {
  it('fetches manifest, downloads resolved + base bundles only, then translates', async () => {
    const s = fakeServer(manifest(3), { en: EN, es: ES, fr: { welcome: 'Bienvenue' } });
    const storage = new MemoryStorage();
    const p = make({ fetch: s.fetch as unknown as typeof fetch, storage });
    expect(p.t('welcome', { name: 'Ana' })).toBe('welcome'); // nothing cached yet
    await p.ready;
    expect(p.language).toBe('es');
    expect(p.languages).toEqual(['en', 'es', 'fr']);
    expect(p.version).toBe(3);
    expect(callsTo(s, '/fr.json')).toHaveLength(0);
    expect(p.t('welcome', { name: 'Ana' })).toBe('Bienvenido Ana');
    expect(callsTo(s, '/manifest')[0]!.init!.headers).toMatchObject({ 'X-Api-Key': 'pk_test' });
  });

  it('fallback chain: resolved → base → defaultValue → key', async () => {
    const s = fakeServer(manifest(1), { en: EN, es: ES });
    const p = make({ fetch: s.fetch as unknown as typeof fetch, storage: null });
    await p.ready;
    expect(p.t('welcome', { name: 'A' })).toBe('Bienvenido A');
    expect(p.t('only_base')).toBe('Base only');
    expect(p.t('nope', { n: 1 }, 'Default {n}')).toBe('Default 1');
    expect(p.t('nope')).toBe('nope');
    expect(p.t('greet', ['Ana', 'StringCast'])).toBe('Hello Ana, from StringCast');
  });

  it('plural with language rules and base fallback', async () => {
    const s = fakeServer(manifest(1), { en: { ...EN, only_en_plural: { one: '%d cat', other: '%d cats' } }, es: ES });
    const p = make({ fetch: s.fetch as unknown as typeof fetch, storage: null });
    await p.ready;
    expect(p.plural('items', 1)).toBe('1 artículo');
    expect(p.plural('items', 5)).toBe('5 artículos');
    expect(p.plural('only_en_plural', 2)).toBe('2 cats');
    expect(p.plural('missing', 2, undefined, { one: '{count} x', other: '{count} xs' })).toBe('2 xs');
    expect(p.plural('missing', 2)).toBe('missing');
    expect(p.t('items', { count: 1 })).toBe('1 artículo');
  });

  it('array lookup with fallback and flattened iOS-style keys', async () => {
    const s = fakeServer(manifest(1), { en: { ...EN, 'colors.0': 'Red', 'colors.1': 'Blue' }, es: ES });
    const p = make({ fetch: s.fetch as unknown as typeof fetch, storage: null });
    await p.ready;
    expect(p.array('planets')).toEqual(['Mercurio', 'Venus']);
    expect(p.array('colors')).toEqual(['Red', 'Blue']);
    expect(p.array('none', ['a'])).toEqual(['a']);
    expect(p.array('none')).toEqual([]);
  });

  it('languageOverride beats device languages; setLanguage lazily loads the bundle', async () => {
    const s = fakeServer(manifest(1), { en: EN, es: ES, fr: { welcome: 'Bienvenue {name}' } });
    const p = make({ fetch: s.fetch as unknown as typeof fetch, storage: null, languageOverride: 'en' });
    await p.ready;
    expect(p.language).toBe('en');
    const events: string[] = [];
    p.onUpdate((e) => events.push(`${e.reason}:${e.language}`));
    p.setLanguage('fr-CA');
    expect(p.language).toBe('fr');
    expect(p.t('welcome', { name: 'A' })).toBe('Welcome A'); // fr not loaded yet → base
    await vi.waitFor(() => expect(p.t('welcome', { name: 'A' })).toBe('Bienvenue A'));
    expect(events).toEqual(['language:fr', 'bundle:fr']);
    p.setLanguage(null);
    expect(p.language).toBe('es');
  });

  it('never throws on network errors', async () => {
    const f = vi.fn().mockRejectedValue(new TypeError('offline'));
    const p = make({ fetch: f as unknown as typeof fetch, storage: null });
    await expect(p.ready).resolves.toBeUndefined();
    expect(p.t('x', undefined, 'X')).toBe('X');
  });

  it('works with a storage that throws on every call', async () => {
    const bad = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('x'); } };
    const s = fakeServer(manifest(1), { en: EN, es: ES });
    const p = make({ fetch: s.fetch as unknown as typeof fetch, storage: bad });
    await p.ready;
    expect(p.t('welcome', { name: 'A' })).toBe('Bienvenido A');
  });
});

describe('cache + ETag', () => {
  it('loads cache synchronously on create, sends If-None-Match and handles 304', async () => {
    const storage = new MemoryStorage();
    const s = fakeServer(manifest(2), { en: EN, es: ES });
    const first = make({ fetch: s.fetch as unknown as typeof fetch, storage });
    await first.ready;
    first.destroy();

    s.calls.length = 0;
    const second = make({ fetch: s.fetch as unknown as typeof fetch, storage, refreshIntervalMs: 0 });
    // synchronous: translations available before any network
    expect(second.t('welcome', { name: 'B' })).toBe('Bienvenido B');
    expect(second.version).toBe(2);
    const updates = vi.fn();
    second.onUpdate(updates);
    await second.ready;
    const m = callsTo(s, '/manifest');
    expect(m).toHaveLength(1);
    expect((m[0]!.init!.headers as Record<string, string>)['If-None-Match']).toBe('"v2"');
    expect(callsTo(s, '.json')).toHaveLength(0); // 304 → no bundle downloads
    expect(updates).not.toHaveBeenCalled();
  });

  it('respects the min refresh interval unless forced', async () => {
    const storage = new MemoryStorage();
    const s = fakeServer(manifest(1), { en: EN, es: ES });
    await make({ fetch: s.fetch as unknown as typeof fetch, storage }).ready;
    s.calls.length = 0;
    const p = make({ fetch: s.fetch as unknown as typeof fetch, storage });
    await p.ready;
    expect(callsTo(s, '/manifest')).toHaveLength(0);
    await p.refresh({ force: true });
    expect(callsTo(s, '/manifest')).toHaveLength(1);
  });

  it('new version: downloads, atomically replaces cache, prunes old bundles, emits update', async () => {
    const storage = new MemoryStorage();
    const s = fakeServer(manifest(1), { en: EN, es: ES });
    const p = make({ fetch: s.fetch as unknown as typeof fetch, storage });
    await p.ready;
    const cb = vi.fn();
    const unsub = p.onUpdate(cb);

    s.manifest = manifest(2);
    s.bundles = { en: EN, es: { ...ES, welcome: 'Hola {name}' } };
    await p.refresh({ force: true });
    expect(cb).toHaveBeenCalledWith({ version: 2, language: 'es', reason: 'release' });
    expect(p.t('welcome', { name: 'A' })).toBe('Hola A');
    const keys = [...storage.map.keys()].sort();
    expect(keys).toEqual([`stringcast:${PID}:bundle:2:en`, `stringcast:${PID}:bundle:2:es`, `stringcast:${PID}:manifest`]);

    unsub();
    s.manifest = manifest(3);
    await p.refresh({ force: true });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('keeps the old release if a new bundle fails to download', async () => {
    const storage = new MemoryStorage();
    const s = fakeServer(manifest(1), { en: EN, es: ES });
    const p = make({ fetch: s.fetch as unknown as typeof fetch, storage });
    await p.ready;
    s.manifest = manifest(2);
    s.bundles = { en: EN }; // es 404
    await p.refresh({ force: true });
    expect(p.version).toBe(1);
    expect(p.t('welcome', { name: 'A' })).toBe('Bienvenido A');
  });

  it('verifies sha256 bundle hashes and rejects mismatches', async () => {
    const m = manifest(4);
    for (const l of m.languages) l.hash = sriHash(bundleBody(4, l.code, l.code === 'es' ? ES : EN));
    const s = fakeServer(m, { en: EN, es: ES });
    const p = make({ fetch: s.fetch as unknown as typeof fetch, storage: null });
    await p.ready;
    expect(p.version).toBe(4);
    expect(p.t('welcome', { name: 'A' })).toBe('Bienvenido A');

    const bad = manifest(5);
    for (const l of bad.languages) l.hash = 'sha256-AAAA';
    s.manifest = bad;
    await p.refresh({ force: true });
    expect(p.version).toBe(4);
  });

  it('cache is namespaced by projectId', async () => {
    const storage = new MemoryStorage();
    const s = fakeServer(manifest(1), { en: EN, es: ES });
    await make({ fetch: s.fetch as unknown as typeof fetch, storage }).ready;
    const other = createStringCast({ projectId: 'p_other', sdkKey: 'k', baseUrl: BASE, storage, fetch: vi.fn().mockRejectedValue(new Error()) as never, logger: false });
    expect(other.version).toBe(0);
    expect(other.t('welcome')).toBe('welcome');
  });
});

describe('draft mode – missing keys', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounces 5 s and posts missing keys with defaultValue, once each', async () => {
    const s = fakeServer(manifest(1), { en: EN, es: ES });
    const p = make({ fetch: s.fetch as unknown as typeof fetch, storage: null, draftMode: true });
    await p.ready;
    p.t('new_a', undefined, 'A default');
    p.t('new_b'); // no local default → not reported (contract §4.2)
    p.t('welcome'); // exists in base → not reported
    p.t('new_a', undefined, 'A default'); // dedup
    p.plural('new_p', 2, undefined, { one: '%d x', other: '%d xs' });
    await vi.advanceTimersByTimeAsync(4999);
    expect(callsTo(s, '/missing')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    const posts = callsTo(s, '/missing');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.init!.method).toBe('POST');
    expect(JSON.parse(posts[0]!.init!.body as string)).toEqual({
      platform: 'web',
      language: 'en',
      keys: [
        { key: 'new_a', value: 'A default' },
        { key: 'new_p', value: { one: '%d x', other: '%d xs' } },
      ],
    });
    p.t('new_a');
    await vi.advanceTimersByTimeAsync(10000);
    expect(callsTo(s, '/missing')).toHaveLength(1);
  });

  it('batches at most 500 keys per request', async () => {
    const s = fakeServer(manifest(1), { en: EN, es: ES });
    const p = make({ fetch: s.fetch as unknown as typeof fetch, storage: null, draftMode: true });
    await p.ready;
    for (let i = 0; i < 1201; i++) p.t(`k${i}`, undefined, `v${i}`);
    await vi.advanceTimersByTimeAsync(5000);
    const sizes = callsTo(s, '/missing').map((c) => JSON.parse(c.init!.body as string).keys.length);
    expect(sizes).toEqual([500, 500, 201]);
  });

  it('does nothing when draftMode is off', async () => {
    const s = fakeServer(manifest(1), { en: EN, es: ES });
    const p = make({ fetch: s.fetch as unknown as typeof fetch, storage: null });
    await p.ready;
    p.t('new_a', undefined, 'A');
    await vi.advanceTimersByTimeAsync(10000);
    expect(callsTo(s, '/missing')).toHaveLength(0);
  });

  it('re-queues keys when the report fails', async () => {
    const s = fakeServer(manifest(1), { en: EN, es: ES });
    const p = make({ fetch: s.fetch as unknown as typeof fetch, storage: null, draftMode: true });
    await p.ready;
    const orig = s.fetch.getMockImplementation()!;
    s.fetch.mockImplementationOnce(async () => new Response('err', { status: 500 }));
    p.t('new_a', undefined, 'A');
    await vi.advanceTimersByTimeAsync(5000);
    s.fetch.mockImplementation(orig);
    await p.flushMissing();
    const ok = callsTo(s, '/missing');
    expect(JSON.parse(ok[ok.length - 1]!.init!.body as string).keys).toEqual([{ key: 'new_a', value: 'A' }]);
  });
});

describe('check-in headers (contract §4.2)', () => {
  const hdrs = (c: { init?: RequestInit }) => Object.fromEntries(new Headers(c.init?.headers).entries());

  it('sends platform, SDK version, language and appVersion on /manifest and /missing, never on bundles', async () => {
    vi.useFakeTimers();
    try {
      const s = fakeServer(manifest(1), { en: EN, es: ES });
      const p = make({ fetch: s.fetch as unknown as typeof fetch, storage: null, draftMode: true, appVersion: '2.3.1' });
      await p.ready;
      // First manifest request: no cache and no override → language not resolvable yet → omitted.
      const first = hdrs(callsTo(s, '/manifest')[0]!);
      expect(first['x-stringcast-platform']).toBe('web');
      expect(first['x-stringcast-sdk-version']).toBe(SDK_VERSION);
      expect(first['x-stringcast-app-version']).toBe('2.3.1');
      expect(first['x-stringcast-app-id']).toBeUndefined();
      expect(first).not.toHaveProperty('x-stringcast-language');

      await p.refresh({ force: true });
      const second = hdrs(callsTo(s, '/manifest')[1]!);
      expect(second['x-stringcast-language']).toBe('es');

      p.t('new_key', undefined, 'New');
      await vi.advanceTimersByTimeAsync(5000);
      const missing = hdrs(callsTo(s, '/missing')[0]!);
      expect(missing).toMatchObject({
        'x-stringcast-platform': 'web',
        'x-stringcast-sdk-version': SDK_VERSION,
        'x-stringcast-app-version': '2.3.1',
        'x-stringcast-language': 'es',
      });
      expect(missing['x-stringcast-app-id']).toBeUndefined();

      const bundleCalls = s.calls.filter((c) => c.url.endsWith('.json'));
      expect(bundleCalls.length).toBeGreaterThan(0);
      for (const c of bundleCalls) {
        expect(Object.keys(hdrs(c)).filter((k) => k.startsWith('x-'))).toEqual([]);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('respects languageOverride and omits appVersion when not set', async () => {
    const s = fakeServer(manifest(1), { en: EN, es: ES, fr: { welcome: 'Bienvenue' } });
    const p = make({ fetch: s.fetch as unknown as typeof fetch, storage: null, languageOverride: 'fr' });
    await p.ready;
    const h = hdrs(callsTo(s, '/manifest')[0]!);
    expect(h['x-stringcast-language']).toBe('fr');
    expect(h).not.toHaveProperty('x-stringcast-app-version');
  });

  it('defaults baseUrl to https://console.stringcast.app', async () => {
    const s = fakeServer(manifest(1), { en: EN });
    const p = createStringCast({ projectId: PID, sdkKey: 'pk', fetch: s.fetch as unknown as typeof fetch, storage: null, logger: false });
    await p.ready;
    expect(DEFAULT_BASE_URL).toBe('https://console.stringcast.app');
    expect(s.calls[0]!.url).toBe(`https://console.stringcast.app/v1/sdk/${PID}/manifest`);
  });

  it('keeps header values ASCII-safe', () => {
    expect(asciiHeaderValue(' 1.0 (β)\n')).toBe('1.0 ()');
    expect(asciiHeaderValue('')).toBe('');
    expect(asciiHeaderValue(null)).toBe('');
  });
});
