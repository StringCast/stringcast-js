import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { makeClient } from '../api.js';
import { out, type Context } from '../context.js';
import { discoverIos, type ImportFormat, type Platform } from '../discover.js';
import { CliError, UsageError } from '../errors.js';
import { canonicalTag, languageToAndroidFolder, languageToLproj, sameLanguage } from '../languages.js';
import { table } from '../table.js';
import {
  COMMON_HELP,
  COMMON_OPTIONS,
  parseCommand,
  parseLanguageList,
  projectLoader,
  resolveCommon,
  resolveDir,
  resolvePlatform,
} from '../settings.js';

export const PULL_HELP = `Usage: stringcast pull [options]

Download translations (GET /v1/projects/{id}/export) and write them into the project.
By default every project language except the base language is pulled.

Options:
  --platform <p>        android | ios | web (default: stringcast.json, else auto-detect)
  --res <dir>           Android res/ directory (default: paths.android or app/src/main/res)
  --path <dir>          iOS source root / web locales directory
  --language <codes>    Only these languages (comma-separated)
  --all                 All project languages, including the base language
  --source <s>          published | latest (default: latest = includes unpublished values)
  --languages <codes>   Project language list (skips the GET /v1/projects lookup)
  --base-language <c>   Base language (default: stringcast.json, else the project's)
  --format <f>          iOS only: strings (Localizable.strings/.stringsdict) | xcstrings
                        (default: xcstrings if a .xcstrings file exists under --path)
  --dry-run             Download and show what would change; write nothing

${COMMON_HELP}

Writes:
  android  <res>/values-<lang>/strings.xml   (es → values-es, pt-BR → values-pt-rBR, zh-Hans → values-b+zh+Hans)
  ios      <path>/<lang>.lproj/Localizable.strings (+ .stringsdict when the language has plurals),
           or the existing .xcstrings file (all languages at once)
  web      <path>/<lang>.json`;

const OPTIONS = {
  ...COMMON_OPTIONS,
  platform: { type: 'string' },
  res: { type: 'string' },
  path: { type: 'string' },
  language: { type: 'string', short: 'l' },
  all: { type: 'boolean' },
  source: { type: 'string' },
  languages: { type: 'string' },
  'base-language': { type: 'string' },
  format: { type: 'string' },
  'dry-run': { type: 'boolean' },
} as const;

interface Target {
  language: string | null;
  format: ImportFormat;
  path: string;
  /** Skip writing when the export has no entries (stringsdict without plurals). */
  optional?: boolean;
}

/** Where a pulled language lands on disk. Exported for tests. */
export function targetsFor(
  platform: Platform,
  dir: string,
  language: string,
  baseLanguage: string,
  existingLproj?: Map<string, string>,
): Target[] {
  switch (platform) {
    case 'android':
      return [{ language, format: 'android-xml', path: join(dir, languageToAndroidFolder(language, baseLanguage), 'strings.xml') }];
    case 'web':
      return [{ language, format: 'json', path: join(dir, `${canonicalTag(language)}.json`) }];
    case 'ios': {
      const lproj = existingLproj?.get(canonicalTag(language).toLowerCase()) ?? join(dir, languageToLproj(language));
      return [
        { language, format: 'apple-strings', path: join(lproj, 'Localizable.strings') },
        { language, format: 'apple-stringsdict', path: join(lproj, 'Localizable.stringsdict'), optional: true },
      ];
    }
  }
}

function hasStringsdictEntries(content: string): boolean {
  return content.includes('NSStringLocalizedFormatKey');
}

function normalizeOutput(format: ImportFormat, content: string): string {
  if (format === 'json' || format === 'apple-xcstrings') {
    try {
      return JSON.stringify(JSON.parse(content), null, 2) + '\n';
    } catch {
      /* write as received */
    }
  }
  return content.endsWith('\n') ? content : content + '\n';
}

