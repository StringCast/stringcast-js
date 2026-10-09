/** Normalise a language tag for comparison: `pt_BR` → `pt-br`. */
export function normalizeTag(code: string): string {
  return code.trim().replace(/_/g, '-').toLowerCase();
}

function scriptOf(tag: string): string | null {
  const parts = tag.split('-');
  const explicit = parts.slice(1).find((p) => /^[a-z]{4}$/i.test(p));
  if (explicit) return explicit.toLowerCase();
  try {
    const Locale = (Intl as unknown as { Locale?: new (t: string) => { maximize(): { script?: string } } }).Locale;
    if (!Locale) return null;
    const s = new Locale(tag).maximize().script;
    return s ? s.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Contract §6.4. For each preferred language in order: exact match, then same language + script
 * (`zh-TW` → `zh-Hant`), then language only (`es-MX` → `es`), then any project language with the
 * same language subtag. First hit wins; fallback is `baseLanguage`. Returns the project's own spelling.
 */
export function resolveLanguage(
  preferred: readonly string[],
  available: readonly string[],
  baseLanguage: string | null,
): string | null {
  const avail = available.map((code) => ({ code, norm: normalizeTag(code) }));
  for (const raw of preferred) {
    if (!raw) continue;
    const pref = normalizeTag(raw);
    const lang = pref.split('-')[0]!;

    const exact = avail.find((a) => a.norm === pref);
    if (exact) return exact.code;

    const script = scriptOf(pref);
    if (script) {
      const withScript = avail.find((a) => a.norm === `${lang}-${script}`);
      if (withScript) return withScript.code;
    }

    const langOnly = avail.find((a) => a.norm === lang);
    if (langOnly) return langOnly.code;

    const sameLang = avail.find((a) => a.norm.startsWith(`${lang}-`));
    if (sameLang) return sameLang.code;
  }
  if (baseLanguage) {
    const base = avail.find((a) => a.norm === normalizeTag(baseLanguage));
    return base ? base.code : baseLanguage;
  }
  return null;
}

export function devicePreferredLanguages(): string[] {
  try {
    const nav = (globalThis as { navigator?: { languages?: readonly string[]; language?: string } }).navigator;
    if (!nav) return [];
    if (nav.languages && nav.languages.length) return [...nav.languages];
    return nav.language ? [nav.language] : [];
  } catch {
    return [];
  }
}
