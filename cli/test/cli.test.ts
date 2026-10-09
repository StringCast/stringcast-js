import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { filterXcstrings } from '../src/commands/push.js';
import { ANDROID_XML, harness, tempDir, utf16le, write } from './helpers.js';

const IMPORT_OK = { created: 2, updated: 1, unchanged: 3, skipped: 0, languages: ['en'] };

function androidProject(extra: Record<string, unknown> = {}) {
  const root = tempDir();
  write(root, 'stringcast.json', JSON.stringify({ projectId: 'p_demo', baseUrl: 'http://api.test', platform: 'android', paths: { android: 'app/src/main/res' }, baseLanguage: 'en', ...extra }));
  write(root, 'app/src/main/res/values/strings.xml', ANDROID_XML);
  write(root, 'app/src/main/res/values-es/strings.xml', ANDROID_XML.replace('Demo', 'Demostración'));
  write(root, 'app/src/main/res/values-pt-rBR/strings.xml', ANDROID_XML);
  return root;
}

describe('global usage', () => {
  it('--help and per-command --help exit 0', async () => {
    const h = harness(tempDir());
    expect(await h.run('--help')).toBe(0);
    expect(h.stdout).toContain('Commands:');
    for (const cmd of ['init', 'push', 'pull', 'status']) {
      const hh = harness(tempDir());
      expect(await hh.run(cmd, '--help')).toBe(0);
      expect(hh.stdout).toContain(`Usage: stringcast ${cmd}`);
    }
    const hh = harness(tempDir());
    expect(await hh.run('help', 'pull')).toBe(0);
    expect(hh.stdout).toContain('Usage: stringcast pull');
  });

  it('no command / unknown command / unknown option → exit 2', async () => {
    expect(await harness(tempDir()).run()).toBe(2);
    const h = harness(tempDir());
    expect(await h.run('deploy')).toBe(2);
    expect(h.stderr).toContain('unknown command "deploy"');
    const h2 = harness(androidProject());
    expect(await h2.run('push', '--bogus')).toBe(2);
    expect(h2.stderr).toMatch(/Unknown option '--bogus'[\s\S]*stringcast push --help/);
    const h3 = harness(androidProject());
    expect(await h3.run('push', '--platform', 'windows')).toBe(2);
    const h4 = harness(androidProject());
    expect(await h4.run('pull', '--language', 'es', '--all')).toBe(2);
  });
});

