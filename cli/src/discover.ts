import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { decodeText } from './encoding.js';
import { androidFolderToLanguage, canonicalTag, isLanguageTag, lprojToLanguage } from './languages.js';

export type Platform = 'android' | 'ios' | 'web';
export type ImportFormat = 'android-xml' | 'apple-strings' | 'apple-stringsdict' | 'apple-xcstrings' | 'json';

export interface SourceFile {
  /** Absolute path. */
  path: string;
  format: ImportFormat;
  /**
   * Language code, or `null` for multi-language files (`.xcstrings`).
   * Base folders (`values/`, `Base.lproj`) are reported with `isBase: true` and `language = baseLanguage`.
   */
  language: string | null;
  isBase: boolean;
}

export const PLATFORMS: readonly Platform[] = ['android', 'ios', 'web'];

export const DEFAULT_PATHS: Record<Platform, string> = {
  android: 'app/src/main/res',
  ios: '.',
  web: 'locales',
};

function listDir(dir: string): string[] {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function readTextFile(path: string): string {
  return decodeText(readFileSync(path));
}

const ANDROID_RESOURCE = /<(string|plurals|string-array)[\s>]/;

/**
 * Android: every `*.xml` in `values` / `values-<lang>` folders that contains `<string>`, `<plurals>`
 * or `<string-array>` (strings.xml, plurals.xml, arrays.xml, …).
 */
export function discoverAndroid(resDir: string, baseLanguage: string): SourceFile[] {
  const files: SourceFile[] = [];
  for (const folder of listDir(resDir)) {
    const full = join(resDir, folder);
    if (!isDir(full)) continue;
    const lang = androidFolderToLanguage(folder);
    if (!lang) continue;
    for (const name of listDir(full)) {
      if (!name.endsWith('.xml')) continue;
      const path = join(full, name);
      let text: string;
      try {
        text = readTextFile(path);
      } catch {
        continue;
      }
      if (!ANDROID_RESOURCE.test(text)) continue;
      files.push({
        path,
        format: 'android-xml',
        language: lang.kind === 'base' ? canonicalTag(baseLanguage) : lang.code,
        isBase: lang.kind === 'base',
      });
    }
  }
  return files;
}

const IOS_SKIP_DIRS = new Set(['node_modules', 'Pods', 'Carthage', 'DerivedData', 'build', '.build', '.git', '.swiftpm', 'fastlane']);
const IOS_SKIP_EXT = /\.(xcassets|framework|xcframework|appiconset|xcodeproj|xcworkspace)$/;

/**
 * iOS: `*.lproj/Localizable.strings`, `*.lproj/Localizable.stringsdict` and `*.xcstrings`, searched
 * recursively (skipping Pods, build output, etc.).
 */
export function discoverIos(root: string, baseLanguage: string, maxDepth = 8): SourceFile[] {
  const files: SourceFile[] = [];
  const walk = (dir: string, depth: number) => {
    for (const name of listDir(dir)) {
      const full = join(dir, name);
      if (isDir(full)) {
        if (name.endsWith('.lproj')) {
          const lang = lprojToLanguage(name);
          if (!lang) continue;
          const language = lang.kind === 'base' ? canonicalTag(baseLanguage) : lang.code;
          for (const [file, format] of [
            ['Localizable.strings', 'apple-strings'],
            ['Localizable.stringsdict', 'apple-stringsdict'],
          ] as const) {
            const p = join(full, file);
            if (existsSync(p)) files.push({ path: p, format, language, isBase: lang.kind === 'base' });
          }
          continue;
        }
        if (IOS_SKIP_DIRS.has(name) || IOS_SKIP_EXT.test(name) || depth >= maxDepth) continue;
        walk(full, depth + 1);
      } else if (name.endsWith('.xcstrings')) {
        files.push({ path: full, format: 'apple-xcstrings', language: null, isBase: false });
      }
    }
  };
  walk(root, 0);
  return files;
}

/** Web: `<dir>/<lang>.json`. */
export function discoverWeb(dir: string): SourceFile[] {
  return listDir(dir)
    .filter((name) => name.endsWith('.json') && isLanguageTag(basename(name, '.json')))
    .filter((name) => !isDir(join(dir, name)))
    .map((name) => ({ path: join(dir, name), format: 'json' as const, language: canonicalTag(basename(name, '.json')), isBase: false }));
}

export function discover(platform: Platform, dir: string, baseLanguage: string): SourceFile[] {
  switch (platform) {
    case 'android':
      return discoverAndroid(dir, baseLanguage);
    case 'ios':
      return discoverIos(dir, baseLanguage);
    case 'web':
      return discoverWeb(dir);
  }
}

/** Guess the platform of a project directory. */
export function detectPlatform(cwd: string): Platform | null {
  if (isDir(join(cwd, DEFAULT_PATHS.android)) || existsSync(join(cwd, 'build.gradle')) || existsSync(join(cwd, 'build.gradle.kts')) || existsSync(join(cwd, 'settings.gradle.kts'))) {
    return 'android';
  }
  if (listDir(cwd).some((n) => n.endsWith('.xcodeproj') || n.endsWith('.xcworkspace')) || existsSync(join(cwd, 'Package.swift'))) return 'ios';
  if (isDir(join(cwd, 'locales')) || existsSync(join(cwd, 'package.json'))) return 'web';
  return null;
}
