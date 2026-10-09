import { relative } from 'node:path';
import { makeClient, type ImportResult } from '../api.js';
import { out, warn, type Context } from '../context.js';
import { discover, readTextFile, type SourceFile } from '../discover.js';
import { CliError } from '../errors.js';
import { canonicalTag, sameLanguage } from '../languages.js';
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

export const PUSH_HELP = `Usage: stringcast push [options]

Upload local string files to StringCast (POST /v1/projects/{id}/import).
By default only the base language is uploaded.

Options:
  --platform <p>        android | ios | web (default: stringcast.json, else auto-detect)
  --res <dir>           Android res/ directory (default: paths.android or app/src/main/res)
  --path <dir>          iOS source root / web locales directory (default: paths.ios "." / paths.web "locales")
  --language <codes>    Only these languages (comma-separated), e.g. es,pt-BR
  --all-languages       Upload every language found (translations too)
  --base-language <c>   Language of values/ and Base.lproj (default: stringcast.json, else the project's)
  --overwrite           Replace existing values on the server (default: only add new keys/values)
  --dry-run             List the files that would be uploaded; send nothing

${COMMON_HELP}

Files:
  android  res/values[-xx[-rYY]|-b+xx+Scrp]/*.xml containing <string>, <plurals> or <string-array>
  ios      **/*.lproj/Localizable.strings, Localizable.stringsdict (UTF-8 or UTF-16), **/*.xcstrings
  web      <path>/<lang>.json`;

const OPTIONS = {
  ...COMMON_OPTIONS,
  platform: { type: 'string' },
  res: { type: 'string' },
  path: { type: 'string' },
  language: { type: 'string', short: 'l' },
  'all-languages': { type: 'boolean' },
  'base-language': { type: 'string' },
  overwrite: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
} as const;

/** Keep only `keep` languages in an .xcstrings file (the source language is always kept). */
export function filterXcstrings(content: string, keep: (lang: string) => boolean): string {
  let doc: { sourceLanguage?: string; strings?: Record<string, { localizations?: Record<string, unknown> }> };
  try {
    doc = JSON.parse(content);
  } catch {
    return content;
  }
  if (!doc || typeof doc !== 'object' || !doc.strings) return content;
  for (const entry of Object.values(doc.strings)) {
    if (!entry || typeof entry !== 'object' || !entry.localizations) continue;
    for (const lang of Object.keys(entry.localizations)) {
      if (!keep(lang) && !(doc.sourceLanguage && sameLanguage(lang, doc.sourceLanguage))) delete entry.localizations[lang];
    }
  }
  return JSON.stringify(doc, null, 2);
}

export async function push(ctx: Context, args: string[]): Promise<number> {
  const v = parseCommand('push', args, OPTIONS);
  if (v.help) {
    out(ctx, PUSH_HELP);
    return 0;
  }
  if (v.language && v['all-languages']) throw new CliError('Use either --language or --all-languages, not both.', 2);
  const common = resolveCommon(ctx, v);
  const { loaded } = common;
  const platform = resolvePlatform(ctx, v.platform, loaded);
  const dir = resolveDir(ctx, platform, v, loaded);
  const onlyLanguages = parseLanguageList(v.language, '--language');
  const dryRun = v['dry-run'] === true;

  const client = () => makeClient(ctx, common.baseUrl, common.projectId, common.creds);
  const project = projectLoader(client);

  let baseLanguage = v['base-language'] ?? loaded.config.baseLanguage;
  if (!baseLanguage) {
    try {
      baseLanguage = (await project()).baseLanguage;
    } catch (e) {
      if (!dryRun) throw e;
      baseLanguage = 'en';
      warn(ctx, 'base language unknown (no stringcast.json "baseLanguage"); assuming "en" for this dry run');
    }
  }
  baseLanguage = canonicalTag(baseLanguage);

  const found = discover(platform, dir, baseLanguage);
  if (!found.length) throw new CliError(`No ${platform} string files found in ${dir}`);

  const wanted = (lang: string) =>
    v['all-languages'] ? true : onlyLanguages ? onlyLanguages.some((l) => sameLanguage(l, lang)) : sameLanguage(lang, baseLanguage!);
  const selected: SourceFile[] = found.filter((f) => f.language === null || wanted(f.language));
  if (!selected.length) {
    const langs = [...new Set(found.map((f) => f.language).filter(Boolean))].join(', ');
    throw new CliError(`No files match the selected language(s). Found: ${langs || 'none'}`);
  }

  const rel = (p: string) => relative(ctx.cwd, p) || p;
  out(ctx, `${dryRun ? 'Would upload' : 'Uploading'} ${selected.length} file(s) to ${common.projectId} (${platform}, base ${baseLanguage})${v.overwrite ? ' with --overwrite' : ''}`);

  if (dryRun) {
    out(ctx, table(['file', 'language', 'format'], selected.map((f) => [rel(f.path), f.language ?? '(multi)', f.format])));
    return 0;
  }

  const api = client();
  const rows: (string | number)[][] = [];
  const totals: ImportResult = { created: 0, updated: 0, unchanged: 0, skipped: 0, languages: [] };
  let failures = 0;
  for (const f of selected) {
    let content: string;
    try {
      content = readTextFile(f.path);
      if (f.format === 'apple-xcstrings' && !v['all-languages']) content = filterXcstrings(content, wanted);
    } catch (e) {
      failures++;
      rows.push([rel(f.path), f.language ?? '(multi)', '-', '-', '-', '-', `error: ${(e as Error).message}`]);
      continue;
    }
    try {
      const r = await api.importFile({
        format: f.format,
        ...(f.language ? { language: f.language } : {}),
        content,
        platform,
        overwrite: v.overwrite === true,
      });
      totals.created += r.created;
      totals.updated += r.updated;
      totals.unchanged += r.unchanged;
      totals.skipped += r.skipped;
      rows.push([rel(f.path), f.language ?? (r.languages.join(',') || '(multi)'), r.created, r.updated, r.unchanged, r.skipped, 'ok']);
    } catch (e) {
      failures++;
      rows.push([rel(f.path), f.language ?? '(multi)', '-', '-', '-', '-', 'failed']);
      ctx.stderr.write(`error: ${rel(f.path)}: ${(e as Error).message}\n`);
    }
  }
  rows.push(['total', '', totals.created, totals.updated, totals.unchanged, totals.skipped, failures ? `${failures} failed` : 'ok']);
  out(ctx, table(['file', 'language', 'created', 'updated', 'unchanged', 'skipped', 'status'], rows));
  if (failures) {
    ctx.stderr.write(`error: ${failures} of ${selected.length} file(s) failed to upload\n`);
    return 1;
  }
  return 0;
}
