import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { CONFIG_FILE, DEFAULT_BASE_URL, writeConfig, type StringCastConfig } from '../config.js';
import { out, type Context } from '../context.js';
import { DEFAULT_PATHS, PLATFORMS, detectPlatform, type Platform } from '../discover.js';
import { CliError, UsageError } from '../errors.js';
import { canonicalTag, isLanguageTag } from '../languages.js';
import { parseCommand, parseLanguageList, parsePlatform } from '../settings.js';

export const INIT_HELP = `Usage: stringcast init [options]

Create stringcast.json in the current directory. Prompts for anything not given as a flag
(when run in a terminal); with --yes or without a TTY, flags and defaults are used.

Options:
  --project-id <id>     Project id (required without a TTY)
  --base-url <url>      API origin (default: ${DEFAULT_BASE_URL})
  --platform <p>        android | ios | web (default: auto-detected)
  --res <dir>           Android res/ directory (default: ${DEFAULT_PATHS.android})
  --path <dir>          iOS source root (default: ${DEFAULT_PATHS.ios}) / web locales dir (default: ${DEFAULT_PATHS.web})
  --base-language <c>   Base language (default: en)
  --languages <codes>   Optional project language list, e.g. en,es,fr
  -y, --yes             Don't prompt
  --force               Overwrite an existing stringcast.json
  -h, --help            Show this help`;

const OPTIONS = {
  'project-id': { type: 'string' },
  'base-url': { type: 'string' },
  platform: { type: 'string' },
  res: { type: 'string' },
  path: { type: 'string' },
  'base-language': { type: 'string' },
  languages: { type: 'string' },
  yes: { type: 'boolean', short: 'y' },
  force: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

export async function init(ctx: Context, args: string[]): Promise<number> {
  const v = parseCommand('init', args, OPTIONS);
  if (v.help) {
    out(ctx, INIT_HELP);
    return 0;
  }
  const file = join(ctx.cwd, CONFIG_FILE);
  if (existsSync(file) && !v.force) throw new CliError(`${CONFIG_FILE} already exists. Use --force to overwrite.`);

  const ask = !v.yes && ctx.prompt ? ctx.prompt : undefined;
  const value = async (q: string, flag: string | undefined, def?: string) => (flag !== undefined ? flag : ask ? (await ask(q, def)).trim() || def : def);

  const projectId = await value('Project id', v['project-id']);
  if (!projectId) throw new UsageError('A project id is required: stringcast init --project-id <id>');

  const baseUrl = (await value('API base URL', v['base-url'], DEFAULT_BASE_URL))!;
  if (!/^https?:\/\//.test(baseUrl)) throw new UsageError(`Invalid base URL "${baseUrl}"`);

  let platform = parsePlatform(v.platform);
  if (!platform) {
    const detected = detectPlatform(ctx.cwd) ?? 'android';
    const answer = await value(`Platform (${PLATFORMS.join('/')})`, undefined, detected);
    platform = parsePlatform(answer) as Platform;
  }

  const pathFlag = platform === 'android' ? v.res ?? v.path : v.path ?? v.res;
  const stringsPath = (await value(platform === 'android' ? 'Android res/ directory' : platform === 'ios' ? 'iOS source root' : 'Locales directory', pathFlag, DEFAULT_PATHS[platform]))!;

  const baseLanguage = (await value('Base language', v['base-language'], 'en'))!;
  if (!isLanguageTag(baseLanguage)) throw new UsageError(`"${baseLanguage}" is not a language code`);

  const languages = parseLanguageList(v.languages, '--languages');

  const config: StringCastConfig = {
    projectId,
    baseUrl,
    platform,
    paths: { [platform]: relative(ctx.cwd, join(ctx.cwd, stringsPath)) || '.' },
    baseLanguage: canonicalTag(baseLanguage),
    ...(languages ? { languages } : {}),
  };
  writeConfig(file, config);
  out(ctx, `Wrote ${CONFIG_FILE}:`);
  out(ctx, JSON.stringify(config, null, 2));
  out(ctx);
  out(ctx, 'Next: export STRINGCAST_UPLOAD_KEY=sk_… and run "stringcast push".');
  return 0;
}