export async function pull(ctx: Context, args: string[]): Promise<number> {
  const v = parseCommand('pull', args, OPTIONS);
  if (v.help) {
    out(ctx, PULL_HELP);
    return 0;
  }
  if (v.language && v.all) throw new UsageError('Use either --language or --all, not both.');
  const source = (v.source ?? 'latest') as 'published' | 'latest';
  if (source !== 'published' && source !== 'latest') throw new UsageError('--source must be "published" or "latest"');
  if (v.format && v.format !== 'strings' && v.format !== 'xcstrings') throw new UsageError('--format must be "strings" or "xcstrings"');

  const common = resolveCommon(ctx, v);
  const { loaded } = common;
  const platform = resolvePlatform(ctx, v.platform, loaded);
  const dir = resolveDir(ctx, platform, v, loaded);
  const api = makeClient(ctx, common.baseUrl, common.projectId, common.creds);
  const project = projectLoader(() => api);

  const only = parseLanguageList(v.language, '--language');
  let projectLanguages = parseLanguageList(v.languages, '--languages') ?? loaded.config.languages?.map(canonicalTag);
  let baseLanguage = v['base-language'] ?? loaded.config.baseLanguage;
  if (!baseLanguage) baseLanguage = (await project()).baseLanguage;
  baseLanguage = canonicalTag(baseLanguage);
  if (!only && !projectLanguages) projectLanguages = (await project()).languages.map(canonicalTag);

  const languages = only ?? (v.all ? projectLanguages! : projectLanguages!.filter((l) => !sameLanguage(l, baseLanguage!)));
  if (!languages.length) {
    out(ctx, `Nothing to pull: the project has no languages besides the base language (${baseLanguage}). Use --all to pull it.`);
    return 0;
  }

  // iOS: reuse existing .lproj folders (Base.lproj for the base language) and detect .xcstrings.
  let targets: Target[] = [];
  if (platform === 'ios') {
    const existing = discoverIos(dir, baseLanguage);
    const xcstrings = existing.filter((f) => f.format === 'apple-xcstrings');
    const useXc = v.format ? v.format === 'xcstrings' : xcstrings.length > 0;
    if (useXc) {
      if (xcstrings.length > 1) throw new CliError(`Found ${xcstrings.length} .xcstrings files under ${dir}; pass --path to pick one directory.`);
      targets = [{ language: null, format: 'apple-xcstrings', path: xcstrings[0]?.path ?? join(dir, 'Localizable.xcstrings') }];
    } else {
      const lproj = new Map<string, string>();
      for (const f of existing) {
        if (f.format !== 'apple-strings' || !f.language) continue;
        const key = f.language.toLowerCase();
        // prefer an explicit <lang>.lproj over Base.lproj
        if (!lproj.has(key) || !f.isBase) lproj.set(key, dirname(f.path));
      }
      targets = languages.flatMap((l) => targetsFor(platform, dir, l, baseLanguage!, lproj));
    }
  } else {
    targets = languages.flatMap((l) => targetsFor(platform, dir, l, baseLanguage!));
  }

  const dryRun = v['dry-run'] === true;
  const rel = (p: string) => relative(ctx.cwd, p) || p;
  out(ctx, `Pulling ${source} strings for ${targets[0]?.format === 'apple-xcstrings' ? 'all languages' : languages.join(', ')} (${platform})${dryRun ? ' — dry run' : ''}`);

  const rows: string[][] = [];
  let failures = 0;
  for (const t of targets) {
    try {
      const raw = await api.exportFile(t.format, t.language ?? undefined, source);
      if (t.optional && !hasStringsdictEntries(raw)) continue;
      const content = normalizeOutput(t.format, raw);
      const before = existsSync(t.path) ? readFileSync(t.path, 'utf8') : null;
      const status = before === null ? 'created' : before === content ? 'unchanged' : 'updated';
      if (!dryRun && status !== 'unchanged') {
        mkdirSync(dirname(t.path), { recursive: true });
        writeFileSync(t.path, content);
      }
      rows.push([t.language ?? '(all)', rel(t.path), dryRun && status !== 'unchanged' ? `would be ${status}` : status]);
    } catch (e) {
      failures++;
      rows.push([t.language ?? '(all)', rel(t.path), 'failed']);
      ctx.stderr.write(`error: ${t.language ?? t.format}: ${(e as Error).message}\n`);
    }
  }
  out(ctx, table(['language', 'file', 'status'], rows));
  if (failures) {
    ctx.stderr.write(`error: ${failures} download(s) failed\n`);
    return 1;
  }
  return 0;
}
