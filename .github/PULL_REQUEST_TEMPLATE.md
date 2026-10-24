## Summary

<!-- What does this pull request change? One or two sentences. -->

## Why

<!-- The problem it solves or the issue it closes, for example "Closes #123". -->

## How I tested it

<!-- Commands you ran, screens you checked, devices or emulators you used. -->

## Checklist

- [ ] `npx tsc --noEmit` and `npx tsc -p tsconfig.node.json --noEmit` pass.
- [ ] `npm test` passes.
- [ ] `npm run build && node scripts/check-pwa-dist.mjs` passes.
- [ ] `npx vite build --mode android` passes.
- [ ] Every screen I touched holds at 360 px and 320 px wide, with no horizontal overflow.
- [ ] All new UI text goes through `t()` / `tp()`, with keys in both `src/i18n/en/` and `src/i18n/it/`.
- [ ] `ROUTEMAP.md` rows (and the Task → files table) are updated for any module I added, renamed or removed.
- [ ] Any Dexie schema change is additive: a new `version(N)` block, no edits to a released one.
- [ ] If I changed native code (`src/native/`, `android/`): I ran `npm run android:debug && scripts/android/smoke.sh` on a debug build.

<!-- Not applicable? Tick it and add "n/a". See CONTRIBUTING.md for the reasons behind each rule. -->