describe('push', () => {
  it('uploads only the base language by default with the right request', async () => {
    const root = androidProject();
    const h = harness(root, () => Response.json(IMPORT_OK));
    expect(await h.run('push')).toBe(0);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = h.fetch.mock.calls[0]!;
    expect(url).toBe('http://api.test/v1/projects/p_demo/import');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'X-Api-Key': 'sk_test', 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ format: 'android-xml', language: 'en', content: ANDROID_XML, platform: 'android', overwrite: false });
    expect(h.stdout).toMatch(/created\s+updated\s+unchanged/);
    expect(h.stdout).toMatch(/total\s+2\s+1\s+3\s+0\s+ok/);
  });

  it('--all-languages uploads every locale; --language filters; --overwrite is sent', async () => {
    const h = harness(androidProject(), () => Response.json(IMPORT_OK));
    expect(await h.run('push', '--all-languages', '--overwrite')).toBe(0);
    expect(h.bodies().map((b) => [b.language, b.overwrite])).toEqual([
      ['en', true],
      ['es', true],
      ['pt-BR', true],
    ]);
    const h2 = harness(androidProject(), () => Response.json(IMPORT_OK));
    expect(await h2.run('push', '--language', 'pt_br')).toBe(0);
    expect(h2.bodies().map((b) => b.language)).toEqual(['pt-BR']);
  });

  it('--dry-run sends nothing and needs no key', async () => {
    const h = harness(androidProject(), undefined, {});
    expect(await h.run('push', '--dry-run', '--all-languages')).toBe(0);
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.stdout).toContain('values-pt-rBR');
  });

  it('missing upload key → exit 1 with a clear message', async () => {
    const h = harness(androidProject(), undefined, {});
    expect(await h.run('push')).toBe(1);
    expect(h.stderr).toContain('STRINGCAST_UPLOAD_KEY');
  });

  it('--key flag and --project-id / --base-url override config', async () => {
    const h = harness(androidProject(), () => Response.json(IMPORT_OK), {});
    expect(await h.run('push', '--key', 'sk_flag', '--project-id', 'p_x', '--base-url', 'https://api.example.com/')).toBe(0);
    const [url, init] = h.fetch.mock.calls[0]!;
    expect(url).toBe('https://api.example.com/v1/projects/p_x/import');
    expect(init.headers).toMatchObject({ 'X-Api-Key': 'sk_flag' });
  });

  it('server error → exit 1, message shown, other files still uploaded', async () => {
    let n = 0;
    const h = harness(androidProject(), () =>
      n++ === 0 ? Response.json({ error: { code: 'parse_error', message: 'bad xml' } }, { status: 422 }) : Response.json(IMPORT_OK),
    );
    expect(await h.run('push', '--all-languages')).toBe(1);
    expect(h.fetch).toHaveBeenCalledTimes(3);
    expect(h.stderr).toContain('HTTP 422 — parse_error: bad xml');
    expect(h.stdout).toMatch(/total.*1 failed/);
  });

  it('network failure → exit 1', async () => {
    const h = harness(androidProject(), () => {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    });
    expect(await h.run('push')).toBe(1);
    expect(h.stderr).toContain('Cannot reach http://api.test: ECONNREFUSED');
  });

  it('fetches the base language from the project when not configured', async () => {
    const root = androidProject({ baseLanguage: undefined });
    const h = harness(root, (url) =>
      url.pathname === '/v1/projects/p_demo' ? Response.json({ id: 'p_demo', baseLanguage: 'es', languages: ['es', 'en'] }) : Response.json(IMPORT_OK),
    );
    expect(await h.run('push')).toBe(0);
    expect(h.bodies().filter(Boolean).map((b) => b.language)).toEqual(['es', 'es']); // values/ (base) + values-es
  });

  it('ios: decodes UTF-16 .strings, sends stringsdict and filters xcstrings to the base language', async () => {
    const root = tempDir();
    write(root, 'stringcast.json', JSON.stringify({ projectId: 'p_demo', baseUrl: 'http://api.test', platform: 'ios', paths: { ios: 'App' }, baseLanguage: 'en' }));
    write(root, 'App/en.lproj/Localizable.strings', utf16le('"hi" = "Hi";'));
    write(root, 'App/en.lproj/Localizable.stringsdict', '<plist>en</plist>');
    write(root, 'App/es.lproj/Localizable.strings', '"hi" = "Hola";');
    write(
      root,
      'App/Localizable.xcstrings',
      JSON.stringify({ sourceLanguage: 'en', version: '1.0', strings: { hi: { localizations: { en: { stringUnit: { value: 'Hi' } }, es: { stringUnit: { value: 'Hola' } } } } } }),
    );
    const h = harness(root, () => Response.json(IMPORT_OK));
    expect(await h.run('push')).toBe(0);
    const bodies = h.bodies();
    expect(bodies.map((b) => [b.format, b.language, b.platform])).toEqual([
      ['apple-xcstrings', undefined, 'ios'],
      ['apple-strings', 'en', 'ios'],
      ['apple-stringsdict', 'en', 'ios'],
    ]);
    expect(bodies[1].content).toBe('"hi" = "Hi";');
    expect(Object.keys(JSON.parse(bodies[0].content).strings.hi.localizations)).toEqual(['en']);
  });

  it('web: uploads <lang>.json', async () => {
    const root = tempDir();
    write(root, 'locales/en.json', '{"a":"A"}');
    write(root, 'locales/fr.json', '{"a":"Ä"}');
    const h = harness(root, () => Response.json(IMPORT_OK));
    expect(await h.run('push', '--platform', 'web', '--project-id', 'p1', '--base-language', 'en', '--all-languages')).toBe(0);
    expect(h.bodies().map((b) => [b.format, b.language])).toEqual([
      ['json', 'en'],
      ['json', 'fr'],
    ]);
  });

  it('no files → exit 1', async () => {
    const h = harness(tempDir());
    expect(await h.run('push', '--platform', 'web', '--project-id', 'p1', '--base-language', 'en')).toBe(1);
    expect(h.stderr).toContain('No web string files found');
  });
});

describe('filterXcstrings', () => {
  it('keeps the source language and the selected ones', () => {
    const doc = { sourceLanguage: 'en', strings: { k: { localizations: { en: 1, es: 2, fr: 3 } }, empty: {} } };
    const out = JSON.parse(filterXcstrings(JSON.stringify(doc), (l) => l === 'fr'));
    expect(Object.keys(out.strings.k.localizations)).toEqual(['en', 'fr']);
  });
});

