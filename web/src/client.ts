import { Cache, defaultStorage, type CacheRecord } from './cache';
import { interpolate, isPluralValue, isValue, selectPlural } from './format';
import { devicePreferredLanguages, normalizeTag, resolveLanguage } from './language';
import type {
  Bundle,
  Manifest,
  Params,
  StringCast,
  StringCastOptions,
  PluralValue,
  RefreshOptions,
  UpdateEvent,
  Value,
} from './types';

/** SDK version sent as `X-StringCast-SDK-Version` (contract §4.2). Keep in sync with package.json. */
export const SDK_VERSION = '0.1.0';
/** Default API origin (contract §6.1). */
export const DEFAULT_BASE_URL = 'https://console.stringcast.app';

const DEFAULT_REFRESH_MS = 15 * 60 * 1000;
const DEFAULT_MISSING_DEBOUNCE_MS = 5000;
const MAX_MISSING_PER_REQUEST = 500;

type Hit = { value: Value; lang: string };

class StringCastClient implements StringCast {
  readonly ready: Promise<void>;

  private readonly projectId: string;
  private readonly sdkKey: string;
  private readonly baseUrl: string;
  private readonly draftMode: boolean;
  private readonly appVersion: string | null;
  private readonly refreshIntervalMs: number;
  private readonly missingDebounceMs: number;
  private readonly fetchImpl: typeof fetch | null;
  private readonly preferred: () => readonly string[];
  private readonly log: (msg: string, err?: unknown) => void;
  private readonly cache: Cache;

  private record: CacheRecord | null = null;
  /** Bundles for `record.manifest.version`, keyed by manifest language code. */
  private bundles = new Map<string, Bundle>();
  private override: string | null;
  private resolved: string | null = null;

  private listeners = new Set<(e: UpdateEvent) => void>();
  private inflight: Promise<void> | null = null;
  private bundleLoads = new Map<string, Promise<void>>();

  private pendingMissing = new Map<string, Value>();
  private reportedMissing = new Set<string>();
  private missingTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private visibilityHandler: (() => void) | null = null;

