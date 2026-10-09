# @stringcast/web

Over-the-air localization SDK for web apps, backed by the [StringCast](https://console.stringcast.app) API. Full guide: https://console.stringcast.app/docs/web

- Shows last-known translations instantly from `localStorage`, then refreshes in the background (`If-None-Match`, 304-aware).
- Language resolution from `navigator.languages` (exact → language+script → language → same language subtag → base).
- Fallback chain: resolved language → base language → `defaultValue` → key.
- `{name}` and `%s` / `%1$s` / `%@` / `%d` placeholders, CLDR plurals via `Intl.PluralRules`, string arrays.
- Draft mode reports keys your app uses that the project lacks.
- Never throws on network/storage errors. Works without storage (private mode, SSR).
- Optional React binding at `@stringcast/web/react`.

## Install

```sh
npm install @stringcast/web
```

## Usage

```ts
import { createStringCast } from '@stringcast/web';

export const stringcast = createStringCast({
  projectId: 'p_demo',
  sdkKey: 'pk_demo_local',              // public SDK key
  // baseUrl: 'http://localhost:8787',  // API origin, no /v1. Default: https://console.stringcast.app
  // appVersion: '2.3.1',               // optional; shown in the portal's connected apps
  // languageOverride: 'es',            // beats navigator.languages
  // draftMode: import.meta.env.DEV,    // report missing keys (never in production)
  // refreshIntervalMs: 15 * 60_000,    // min interval between manifest checks (default 15 min)
  // storage: localStorage,             // default; pass null to disable caching
});

stringcast.t('welcome_title');                                   // "Bienvenido"
stringcast.t('greeting', { name: 'Ana' }, 'Hello {name}');       // named params
stringcast.t('greeting_printf', ['Ana', 3]);                     // "%1$s has %2$d" / "%s has %d" / "%@"
stringcast.plural('items_count', 5);                             // "%d artículos" → "5 artículos"
stringcast.plural('items_count', 1, { where: 'cart' });          // {count} and %d both get the count
stringcast.array('planets');                                     // ["Mercurio", "Venus"]

await stringcast.ready;                  // first network refresh done (never rejects)
stringcast.language;                     // "es"
stringcast.languages;                    // ["en", "es", "fr"]
stringcast.setLanguage('fr');            // null = back to device languages; loads the bundle lazily
await stringcast.refresh({ force: true });
const off = stringcast.onUpdate(({ version, language, reason }) => rerender());
```

### API

| Member | Description |
|---|---|
| `createStringCast(options)` | Creates an instance; loads the cache synchronously and starts a background refresh. |
| `ready: Promise<void>` | Resolves when the initial refresh attempt finishes (success or failure). |
| `t(key, params?, defaultValue?)` | String lookup. `params` is an object (`{name}`, `{{name}}`) or an array (`%s`, `%1$s`, `%@`, `%d`, `%.2f`, `%%`). If the value is a plural map, `params.count` selects the form. |
| `plural(key, count, params?, defaultValue?)` | Plural lookup via `Intl.PluralRules` for the language the value came from. An explicit `zero` form wins for 0. `count` fills `{count}` and the first `%d`. `defaultValue` may be a string or a plural map. |
| `array(key, defaultValue?)` | String array (also reassembles iOS-style `key.0`, `key.1`, …). |
| `setLanguage(code \| null)` | Override the language at runtime. |
| `language` / `languages` / `baseLanguage` / `version` | Current state. |
| `refresh({ force })` | Check the manifest now (respects `refreshIntervalMs` unless `force`). Also runs when the tab becomes visible. |
| `onUpdate(cb) => unsubscribe` | Called with `{ version, language, reason: 'release' \| 'language' \| 'bundle' }`. |
| `flushMissing()` | Send pending draft-mode reports immediately. |
| `destroy()` | Stop timers and listeners. |

Other options: `baseUrl` (default `https://console.stringcast.app`), `appVersion` (sent as `X-StringCast-App-Version`, omitted if unset), `fetch` (custom fetch), `preferredLanguages` (instead of `navigator.languages`), `missingKeysDebounceMs` (default 5000), `logger` (default `console.warn`, `false` to silence).

### Update behaviour

1. On create: cached manifest + bundles are read from `localStorage` (`stringcast:{projectId}:…`).
2. Background `GET /v1/sdk/{projectId}/manifest` with `If-None-Match`. On `304` nothing is downloaded.
3. On a new version, bundles for the resolved and base languages are downloaded, checked (version, language, `sha256-` hash), written to the cache, then the manifest record is swapped and the old version's bundles are removed. If any download fails, the previous release stays in use. Other languages load lazily on `setLanguage`.
4. `onUpdate` fires; re-render.

### What the SDK sends

Manifest checks (`GET …/manifest`) and draft-mode reports (`POST …/missing`) carry your public SDK key (`X-Api-Key`) plus these check-in headers, so the portal can show which apps are connected:

| Header | Value |
|---|---|
| `X-StringCast-Platform` | `web` |
| `X-StringCast-App-Version` | the `appVersion` option (omitted if not set) |
| `X-StringCast-SDK-Version` | SDK version, e.g. `0.1.0` |
| `X-StringCast-Language` | the language the SDK resolved for this browser (omitted until known) |

No app ID header is sent on web — the server uses the browser's `Origin`. No device IDs, cookies, user identifiers or other personal data are sent. Bundle downloads (CDN) carry no custom headers at all, so they stay cacheable and preflight-free. Empty values are omitted; values are restricted to printable ASCII.

### Draft mode

With `draftMode: true`, keys requested via `t`/`plural`/`array` that are not in the base-language bundle are collected and sent to `POST /v1/sdk/{projectId}/missing` (5 s after the first new key, ≤500 keys per request, each key once per session). The value sent is the `defaultValue` you passed, or the key itself if none. Keys are created in the project's base language and never overwrite existing ones.

## React

```tsx
import { createStringCast } from '@stringcast/web';
import { StringCastProvider, useT, useStringCast } from '@stringcast/web/react';

const stringcast = createStringCast({ projectId: 'p_demo', sdkKey: 'pk_demo_local' }); // baseUrl defaults to https://console.stringcast.app

function App() {
  return (
    <StringCastProvider client={stringcast}>
      <Cart count={3} />
    </StringCastProvider>
  );
}

function Cart({ count }: { count: number }) {
  const t = useT();                 // re-renders on updates / language changes
  const stringcast = useStringCast();
  return (
    <>
      <h1>{t('cart_title', undefined, 'Your cart')}</h1>
      <p>{t.plural('items_count', count)}</p>
      <button onClick={() => stringcast.setLanguage('es')}>{t.language}</button>
    </>
  );
}
```

`react` is an optional peer dependency (>= 17).

## Plain `<script>`

`dist/stringcast.global.js` exposes `window.StringCast.createStringCast`. See `examples/index.html`:

```sh
cd backend && npm install && npm run seed && npm run dev   # API on :8787
cd sdk-web && npm install && npm run build
python3 -m http.server -d . 8000                           # open http://localhost:8000/examples/
```

## Development

```sh
npm test        # vitest
npm run build   # tsup → dist/ (ESM + CJS + d.ts + IIFE)
```
