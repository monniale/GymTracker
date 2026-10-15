# Handoff: build the 9 planned features

**Generated**: 2026-10-15
**Branch**: `main` (= `feature/android-app`), last commit `3e87ff3`
**Status**: Plan ready, nothing built. One small uncommitted batch (rank emblems + particles), see below.

## Start here

1. Read [`ROUTEMAP.md`](ROUTEMAP.md) (module index + **Invariants**). Load only the files a task needs; never scan `src/` blindly.
2. Read [`docs/FEATURE_PLAN.md`](docs/FEATURE_PLAN.md): the full plan, with build order, file-level design, reuse list and verification steps.
3. Begin with **Phase 1 · feature 1: training heatmap**. Then continue in order.

## The 9 features, in build order

| # | Feature | Phase |
|---|---------|-------|
| 1 | Training heatmap (Progress tile) | 1 |
| 2 | Rep-range PRs (1/3/5/8/10/12 RM) | 1 |
| 3 | Shareable workout card (PNG) | 1 |
| 4 | Tomorrow's meal plan (`plannedFoods`, Dexie v9) | 1 |
| 5 | Weekly AI coach review (`/progress/week`, kind `'week'`) | 1 |
| 6 | Cardio sets (duration + distance, no rank points) | 2 |
| 7 | Import from Strong / Hevy CSV | 2 |
| 8 | Android home-screen widget | 3 |
| 9 | Italian translation (full i18n, no library) | 4 |

## Owner decisions (do not re-ask)

- Build order as above.
- Cardio earns **no** rank points. It is tracked and counts for the streak and weekly target. Keep the `cardioBonusPoints()` hook returning 0.
- No real Strong/Hevy export is available. Build from the documented formats and test a real file later.
- Italian covers **everything**: screens, dates, plurals, Android notifications including the rest timer, and AI notes.

## Working rules (from the owner)

- Commit and push **only when the owner asks**. A push to `main` deploys the website.
- Never connect a debug/emulator build to the real `gymtracker-data` sync repo.
- Never change the appId, the WebView origin or the signing key (`~/.android-keys/gymtracker/`). Never print or commit the keystore or its passwords.
- After app changes the owner wants on the phone: run `scripts/android/release.sh` (needs a clean tree). The APK installs over the old one. Never tell them to uninstall.
- Do not use graphify in this repo. The owner dropped it; `ROUTEMAP.md` is the map.
- Keep every screen working at 360 px and 320 px (invariant 13).

## Uncommitted work (ask the owner before committing)

Rank emblems + particle effects. Tests (364), build and PWA dist check are green.
- `src/assets/ranks/*.svg`: 22 emblems extracted from a bundle file (source HTML deleted on purpose).
- `src/components/RankBadge.tsx`: renders the emblem per tier.
- `src/components/RankParticles.tsx`: canvas aura per rank, with Champion = fire. The owner asked for fewer particles; rates are already reduced.
- `src/screens/rank/RankScreen.tsx`: hero aura, "All ranks" rows with emblems and scores, tap → preview sheet.
- `src/screens/workout/SessionSummary.tsx`: aura on rank-up.
- `ROUTEMAP.md`: rows updated. `docs/FEATURE_PLAN.md` and this file are new or rewritten.

## Verification recipe (every feature)

- `npx tsc --noEmit && npx tsc -p tsconfig.node.json --noEmit`
- `npm test` (`TZ=Europe/Rome` is set in the script)
- `npm run build && node scripts/check-pwa-dist.mjs`
- For layout and behaviour, use puppeteer-core in the session scratchpad: `npm i puppeteer-core@23.11.1` and `/usr/bin/google-chrome`, serving `npx vite preview --port 4317` (base `/GymTracker/`). Check 360 and 320 px for no horizontal overflow. The scratchpad is wiped between sessions.
- Native features: `npm run android:debug` and `scripts/android/smoke.sh` on the S25-like AVD (see `ANDROID.md`). The toolchain is `JAVA_HOME=~/opt/jdk-21` and `ANDROID_HOME=~/Android/Sdk`.

## Failed approaches (don't repeat)

- `orderBy('id')` on synced tables: ids are UUIDs, so the order is random. Order by `date`/`startedAt` (invariant 10). Two such bugs were fixed in `be98823`.
- `pkill -f "vite preview"` in the same shell command as other work: it can kill its own shell (exit 144). Run it as a separate command, with the pattern `[v]ite`.
- Additive canvas blending (`'lighter'`) for flames: it washes them out to grey-white. Draw flame bodies with `source-over` and only the core additive.
