import type { Context } from './context.js';
import type { ImportFormat, Platform } from './discover.js';
import { CliError } from './errors.js';

export interface ImportRequest {
  format: ImportFormat;
  language?: string;
  content: string;
  platform?: Platform;
  overwrite?: boolean;
}

export interface ImportResult {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  languages: string[];
}

export interface Project {
  id: string;
  name: string;
  baseLanguage: string;
  languages: string[];
  publishedVersion: number;
  updatedAt?: string;
  stats?: {
    totalKeys: number;
    perLanguage: Record<string, { translated: number; reviewed: number; changedSincePublish: number }>;
  };
}

export interface Credentials {
  /** Upload key (`sk_…`) → `X-Api-Key`. */
  key?: string;
  /** Portal JWT → `Authorization: Bearer`. */
  token?: string;
}

export class ApiClient {
  readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly projectId: string,
    private readonly creds: Credentials,
    private readonly fetchImpl: typeof fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private headers(json: boolean): Record<string, string> {
    const h: Record<string, string> = { Accept: 'application/json', 'User-Agent': 'stringcast-cli' };
    if (json) h['Content-Type'] = 'application/json';
    if (this.creds.key) h['X-Api-Key'] = this.creds.key;
    else if (this.creds.token) h['Authorization'] = `Bearer ${this.creds.token}`;
    return h;
  }

  url(path: string, query?: Record<string, string | undefined>): string {
    const u = new URL(`${this.baseUrl}/v1/projects/${encodeURIComponent(this.projectId)}${path}`);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) u.searchParams.set(k, v);
    return u.toString();
  }

  private async send(method: string, url: string, body?: unknown): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: this.headers(body !== undefined),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      const cause = (e as { cause?: { code?: string; message?: string } }).cause;
      throw new CliError(`Cannot reach ${this.baseUrl}: ${cause?.code ?? cause?.message ?? (e as Error).message}`);
    }
    if (!res.ok) throw await apiError(res, method, url);
    return res;
  }

  async importFile(req: ImportRequest): Promise<ImportResult> {
    const res = await this.send('POST', this.url('/import'), req);
    const data = (await res.json()) as Partial<ImportResult>;
    return {
      created: data.created ?? 0,
      updated: data.updated ?? 0,
      unchanged: data.unchanged ?? 0,
      skipped: data.skipped ?? 0,
      languages: data.languages ?? [],
    };
  }

  async exportFile(format: ImportFormat, language: string | undefined, source: 'published' | 'latest'): Promise<string> {
    const res = await this.send('GET', this.url('/export', { format, language, source }));
    return res.text();
  }

  async getProject(): Promise<Project> {
    const res = await this.send('GET', this.url(''));
    return (await res.json()) as Project;
  }
}

async function apiError(res: Response, method: string, url: string): Promise<CliError> {
  let detail = '';
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text) as { error?: { code?: string; message?: string } };
      detail = j.error ? `${j.error.code ?? 'error'}: ${j.error.message ?? ''}` : text;
    } catch {
      detail = text;
    }
  } catch {
    /* ignore */
  }
  const path = new URL(url).pathname;
  let hint = '';
  if (res.status === 401 || res.status === 403) hint = '\n  Check STRINGCAST_UPLOAD_KEY / --key (an upload key "sk_…" for this project).';
  if (res.status === 404) hint = '\n  Check the project id and --base-url.';
  return new CliError(`${method} ${path} failed: HTTP ${res.status}${detail ? ` — ${detail.trim().slice(0, 500)}` : ''}${hint}`);
}

export function makeClient(ctx: Context, baseUrl: string, projectId: string, creds: Credentials, required = true): ApiClient {
  if (required && !creds.key && !creds.token) {
    throw new CliError('Missing upload key. Set STRINGCAST_UPLOAD_KEY (or pass --key sk_…).');
  }
  return new ApiClient(baseUrl, projectId, creds, ctx.fetch);
}
