/// <reference types="node" />
import { createHash } from 'node:crypto';
import { vi } from 'vitest';
import type { Bundle, Manifest, StorageLike } from '../src/types';

export const BASE = 'http://api.test';
export const PID = 'p_test';

export class MemoryStorage implements StorageLike {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

export function manifest(version: number, codes = ['en', 'es', 'fr'], base = 'en'): Manifest {
  return {
    projectId: PID,
    version,
    publishedAt: '2026-10-08T00:00:00.000Z',
    baseLanguage: base,
    languages: codes.map((code) => ({ code, url: `${BASE}/v1/sdk/${PID}/bundles/${version}/${code}.json`, keyCount: 1 })),
  };
}

export function bundle(version: number, language: string, strings: Bundle['strings']): Bundle {
  return { projectId: PID, version, language, publishedAt: '2026-10-08T00:00:00.000Z', strings };
}

export const bundleBody = (version: number, lang: string, strings: Bundle['strings']) => JSON.stringify(bundle(version, lang, strings));
export const sriHash = (body: string) => `sha256-${createHash('sha256').update(body).digest('base64')}`;

export interface Server {
  manifest: Manifest;
  bundles: Record<string, Bundle['strings']>;
  calls: { url: string; init?: RequestInit }[];
  fetch: ReturnType<typeof vi.fn>;
}

/** A fake backend. Honors If-None-Match on the manifest. */
export function fakeServer(m: Manifest, bundles: Record<string, Bundle['strings']>): Server {
  const server: Server = {
    manifest: m,
    bundles,
    calls: [],
    fetch: vi.fn(),
  };
  server.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
    server.calls.push({ url, init });
    const headers = new Headers(init?.headers);
    if (url.endsWith('/manifest')) {
      const etag = `"v${server.manifest.version}"`;
      if (headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers: { ETag: etag } });
      return Response.json(server.manifest, { headers: { ETag: etag } });
    }
    if (url.endsWith('/missing')) return Response.json({ created: 1, ignored: 0 });
    const m2 = /bundles\/(\d+)\/(.+)\.json$/.exec(url);
    if (m2) {
      const lang = m2[2]!;
      const strings = server.bundles[lang];
      if (!strings) return new Response('nope', { status: 404 });
      return new Response(bundleBody(Number(m2[1]), lang, strings), { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  });
  return server;
}

export const callsTo = (s: Server, suffix: string) => s.calls.filter((c) => c.url.endsWith(suffix));