  constructor(opts: StringCastOptions) {
    if (!opts || !opts.projectId) throw new Error('[stringcast] projectId is required');
    this.projectId = opts.projectId;
    this.sdkKey = opts.sdkKey;
    this.baseUrl = (opts.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.appVersion = opts.appVersion ?? null;
    this.draftMode = opts.draftMode === true;
    this.refreshIntervalMs = opts.refreshIntervalMs ?? DEFAULT_REFRESH_MS;
    this.missingDebounceMs = opts.missingKeysDebounceMs ?? DEFAULT_MISSING_DEBOUNCE_MS;
    this.override = opts.languageOverride ?? null;
    const f = opts.fetch ?? (typeof fetch === 'function' ? fetch : null);
    this.fetchImpl = f ? (f.bind(globalThis) as typeof fetch) : null;
    this.preferred = opts.preferredLanguages ? () => opts.preferredLanguages! : devicePreferredLanguages;
    this.log =
      opts.logger === false
        ? () => {}
        : opts.logger ??
          ((msg, err) => {
            try {
              console.warn(`[stringcast] ${msg}`, err ?? '');
            } catch {
              /* ignore */
            }
          });
    this.cache = new Cache(opts.storage === undefined ? defaultStorage() : opts.storage, this.projectId, this.log);

    this.loadFromCache();
    this.ready = this.refresh().catch(() => {});
    this.watchVisibility();
  }

  // ---------------------------------------------------------------- public getters

  get language(): string | null {
    return this.resolved;
  }

  get languages(): string[] {
    return this.record ? this.record.manifest.languages.map((l) => l.code) : [];
  }

  get baseLanguage(): string | null {
    return this.record?.manifest.baseLanguage ?? null;
  }

  get version(): number {
    return this.record?.manifest.version ?? 0;
  }

  // ---------------------------------------------------------------- lookup

  t(key: string, params?: Params, defaultValue?: string): string {
    try {
      const hit = this.lookup(key);
      this.trackMissing(key, hit, defaultValue);
      if (hit) {
        const v = hit.value;
        if (typeof v === 'string') return interpolate(v, params);
        if (isPluralValue(v)) {
          const count = params && !Array.isArray(params) ? (params as Record<string, unknown>).count : undefined;
          return typeof count === 'number' ? this.formatPlural(v, hit.lang, count, params) : interpolate(v.other, params);
        }
        // arrays are not strings: fall through to the default
      }
      return defaultValue !== undefined ? interpolate(defaultValue, params) : key;
    } catch (e) {
      this.log(`t(${key}) failed`, e);
      return defaultValue ?? key;
    }
  }

  plural(key: string, count: number, params?: Params, defaultValue?: string | PluralValue): string {
    try {
      const hit = this.lookup(key);
      this.trackMissing(key, hit, defaultValue);
      if (hit) {
        const v = hit.value;
        if (isPluralValue(v)) return this.formatPlural(v, hit.lang, count, params);
        if (typeof v === 'string') return this.formatPlural({ other: v }, hit.lang, count, params);
      }
      if (defaultValue !== undefined) {
        const def = typeof defaultValue === 'string' ? { other: defaultValue } : defaultValue;
        return this.formatPlural(def, this.resolved ?? this.baseLanguage, count, params);
      }
      return key;
    } catch (e) {
      this.log(`plural(${key}) failed`, e);
      return key;
    }
  }

  array(key: string, defaultValue?: string[]): string[] {
    try {
      const hit = this.lookup(key);
      this.trackMissing(key, hit, defaultValue);
      if (hit && Array.isArray(hit.value)) return [...hit.value];
      // iOS-style flattened arrays: name.0, name.1, …
      const flat = this.lookupFlattenedArray(key);
      if (flat) return flat;
      return defaultValue ? [...defaultValue] : [];
    } catch (e) {
      this.log(`array(${key}) failed`, e);
      return defaultValue ? [...defaultValue] : [];
    }
  }

  private formatPlural(v: PluralValue, lang: string | null, count: number, params?: Params): string {
    const template = selectPlural(v, lang, count);
    if (Array.isArray(params)) return interpolate(template, params);
    const named = { count, ...((params as Record<string, string | number> | undefined) ?? {}) };
    return interpolate(template, named, [count]);
  }

  /** resolved-language bundle → base-language bundle (contract §6.5). */
  private lookup(key: string): Hit | null {
    for (const lang of this.lookupOrder()) {
      const v = this.bundles.get(lang)?.strings[key];
      if (v !== undefined && v !== null && v !== '') return { value: v, lang };
    }
    return null;
  }

  private lookupFlattenedArray(key: string): string[] | null {
    for (const lang of this.lookupOrder()) {
      const strings = this.bundles.get(lang)?.strings;
      if (!strings || typeof strings[`${key}.0`] !== 'string') continue;
      const out: string[] = [];
      for (let i = 0; typeof strings[`${key}.${i}`] === 'string'; i++) out.push(strings[`${key}.${i}`] as string);
      return out;
    }
    return null;
  }

  private lookupOrder(): string[] {
    const order: string[] = [];
    if (this.resolved) order.push(this.resolved);
    const base = this.baseLanguage;
    if (base && base !== this.resolved) order.push(base);
    return order;
  }

  // ---------------------------------------------------------------- language

  setLanguage(code: string | null): void {
    this.override = code ? code : null;
    const before = this.resolved;
    this.resolved = this.computeLanguage(this.record?.manifest ?? null);
    if (before !== this.resolved) this.emit('language');
    if (this.resolved) void this.ensureBundles([this.resolved]);
  }

  private computeLanguage(manifest: Manifest | null): string | null {
    if (!manifest || manifest.languages.length === 0) {
      return this.override ? this.override : manifest?.baseLanguage ?? null;
    }
    const prefs = this.override ? [this.override] : this.preferred();
    return resolveLanguage(prefs, manifest.languages.map((l) => l.code), manifest.baseLanguage);
  }

  // ---------------------------------------------------------------- updates

  onUpdate(cb: (event: UpdateEvent) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private emit(reason: UpdateEvent['reason']): void {
    const event: UpdateEvent = { version: this.version, language: this.resolved, reason };
    for (const cb of Array.from(this.listeners)) {
      try {
        cb(event);
      } catch (e) {
        this.log('onUpdate listener threw', e);
      }
    }
  }

  // ---------------------------------------------------------------- cache + network

  private loadFromCache(): void {
    const rec = this.cache.readRecord();
    if (rec && rec.manifest.projectId && rec.manifest.projectId !== this.projectId) return;
    this.record = rec;
    if (rec) {
      for (const lang of rec.bundles) {
        const b = this.cache.readBundle(rec.manifest.version, lang);
        if (b) this.bundles.set(lang, b);
      }
    }
    this.resolved = this.computeLanguage(rec?.manifest ?? null);
  }

  refresh(options: RefreshOptions = {}): Promise<void> {
    if (this.inflight) return this.inflight;
    const p = this.doRefresh(options.force === true)
      .catch((e) => this.log('refresh failed', e))
      .finally(() => {
        this.inflight = null;
      });
    this.inflight = p;
    return p;
  }

  private async doRefresh(force: boolean): Promise<void> {
    if (this.destroyed || !this.fetchImpl || !this.baseUrl) return;
    const rec = this.record;
    const fresh = rec && Date.now() - rec.fetchedAt < this.refreshIntervalMs;
    if (fresh && !force) {
      await this.ensureBundles(this.wantedLanguages(rec.manifest));
      return;
    }

    const headers: Record<string, string> = { 'X-Api-Key': this.sdkKey, Accept: 'application/json', ...this.checkInHeaders() };
    const etag = rec ? rec.etag ?? `"v${rec.manifest.version}"` : null;
    if (etag) headers['If-None-Match'] = etag;

    const res = await this.fetchImpl(`${this.baseUrl}/v1/sdk/${encodeURIComponent(this.projectId)}/manifest`, {
      headers,
      cache: 'no-store',
    });

    if (res.status === 304 && rec) {
      this.record = { ...rec, fetchedAt: Date.now() };
      this.cache.touch(this.record);
      await this.ensureBundles(this.wantedLanguages(rec.manifest));
      return;
    }
    if (!res.ok) throw new Error(`manifest HTTP ${res.status}`);

    const manifest = parseManifest(await res.json());
    const newEtag = res.headers.get('ETag') ?? `"v${manifest.version}"`;

    if (rec && rec.manifest.version === manifest.version) {
      this.record = { ...rec, manifest, etag: newEtag, fetchedAt: Date.now() };
      this.cache.touch(this.record);
      await this.ensureBundles(this.wantedLanguages(manifest));
      return;
    }

    // New release: download resolved + base, then swap everything at once.
    const wanted = this.wantedLanguages(manifest);
    const downloaded = await Promise.all(wanted.map((code) => this.downloadBundle(manifest, code)));
    const next: CacheRecord = { manifest, etag: newEtag, fetchedAt: Date.now(), bundles: wanted };
    this.cache.writeRelease(next, downloaded, rec);
    this.record = next;
    this.bundles = new Map(downloaded.map((b) => [b.language, b]));
    this.resolved = this.computeLanguage(manifest);
    this.emit('release');
  }

  /**
   * Check-in headers (contract §4.2) for `/manifest` and `/missing` only — never on bundle downloads (CDN).
   * No App-Id on web: the server uses the browser's `Origin`. Empty values are omitted.
   */
  private checkInHeaders(): Record<string, string> {
    const out: Record<string, string> = {};
    const put = (name: string, value: string | null | undefined) => {
      const v = asciiHeaderValue(value);
      if (v) out[name] = v;
    };
    put('X-StringCast-Platform', 'web');
    put('X-StringCast-App-Version', this.appVersion);
    put('X-StringCast-SDK-Version', SDK_VERSION);
    put('X-StringCast-Language', this.resolved);
    return out;
  }

  private wantedLanguages(manifest: Manifest): string[] {
    const resolved = this.computeLanguage(manifest);
    const codes = manifest.languages.map((l) => l.code);
    return Array.from(new Set([resolved, manifest.baseLanguage].filter((c): c is string => !!c && codes.includes(c))));
  }

  /** Load bundles for the current release that are not in memory yet (lazy languages, cache misses). */
  private async ensureBundles(codes: string[]): Promise<void> {
    const rec = this.record;
    if (!rec || !this.fetchImpl) return;
    await Promise.all(
      codes
        .filter((c) => !this.bundles.has(c) && rec.manifest.languages.some((l) => l.code === c))
        .map((code) => {
          const key = `${rec.manifest.version}:${code}`;
          let p = this.bundleLoads.get(key);
          if (!p) {
            p = this.downloadBundle(rec.manifest, code)
              .then((b) => {
                if (this.record?.manifest.version !== rec.manifest.version) return; // superseded
                this.bundles.set(code, b);
                this.record = this.cache.addBundle(this.record, b);
                this.emit('bundle');
              })
              .catch((e) => this.log(`bundle ${code} failed`, e))
              .finally(() => this.bundleLoads.delete(key));
            this.bundleLoads.set(key, p);
          }
          return p;
        }),
    );
  }

  private async downloadBundle(manifest: Manifest, code: string): Promise<Bundle> {
    const entry = manifest.languages.find((l) => l.code === code);
    if (!entry) throw new Error(`language ${code} not in manifest`);
    // No API key: bundle URLs are public (CDN) and a custom header would force a CORS preflight.
    const res = await this.fetchImpl!(entry.url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`bundle ${code} HTTP ${res.status}`);
    const text = await res.text();
    if (entry.hash && !(await verifyHash(text, entry.hash))) throw new Error(`bundle ${code} hash mismatch`);
    const data = JSON.parse(text) as Partial<Bundle>;
    if (!data || typeof data !== 'object' || !data.strings || typeof data.strings !== 'object' || Array.isArray(data.strings)) {
      throw new Error(`bundle ${code} is malformed`);
    }
    if (typeof data.version === 'number' && data.version !== manifest.version) {
      throw new Error(`bundle ${code} version ${data.version} != manifest ${manifest.version}`);
    }
    if (typeof data.language === 'string' && normalizeTag(data.language) !== normalizeTag(code)) {
      throw new Error(`bundle language ${data.language} != ${code}`);
    }
    const strings: Record<string, Value> = {};
    for (const [k, v] of Object.entries(data.strings)) if (isValue(v)) strings[k] = v;
    return { projectId: this.projectId, version: manifest.version, language: code, publishedAt: data.publishedAt, strings };
  }

  // ---------------------------------------------------------------- draft mode

  private trackMissing(key: string, hit: Hit | null, defaultValue: Value | undefined): void {
    if (!this.draftMode || this.destroyed) return;
    // Contract §4.2: keys without a local default are not reported (avoids key-as-value noise).
    if (defaultValue === undefined) return;
    if (this.reportedMissing.has(key) || this.pendingMissing.has(key)) return;
    const base = this.baseLanguage;
    if (hit && base && this.bundles.get(base)?.strings[key] !== undefined) return;
    this.pendingMissing.set(key, defaultValue);
    if (!this.missingTimer) {
      this.missingTimer = setTimeout(() => {
        this.missingTimer = null;
        void this.flushMissing();
      }, this.missingDebounceMs);
    }
  }

  async flushMissing(): Promise<void> {
    if (this.missingTimer) {
      clearTimeout(this.missingTimer);
      this.missingTimer = null;
    }
    if (!this.pendingMissing.size || !this.fetchImpl) return;
    await this.ready;
    const rec = this.record;
    if (!rec) return; // can't tell what's missing yet; keep pending for the next flush
    const base = rec.manifest.baseLanguage;
    const baseBundle = this.bundles.get(base);
    if (rec.manifest.version > 0 && !baseBundle) return; // base not loaded yet; retry later

    const items: { key: string; value: Value }[] = [];
    for (const [key, value] of this.pendingMissing) {
      this.pendingMissing.delete(key);
      if (baseBundle && baseBundle.strings[key] !== undefined) continue;
      this.reportedMissing.add(key);
      items.push({ key, value });
    }

    for (let i = 0; i < items.length; i += MAX_MISSING_PER_REQUEST) {
      const batch = items.slice(i, i + MAX_MISSING_PER_REQUEST);
      try {
        const res = await this.fetchImpl(`${this.baseUrl}/v1/sdk/${encodeURIComponent(this.projectId)}/missing`, {
          method: 'POST',
          headers: { 'X-Api-Key': this.sdkKey, 'Content-Type': 'application/json', ...this.checkInHeaders() },
          body: JSON.stringify({ platform: 'web', language: base, keys: batch }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (e) {
        this.log(`reporting ${batch.length} missing keys failed`, e);
        for (const it of batch) {
          this.reportedMissing.delete(it.key);
          this.pendingMissing.set(it.key, it.value);
        }
      }
    }
  }

  // ---------------------------------------------------------------- lifecycle

  private watchVisibility(): void {
    try {
      const doc = (globalThis as { document?: Document }).document;
      if (!doc || typeof doc.addEventListener !== 'function') return;
      this.visibilityHandler = () => {
        if (doc.visibilityState === 'visible') void this.refresh();
      };
      doc.addEventListener('visibilitychange', this.visibilityHandler);
    } catch {
      /* ignore */
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.missingTimer) clearTimeout(this.missingTimer);
    this.missingTimer = null;
    this.listeners.clear();
    try {
      const doc = (globalThis as { document?: Document }).document;
      if (doc && this.visibilityHandler) doc.removeEventListener('visibilitychange', this.visibilityHandler);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Verify an SRI-style `sha256-<base64>` hash of the raw bundle body (what the backend emits).
 * Unknown hash formats, or environments without WebCrypto, are accepted unverified.
 */
async function verifyHash(body: string, hash: string): Promise<boolean> {
  if (!hash.startsWith('sha256-')) return true;
  const subtle = (globalThis as { crypto?: Crypto }).crypto?.subtle;
  if (!subtle || typeof TextEncoder === 'undefined') return true;
  try {
    const digest = new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(body)));
    let bin = '';
    for (const b of digest) bin += String.fromCharCode(b);
    const b64 = btoa(bin);
    const hex = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
    const expected = hash.slice('sha256-'.length);
    return expected === b64 || expected.toLowerCase() === hex;
  } catch {
    return true;
  }
}

/** Keep printable ASCII only (header values must be ASCII-safe); trims, returns '' for nothing left. */
export function asciiHeaderValue(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[^\x20-\x7E]/g, '').trim();
}

function parseManifest(data: unknown): Manifest {
  const m = data as Partial<Manifest> | null;
  if (!m || typeof m !== 'object' || typeof m.version !== 'number' || !Array.isArray(m.languages) || typeof m.baseLanguage !== 'string') {
    throw new Error('manifest is malformed');
  }
  const languages = m.languages.filter(
    (l): l is Manifest['languages'][number] => !!l && typeof l.code === 'string' && typeof l.url === 'string',
  );
  return {
    projectId: String(m.projectId ?? ''),
    version: m.version,
    publishedAt: m.publishedAt ?? null,
    baseLanguage: m.baseLanguage,
    languages,
  };
}

export function createStringCast(options: StringCastOptions): StringCast {
  return new StringCastClient(options);
}