describe('pull', () => {
  it('android: writes values-xx folders for non-base project languages fetched from the project', async () => {
    const root = androidProject();
    const h = harness(root, (url) => {
      if (url.pathname === '/v1/projects/p_demo') return Response.json({ id: 'p_demo', baseLanguage: 'en', languages: ['en', 'es', 'pt-BR', 'zh-Hans'] });
      return new Response(`<resources><!-- ${url.searchParams.get('language')} ${url.searchParams.get('source')} --></resources>`);
    });
    expect(await h.run('pull')).toBe(0);
    const exports = h.fetch.mock.calls.map(([u]) => new URL(u)).filter((u) => u.pathname.endsWith('/export'));
    expect(exports.map((u) => [u.searchParams.get('format'), u.searchParams.get('language'), u.searchParams.get('source')])).toEqual([
      ['android-xml', 'es', 'latest'],
      ['android-xml', 'pt-BR', 'latest'],
      ['android-xml', 'zh-Hans', 'latest'],
    ]);
    const res = join(root, 'app/src/main/res');
    expect(readFileSync(join(res, 'values-es/strings.xml'), 'utf8')).toContain('es latest');
    expect(readFileSync(join(res, 'values-pt-rBR/strings.xml'), 'utf8')).toContain('pt-BR');
    expect(readFileSync(join(res, 'values-b+zh+Hans/strings.xml'), 'utf8')).toContain('zh-Hans');
    expect(readFileSync(join(res, 'values/strings.xml'), 'utf8')).toBe(ANDROID_XML); // base untouched
    expect(h.stdout).toMatch(/updated[\s\S]*created/);
  });

  it('--languages / config languages avoid the project lookup; --all includes base; --source published', async () => {
    const root = androidProject({ languages: ['en', 'fr'] });
    const h = harness(root, () => new Response('<resources/>'));
    expect(await h.run('pull', '--all', '--source', 'published')).toBe(0);
    const urls = h.fetch.mock.calls.map(([u]) => new URL(u));
    expect(urls.every((u) => u.pathname.endsWith('/export') && u.searchParams.get('source') === 'published')).toBe(true);
    expect(urls.map((u) => u.searchParams.get('language'))).toEqual(['en', 'fr']);
    expect(existsSync(join(root, 'app/src/main/res/values-fr/strings.xml'))).toBe(true);
  });

  it('ios: writes into existing lproj folders and only writes stringsdict with plurals', async () => {
    const root = tempDir();
    write(root, 'App/Base.lproj/Localizable.strings', '"a" = "A";');
    const h = harness(root, (url) => {
      const lang = url.searchParams.get('language');
      if (url.searchParams.get('format') === 'apple-stringsdict') {
        return new Response(lang === 'es' ? '<plist><key>NSStringLocalizedFormatKey</key></plist>' : '<plist><dict/></plist>');
      }
      return new Response(`"a" = "${lang}";`);
    });
    expect(await h.run('pull', '--platform', 'ios', '--path', 'App', '--project-id', 'p', '--base-language', 'en', '--languages', 'en,es,fr', '--all')).toBe(0);
    expect(readFileSync(join(root, 'App/Base.lproj/Localizable.strings'), 'utf8')).toBe('"a" = "en";\n');
    expect(readFileSync(join(root, 'App/es.lproj/Localizable.strings'), 'utf8')).toBe('"a" = "es";\n');
    expect(existsSync(join(root, 'App/es.lproj/Localizable.stringsdict'))).toBe(true);
    expect(existsSync(join(root, 'App/fr.lproj/Localizable.strings'))).toBe(true);
    expect(existsSync(join(root, 'App/fr.lproj/Localizable.stringsdict'))).toBe(false);
  });

  it('ios: xcstrings projects pull one multi-language file', async () => {
    const root = tempDir();
    write(root, 'App/Localizable.xcstrings', '{}');
    const h = harness(root, () => new Response('{"sourceLanguage":"en","strings":{}}'));
    expect(await h.run('pull', '--platform', 'ios', '--path', 'App', '--project-id', 'p', '--base-language', 'en', '--language', 'es')).toBe(0);
    const u = new URL(h.fetch.mock.calls[0]![0]);
    expect(u.searchParams.get('format')).toBe('apple-xcstrings');
    expect(JSON.parse(readFileSync(join(root, 'App/Localizable.xcstrings'), 'utf8'))).toEqual({ sourceLanguage: 'en', strings: {} });
  });

  it('web: writes pretty JSON; --dry-run writes nothing', async () => {
    const root = tempDir();
    const h = harness(root, () => new Response('{"a":"B"}'));
    expect(await h.run('pull', '--platform', 'web', '--project-id', 'p', '--base-language', 'en', '--language', 'es,pt-BR', '--dry-run')).toBe(0);
    expect(existsSync(join(root, 'locales/es.json'))).toBe(false);
    expect(h.stdout).toContain('would be created');
    const h2 = harness(root, () => new Response('{"a":"B"}'));
    expect(await h2.run('pull', '--platform', 'web', '--project-id', 'p', '--base-language', 'en', '--language', 'es,pt-BR')).toBe(0);
    expect(readFileSync(join(root, 'locales/pt-BR.json'), 'utf8')).toBe('{\n  "a": "B"\n}\n');
    const h3 = harness(root, () => new Response('{"a":"B"}'));
    expect(await h3.run('pull', '--platform', 'web', '--project-id', 'p', '--base-language', 'en', '--language', 'es')).toBe(0);
    expect(h3.stdout).toContain('unchanged');
  });

  it('auth failure → exit 1 with hint', async () => {
    const h = harness(androidProject(), () => Response.json({ error: { code: 'unauthorized', message: 'Invalid API key' } }, { status: 401 }));
    expect(await h.run('pull')).toBe(1);
    expect(h.stderr).toContain('HTTP 401');
    expect(h.stderr).toContain('STRINGCAST_UPLOAD_KEY');
  });
});

