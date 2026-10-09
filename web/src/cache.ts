import type { Bundle, Manifest, StorageLike } from './types';

/** What we persist next to the bundles. */
export interface CacheRecord {
  manifest: Manifest;
  etag: string | null;
  fetchedAt: number;
  /** Language codes whose bundles are stored for `manifest.version`. */
  bundles: string[];
}

export function defaultStorage(): StorageLike | null {
  try {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (!ls) return null;
    // Safari private mode / disabled storage throws on access or write.
    const probe = '__stringcast_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}

/**
 * localStorage-backed cache, namespaced by project id. Every access is guarded; failures degrade to
 * "no cache". Layout:
 *   stringcast:{projectId}:manifest              → CacheRecord
 *   stringcast:{projectId}:bundle:{version}:{lang} → Bundle
 * Bundles are written before the manifest record, and old-version bundles are removed after, so a
 * crash mid-update leaves the previous release intact.
 */
export class Cache {
  constructor(
    private readonly storage: StorageLike | null,
    private readonly projectId: string,
    private readonly log: (msg: string, err?: unknown) => void,
  ) {}

  private key(suffix: string): string {
    return `stringcast:${this.projectId}:${suffix}`;
  }

  private bundleKey(version: number, lang: string): string {
    return this.key(`bundle:${version}:${lang}`);
  }

  private get(k: string): unknown {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(k);
      return raw == null ? null : JSON.parse(raw);
    } catch (e) {
      this.log(`cache read failed for ${k}`, e);
      return null;
    }
  }

  private set(k: string, v: unknown): boolean {
    if (!this.storage) return false;
    try {
      this.storage.setItem(k, JSON.stringify(v));
      return true;
    } catch (e) {
      this.log(`cache write failed for ${k}`, e);
      return false;
    }
  }

  private remove(k: string): void {
    if (!this.storage) return;
    try {
      this.storage.removeItem(k);
    } catch {
      /* ignore */
    }
  }

  readRecord(): CacheRecord | null {
    const r = this.get(this.key('manifest')) as CacheRecord | null;
    if (!r || typeof r !== 'object' || !r.manifest || typeof r.manifest.version !== 'number' || !Array.isArray(r.manifest.languages)) {
      return null;
    }
    return { manifest: r.manifest, etag: r.etag ?? null, fetchedAt: Number(r.fetchedAt) || 0, bundles: Array.isArray(r.bundles) ? r.bundles : [] };
  }

  readBundle(version: number, lang: string): Bundle | null {
    const b = this.get(this.bundleKey(version, lang)) as Bundle | null;
    if (!b || typeof b !== 'object' || !b.strings || typeof b.strings !== 'object') return null;
    return b;
  }

  /** Persist a full release atomically-ish: bundles, then record, then prune the previous version. */
  writeRelease(record: Omit<CacheRecord, 'bundles'>, bundles: Bundle[], previous: CacheRecord | null): void {
    const stored: string[] = [];
    for (const b of bundles) {
      if (this.set(this.bundleKey(record.manifest.version, b.language), b)) stored.push(b.language);
    }
    if (!this.set(this.key('manifest'), { ...record, bundles: stored })) return;
    if (previous && previous.manifest.version !== record.manifest.version) {
      for (const lang of previous.bundles) this.remove(this.bundleKey(previous.manifest.version, lang));
    }
  }

  /** Add one bundle for the current version (lazy language load). */
  addBundle(record: CacheRecord, bundle: Bundle): CacheRecord {
    if (!this.set(this.bundleKey(record.manifest.version, bundle.language), bundle)) return record;
    const next = { ...record, bundles: Array.from(new Set([...record.bundles, bundle.language])) };
    this.set(this.key('manifest'), next);
    return next;
  }

  touch(record: CacheRecord): void {
    this.set(this.key('manifest'), record);
  }
}
