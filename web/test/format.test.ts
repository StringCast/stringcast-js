import { describe, expect, it } from 'vitest';
import { interpolate, selectPlural } from '../src/format';

describe('interpolate', () => {
  it('named params {name} and {{name}}', () => {
    expect(interpolate('Hi {name}, you have {count} new', { name: 'Ana', count: 3 })).toBe('Hi Ana, you have 3 new');
    expect(interpolate('Hi {{ name }}', { name: 'Ana' })).toBe('Hi Ana');
    expect(interpolate('Hi {unknown}', { name: 'Ana' })).toBe('Hi {unknown}');
  });

  it('positional %s %d %@ sequentially', () => {
    expect(interpolate('%s has %d items (%@)', ['Ana', 3, 'x'])).toBe('Ana has 3 items (x)');
    expect(interpolate('%d', [2.7])).toBe('2');
    expect(interpolate('%.2f%%', [1.5])).toBe('1.50%');
    expect(interpolate('%ld left', [4])).toBe('4 left');
  });

  it('indexed %1$s %2$@ %1$d', () => {
    expect(interpolate('%2$s, %1$s', ['World', 'Hello'])).toBe('Hello, World');
    expect(interpolate('%2$@ %1$d', [5, 'n'])).toBe('n 5');
  });

  it('leaves tokens alone when args are missing or no params', () => {
    expect(interpolate('%s and %s', ['a'])).toBe('a and %s');
    expect(interpolate('100% {x} %s')).toBe('100% {x} %s');
    expect(interpolate('{name} %s', { name: 'a' })).toBe('a %s');
  });
});

describe('selectPlural', () => {
  it('uses Intl.PluralRules for the language', () => {
    const v = { one: 'one', few: 'few', many: 'many', other: 'other' };
    expect(selectPlural(v, 'en', 1)).toBe('one');
    expect(selectPlural(v, 'en', 2)).toBe('other');
    expect(selectPlural(v, 'pl', 3)).toBe('few');
    expect(selectPlural(v, 'pl', 5)).toBe('many');
    expect(selectPlural(v, 'ja', 1)).toBe('other');
  });
  it('explicit zero wins for 0, else falls back to other', () => {
    expect(selectPlural({ zero: 'none', other: 'n' }, 'en', 0)).toBe('none');
    expect(selectPlural({ one: 'x', other: 'n' }, 'en', 0)).toBe('n');
  });
});
