import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { vi } from 'vitest';
import { run } from '../src/cli.js';
import type { Context } from '../src/context.js';

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'stringcast-cli-'));
}

export function write(root: string, rel: string, content: string | Buffer): string {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
  return p;
}

export function utf16le(text: string, bom = true): Buffer {
  const body = Buffer.from(text, 'utf16le');
  return bom ? Buffer.concat([Buffer.from([0xff, 0xfe]), body]) : body;
}

export function utf16be(text: string): Buffer {
  return Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(text, 'utf16le').swap16()]);
}

export type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;

export function harness(cwd: string, handler: Handler = () => Response.json({}), env: Record<string, string> = { STRINGCAST_UPLOAD_KEY: 'sk_test' }) {
  let stdout = '';
  let stderr = '';
  const fetch = vi.fn(async (url: string, init: RequestInit) => handler(new URL(url), init ?? {}));
  const ctx: Context = {
    cwd,
    env,
    fetch: fetch as unknown as typeof globalThis.fetch,
    stdout: { write: (s: string) => (stdout += s) },
    stderr: { write: (s: string) => (stderr += s) },
  };
  return {
    ctx,
    fetch,
    run: (...argv: string[]) => run(argv, ctx),
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
    bodies: () => fetch.mock.calls.map(([, init]) => (init?.body ? JSON.parse(init.body as string) : undefined)),
  };
}

export const ANDROID_XML = `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <string name="app_name">Demo</string>
</resources>
`;
