import { makeClient } from '../api.js';
import { out, type Context } from '../context.js';
import { table } from '../table.js';
import { COMMON_HELP, COMMON_OPTIONS, parseCommand, resolveCommon } from '../settings.js';

export const STATUS_HELP = `Usage: stringcast status [options]

Show the project's languages, translation progress and published release (GET /v1/projects/{id}).

${COMMON_HELP}`;

export async function status(ctx: Context, args: string[]): Promise<number> {
  const v = parseCommand('status', args, COMMON_OPTIONS);
  if (v.help) {
    out(ctx, STATUS_HELP);
    return 0;
  }
  const common = resolveCommon(ctx, v);
  const p = await makeClient(ctx, common.baseUrl, common.projectId, common.creds).getProject();
  const total = p.stats?.totalKeys;
  out(ctx, `Project    ${p.name} (${p.id})`);
  out(ctx, `API        ${common.baseUrl}`);
  out(ctx, `Base       ${p.baseLanguage}`);
  out(ctx, `Published  ${p.publishedVersion ? `v${p.publishedVersion}` : 'never'}`);
  if (total !== undefined) out(ctx, `Keys       ${total}`);
  out(ctx);
  const rows = p.languages.map((code) => {
    const s = p.stats?.perLanguage?.[code];
    const pct = s && total ? `${Math.round((s.translated / total) * 100)}%` : '-';
    return [code + (code === p.baseLanguage ? ' (base)' : ''), s?.translated ?? '-', pct, s?.reviewed ?? '-', s?.changedSincePublish ?? '-'];
  });
  out(ctx, table(['language', 'translated', 'done', 'reviewed', 'unpublished changes'], rows));
  return 0;
}
