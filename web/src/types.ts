export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

/** A plural map; `other` is required by the contract (§2). */
export type PluralValue = Partial<Record<PluralCategory, string>> & { other: string };

/** A key's value in one language (contract §2). */
export type Value = string | PluralValue | string[];

export type Params = Record<string, string | number> | ReadonlyArray<string | number>;

export interface ManifestLanguage {
  code: string;
  url: string;
  hash?: string;
  keyCount?: number;
}

/** `GET /v1/sdk/{projectId}/manifest` (contract §4.2). */
export interface Manifest {
  projectId: string;
  version: number;
  publishedAt?: string | null;
  baseLanguage: string;
  languages: ManifestLanguage[];
}

/** A release bundle (contract §3). */
export interface Bundle {
  projectId: string;
  version: number;
  language: string;
  publishedAt?: string;
  strings: Record<string, Value>;
}

/** Minimal Web Storage subset used for the cache. `localStorage` satisfies it. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface StringCastOptions {
  projectId: string;
  /** Public SDK key (`pk_…`). */
  sdkKey: string;
  /** API origin (no `/v1`). Default `https://console.stringcast.app`; e.g. `http://localhost:8787` for local dev. */
  baseUrl?: string;
  /** Your app's version, sent as `X-StringCast-App-Version` so the portal can show it. Omitted if not set. */
  appVersion?: string;
  /** Force a language (beats device preferences). */
  languageOverride?: string | null;
  /** Report keys missing from the base bundle to `/missing`. Default `false`. Never enable in production. */
  draftMode?: boolean;
  /** Minimum interval between manifest checks. Default 15 min. */
  refreshIntervalMs?: number;
  /** Cache storage. Default `window.localStorage` when available; pass `null` to disable caching. */
  storage?: StorageLike | null;
  /** Override `fetch` (tests, SSR). Default `globalThis.fetch`. */
  fetch?: typeof fetch;
  /** Override preferred languages. Default `navigator.languages`. */
  preferredLanguages?: readonly string[];
  /** Debounce window for missing-key reports. Default 5000 ms. */
  missingKeysDebounceMs?: number;
  /** Logger for swallowed errors. Default `console.warn`; pass `false` to silence. */
  logger?: ((message: string, error?: unknown) => void) | false;
}

export interface UpdateEvent {
  /** Release version now in use (0 = nothing published / unknown). */
  version: number;
  /** Resolved language. */
  language: string | null;
  reason: 'release' | 'language' | 'bundle';
}

export interface RefreshOptions {
  /** Ignore the min refresh interval. */
  force?: boolean;
}

export interface StringCast {
  /** Resolves once the first network refresh attempt finishes (success or failure). Never rejects. */
  readonly ready: Promise<void>;
  t(key: string, params?: Params, defaultValue?: string): string;
  plural(key: string, count: number, params?: Params, defaultValue?: string | PluralValue): string;
  array(key: string, defaultValue?: string[]): string[];
  setLanguage(code: string | null): void;
  /** Resolved language, or `null` before any manifest is known and no override was given. */
  readonly language: string | null;
  /** Language codes in the current release. */
  readonly languages: string[];
  readonly baseLanguage: string | null;
  /** Current release version (0 = none). */
  readonly version: number;
  refresh(options?: RefreshOptions): Promise<void>;
  onUpdate(cb: (event: UpdateEvent) => void): () => void;
  /** Send pending missing-key reports now (draft mode). */
  flushMissing(): Promise<void>;
  /** Stop timers and drop listeners. */
  destroy(): void;
}
