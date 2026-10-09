/** Render a plain-text table. Numeric cells are right-aligned. */
export function table(headers: string[], rows: (string | number)[][]): string {
  const cells = [headers, ...rows.map((r) => r.map((c) => String(c)))];
  const widths = headers.map((_, i) => Math.max(...cells.map((r) => (r[i] ?? '').length)));
  const numeric = headers.map((_, i) => rows.length > 0 && rows.every((r) => typeof r[i] === 'number' || r[i] === '' || r[i] === '-'));
  const line = (r: string[]) =>
    r
      .map((c, i) => (numeric[i] ? c.padStart(widths[i]!) : c.padEnd(widths[i]!)))
      .join('  ')
      .trimEnd();
  const sep = widths.map((w) => '-'.repeat(w)).join('  ');
  return [line(cells[0]!), sep, ...cells.slice(1).map(line)].join('\n');
}
