import type { Params, PluralCategory, PluralValue, Value } from './types';

const PLURAL_CATEGORIES: readonly PluralCategory[] = ['zero', 'one', 'two', 'few', 'many', 'other'];

export function isPluralValue(v: unknown): v is PluralValue {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const keys = Object.keys(v);
  return keys.length > 0 && keys.every((k) => (PLURAL_CATEGORIES as readonly string[]).includes(k)) && typeof (v as Record<string, unknown>).other === 'string';
}

export function isValue(v: unknown): v is Value {
  return typeof v === 'string' || isPluralValue(v) || (Array.isArray(v) && v.every((x) => typeof x === 'string'));
}

// {{name}} or {name}
const NAMED = /\{\{\s*([A-Za-z0-9_.$-]+)\s*\}\}|\{([A-Za-z0-9_.$-]+)\}/g;
// %% | %1$s %1$@ %1$d | %s %@ %d %i %f %.2f %ld %lld %lu
const POSITIONAL = /%%|%(?:(\d+)\$)?(?:\.\d+)?(?:ll|l|h)?([sdif@u])/g;

function fmtArg(arg: string | number, conv: string, spec: string): string {
  if (typeof arg === 'number') {
    if (conv === 'd' || conv === 'i' || conv === 'u') return String(Math.trunc(arg));
    if (conv === 'f') {
      const m = /\.(\d+)/.exec(spec);
      return m ? arg.toFixed(Number(m[1])) : String(arg);
    }
  }
  return String(arg);
}

/**
 * Interpolate a template.
 * - object params → `{name}` / `{{name}}` (unknown names are left as-is)
 * - array params → `%s` `%d` `%@` `%1$s` `%2$@` … positionally, and `%%` → `%`
 * `positional`, when given, is used for printf tokens even if `params` is an object (used by plural()).
 */
export function interpolate(template: string, params?: Params, positional?: ReadonlyArray<string | number>): string {
  if (params === undefined && positional === undefined) return template;
  let out = template;
  const named = params && !Array.isArray(params) ? (params as Record<string, string | number>) : undefined;
  const args = Array.isArray(params) ? (params as ReadonlyArray<string | number>) : positional;

  if (named) {
    out = out.replace(NAMED, (whole, a: string | undefined, b: string | undefined) => {
      const name = (a ?? b)!;
      return Object.prototype.hasOwnProperty.call(named, name) ? String(named[name]) : whole;
    });
  }
  if (args) {
    let next = 0;
    out = out.replace(POSITIONAL, (whole, index: string | undefined, conv: string | undefined) => {
      if (whole === '%%') return '%';
      const i = index !== undefined ? Number(index) - 1 : next++;
      if (i < 0 || i >= args.length) return whole;
      return fmtArg(args[i]!, conv!, whole);
    });
  }
  return out;
}

const rulesCache = new Map<string, Intl.PluralRules>();

export function pluralCategory(language: string | null, count: number): PluralCategory {
  const lang = language || 'en';
  let rules = rulesCache.get(lang);
  if (!rules) {
    try {
      rules = new Intl.PluralRules(lang);
    } catch {
      rules = new Intl.PluralRules('en');
    }
    rulesCache.set(lang, rules);
  }
  return rules.select(count) as PluralCategory;
}

/** Pick the plural form. An explicit `zero` form wins for 0 (Android/iOS convention). */
export function selectPlural(value: PluralValue, language: string | null, count: number): string {
  if (count === 0 && typeof value.zero === 'string') return value.zero;
  const cat = pluralCategory(language, count);
  return value[cat] ?? value.other;
}
