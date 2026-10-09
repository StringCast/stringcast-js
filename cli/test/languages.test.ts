import { describe, expect, it } from 'vitest';
import { androidFolderToLanguage, canonicalTag, languageToAndroidFolder, languageToLproj, lprojToLanguage } from '../src/languages.js';

describe('android folder ↔ language', () => {
  it.each([
    ['values', { kind: 'base' }],
    ['values-es', { kind: 'language', code: 'es' }],
    ['values-pt-rBR', { kind: 'language', code: 'pt-BR' }],
    ['values-es-r419', { kind: 'language', code: 'es-419' }],
    ['values-b+zh+Hans', { kind: 'language', code: 'zh-Hans' }],
    ['values-b+sr+Latn+RS', { kind: 'language', code: 'sr-Latn-RS' }],
    ['values-fil', { kind: 'language', code: 'fil' }],
    ['values-mcc310-es', { kind: 'language', code: 'es' }],
  ])('%s', (folder, expected) => {
    expect(androidFolderToLanguage(folder)).toEqual(expected);
  });

  it.each(['values-night', 'values-v21', 'values-land', 'values-sw600dp', 'values-es-night', 'values-car', 'values-ldrtl', 'drawable', 'values-es-rbr'])(
    'ignores %s',
    (folder) => expect(androidFolderToLanguage(folder)).toBeNull(),
  );

  it.each([
    ['es', 'values-es'],
    ['pt-BR', 'values-pt-rBR'],
    ['pt_br', 'values-pt-rBR'],
    ['zh-Hans', 'values-b+zh+Hans'],
    ['es-419', 'values-es-r419'],
    ['sr-Latn-RS', 'values-b+sr+Latn+RS'],
  ])('%s → %s', (code, folder) => {
    expect(languageToAndroidFolder(code)).toBe(folder);
    expect(androidFolderToLanguage(folder)).toEqual({ kind: 'language', code: canonicalTag(code) });
  });

  it('base language maps to values/', () => {
    expect(languageToAndroidFolder('en', 'en')).toBe('values');
    expect(languageToAndroidFolder('EN', 'en')).toBe('values');
  });
});

describe('lproj ↔ language', () => {
  it('maps folder names', () => {
    expect(lprojToLanguage('Base.lproj')).toEqual({ kind: 'base' });
    expect(lprojToLanguage('en.lproj')).toEqual({ kind: 'language', code: 'en' });
    expect(lprojToLanguage('pt-BR.lproj')).toEqual({ kind: 'language', code: 'pt-BR' });
    expect(lprojToLanguage('pt_BR.lproj')).toEqual({ kind: 'language', code: 'pt-BR' });
    expect(lprojToLanguage('zh-Hans.lproj')).toEqual({ kind: 'language', code: 'zh-Hans' });
    expect(lprojToLanguage('English.lproj')).toEqual({ kind: 'language', code: 'en' });
    expect(lprojToLanguage('Whatever Name.lproj')).toBeNull();
    expect(lprojToLanguage('Foo')).toBeNull();
  });
  it('language → lproj', () => {
    expect(languageToLproj('pt_br')).toBe('pt-BR.lproj');
    expect(languageToLproj('zh-hans')).toBe('zh-Hans.lproj');
  });
});
