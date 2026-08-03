# ROUTEMAP — GymTracker module index

Purpose: a compact map of the codebase so a fresh chat can **load only the files a task needs** instead of scanning `src/`. Line counts `(N)` flag context cost. Paths are relative to repo root.

**Stack:** React + TypeScript + Vite + Tailwind, Dexie/IndexedDB, `HashRouter`. Ships as a **static PWA on GitHub Pages — no backend.** Cross-device sync is a snapshot pushed to a **private GitHub repo via the user's PAT**. AI is **Gemini free-tier with a device-local BYO key**. Deploy = `git push origin main` → Actions → Pages.

Build/verify: `npm run build` (= `tsc --noEmit && vite build`) · `npm test` (vitest) · Node 18 floor / CI Node 22.

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
| **AI (any feature)** | `src/lib/gemini.ts`, `aiStore.ts`, `src/components/AiReportCard.tsx` (+ the feature's briefing in `coachBriefing.ts`/`dietReport.ts`) |
| **AI workout coach / weight suggestions** | `src/lib/coachBriefing.ts`, `workoutSuggest.ts`, `src/components/CoachCard.tsx` |
| **AI diet coach / macro suggestions** | `src/lib/dietReport.ts`, `foodResolve.ts`, `src/components/DietCoachCard.tsx`, `MacroCompletionCard.tsx` |
| **Sync / backup / merge** | `src/lib/sync.ts`, `merge.ts`, `githubApi.ts`, `src/db/backup.ts`, `src/screens/settings/SyncSection.tsx` |
| **Charts / progress** | `src/screens/progress/ProgressScreen.tsx`, `src/components/Charts.tsx`, `src/lib/muscleVolume.ts`, `standards.ts` |
| **Settings** | `src/screens/settings/SettingsScreen.tsx`, `AiSection.tsx`, `SyncSection.tsx` |

Cross-cutting rules live in **Invariants** at the bottom — read those before any schema/sync/scoring change.

---

## App shell & routing
- `src/main.tsx` (10) — entry; mounts `<App/>`.
- `src/App.tsx` (69) — `HashRouter` + all routes; on launch: `ensureSeeded`, `runDailyChecks`, catch-up achievements/quests, install sync, first sync. Routes: `/workout`, `/workout/template/:id`, `/workout/session`, `/workout/summary/:id`, `/workout/history`, `/workout/past/:id`, `/diet`, `/progress`, `/rank`, `/settings`.
- `src/store.ts` (63) — Zustand app store: `activeSessionId`, rest timer, stopwatch (persisted to localStorage).
- `src/components/TabBar.tsx` (33) — bottom nav (workout/diet/progress/rank/settings).
- `src/components/RestTimerBar.tsx` (74) — fixed rest-countdown bar (reads store timer + `audio.ts`).

## Data model & persistence
- `src/types.ts` (369) — **all interfaces.** Key: `Exercise`(+`Equipment`), `TemplateItem`, `WorkoutTemplate`, `Session`, `SetRow`, `Food`/`MacroSet`/`FoodLog`/`SavedMeal`, `Settings`, `RankState`/`ScoreEvent`/`Season`, `DayType`/`BodyLogEntry`/`WaterLog`, `CoachNote`/`CoachInsight`, AI payloads (`RemoteFood`, `FoodProvider`, `MacroSuggestion`, `WorkoutPlanRow`, `DietSuggestionRow`, `PlannedSet`/`ExercisePlan`), cache rows (`CoachNoteRow`/`DietNoteRow`), `Tombstone`. `Id = number|string`.
- `src/db/db.ts` (179) — Dexie `GymDB` (**version 7**), the sync middleware (UUID ids, `updatedAt` stamp, dirty flag), `withSyncTrackingSuspended`, `deleteWithTombstone`/`tombstoneKeys`, `UUID_TABLES`. Device-local AI caches: `coachNotes`, `dietNotes`, `workoutSuggestions`, `dietSuggestions`.
- `src/db/backup.ts` (87) — `TABLES` **sync/backup allow-list** (the single source of truth for what serializes), `collectTables`/`applyTables`, export/import.
- `src/db/seed.ts` (145) — exercise catalog (`ROWS`, deterministic ids), default `Settings`, `ensureSeeded`.
- `src/lib/merge.ts` (269) — row-level merge of local+remote snapshots (updatedAt-wins; foods dedup by `offId` + FK remap into foodLogs/savedMeals); `SnapshotTables`.
- `src/lib/ids.ts` (7) — `parseRouteId` (handles number|string route ids; never `Number()`).

## Sync (GitHub snapshot)
- `src/lib/sync.ts` (317) — `buildPayload` (TABLES-only), `syncNow`, `installSyncTriggers` (8s debounced dirty push), `isConnected`.
- `src/lib/githubApi.ts` (140) — GitHub REST wrapper `gh()` (PAT auth, error mapping).
- `src/screens/settings/SyncSection.tsx` (213) — connect PAT + repo, manual sync UI.

## Workout
- `src/screens/workout/WorkoutHome.tsx` (144) — landing: template list, `startWorkout`, stopwatch.
- `src/screens/workout/TemplateEditor.tsx` (175) — edit a template's `TemplateItem`s (sets/reps/rest/superset).
- `src/screens/workout/ActiveSession.tsx` (574) — **live session.** `ExerciseCard` (prevSets, `draftFor` prefill, suggestion chip, warm-up ramp, `PendingRow`), `logSet`/`deleteSet`, `NoteSheet` (notes + progression step + **equipment**), AI opening weights via `useWorkoutPlan`, equipment badge, plate/ramp gated on `equipment==='barbell'`.
- `src/screens/workout/SessionSummary.tsx` (173) — post-workout summary; **report mode** (`?report=1`) suppresses confetti/rank/achievement side-effects for viewing old sessions. Requires a `scoreEvent` to render.
- `src/screens/workout/History.tsx` (158) — **month calendar** of past workouts (dots on workout days); tap a day → its sessions; tap a session → editor.
- `src/screens/workout/PastWorkout.tsx` (317) — **edit a finished workout**: per-set weight/reps/warm-up, add/remove sets, session details (name/bodyweight/date); every change calls `rescoreSession`.
- `src/screens/workout/ExercisePicker.tsx` (185) — pick/create exercise; equipment filter chips + badges; create sets muscle + equipment.
- `src/lib/progression.ts` (44) — `suggestNext` double-progression (the offline weight/rep baseline).
- `src/lib/plates.ts` (52) — `platesPerSide`, `warmupRamp` (barbell only).
- `src/lib/scoring.ts` (165) — `scoreSession` (base points, PR bonuses, streak mult, day factor), `epley`, `SCORING` constants.
- `src/lib/finishSession.ts` (184) — `finishSession` (first close; non-idempotent), `gatherSeasonPriorBests`, **`rescoreSession`** (idempotent re-score for edits: updates existing scoreEvent, applies rank delta, carries streak).
- `src/lib/season.ts` (129) — season lifecycle: `registerSessionForStreak`, `runDailyChecks`, idle-decay.
- `src/lib/standards.ts` (53) — strength standards per lift; `standardFor`/`levelFor` (matched by `nameLower`).
- `src/lib/muscleVolume.ts` (58) — weekly hard-set volume per muscle group.
- `src/lib/equipment.ts` (13) — `EQUIPMENTS` list + `EQUIPMENT_LABEL`.

## Diet & nutrition
- `src/screens/diet/DietDay.tsx` (320) — the day screen: macro rings vs targets, per-meal lists, water, week report; mounts `DietCoachCard` + `MacroCompletionCard`; derives `remaining` macros.
- `src/screens/diet/AddFoodSheet.tsx` (531) — add-food UI: recent / search (local + online via `searchFoods`) / custom / recipe / barcode.
- `src/screens/diet/EntryEditor.tsx` (279) — edit one logged entry (grams / food macros / reset) + AI "Suggest a swap".
- `src/lib/nutrition.ts` (103) — `macrosFor`, `totalsForLogs`, `dayTargets`, `logFood` (single write path), `recipePer100`, `MacroTotals`/`DayTargets`.
- `src/lib/foodProviders.ts` (139) — provider **registry + orchestrator**: `searchFoods` (fallback), `lookupBarcodeChained` (chain), `upsertRemoteFood`, `remoteFoodKey`.
- `src/lib/off.ts` (85) — Open Food Facts provider (`offProvider`, `searchOff`, `lookupBarcode`).
- `src/lib/usda.ts` (142) — USDA FoodData Central provider (`usdaProvider`, `mapFdc`, `canonicalGtin`); key `VITE_USDA_KEY` from `.env` (falls back to `DEMO_KEY`).
- `src/lib/foodResolve.ts` (130) — resolve an AI food suggestion → real food id (known → OFF/USDA macro-matched → custom); `applyMacroSuggestion`, `applySwap`, `pickBestOff`.
- `src/lib/scanner.ts` (39) — zxing EAN barcode reader + `validEan`.
- `src/components/BarcodeScanSheet.tsx` (248) — camera scan → `lookupBarcodeChained` → product.

## AI layer (Gemini, device-local BYO key)
- `src/lib/gemini.ts` (475) — Gemini client: generic `generateStructured<T>` engine (`thinkingBudget:0`), `generateCoachNote`/`generateDietNote`/`generateWeightPlan`/`generateMacroSuggestion`/`generateSubstitution`, schemas + parsers (`parseCoachNote`/`parseWeightPlan`/`parseMacroSuggestion`), `GeminiError`, `listModels`/`pickDefaultModel`.
- `src/lib/aiStore.ts` (39) — Zustand store for `apiKey`/`model`/`models` (localStorage `gymtracker-ai`; **never Dexie**).
- `src/components/AiReportCard.tsx` (295) — generic `AiReportCard<T>` state machine (cache 3-state, auto/manual generate, offline/no-key/error, regenerate) + `renderCoachNote` + `errMsg`.
- `src/components/CoachCard.tsx` (48) — workout coach note (auto-gen, cached by sessionId).
- `src/components/DietCoachCard.tsx` (49) — diet report (manual, cached by date).
- `src/components/MacroCompletionCard.tsx` (145) — "complete your macros" suggestions with tap-to-Add.
- `src/lib/coachBriefing.ts` (306) — `gatherWorkoutBriefing`/`formatBriefing` (post-workout) + `gatherWorkoutPlanBriefing`/`formatWorkoutPlanBriefing` (pre-workout AI weights).
- `src/lib/dietReport.ts` (383) — diet briefings: `gatherDietBriefing` (report), `gatherWeekNutrition`, `gatherMacroCompletionBriefing`, `gatherSubstitutionBriefing`, `macroBasisSig`, candidate-food assembly.
- `src/lib/workoutSuggest.ts` (115) — `useWorkoutPlan` hook (fire-once-per-session AI weights, cached, silent offline fallback) + `snapWeight`.
- `src/screens/settings/AiSection.tsx` (147) — paste Gemini key → validate + model picker.

## Gamification, progress, misc
- `src/lib/ranks.ts` (71) — rank tiers/thresholds; `rankFor`.
- `src/lib/achievements.ts` (92) — achievement unlocks (`computeAchievementStats`, `checkAchievements` — add-only).
- `src/lib/quests.ts` (189) — weekly quests + bonus awards (add-only).
- `src/screens/rank/RankScreen.tsx` (280) — rank/season screen; `src/components/RankBadge.tsx` (45), `Confetti.tsx` (55).
- `src/screens/progress/ProgressScreen.tsx` (262) — e1RM trends / PR wall / muscle volume; `src/components/Charts.tsx` (197) — SVG chart primitives (no CDN).
- `src/screens/settings/SettingsScreen.tsx` (332) — targets, bodyweight, bar/plates, sound, sub-sections.
- Shared UI: `src/components/Sheet.tsx` (35, bottom sheet), `NumberStepper.tsx` (78), `ProgressRing.tsx` (35).
- Shared libs: `src/lib/dates.ts` (93, local-date + month-calendar helpers), `hooks.ts` (54, `useNow`/`useWakeLock`), `audio.ts` (51, beep/unlock).

## Tests
`*.test.ts` next to their lib (vitest, node env, no jsdom). Pure functions only. ~154 tests: `scoring`, `progression`, `merge`, `gemini`, `dietReport`, `coachBriefing`, `nutrition`, `muscleVolume`, `gamification`, `idbKeys`, `aiSuggest`, `foodProviders`, `dates`.

---

## Invariants (read before schema / sync / scoring / AI changes)
1. **Sync allow-list is `backup.ts` TABLES** (mirrored in `merge.ts` `SnapshotTables`). A table syncs **iff** it's listed there. Device-local AI caches (`coachNotes`, `dietNotes`, `workoutSuggestions`, `dietSuggestions`) are **deliberately excluded** — never add them.
2. **AI cache writes** must be wrapped in `withSyncTrackingSuspended` and use natural keys (not in `UUID_TABLES`). Real user-data writes (sessions/sets/foods/rank…) must **not** be suspended.
3. **The Gemini API key never touches Dexie** — it lives only in `aiStore`/localStorage.
4. **Every structured Gemini call sets `generationConfig.thinkingConfig.thinkingBudget=0`** (Flash otherwise truncates JSON). Add new generators via `generateStructured<T>`.
5. **`finishSession` is non-idempotent** (adds a scoreEvent, adds full points, bumps streak). To re-score an edited past workout use **`rescoreSession`** (updates the existing event, applies only the points delta, carries the streak).
6. **Equipment separation is by `exerciseId`** — variants are distinct exercises; no `SetRow.equipment`. Every weight/PR/progression path already partitions by exerciseId.
7. **Food dedup key** is the derived `offId = barcode ?? source:sourceId` (OFF stays bare EAN → backward-compatible; USDA branded reuses the EAN; whole foods → `usda:<fdcId>`).
8. **Dexie schema is additive** — bump `version(N)` with only new stores; never edit a released version block. Seed uses **deterministic ids** (id: i+1) so two fresh installs merge without duplicating the catalog.
9. **Deletes that must propagate** use `deleteWithTombstone`/`tombstoneKeys`; device-local cache deletes use a plain suspended `delete()`.
10. **Routing:** `HashRouter`; parse ids with `parseRouteId`, never `Number()`. **Ordering:** `orderBy('date'/'startedAt')`, not `orderBy('id')` (UUID strings don't sort chronologically).
11. **Report mode** (`?report=1`) must skip `checkAchievements`/`evaluateQuests`/confetti/rank-up (side-effects wrong for old sessions).
12. **Env/CI:** Node 18 floor / CI Node 22; `workbox-build` 7.1.1 override; self-hosted assets only (no CDN — zxing wasm + fonts bundled). USDA key: `VITE_USDA_KEY` (inlined into the public bundle at build — only OK because it's a free per-IP-rate-limited key).

---

## Keeping this file fresh
When you add/rename/remove a module or change an invariant, update the matching row here (and the Task→files table). Keep entries to one line. If a subsystem grows past ~8 files, give it its own section.
