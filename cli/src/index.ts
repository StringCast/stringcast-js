import { createInterface } from 'node:readline/promises';
import { run } from './cli.js';
import type { Context } from './context.js';

const ctx: Context = {
  cwd: process.cwd(),
  env: process.env,
  fetch: globalThis.fetch,
  stdout: process.stdout,
  stderr: process.stderr,
  prompt: process.stdin.isTTY
    ? async (question, def) => {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        try {
          return await rl.question(`${question}${def ? ` (${def})` : ''}: `);
        } finally {
          rl.close();
        }
      }
    : undefined,
};

run(process.argv.slice(2), ctx).then(
  (code) => {
    process.exitCode = code;
  },
  (e) => {
    process.stderr.write(`error: ${String(e)}\n`);
    process.exitCode = 1;
  },
);
