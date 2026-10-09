import { describe, expect, it } from 'vitest';
import { resolveLanguage } from '../src/language';

describe('resolveLanguage (§6.4)', () => {
  const project = ['en', 'es', 'es-MX', 'pt-BR', 'zh-Hans', 'zh-Hant', 'fr'];

  it('exact match wins, case-insensitive, _ normalised', () => {
    expect(resolveLanguage(['es-MX'], project, 'en')).toBe('es-MX');
    expect(resolveLanguage(['es_mx'], project, 'en')).toBe('es-MX');
    expect(resolveLanguage(['PT-br'], project, 'en')).toBe('pt-BR');
  });

  it('same language with script', () => {
    expect(resolveLanguage(['zh-Hans-CN'], project, 'en')).toBe('zh-Hans');
    expect(resolveLanguage(['zh-TW'], project, 'en')).toBe('zh-Hant');
    expect(resolveLanguage(['zh-CN'], project, 'en')).toBe('zh-Hans');
  });

  it('language only', () => {
    expect(resolveLanguage(['es-AR'], project, 'en')).toBe('es');
    expect(resolveLanguage(['fr-CA'], project, 'en')).toBe('fr');
  });

  it('any project language with the same language subtag', () => {
    expect(resolveLanguage(['pt'], project, 'en')).toBe('pt-BR');
    expect(resolveLanguage(['pt-PT'], project, 'en')).toBe('pt-BR');
  });

  it('iterates preferences in order; first hit wins', () => {
    expect(resolveLanguage(['de-DE', 'ja', 'fr-FR', 'es'], project, 'en')).toBe('fr');
  });

  it('falls back to base language', () => {
    expect(resolveLanguage(['de', 'ja'], project, 'en')).toBe('en');
    expect(resolveLanguage([], project, 'en')).toBe('en');
  });
});
