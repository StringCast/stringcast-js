import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { discoverAndroid, discoverIos, discoverWeb, readTextFile } from '../src/discover.js';
import { decodeText } from '../src/encoding.js';
import { ANDROID_XML, tempDir, utf16be, utf16le, write } from './helpers.js';

describe('discoverAndroid', () => {
  it('finds string resources in language folders only', () => {
    const res = tempDir();
    write(res, 'values/strings.xml', ANDROID_XML);
    write(res, 'values/plurals.xml', '<resources><plurals name="n"><item quantity="other">%d</item></plurals></resources>');
    write(res, 'values/arrays.xml', '<resources><string-array name="a"><item>x</item></string-array></resources>');
    write(res, 'values/colors.xml', '<resources><color name="c">#fff</color></resources>');
    write(res, 'values-es/strings.xml', ANDROID_XML);
    write(res, 'values-pt-rBR/strings.xml', ANDROID_XML);
    write(res, 'values-b+zh+Hans/strings.xml', ANDROID_XML);
    write(res, 'values-night/strings.xml', ANDROID_XML);
    write(res, 'values-v21/styles.xml', '<resources><style name="s"/></resources>');
    write(res, 'drawable/x.xml', ANDROID_XML);

    const files = discoverAndroid(res, 'en').map((f) => [f.path.slice(res.length + 1), f.language, f.isBase, f.format]);
    expect(files).toEqual([
      ['values/arrays.xml', 'en', true, 'android-xml'],
      ['values/plurals.xml', 'en', true, 'android-xml'],
      ['values/strings.xml', 'en', true, 'android-xml'],
      ['values-b+zh+Hans/strings.xml', 'zh-Hans', false, 'android-xml'],
      ['values-es/strings.xml', 'es', false, 'android-xml'],
      ['values-pt-rBR/strings.xml', 'pt-BR', false, 'android-xml'],
    ]);
  });

  it('returns nothing for a missing directory', () => {
    expect(discoverAndroid(join(tempDir(), 'nope'), 'en')).toEqual([]);
  });
});

describe('discoverIos', () => {
  it('finds Localizable.strings/.stringsdict in .lproj folders and .xcstrings, skipping Pods', () => {
    const root = tempDir();
    write(root, 'App/Base.lproj/Localizable.strings', '"a" = "A";');
    write(root, 'App/es.lproj/Localizable.strings', utf16le('"a" = "Á";'));
    write(root, 'App/es.lproj/Localizable.stringsdict', '<plist/>');
    write(root, 'App/pt-BR.lproj/Localizable.strings', '"a" = "A";');
    write(root, 'App/fr.lproj/InfoPlist.strings', '"x" = "y";');
    write(root, 'App/Resources/Localizable.xcstrings', '{"sourceLanguage":"en","strings":{}}');
    write(root, 'Pods/Lib/en.lproj/Localizable.strings', '"p" = "p";');
    const files = discoverIos(root, 'en').map((f) => [f.path.slice(root.length + 1), f.language, f.format]);
    expect(files).toEqual([
      ['App/Base.lproj/Localizable.strings', 'en', 'apple-strings'],
      ['App/Resources/Localizable.xcstrings', null, 'apple-xcstrings'],
      ['App/es.lproj/Localizable.strings', 'es', 'apple-strings'],
      ['App/es.lproj/Localizable.stringsdict', 'es', 'apple-stringsdict'],
      ['App/pt-BR.lproj/Localizable.strings', 'pt-BR', 'apple-strings'],
    ]);
    expect(readTextFile(join(root, 'App/es.lproj/Localizable.strings'))).toBe('"a" = "Á";');
  });
});

describe('discoverWeb', () => {
  it('finds <lang>.json', () => {
    const dir = tempDir();
    write(dir, 'en.json', '{}');
    write(dir, 'pt_BR.json', '{}');
    write(dir, 'zh-Hans.json', '{}');
    write(dir, 'package.json', '{}');
    write(dir, 'notes.txt', '');
    expect(discoverWeb(dir).map((f) => f.language)).toEqual(['en', 'pt-BR', 'zh-Hans']);
  });
});

describe('decodeText', () => {
  const text = '"greeting" = "¡Hola, 世界!";';
  it('UTF-8 with and without BOM', () => {
    expect(decodeText(Buffer.from(text))).toBe(text);
    expect(decodeText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]))).toBe(text);
  });
  it('UTF-16 LE/BE with BOM', () => {
    expect(decodeText(utf16le(text))).toBe(text);
    expect(decodeText(utf16be(text))).toBe(text);
  });
  it('UTF-16 LE without BOM (heuristic)', () => {
    expect(decodeText(utf16le(text, false))).toBe(text);
  });
});
