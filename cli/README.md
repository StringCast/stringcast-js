# @stringcast/cli

Push and pull string files to [StringCast](https://console.stringcast.app/docs/cli) from a terminal, CI, a Gradle task or an Xcode build phase.

| Platform | Push (source files) | Pull (written files) |
|---|---|---|
| android | `res/values*/**.xml` containing `<string>`, `<plurals>` or `<string-array>` (strings.xml, plurals.xml, arrays.xml, …) | `res/values-<lang>/strings.xml` |
| ios | `**/*.lproj/Localizable.strings` (UTF-8 or UTF-16), `Localizable.stringsdict`, `**/*.xcstrings` | `<lang>.lproj/Localizable.strings` (+ `.stringsdict` when there are plurals), or the `.xcstrings` file |
| web | `<path>/<lang>.json` | `<path>/<lang>.json` |

Folder ↔ language mapping:

| Language | Android | iOS |
|---|---|---|
| base | `values/` | `Base.lproj/` (or `<base>.lproj/`) |
| `es` | `values-es/` | `es.lproj/` |
| `pt-BR` | `values-pt-rBR/` | `pt-BR.lproj/` |
| `zh-Hans` | `values-b+zh+Hans/` | `zh-Hans.lproj/` |

Android folders with other qualifiers (`values-night`, `values-v21`, `values-es-land`, …) are ignored.

## Install

```sh
npm install -D @stringcast/cli     # or run without installing: npx @stringcast/cli <command>
```

Requires Node 18.17+. No runtime dependencies.

## Setup

```sh
npx stringcast init                       # interactive
npx stringcast init --project-id p_demo --platform android --base-language en -y
export STRINGCAST_UPLOAD_KEY=sk_demo_local    # upload key from the portal (keep it secret)
```

`stringcast.json` (paths are relative to this file; it's looked up from the current directory upward):

```json
{
  "projectId": "p_demo",
  "baseUrl": "http://localhost:8787",
  "platform": "android",
  "paths": { "android": "app/src/main/res", "ios": "MyApp", "web": "src/locales" },
  "baseLanguage": "en",
  "languages": ["en", "es", "fr"]
}
```

`languages` is optional; without it `pull` asks the API for the project's language list.

## Commands

```sh
stringcast push                              # upload the base language (values/, Base.lproj, en.json)
stringcast push --all-languages              # upload every locale found
stringcast push --language es,pt-BR          # only these
stringcast push --overwrite                  # replace server values (default: add only)
stringcast push --dry-run                    # show what would be uploaded

stringcast pull                              # every project language except the base
stringcast pull --language es                # one (or a comma list)
stringcast pull --all                        # including the base language
stringcast pull --source published           # last published release instead of latest values
stringcast pull --dry-run                    # show which files would change

stringcast status                            # languages, progress, published version
stringcast <command> --help
```

Common flags: `--platform android|ios|web`, `--res <dir>` (Android), `--path <dir>` (iOS root / web locales),
`--project-id`, `--base-url`, `--key`, `--config <file>`, `--base-language`.

Environment: `STRINGCAST_UPLOAD_KEY`, `STRINGCAST_PROJECT_ID`, `STRINGCAST_BASE_URL`, `STRINGCAST_TOKEN` (portal JWT, used when no upload key is set).

`push` prints a table of `created / updated / unchanged / skipped` per file. Exit codes: `0` success, `1` failure (network, auth, any file failing), `2` usage error.

## Gradle (Android)

`app/build.gradle.kts`:

```kotlin
val stringcastPull by tasks.registering(Exec::class) {
    group = "stringcast"
    description = "Download translations from StringCast into res/values-*/strings.xml"
    workingDir = rootDir                       // where stringcast.json lives
    commandLine("npx", "stringcast", "pull", "--source", "published")
    isIgnoreExitValue = false
}

val stringcastPush by tasks.registering(Exec::class) {
    group = "stringcast"
    description = "Upload base strings to StringCast"
    workingDir = rootDir
    commandLine("npx", "stringcast", "push")
}

// Optional: refresh translations before every release build
tasks.matching { it.name == "preReleaseBuild" }.configureEach { dependsOn(stringcastPull) }
```

Run with `STRINGCAST_UPLOAD_KEY=sk_… ./gradlew stringcastPull`.

## Xcode Run Script build phase (iOS)

Add a *Run Script* phase **before** "Copy Bundle Resources" (and uncheck "Based on dependency analysis"):

```sh
# Xcode doesn't load your shell profile: make node/npx visible
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$SRCROOT"
if [ -z "$STRINGCAST_UPLOAD_KEY" ] && [ -f "$SRCROOT/.stringcast-key" ]; then
  export STRINGCAST_UPLOAD_KEY="$(cat "$SRCROOT/.stringcast-key")"   # keep this file out of git
fi
if [ "$CONFIGURATION" = "Release" ]; then
  npx stringcast pull --platform ios --source published || exit 1
else
  npx stringcast pull --platform ios || echo "warning: stringcast pull failed (offline?)"
fi
```

With *User Script Sandboxing* enabled (Xcode 15+ default), either disable it for the target or list the
`.lproj`/`.xcstrings` files as the phase's output files so the script may write them.

## GitHub Actions

```yaml
name: Sync strings
on:
  push:
    branches: [main]
    paths: ['app/src/main/res/values/**', '**/Base.lproj/**', 'locales/en.json']
jobs:
  stringcast:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - name: Push base strings to StringCast
        run: npx stringcast push
        env:
          STRINGCAST_UPLOAD_KEY: ${{ secrets.STRINGCAST_UPLOAD_KEY }}
      - name: Pull published translations
        run: npx stringcast pull --source published
        env:
          STRINGCAST_UPLOAD_KEY: ${{ secrets.STRINGCAST_UPLOAD_KEY }}
      # then e.g. peter-evans/create-pull-request to open a PR with the updated files
```

## Notes

- Only the base language is pushed by default, so translators' work on the server isn't overwritten. `--overwrite` replaces server values for the uploaded language.
- `.strings` files may be UTF-16 (BOM or BOM-less); they are decoded before upload. Pulled files are written as UTF-8, which Xcode accepts.
- `.xcstrings` files hold every language. `push` sends only the selected languages' localizations unless `--all-languages` is given. `pull` overwrites the whole file.
- `pull` for Android writes one `strings.xml` per language with strings, plurals and arrays together. If you keep plurals/arrays in separate files inside `values-xx/`, delete them or you'll get duplicate-resource errors.

## Development

```sh
npm install
npm test          # vitest
npm run build     # tsup → dist/index.js (bin)
node dist/index.js --help
```
