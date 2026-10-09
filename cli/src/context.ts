export interface Output {
  write(chunk: string): unknown;
}

/** Everything the CLI touches in the outside world — injectable for tests. */
export interface Context {
  cwd: string;
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  stdout: Output;
  stderr: Output;
  /** Interactive prompt; undefined when stdin is not a TTY. */
  prompt?: (question: string, defaultValue?: string) => Promise<string>;
}

export function out(ctx: Context, line = ''): void {
  ctx.stdout.write(line + '\n');
}

export function warn(ctx: Context, line: string): void {
  ctx.stderr.write(`warning: ${line}\n`);
}