describe('status', () => {
  it('prints languages and published version', async () => {
    const h = harness(androidProject(), (url) => {
      expect(url.pathname).toBe('/v1/projects/p_demo');
      return Response.json({
        id: 'p_demo',
        name: 'Demo',
        baseLanguage: 'en',
        languages: ['en', 'es'],
        publishedVersion: 4,
        stats: { totalKeys: 10, perLanguage: { en: { translated: 10, reviewed: 10, changedSincePublish: 0 }, es: { translated: 5, reviewed: 1, changedSincePublish: 2 } } },
      });
    });
    expect(await h.run('status')).toBe(0);
    expect(h.stdout).toContain('Demo (p_demo)');
    expect(h.stdout).toContain('v4');
    expect(h.stdout).toMatch(/en \(base\)\s+10\s+100%/);
    expect(h.stdout).toMatch(/es\s+5\s+50%\s+1\s+2/);
  });

  it('no project id → exit 1', async () => {
    const h = harness(tempDir());
    expect(await h.run('status')).toBe(1);
    expect(h.stderr).toContain('No project id');
  });
});

describe('init', () => {
  it('writes stringcast.json from flags', async () => {
    const root = tempDir();
    const h = harness(root);
    expect(await h.run('init', '--project-id', 'p_demo', '--platform', 'android', '--res', 'mobile/res', '--base-language', 'en', '--languages', 'en,es', '-y')).toBe(0);
    expect(JSON.parse(readFileSync(join(root, 'stringcast.json'), 'utf8'))).toEqual({
      projectId: 'p_demo',
      baseUrl: 'http://localhost:8787',
      platform: 'android',
      paths: { android: 'mobile/res' },
      baseLanguage: 'en',
      languages: ['en', 'es'],
    });
    const again = harness(root);
    expect(await again.run('init', '--project-id', 'x', '-y')).toBe(1);
    expect(again.stderr).toContain('already exists');
  });

  it('prompts for missing values when interactive', async () => {
    const root = tempDir();
    write(root, 'locales/en.json', '{}');
    const h = harness(root);
    const answers: Record<string, string> = { 'Project id': 'p_web' };
    const asked: string[] = [];
    h.ctx.prompt = async (q, def) => {
      asked.push(`${q}|${def ?? ''}`);
      return answers[q] ?? '';
    };
    expect(await h.run('init')).toBe(0);
    const cfg = JSON.parse(readFileSync(join(root, 'stringcast.json'), 'utf8'));
    expect(cfg).toMatchObject({ projectId: 'p_web', platform: 'web', paths: { web: 'locales' }, baseLanguage: 'en' });
    expect(asked[0]).toBe('Project id|');
  });

  it('requires a project id without a TTY', async () => {
    const h = harness(tempDir());
    expect(await h.run('init', '--platform', 'web')).toBe(2);
  });
});
