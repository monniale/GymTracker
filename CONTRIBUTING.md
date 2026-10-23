# Contributing to GymTracker

Thanks for your interest in GymTracker. Bug reports, fixes, translations and new features are all welcome. This guide explains how to set up the project and which rules a change must follow.

## Development setup

You need:

- **Node 18 or newer** for the web app (CI uses Node 22).
- **Node 22 or newer and JDK 21 (with `javac`)** for the Android app. See [ANDROID.md](ANDROID.md) for the Android SDK and the rest of the toolchain.

Then:

```sh
npm ci            # install the exact versions from package-lock.json
npm run dev       # dev server with hot reload
npm test          # all unit tests (vitest)
npm run build && node scripts/check-pwa-dist.mjs   # type-check, build dist/, check the PWA bundle
```

`npm test` pins the time zone to `Europe/Rome` and the locale to English, so date tests give the same result on every machine. To run one file, pass it after `--`, for example `npm test -- src/lib/scoring.test.ts`.

`scripts/check-pwa-dist.mjs` checks the GitHub Pages build in `dist/`. It fails if the service worker or the manifest is missing, or if native Android code leaked into the web bundle.

## Find your way

The codebase is large. Do not read `src/` file by file.

1. Read [ROUTEMAP.md](ROUTEMAP.md) first. Its **Task → files** table lists the files to open for each kind of change.
2. Before any change to the database schema, sync, scoring or AI, read the **Invariants** section at the bottom of `ROUTEMAP.md`. These rules protect user data across devices and app versions.

## Project rules

Every change must follow these rules. Each one comes from an invariant in `ROUTEMAP.md`.

- **The Dexie schema is additive only.** Add a new `version(N)` block with only new stores, and never edit a released one, because installed apps would lose or corrupt data (invariant 8).
- **Sync is an allow-list.** A table syncs only if it is listed in `TABLES` in `src/db/backup.ts`, so device-local caches never reach other devices (invariant 1).
- **Keys and device preferences never go in Dexie.** The Gemini key, the GitHub token and device settings live in localStorage stores, so they are never synced or exported in a backup (invariant 3).
- **All UI text goes through `src/i18n`.** Use `t()` or `tp()` and add the key to both the English (`src/i18n/en/`) and Italian (`src/i18n/it/`) dictionaries, so the app is never half translated. `src/i18n/stringGuard.test.ts` fails on literal text in JSX, and `src/i18n/i18n.test.ts` checks that both languages have the same keys and placeholders (invariant 19).
- **Every screen must work at 360 px and 320 px wide** with no horizontal overflow, because the app is used one-handed on small phones (invariant 13).
- **Native code lives only under `src/native/`** and is reached through `isNative`, so the Android plugins never end up in the web build. `src/lib/nativeBoundary.test.ts` and `scripts/check-pwa-dist.mjs` enforce this (invariant 14).
- **No CDN assets.** Fonts, wasm and other static assets are bundled and never loaded from a CDN, so the app shell works offline. The only exception is the opt-in exercise-library media, which loads from a pinned GitHub commit only when Settings › Exercise library is on (invariant 12).
- **Tests sit next to the module** they test, as `<module>.test.ts`. They run with vitest in a Node environment with `TZ=Europe/Rome`, so put logic in pure functions that a test can reach.

## Branches and pull requests

- Keep one feature or one fix per pull request. Small pull requests are reviewed faster.
- Branch from `main` and name the branch `feat/NN-<short-name>`, for example `feat/12-oss-hygiene`. `NN` is the next feature number. If you are not sure which number to use, ask in the issue.
- The maintainer's own feature series are stacked: each `feat/NN-<name>` branch starts from the previous feature branch, and the pull requests are merged in order.
- CI must be green before a pull request is merged. Run the same checks locally first:

  ```sh
  npx tsc --noEmit
  npx tsc -p tsconfig.node.json --noEmit
  npm test
  npm run build && node scripts/check-pwa-dist.mjs
  npx vite build --mode android
  ```

- When you add, rename or remove a module, update its one-line row in `ROUTEMAP.md` and the Task → files table in the same pull request. If you change an invariant, update the Invariants section too.
- Fill in the pull request template. Its checklist repeats the rules above.

## Android

Read [ANDROID.md](ANDROID.md) before you touch `android/` or `src/native/`.

- Never change the appId, the WebView origin or the signing key. Any of these changes would cut existing installs off from their data.
- Never connect a debug build to a real sync repository. Debug builds are for test data only, and `scripts/android/smoke.sh` stops if it finds the real repository.
- If your change touches native code, build a debug APK and run the smoke test: `npm run android:debug && scripts/android/smoke.sh`.

## Translations

GymTracker ships in English and Italian. To improve a translation or add a new language, follow [docs/TRANSLATING.md](docs/TRANSLATING.md).

## Reporting bugs

Open an issue with the **Bug report** template. Please include the build stamp from the bottom of the Settings screen: the version line (`GymTracker v…`), the `Build …` line and the `Database schema v…` line. On Android, also include the `Android …` line. The stamp tells us exactly which build you are running.

For ideas, use the **Feature request** template.

## Security issues

Do not put the details of a security problem in a public issue.

Report it privately instead: open the repository's **Security** tab and choose **Report a vulnerability** ([direct link](https://github.com/monniale/GymTracker/security/advisories/new)). This creates a private security advisory that only you, the maintainer and any collaborators the maintainer invites can see.

## Code of conduct

Everyone taking part in this project follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

GymTracker is released under the [MIT License](LICENSE). By contributing, you agree that your contributions are licensed under the same terms.
