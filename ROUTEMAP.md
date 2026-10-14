# ROUTEMAP — GymTracker module index

Purpose: a compact map of the codebase so a fresh chat can **load only the files a task needs** instead of scanning `src/`. Line counts `(N)` flag context cost. Paths are relative to repo root.

**Stack:** React + TypeScript + Vite + Tailwind, Dexie/IndexedDB, `HashRouter`. Ships as a **static PWA on GitHub Pages — no backend.** Cross-device sync is a snapshot pushed to a **private GitHub repo via the user's PAT**. AI is **Gemini free-tier with a device-local BYO key**. Deploy = `git push origin main` → Actions → Pages. The same codebase is also a **sideloaded Android app (Capacitor 8)**: `android/` + `src/native/`, runbook in `ANDROID.md`.

Build/verify: `npm run build` (= `tsc --noEmit && vite build`) + `node scripts/check-pwa-dist.mjs` · `npm test` (vitest, `TZ=Europe/Rome`) · Node 18 floor / CI Node 22 · Android: `npm run android:debug` / `scripts/android/release.sh` / `scripts/android/smoke.sh` (Node ≥ 22, JDK 21, SDK 36) — see ANDROID.md.

---

## Task → files to load (start here)

| If you're working on… | Load these |
|---|---|
| **Data model / any schema change** | `src/types.ts`, `src/db/db.ts`, `src/db/backup.ts` (+ `src/lib/merge.ts` if it syncs) |
| **Workout scoring / rank / PRs** | `src/lib/scoring.ts`, `src/lib/finishSession.ts`, `src/lib/season.ts`, `src/lib/ranks.ts` |
| **Active workout / logging sets** | `src/screens/workout/ActiveSession.tsx`, `src/lib/progression.ts`, `src/lib/plates.ts` |
| **Past workouts / calendar / edit** | `src/screens/workout/History.tsx`, `PastWorkout.tsx`, `src/lib/dates.ts`, `rescoreSession` in `finishSession.ts` |
| **Exercises / equipment** | `src/screens/workout/ExercisePicker.tsx`, `src/lib/equipment.ts`, `src/db/seed.ts`, `Exercise`/`Equipment` in `types.ts` |
| **Diet: logging / macros UI** | `src/screens/diet/DietDay.tsx`, `AddFoodSheet.tsx`, `EntryEditor.tsx`, `src/lib/nutrition.ts` |
| **Food databases (search/barcode)** | `src/lib/foodProviders.ts`, `off.ts`, `usda.ts`, `foodResolve.ts`, `scanner.ts`, `src/components/BarcodeScanSheet.tsx` |
| **AI (any feature)** | `src/lib/gemini.ts` (incl. the free-model fallback chain), `aiStore.ts` (`aiRequestOpts`), `src/components/AiReportCard.tsx` (+ the feature's briefing in `coachBriefing.ts`/`dietReport.ts`) |
| **AI workout coach / weight suggestions** | `src/lib/coachBriefing.ts`, `workoutSuggest.ts`, `src/components/CoachCard.tsx`, `src/lib/coachHistory.ts` |
| **Stored coach verdicts (history)** | `src/lib/coachHistory.ts`, `src/screens/progress/CoachHistory.tsx`, `CoachJudgement` in `types.ts`, `src/db/db.ts` (v8), `src/db/backup.ts` (`LATE_TABLES`), `src/lib/merge.ts` |
| **AI diet coach / macro suggestions** | `src/lib/dietReport.ts`, `foodResolve.ts`, `src/components/DietCoachCard.tsx`, `MacroCompletionCard.tsx` |
| **Sync / backup / merge** | `src/lib/sync.ts`, `merge.ts`, `githubApi.ts`, `src/db/backup.ts`, `src/screens/settings/SyncSection.tsx` |
| **Charts / progress** | `src/screens/progress/ProgressScreen.tsx`, `src/components/Charts.tsx`, `src/lib/muscleVolume.ts`, `standards.ts` |
| **Bodyweight history** | `src/screens/progress/WeightHistory.tsx`, `src/lib/bodyweight.ts`, `BodyweightTile` in `ProgressScreen.tsx`, `src/components/Charts.tsx` |
| **Settings** | `src/screens/settings/SettingsScreen.tsx`, `AiSection.tsx`, `SyncSection.tsx` (+ `vite.config.ts` for the version footer's build stamp) |
| **Android shell / back / keep-awake / haptics** | `src/native/platform.ts`, `init.ts`, `NativeShell.tsx`, `navigation.ts`, `haptics.ts`, `src/lib/backStack.ts`, `src/routes.ts`, `capacitor.config.ts`, `android/app/src/main/java/io/github/monniale/gymtracker/MainActivity.java` |
| **Notifications / reminders (Android)** | `src/lib/notifyPlanner.ts`, `notifyPrefs.ts`, `notifyStore.ts`, `notifyData.ts`, `src/native/notifications.ts`, `status.ts`, `deviceSettings.ts`, `src/native/ui/NotificationsSection.tsx`, `notifyHealth.ts` |
| **Rest timer (native)** | `src/store.ts`, `src/components/RestTimerBar.tsx`, `src/native/restTimerBridge.ts`, `restTimerPlugin.ts`, `android/…/resttimer/*.java`, `src/native/ui/RestTimerNativeSettings.tsx` |
| **Android build / sign / release / smoke** | `android/app/build.gradle`, `AndroidManifest.xml`, `capacitor.config.ts`, `vite.config.ts`, `scripts/android/*`, `scripts/check-pwa-dist.mjs`, `ANDROID.md` |

Cross-cutting rules live in **Invariants** at the bottom — read those before any schema/sync/scoring change.

---

## App shell & routing
- `src/main.tsx` (18) — entry; mounts `<App/>`; Android: `initNativeEarly()` (tap-route listeners) before the first render.
- `src/App.tsx` (92) — `HashRouter` + all routes; on launch: `ensureSeeded`, `runDailyChecksOnce`, catch-up achievements/quests, coach-history backfill (on the sync lock), install sync, first sync; Android: gated `initNative()` + lazy `NativeShell`. Routes: `/workout`, `/workout/template/:id`, `/workout/session`, `/workout/summary/:id`, `/workout/history`, `/workout/past/:id`, `/diet`, `/progress`, `/progress/bodyweight`, `/progress/coach`, `/rank`, `/settings`.
- `src/routes.ts` (33) — `TAB_ROUTES` (path/label/icon, shared by TabBar, back handler, deep links) + `KNOWN_ROUTES` (every App.tsx pattern; test: `ALLOWED_ROUTES ⊆ KNOWN_ROUTES`).
- `src/store.ts` (75) — Zustand app store: `activeSessionId`, rest timer (`startRest(sec, label?, { warmup? })`; `label` = Android lock-screen "what's next"), stopwatch (persisted to localStorage).
- `src/components/TabBar.tsx` (25) — bottom nav from `TAB_ROUTES`.
- `src/components/RestTimerBar.tsx` (93) — fixed rest-countdown bar (store timer + `audio.ts`); beep/haptic only for an expiry seen live (<3 s) and, on Android, not while hidden (the native alert covers it); tap haptics.

## Data model & persistence
- `src/types.ts` (392) — **all interfaces.** Key: `Exercise`(+`Equipment`), `TemplateItem`, `WorkoutTemplate`, `Session`, `SetRow`, `Food`/`MacroSet`/`FoodLog`/`SavedMeal`, `Settings`, `RankState`/`ScoreEvent`/`Season`, `DayType`/`BodyLogEntry`/`WaterLog`, `CoachNote`/`CoachInsight`, AI payloads (`RemoteFood`, `FoodProvider`, `MacroSuggestion`, `WorkoutPlanRow`, `DietSuggestionRow`, `PlannedSet`/`ExercisePlan`), cache rows (`CoachNoteRow`/`DietNoteRow`), stored verdicts (`CoachJudgement`), `Tombstone`. `Id = number|string`.
- `src/db/db.ts` (208) — Dexie `GymDB` (**version 8**: + `coachHistory`), the sync middleware (UUID ids, `updatedAt` stamp, dirty flag, `onSyncDirty`), `withSyncTrackingSuspended`, `onDataReplaced`/`emitDataReplaced` (wholesale replaces the suspended writes hide), `deleteWithTombstone`/`tombstoneKeys`, `UUID_TABLES`. Device-local AI caches: `coachNotes`, `dietNotes` (legacy: no longer written, copied into `coachHistory` once), `workoutSuggestions`, `dietSuggestions`.
- `src/db/backup.ts` (116) — `TABLES` **sync/backup allow-list** (the single source of truth for what serializes), `LATE_TABLES` (tables newer than snapshot v2: a snapshot without one keeps the local rows), `collectTables`/`applyTables` (emits `onDataReplaced` after commit; resolves true when it kept late-table rows), export (Android: cache file + share sheet via `native/files.ts`)/import.
- `src/db/seed.ts` (153) — exercise catalog (`ROWS`, deterministic ids), default `Settings`, `ensureSeeded` (seed rows suspended, `updatedAt: 0`).
- `src/lib/merge.ts` (275) — row-level merge of local+remote snapshots (updatedAt-wins; foods dedup by `offId` + FK remap into foodLogs/savedMeals; `coachHistory` union, optional per side); `SnapshotTables`.
- `src/lib/ids.ts` (7) — `parseRouteId` (handles number|string route ids; never `Number()`).

## Sync (GitHub snapshot)
- `src/lib/sync.ts` (329) — `buildPayload` (TABLES-only), `syncNow` (a pull that kept late-table rows leaves the device dirty), `withSyncLock` (runs work on the sync chain, never overlapping a pull), `installSyncTriggers` (8s debounced dirty push; `visibilitychange` sync also covers Android resume), `isConnected`.
- `src/lib/githubApi.ts` (140) — GitHub REST wrapper `gh()` (PAT auth, error mapping).
- `src/screens/settings/SyncSection.tsx` (213) — connect PAT + repo, manual sync UI.

## Workout
- `src/screens/workout/WorkoutHome.tsx` (167) — landing: template list, `startWorkout`, stopwatch; Android: first-run `RestoreCard` (empty install) and the one-time notification prompt on the first workout.
- `src/screens/workout/TemplateEditor.tsx` (175) — edit a template's `TemplateItem`s (sets/reps/rest/superset).
- `src/screens/workout/ActiveSession.tsx` (632) — **live session.** `ExerciseCard` (prevSets, `draftFor`/`draftForWork` prefill, suggestion chip, warm-up ramp, `PendingRow`), `logSet`/`deleteSet`, rest label (`restLabel`: next set target, `nextExerciseName`/`supersetNextName`; warm-up rests flagged), `NoteSheet` (notes + progression step + **equipment**), AI opening weights via `useWorkoutPlan`, equipment badge, plate/ramp gated on `equipment==='barbell'`, set/finish haptics.
- `src/screens/workout/SessionSummary.tsx` (191) — post-workout summary; **report mode** (`?report=1`) suppresses confetti/rank/achievement side-effects (and the PR/rank-up haptic, and the coach note's auto-generation) for viewing old sessions. Requires a `scoreEvent` to render.
- `src/screens/workout/History.tsx` (158) — **month calendar** of past workouts (dots on workout days); tap a day → its sessions; tap a session → editor.
- `src/screens/workout/PastWorkout.tsx` (357) — **edit a finished workout**: per-set weight/reps/warm-up, add/remove sets, session details (name/bodyweight/date); every change calls `rescoreSession`.
- `src/screens/workout/ExercisePicker.tsx` (185) — pick/create exercise; equipment filter chips + badges; create sets muscle + equipment.
- `src/lib/progression.ts` (44) — `suggestNext` double-progression (the offline weight/rep baseline).
- `src/lib/plates.ts` (52) — `platesPerSide`, `warmupRamp` (barbell only).
- `src/lib/scoring.ts` (165) — `scoreSession` (base points, PR bonuses, streak mult, day factor), `epley`, `SCORING` constants.
- `src/lib/finishSession.ts` (192) — `finishSession` (first close; non-idempotent), `gatherSeasonPriorBests`, **`rescoreSession`** (idempotent re-score for edits: updates existing scoreEvent, applies rank delta, carries streak).
- `src/lib/season.ts` (147) — season lifecycle: `registerSessionForStreak`, `runDailyChecks` + single-flight `runDailyChecksOnce` (launch, Android resume + midnight; never stamps the untouched seed rank row), idle-decay.
- `src/lib/standards.ts` (53) — strength standards per lift; `standardFor`/`levelFor` (matched by `nameLower`).
- `src/lib/muscleVolume.ts` (58) — weekly hard-set volume per muscle group.
- `src/lib/equipment.ts` (13) — `EQUIPMENTS` list + `EQUIPMENT_LABEL`.

## Diet & nutrition
- `src/screens/diet/DietDay.tsx` (340) — the day screen: macro rings vs targets, per-meal lists, water, week report; mounts `DietCoachCard` + `MacroCompletionCard`; derives `remaining` macros; follows a day rollover (`useLocalToday`); opens on `location.state.date` (from Coach history); "Save as meal" defaults the name.
- `src/screens/diet/AddFoodSheet.tsx` (532) — add-food UI: recent / search (local + online via `searchFoods`) / custom / recipe / barcode.
- `src/screens/diet/EntryEditor.tsx` (279) — edit one logged entry (grams / food macros / reset) + AI "Suggest a swap".
- `src/lib/nutrition.ts` (103) — `macrosFor`, `totalsForLogs`, `dayTargets`, `logFood` (single write path), `recipePer100`, `MacroTotals`/`DayTargets`.
- `src/lib/foodProviders.ts` (139) — provider **registry + orchestrator**: `searchFoods` (fallback), `lookupBarcodeChained` (chain), `upsertRemoteFood`, `remoteFoodKey`.
- `src/lib/off.ts` (85) — Open Food Facts provider (`offProvider`, `searchOff`, `lookupBarcode`).
- `src/lib/usda.ts` (142) — USDA FoodData Central provider (`usdaProvider`, `mapFdc`, `canonicalGtin`); key `VITE_USDA_KEY` from `.env` (falls back to `DEMO_KEY`).
- `src/lib/foodResolve.ts` (130) — resolve an AI food suggestion → real food id (known → OFF/USDA macro-matched → custom); `applyMacroSuggestion`, `applySwap`, `pickBestOff`.
- `src/lib/scanner.ts` (31) — zxing EAN barcode reader (re-exports `validEan`).
- `src/lib/ean.ts` (26) — pure `validEan` (EAN-8/13 checksum) + `normalizeScannedEan` (UPC-A → EAN-13).
- `src/components/BarcodeScanSheet.tsx` (317) — scan → `lookupBarcodeChained` → product. Android: ML Kit (`native/barcode.ts`) first, zxing camera fallback; a cancelled native scan switches to manual entry + "Scan again".

## AI layer (Gemini, device-local BYO key)
- `src/lib/gemini.ts` (543) — Gemini client: generic `generateStructured<T>` engine (`thinkingBudget:0`; on a retryable failure — quota, overload, retired model, rejected request shape, empty/blocked answer — retries `opts.fallbacks` in order and reports the answering model via `onModel`), `fallbackModels` (free Flash/Flash-Lite only, never Pro, ≤ `MAX_FALLBACKS`), `generateCoachNote`/`generateDietNote`/`generateWeightPlan`/`generateMacroSuggestion`/`generateSubstitution`, schemas + parsers (`parseCoachNote`/`parseWeightPlan`/`parseMacroSuggestion`), `GeminiError`, `listModels`/`pickDefaultModel`.
- `src/lib/aiStore.ts` (50) — Zustand store for `apiKey`/`model`/`models` (localStorage `gymtracker-ai`; **never Dexie**); `aiRequestOpts(onModel?)` = key + model + fallback chain for every call site.
- `src/components/AiReportCard.tsx` (328) — generic `AiReportCard<T>` state machine (cache 3-state, auto/manual generate, offline/no-key/error, regenerate, optional `footer`) + `renderCoachNote` + `errMsg` + `HistoryLink`.
- `src/components/CoachCard.tsx` (52) — workout coach note (auto-generated only on the fresh post-workout summary, a manual button in report mode, so an old report never spends quota or re-creates a deleted verdict; shows the newest stored verdict; every generation is appended to `coachHistory` with the answering model).
- `src/components/DietCoachCard.tsx` (49) — diet report (manual; newest stored report for the day, appended to `coachHistory`).
- `src/lib/coachHistory.ts` (134) — stored verdicts: `saveJudgement` (append, tracked write), `currentNote` (newest, else legacy cache), `judgementsFor`, `deleteJudgement` (tombstone + matching cache row), one-time `backfillCoachHistory` from the legacy caches.
- `src/components/MacroCompletionCard.tsx` (145) — "complete your macros" suggestions with tap-to-Add.
- `src/lib/coachBriefing.ts` (306) — `gatherWorkoutBriefing`/`formatBriefing` (post-workout) + `gatherWorkoutPlanBriefing`/`formatWorkoutPlanBriefing` (pre-workout AI weights).
- `src/lib/dietReport.ts` (383) — diet briefings: `gatherDietBriefing` (report), `gatherWeekNutrition`, `gatherMacroCompletionBriefing`, `gatherSubstitutionBriefing`, `macroBasisSig`, candidate-food assembly.
- `src/lib/workoutSuggest.ts` (115) — `useWorkoutPlan` hook (fire-once-per-session AI weights, cached, silent offline fallback) + `snapWeight`.
- `src/screens/settings/AiSection.tsx` (171) — paste Gemini key → validate + model picker + the fallback chain it retries on.

## Gamification, progress, misc
- `src/lib/ranks.ts` (71) — rank tiers/thresholds; `rankFor`.
- `src/lib/achievements.ts` (92) — achievement unlocks (`computeAchievementStats`, `checkAchievements` — add-only).
- `src/lib/quests.ts` (189) — weekly quests + bonus awards (add-only).
- `src/screens/rank/RankScreen.tsx` (285) — rank/season screen; `src/components/RankBadge.tsx` (45), `Confetti.tsx` (55).
- `src/screens/progress/ProgressScreen.tsx` (300) — bodyweight tile (→ history), Coach history tile, e1RM trends / PR wall / muscle volume; `src/components/Charts.tsx` (230) — SVG chart primitives (no CDN; `LineChart` optional dashed `trend` series, x labels, tap selects the nearest point, markers hidden past 40 points).
- `src/screens/progress/WeightHistory.tsx` (358) — `/progress/bodyweight`: stats (since start, 4-week kg/week, lowest/highest), range chart + 7-day average, month-by-month story (older months collapsed) with badges; add (any past day)/edit/delete weigh-ins (tombstoned; the newest one sets `settings.bodyweightKg`). Logic in `src/lib/bodyweight.ts` (160: `inRange`, `movingAverage`, `weeklyRate`, `buildWeightStory`).
- `src/screens/progress/CoachHistory.tsx` (208) — `/progress/coach`: every stored verdict by month, filter All/Workouts/Diet (`?kind=`), earlier verdicts marked, expand → insights, model, Open workout / Open day, delete.
- `src/screens/settings/SettingsScreen.tsx` (447) — targets, bodyweight, bar/plates, sound, sub-sections; Android: lazy `RestTimerNativeSettings` (in Rest timer) + `NotificationsSection`, `location.state.focus` scroll targets (`settings-sync`/`settings-data`, from RestoreCard); `VersionFooter` (app version, build SHA + time, Dexie schema `db.verno`; Android versionName/versionCode).
- Shared UI: `src/components/Sheet.tsx` (46, bottom sheet; registers with `backStack` while open), `NumberStepper.tsx` (87; `compact` true | `'narrow'` = small only under 380px), `ProgressRing.tsx` (41; `boxSize` for fluid rings).
- Shared libs: `src/lib/dates.ts` (93, local-date + month-calendar helpers), `hooks.ts` (89, `useNow`/`useWakeLock` (no-op on Android)/`useLocalToday` (day rollover)), `audio.ts` (51, beep/unlock).

## Native (Android / Capacitor)
Only reachable through `isNative` (invariant 14). Runbook: `ANDROID.md`.
- `src/native/platform.ts` (14) — `isNative` (compile-time false outside `--mode android`) / `isAndroid`. Shared-safe.
- `src/native/haptics.ts` (29) — `haptic(kind)`: no-op unless native + the haptics pref. Shared-safe.
- `src/native/init.ts` (104) — `initNativeEarly` (tap listeners) / `initNative` (splash, `storage.persist`, rest bridge, reminder engine, resume → `gt:resume` + reconcile + resync + locked daily checks, single midnight timer).
- `src/native/NativeShell.tsx` (87) — router companion: back button (`backAction`), pending tap routes, keep-awake rule (session active AND on `/workout/session` or resting).
- `src/native/navigation.ts` (103) — `ALLOWED_ROUTES`, `sanitizeRoute` (exact match; never `/workout/summary/*`), pending-route queue, pure `backAction`.
- `src/native/restTimerPlugin.ts` (77) — `RestTimer` plugin types/registration (Java below).
- `src/native/restTimerBridge.ts` (249) — store `rest` ⇄ native timer: pure `reconcileDecision`/`bridgeAction`/`nativeStartOptions`, serial queue, shade +15 s/Skip, re-arm on resume.
- `src/native/notifications.ts` (408) — reminder engine: channels, permission cache, `resyncNow` (plan → diff/full → schedule → shade cleanup), debounced single-flight `requestResync`, triggers, permission flows, test reminder, `getScheduledSummary`; every reminder in app group `gt_reminders`.
- `src/native/status.ts` (81) — `loadNativeStatus`/`useNativeStatus` (permission + DeviceSettings status, refreshed on `gt:resume`).
- `src/native/deviceSettings.ts` (58) — `DeviceSettings` plugin wrapper: `getDeviceStatus`, `openDeviceSettings(target, channelId?)`.
- `src/native/files.ts` (29) — `shareTextFile` (Filesystem cache + Share sheet) for backup export.
- `src/native/barcode.ts` (76) — ML Kit Google code scanner with on-demand module install; `scanBarcodeNative`.
- `src/native/appInfo.ts` (14) — `getAppInfo` (APK versionName/versionCode).
- `src/native/ui/NotificationsSection.tsx` (813) — Settings › Notifications: health row (also flags reminder categories muted in Android), schedule line, reminder categories (auto-open when one is muted), test/reschedule, haptics.
- `src/native/ui/RestTimerNativeSettings.tsx` (160) — countdown/alert/mode/warm-up prefs, muted-channel rows, "Test rest (15 s)".
- `src/native/ui/RestoreCard.tsx` (67) — first-run "Restore your data" card (Sync / Import / Start fresh).
- `src/native/ui/controls.tsx` (264) — shared native-settings controls (`SwitchRow`, `TimeInput`, `Segment`, `IssueRow`, `useAction`…). `notifyHealth.ts` (185) — pure health/channel/copy helpers incl. `mutedCategories` (channel ids mirrored here).
- Pure libs: `src/lib/notifyPrefs.ts` (144, prefs types/defaults + validating deep merge), `notifyStore.ts` (100, zustand `gymtracker-notify`; `lastResync` runtime only), `notifyPlanner.ts` (506, `planNotifications`/`diffSchedules`/`planCleanup`/ids/DST-safe `atLocal`; candidates never depend on the time of day), `notifyData.ts` (94, `gatherPlannerData`: one read-only transaction), `backStack.ts` (41, open-sheet LIFO for back).
- Java (`android/app/src/main/java/io/github/monniale/gymtracker/`): `MainActivity` (21, registers the plugins, `setTextZoom(100)`; font scale/weight in `configChanges`, so no recreate), `resttimer/RestTimerController` (392, channels, exact end alarm, countdown + "Rest over" notifications; "Rest over" in app group `gt_rest`), `RestTimerReceiver` (52, Skip/+15 s/end with the process dead), `RestTimerPlugin` (143, JS face, foreground flag, `openRoute`), `devicesettings/DeviceSettingsPlugin` (202, status + defensive deep links).
- Config: `capacitor.config.ts` (30, appId, `webDir: dist-android`, SystemBars/Splash/LN), `vite.config.ts` (63, `--mode android` → `dist-android/`, base `./`, PWA off), `android/app/build.gradle` (134, version, signing, release guards), `AndroidManifest.xml` (71, permissions, receiver, no backup).
- Scripts: `scripts/check-pwa-dist.mjs` (62, Pages bundle has no native plugin), `scripts/android/env.sh` (19), `icons.sh` (71), `release.sh` (110, guarded signed build + `--verify`), `smoke.sh` (705, emulator checks 1–10; aborts on the real sync repo), `cdp-eval.mjs` (167, WebView DevTools eval).

## Tests
`*.test.ts` next to their module (vitest, node env, no jsdom, `TZ=Europe/Rome`). Pure functions (+ fake-indexeddb). ~364 tests: `scoring`, `progression`, `merge`, `gemini` (incl. fallback chain), `dietReport`, `coachBriefing`, `nutrition`, `muscleVolume`, `gamification`, `idbKeys`, `aiSuggest`, `foodProviders`, `dates`, `rescore`, `notifyPrefs`, `notifyPlanner` (incl. DST), `coachHistory` (fake-indexeddb, incl. old-build snapshots), `bodyweight`, `notifyData`, `syncLock`, `seed` (fake-indexeddb), `backStack`, `ean`, `nativeBoundary` (invariant 14), `routes`, `native/navigation`, `native/restTimerBridge`, `native/notifications`, `native/ui/notifyHealth`.

---

## Invariants (read before schema / sync / scoring / AI changes)
1. **Sync allow-list is `backup.ts` TABLES** (mirrored in `merge.ts` `SnapshotTables`). A table syncs **iff** it's listed there. Device-local AI caches (`coachNotes`, `dietNotes`, `workoutSuggestions`, `dietSuggestions`) are **deliberately excluded** — never add them. Stored coach verdicts are user data in their own table (`coachHistory`, synced). A table added after snapshot v2 goes in `LATE_TABLES` too and is optional in `SnapshotTables`, so a snapshot from an older build (missing it) never wipes it.
2. **AI cache writes** must be wrapped in `withSyncTrackingSuspended` and use natural keys (not in `UUID_TABLES`). Real user-data writes (sessions/sets/foods/rank… and stored coach verdicts in `coachHistory`) must **not** be suspended.
3. **The Gemini key, the GitHub PAT and all device-local prefs (notifications, haptics, rest-alert mode) never touch Dexie** — they live in zustand-persist stores in localStorage (`gymtracker-ai`, `gymtracker-sync`, `gymtracker-notify`), so they are never synced or backed up.
4. **Every structured Gemini call sets `generationConfig.thinkingConfig.thinkingBudget=0`** (Flash otherwise truncates JSON). Add new generators via `generateStructured<T>`, and call them with `aiRequestOpts()` so they get the free-model fallback chain. Fallbacks are free Flash/Flash-Lite models only (a billed key must never silently pay for a Pro fallback); a rejected key, a permission error on the chosen model or no network never falls back.
5. **`finishSession` is non-idempotent** (adds a scoreEvent, adds full points, bumps streak). To re-score an edited past workout use **`rescoreSession`** (updates the existing event, applies only the points delta, carries the streak).
6. **Equipment separation is by `exerciseId`** — variants are distinct exercises; no `SetRow.equipment`. Every weight/PR/progression path already partitions by exerciseId.
7. **Food dedup key** is the derived `offId = barcode ?? source:sourceId` (OFF stays bare EAN → backward-compatible; USDA branded reuses the EAN; whole foods → `usda:<fdcId>`).
8. **Dexie schema is additive** — bump `version(N)` with only new stores; never edit a released version block (current: 8). Seed uses **deterministic ids** (id: i+1) so two fresh installs merge without duplicating the catalog; seed rows carry `updatedAt: 0` (written suspended), so a real row always wins a merge.
9. **Deletes that must propagate** use `deleteWithTombstone`/`tombstoneKeys`; device-local cache deletes use a plain suspended `delete()`.
10. **Routing:** `HashRouter`; parse ids with `parseRouteId`, never `Number()`. **Ordering:** `orderBy('date'/'startedAt')`, not `orderBy('id')` (UUID strings don't sort chronologically).
11. **Report mode** (`?report=1`) must skip `checkAchievements`/`evaluateQuests`/confetti/rank-up (side-effects wrong for old sessions).
12. **Env/CI:** Node 18 floor / CI Node 22 for the PWA; Android tooling needs Node ≥ 22 (`@capacitor/cli` 8.5.2) and JDK 21 with `javac`; Capacitor packages are pinned exactly (the committed `android/` must match); `workbox-build` 7.1.1 override; self-hosted assets only (no CDN — zxing wasm + fonts bundled). USDA key: `VITE_USDA_KEY` (inlined into the public bundle at build — only OK because it's a free per-IP-rate-limited key). Build stamp: `vite.config.ts` `define`s `__APP_VERSION__` (package.json), `__BUILD_SHA__` (`GITHUB_SHA` → local git), `__BUILD_TIME__`; typed in `src/vite-env.d.ts`.
13. **Phone widths:** every screen must hold at **360px** (Galaxy S25) and **320px** with no overflow. Two+ `NumberStepper`s in one row → `compact="narrow"` + `flex-wrap`; chips/badges/short buttons get `whitespace-nowrap` (+ `shrink-0` in flex rows) so they move as a unit instead of breaking onto 2 lines; names `truncate`. Fixed-px widths in a row must sum under ~290px. On Android the WebView text zoom is pinned to 100% (`setTextZoom(100)` in `MainActivity`), so these rules hold whatever the One UI font size.
14. **Native/PWA split.** Plugin packages (`@capacitor/*` except `@capacitor/core`, `@capacitor-community/*`, `@capacitor-mlkit/*`) are imported only in `src/native/**`. Outside `src/native/`, code may statically import only `native/platform.ts` and `native/haptics.ts`; everything else is a dynamic `import()`/`React.lazy` gated on `isNative` (compile-time false in the Pages build, so Rollup drops the chunks). Native-only UI lives in `src/native/ui/`. Enforced by `nativeBoundary.test.ts` + `scripts/check-pwa-dist.mjs`. The Pages build keeps SW, manifest and base `/GymTracker/`; `dist-android/` is never deployed.
15. **Identity is permanent.** `appId = io.github.monniale.gymtracker`, WebView origin `https://localhost` (never set `server`/`hostname`/`androidScheme`), release key in `~/.android-keys/gymtracker/` (never in the repo). Changing any of them orphans or wipes the phone's data. Debug/emulator builds (`….debug`) must never connect to the real sync repo (`smoke.sh` aborts).
16. **Notification IDs.** LocalNotifications ids = `cat*10_000_000 + dayIdx*100 + slot` (`dayIdx` from 2026-01-01); planner cats 10–18 (`isManagedId`), 99 = test reminder. RestTimer owns Android ids 4201 (countdown) / 4202 ("Rest over") and PendingIntent request codes 4211–4215; it never goes through LN. Every alerting notification except the countdown sets an app group (`gt_reminders`, `gt_rest`; no summary): Android 16 force-groups ungrouped ones and, on its base release, silences them. Never make 4201 a group summary (it blocks Live Update promotion). Never call `LocalNotifications.removeAllDeliveredNotifications()` (it cancels everything, incl. the rest countdown).
17. **Channels are immutable.** Ids carry `_vN`; to change sound/importance/vibration, bump the id and delete the old one: reminder channels via `OBSOLETE_CHANNELS` in `native/notifications.ts`, rest channels in `RestTimerController.ensureChannels` (also update the ids mirrored in `native/ui/notifyHealth.ts` and `smoke.sh`).
18. **LocalNotifications discipline.** Only one-shot `schedule.at` with `allowWhileIdle: true` and an explicit `isExactNotification`; never `on`/`every`/`repeats`; never `schedule()` without notifications granted + enabled (no implicit prompt, no Alarms & reminders bounce); never a time ≤ now + 30 s (`LEAD_MS`); never `cancel({ notifications: [] })`. Notification taps only navigate (whitelisted routes), never write data or call `finishSession`.

---

## Keeping this file fresh
When you add/rename/remove a module or change an invariant, update the matching row here (and the Task→files table). Keep entries to one line. If a subsystem grows past ~8 files, give it its own section.
