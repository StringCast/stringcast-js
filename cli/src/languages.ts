/**
 * Language tag helpers and the folder ↔ language mappings used by push/pull.
 * Contract §1: codes compare case-insensitively and `_` is normalised to `-`.
 */

/** Canonical casing: `pt_br` → `pt-BR`, `zh-hans` → `zh-Hans`, `es-419` → `es-419`. */
export function canonicalTag(code: string): string {
  const parts = code.trim().replace(/_/g, '-').split('-').filter(Boolean);
  return parts
    .map((p, i) => {
      if (i === 0) return p.toLowerCase();
      if (/^[A-Za-z]{4}$/.test(p)) return p[0]!.toUpperCase() + p.slice(1).toLowerCase();
      if (/^[A-Za-z]{2}$/.test(p) || /^\d{3}$/.test(p)) return p.toUpperCase();
      return p.toLowerCase();
    })
    .join('-');
}

export function sameLanguage(a: string, b: string): boolean {
  return canonicalTag(a).toLowerCase() === canonicalTag(b).toLowerCase();
}

export function isLanguageTag(code: string): boolean {
  return /^[A-Za-z]{2,3}([-_]([A-Za-z]{4}|[A-Za-z]{2}|\d{3}|[A-Za-z0-9]{5,8}))*$/.test(code);
}

// ------------------------------------------------------------------ Android

export type AndroidFolder = { kind: 'base' } | { kind: 'language'; code: string };

/** Android resource qualifiers that look like a language code but aren't. */
const NON_LANGUAGE_QUALIFIERS = new Set(['car', 'ldltr', 'ldrtl']);

/**
 * `values` → base; `values-es` → es; `values-pt-rBR` → pt-BR; `values-b+zh+Hans` → zh-Hans;
 * `values-b+sr+Latn+RS` → sr-Latn-RS. Folders with other qualifiers (`values-night`, `values-v21`,
 * `values-es-land`, …) return null and are ignored.
 */
export function androidFolderToLanguage(folder: string): AndroidFolder | null {
  if (folder === 'values') return { kind: 'base' };
  const m = /^values-(.+)$/.exec(folder);
  if (!m) return null;
  const parts = m[1]!.split('-');
  while (parts.length && /^(mcc\d+|mnc\d+)$/i.test(parts[0]!)) parts.shift();
  const first = parts.shift();
  if (!first) return null;
  if (first.startsWith('b+')) {
    if (parts.length) return null;
    const sub = first.slice(2).split('+').filter(Boolean);
    if (!sub.length || !/^[a-zA-Z]{2,3}$/.test(sub[0]!)) return null;
    return { kind: 'language', code: canonicalTag(sub.join('-')) };
  }
  if (!/^[a-z]{2,3}$/.test(first) || NON_LANGUAGE_QUALIFIERS.has(first)) return null;
  let code = first;
  if (parts.length) {
    const r = /^r([A-Z]{2}|\d{3})$/.exec(parts[0]!);
    if (!r) return null;
    code += '-' + r[1];
    parts.shift();
  }
  if (parts.length) return null;
  return { kind: 'language', code: canonicalTag(code) };
}

/** `es` → values-es, `pt-BR` → values-pt-rBR, `zh-Hans` → values-b+zh+Hans. */
export function languageToAndroidFolder(code: string, baseLanguage?: string): string {
  if (baseLanguage && sameLanguage(code, baseLanguage)) return 'values';
  const parts = canonicalTag(code).split('-');
  if (parts.length === 1) return `values-${parts[0]}`;
  if (parts.length === 2 && /^([A-Z]{2}|\d{3})$/.test(parts[1]!)) return `values-${parts[0]}-r${parts[1]}`;
  return `values-b+${parts.join('+')}`;
}

// ------------------------------------------------------------------ Apple

const LEGACY_LPROJ: Record<string, string> = {
  english: 'en',
  french: 'fr',
  german: 'de',
  spanish: 'es',
  italian: 'it',
  japanese: 'ja',
  dutch: 'nl',
  portuguese: 'pt',
  swedish: 'sv',
  danish: 'da',
  finnish: 'fi',
  norwegian: 'nb',
  korean: 'ko',
  russian: 'ru',
  polish: 'pl',
  chinese: 'zh-Hans',
};

/** `Base.lproj` → base; `en.lproj` → en; `pt_BR.lproj` → pt-BR; `English.lproj` → en. */
export function lprojToLanguage(dirName: string): { kind: 'base' } | { kind: 'language'; code: string } | null {
  const m = /^(.+)\.lproj$/.exec(dirName);
  if (!m) return null;
  const name = m[1]!;
  if (name === 'Base') return { kind: 'base' };
  const legacy = LEGACY_LPROJ[name.toLowerCase()];
  if (legacy) return { kind: 'language', code: legacy };
  if (!isLanguageTag(name)) return null;
  return { kind: 'language', code: canonicalTag(name) };
}

export function languageToLproj(code: string): string {
  return `${canonicalTag(code)}.lproj`;
}
