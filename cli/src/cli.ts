import { init, INIT_HELP } from './commands/init.js';
import { pull, PULL_HELP } from './commands/pull.js';
import { push, PUSH_HELP } from './commands/push.js';
import { status, STATUS_HELP } from './commands/status.js';
import type { Context } from './context.js';
import { CliError } from './errors.js';
import { VERSION } from './version.js';

export const MAIN_HELP = `stringcast ${VERSION} — sync string files with StringCast

Usage: stringcast <command> [options]

Commands:
  init      Create stringcast.json
  push      Upload local string files (base language by default)
  pull      Download translations into the project
  status    Show project languages and the published release

Run "stringcast <command> --help" for command options.

Environment:
  STRINGCAST_UPLOAD_KEY   Upload key (sk_…) — required for push/pull/status
  STRINGCAST_PROJECT_ID   Project id (overrides stringcast.json)
  STRINGCAST_BASE_URL     API origin (overrides stringcast.json)
  STRINGCAST_TOKEN        Portal JWT, used when no upload key is set

Exit codes: 0 success, 1 failure, 2 usage error.`;

const COMMANDS: Record<string, { run: (ctx: Context, args: string[]) => Promise<number>; help: string }> = {
  init: { run: init, help: INIT_HELP },
  push: { run: push, help: PUSH_HELP },
  pull: { run: pull, help: PULL_HELP },
  status: { run: status, help: STATUS_HELP },
};

/** Entry point; returns the process exit code. Never throws. */
export async function run(argv: string[], ctx: Context): Promise<number> {
  const [cmd, ...rest] = argv;
  try {
    if (!cmd || cmd === '--help' || cmd === '-h') {
      ctx.stdout.write(MAIN_HELP + '\n');
      return cmd ? 0 : 2;
    }
    if (cmd === '--version' || cmd === '-v' || cmd === 'version') {
      ctx.stdout.write(VERSION + '\n');
      return 0;
    }
    if (cmd === 'help') {
      const target = rest[0] ? COMMANDS[rest[0]] : undefined;
      ctx.stdout.write((target ? target.help : MAIN_HELP) + '\n');
      return 0;
    }
    const command = COMMANDS[cmd];
    if (!command) {
      ctx.stderr.write(`error: unknown command "${cmd}"\n\n${MAIN_HELP}\n`);
      return 2;
    }
    return await command.run(ctx, rest);
  } catch (e) {
    if (e instanceof CliError) {
      ctx.stderr.write(`error: ${e.message}\n`);
      return e.exitCode;
    }
    ctx.stderr.write(`error: ${(e as Error)?.stack ?? String(e)}\n`);
    return 1;
  }
}
