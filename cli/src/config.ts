import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';
import { DEFAULT_PATHS, PLATFORMS, type Platform } from './discover.js';
import { CliError } from './errors.js';

export const CONFIG_FILE = 'stringcast.json';
export const DEFAULT_BASE_URL = 'http://localhost:8787';

/** `stringcast.json` */
export interface StringCastConfig {
  projectId: string;
  baseUrl: string;
  platform: Platform;
  /** Per-platform string directories, relative to stringcast.json. */
  paths: Partial<Record<Platform, string>>;
  baseLanguage?: string;
  /** Optional project language list (saves a `GET /v1/projects/{id}` on pull). */
  languages?: string[];
}

export interface LoadedConfig {
  config: Partial<StringCastConfig>;
  /** Directory containing stringcast.json (paths resolve against it). */
  dir: string;
  file: string | null;
}

/** Find stringcast.json in `cwd` or any parent (Xcode build phases run from $SRCROOT). */
export function findConfig(cwd: string): string | null {
  let dir = resolve(cwd);
  const root = parse(dir).root;
  for (;;) {
    const candidate = join(dir, CONFIG_FILE);
    if (existsSync(candidate)) return candidate;
    if (dir === root) return null;
    dir = dirname(dir);
  }
}

export function loadConfig(cwd: string, explicit?: string): LoadedConfig {
  const file = explicit ? resolve(cwd, explicit) : findConfig(cwd);
  if (!file) return { config: {}, dir: resolve(cwd), file: null };
  if (!existsSync(file)) throw new CliError(`Config file not found: ${file}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new CliError(`Invalid JSON in ${file}: ${(e as Error).message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new CliError(`${file} must contain a JSON object`);
  const config = parsed as Partial<StringCastConfig>;
  if (config.platform !== undefined && !PLATFORMS.includes(config.platform)) {
    throw new CliError(`${file}: "platform" must be one of ${PLATFORMS.join(', ')}`);
  }
  return { config, dir: dirname(file), file };
}

export function writeConfig(path: string, config: StringCastConfig): void {
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
}

export function defaultPathFor(platform: Platform): string {
  return DEFAULT_PATHS[platform];
}
