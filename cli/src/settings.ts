import { resolve } from 'node:path';
import { parseArgs, type ParseArgsConfig } from 'node:util';
import type { ApiClient, Credentials, Project } from './api.js';
import { DEFAULT_BASE_URL, loadConfig, type LoadedConfig } from './config.js';
import type { Context } from './context.js';
import { DEFAULT_PATHS, PLATFORMS, detectPlatform, type Platform } from './discover.js';
import { CliError, UsageError } from './errors.js';
import { canonicalTag, isLanguageTag } from './languages.js';

type Options = NonNullable<ParseArgsConfig['options']>;

export const COMMON_OPTIONS = {
  'project-id': { type: 'string' },
  'base-url': { type: 'string' },
  key: { type: 'string' },
  config: { type: 'string', short: 'c' },
  help: { type: 'boolean', short: 'h' },
} as const satisfies Options;

export const COMMON_HELP = `Common options:
  --project-id <id>     Project id (default: stringcast.json "projectId" or $STRINGCAST_PROJECT_ID)
  --base-url <url>      API origin (default: stringcast.json "baseUrl", $STRINGCAST_BASE_URL, ${DEFAULT_BASE_URL})
  --key <sk_…>          Upload key (default: $STRINGCAST_UPLOAD_KEY). $STRINGCAST_TOKEN (portal JWT) also works.
  -c, --config <file>   Path to stringcast.json (default: searched upward from the current directory)
  -h, --help            Show this help`;

/** Strict parseArgs that turns parse errors into usage errors. */
export function parseCommand<T extends Options>(command: string, args: string[], options: T) {
  try {
    return parseArgs({ args, options, strict: true, allowPositionals: false }).values;
  } catch (e) {
    throw new UsageError(`${(e as Error).message}\nRun "stringcast ${command} --help" for usage.`);
  }
}

export interface CommonValues {
  'project-id'?: string;
  'base-url'?: string;
  key?: string;
  config?: string;
}

export interface Common {
  loaded: LoadedConfig;
  projectId: string;
  baseUrl: string;
  creds: Credentials;
}

export function resolveCommon(ctx: Context, values: CommonValues): Common {
  const loaded = loadConfig(ctx.cwd, values.config);
  const projectId = values['project-id'] ?? ctx.env.STRINGCAST_PROJECT_ID ?? loaded.config.projectId;
  if (!projectId) throw new CliError('No project id. Run "stringcast init", or pass --project-id / set STRINGCAST_PROJECT_ID.');
  const baseUrl = values['base-url'] ?? ctx.env.STRINGCAST_BASE_URL ?? loaded.config.baseUrl ?? DEFAULT_BASE_URL;
  if (!/^https?:\/\//.test(baseUrl)) throw new UsageError(`Invalid base URL "${baseUrl}" (expected http(s)://…)`);
  const creds: Credentials = { key: values.key ?? ctx.env.STRINGCAST_UPLOAD_KEY, token: ctx.env.STRINGCAST_TOKEN };
  if (!creds.key) delete creds.key;
  if (!creds.token) delete creds.token;
  return { loaded, projectId, baseUrl, creds };
}

export function parsePlatform(value: string | undefined): Platform | undefined {
  if (value === undefined) return undefined;
  if (!PLATFORMS.includes(value as Platform)) throw new UsageError(`--platform must be one of ${PLATFORMS.join(', ')} (got "${value}")`);
  return value as Platform;
}

export function resolvePlatform(ctx: Context, flag: string | undefined, loaded: LoadedConfig): Platform {
  const p = parsePlatform(flag) ?? loaded.config.platform ?? detectPlatform(loaded.dir);
  if (!p) throw new CliError('Cannot tell the platform. Pass --platform android|ios|web or set "platform" in stringcast.json.');
  return p;
}

/** The string directory: --res/--path (relative to cwd) → stringcast.json paths (relative to it) → default. */
export function resolveDir(ctx: Context, platform: Platform, values: { res?: string; path?: string }, loaded: LoadedConfig): string {
  const flag = platform === 'android' ? values.res ?? values.path : values.path ?? values.res;
  if (flag) return resolve(ctx.cwd, flag);
  const fromConfig = loaded.config.paths?.[platform];
  return resolve(loaded.dir, fromConfig ?? DEFAULT_PATHS[platform]);
}

export function parseLanguageList(value: string | undefined, flag: string): string[] | undefined {
  if (value === undefined) return undefined;
  const list = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const code of list) if (!isLanguageTag(code)) throw new UsageError(`${flag}: "${code}" is not a language code`);
  if (!list.length) throw new UsageError(`${flag} needs at least one language code`);
  return list.map(canonicalTag);
}

/** Lazily fetches the project once. */
export function projectLoader(client: () => ApiClient): () => Promise<Project> {
  let p: Promise<Project> | null = null;
  return () => (p ??= client().getProject());
}
