# Handoff: Food-DB providers + Past-workout calendar/edit + Equipment variants

**Generated**: 2026-08-03 18:54
**Branch**: main
**Status**: Ready for Review — all uncommitted, tsc + 158 tests + build green. Both feature batches adversarially reviewed and confirmed findings fixed.

## Codebase map — load this first (context efficiency)

**[`ROUTEMAP.md`](ROUTEMAP.md) is the module index for this repo** (also auto-referenced from [`CLAUDE.md`](CLAUDE.md), loaded every session). Use its **Task → files** table to load only the files a task needs — do NOT scan `src/` (~10k lines). Read its **Invariants** section before any schema/sync/scoring/AI change. When you add/rename/remove a module or change an invariant, update the matching one-line row in `ROUTEMAP.md`.

## Goal

Personal fitness PWA (React+TS+Vite+Dexie, static GitHub Pages, no backend). This session added, on top of the already-shipped AI coach: (A) mix multiple online food databases for search + barcode; (B) a past-workout calendar with full editing; (C) per-exercise equipment with separated weight data; and (D) the routemap docs above.

## Completed (uncommitted unless noted)

- [x] **SHIPPED & DEPLOYED** (commit `a00c80d`): AI diet macro-completion + food-swap, AI workout opening-weights (silent offline fallback). Live at https://monniale.github.io/GymTracker/.
- [x] **Multi-provider food DBs**: pluggable `FoodProvider` registry (`foodProviders.ts`) — Open Food Facts + USDA FoodData Central. Fallback search (OFF first, USDA when thin), barcode chain (first hit wins). Zero Dexie migration (dedup key `offId = barcode ?? source:sourceId`). `.env` key handling (`VITE_USDA_KEY`, CI secret, `DEMO_KEY` fallback). Adversarially reviewed: 7 confirmed, 6 fixed (GTIN canonicalization, search-abort race, error semantics, servingG GRM, offline spinner), 1 low accepted (see Warnings).
- [x] **Past-workout calendar + edit**: `History.tsx` is now a month calendar (dots on workout days → tap day → sessions → editor). New `PastWorkout.tsx` at `/workout/past/:id` edits sets (weight/reps/warm-up, add/remove) + session details (name/bodyweight/date). New `rescoreSession` recomputes points/PRs and applies the rank delta. Adversarially reviewed: **7 confirmed, 5 fixed**, 2 accepted (see below). Fixes: dayFactor/streak now CARRIED from the stored event (recomputing quartered the day's primary session on any edit — HIGH); rank delta made atomic (re-read inside txn) + UI double-tap guards; date-move shifts every set's `completedAt`; finish + rescore both bucket `scoreEvent.date` by `startedAt`.
- [x] **Equipment variants**: `Equipment` enum on `Exercise`; picker equipment filter chips + badges + create-time selector; session NoteSheet equipment editor. Weight data separated by `exerciseId` (variants = distinct exercises) — no analytics changes.
- [x] **Routemap docs**: `ROUTEMAP.md`, `CLAUDE.md` (auto-loaded), `HANDOFF.md` map section.
- [x] tsc clean, **158 vitest tests** pass (14 files), `vite build` green.

## Not Yet Done

- [ ] **Nothing is committed/pushed** — the whole session's work (food providers + past-workout/equipment + docs) is uncommitted. User said push only when asked. Consider two commits: (1) multi-provider food DBs + `.env`, (2) past-workout/equipment + routemap docs.
- [ ] Set a real free USDA key: put it in `.env` (`VITE_USDA_KEY=...`) and/or repo secret `VITE_USDA_KEY`. Ships on `DEMO_KEY` (~30 req/hr/IP) until then.
- [ ] **Accepted (documented, not fixed)** — would need a full season-wide recompute subsystem:
  - Editing an OLD session's e1RM/volume upward can leave a later session's PR bonus in place → rank drifts above a from-scratch recompute (bounded by prBonusCap; only on upward edits of historical sessions).
  - Rank clamp-at-0 can drift if a large downward edit floors points at 0.
  - Food dedup: USDA *branded search* result vs OFF result for the same product (UPC-12 vs EAN-13) can save as two rows (scan path already dedups via `canonicalGtin`).

## Failed Approaches (Don't Repeat These)

- **Workflow script with backtick-quoted words inside a template-literal prompt** → `Script parse error: Unexpected token`. Fix: build the shared CONTEXT via `[...].join('\n')` and use single quotes, never backticks, inside `agent()` prompt strings.
- **USDA energy from nutrientNumber `208` only** → Foundation foods report energy under **`957`/`958` (Atwater)**, NOT 208 (verified against the live API); using 208 alone silently drops every whole food. Fix: try `208 → 957 → 958 → kJ 268/4.184`, filtering `unitName==='KCAL'`.
- **USDA barcode exact-string gtin compare** → FDC stores UPC-12/GTIN-14 while zxing yields EAN-13; exact compare never matched. Fix: `canonicalGtin` (strip leading zeros both sides).
- **`safeSearch` swallowing all errors** → a real outage showed "No results" instead of "unreachable". Fix: `searchAcross`/`lookupAcross` track `anyOk` and rethrow only when EVERY provider errored.
- **Per-set equipment on `SetRow`** → rejected: would touch every weight/PR/progression/chart/briefing path + a new index + backfill, and conflicts with the seed's existing variant exercises. Chose equipment-on-`Exercise` (variants) instead.
- **Re-running `finishSession` to re-score an edit** → it is non-idempotent (adds a duplicate scoreEvent, adds full points again, re-bumps the streak). Use `rescoreSession` (updates the existing event, applies only the delta).
- **Believing `.env` hides the key in a static app** → Vite inlines `VITE_*` into the public bundle at build (`grep DEMO_KEY dist/assets/index-*.js` finds it). `.env` only keeps it out of source/git; acceptable ONLY for the free per-IP USDA key.

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| OFF + USDA, no secret key | Both free/CORS-open (USDA verified `access-control-allow-origin: *`); USDA complements OFF on whole foods. Others (Nutritionix/Edamam/FatSecret) need secret keys/OAuth → wrong for no-backend. |
| Search = fallback, barcode = chain | User choice: query USDA only when OFF is thin; barcode tries OFF then USDA, first hit wins. |
| `offId = barcode ?? source:sourceId` | Reuses the existing `&offId` unique index + `merge.ts` dedup → **no schema migration, backward-compatible** with existing OFF rows (bare EAN). |
| Equipment = variants-as-exercises | Separated weight data "for free" (all analytics key by `exerciseId`); zero risk to scoring engine; matches the seed catalog. |
| Editing rescores + adjusts rank | User choice: keep score consistent with edited data (delta applied); achievements/quests only add, never revoke. |
| `CLAUDE.md`, not the `/handoff` command | The handoff command lives in the global plugin cache (affects all projects, wiped on update). `CLAUDE.md` is repo-scoped + auto-loaded. |

## Current State

**Working**: everything above; tsc clean; 154/154 tests; `vite build` green (bundle ~535 kB).
**Broken**: nothing known (pending the in-flight review).
**Uncommitted Changes**: 17 modified + 10 new files. New: `ROUTEMAP.md`, `CLAUDE.md`, `.env.example`, `src/lib/{foodProviders,usda,equipment}.ts`, `src/lib/{foodProviders,dates}.test.ts`, `src/screens/workout/PastWorkout.tsx`. `.env` is gitignored (not shown).

## Files to Know

| File | Why It Matters |
|------|----------------|
| `ROUTEMAP.md` | Module index; start here. |
| `src/lib/foodProviders.ts` | Registry + `searchFoods`/`lookupBarcodeChained`/`upsertRemoteFood`/`remoteFoodKey`. |
| `src/lib/off.ts` / `usda.ts` | The two `FoodProvider`s; `usda.ts` has `mapFdc` + `canonicalGtin` + `VITE_USDA_KEY`. |
| `src/lib/finishSession.ts` | `rescoreSession` (idempotent re-score) beside non-idempotent `finishSession`. |
| `src/screens/workout/History.tsx` | Month calendar of past workouts. |
| `src/screens/workout/PastWorkout.tsx` | `/workout/past/:id` editor (sets + details + delete). |
| `src/lib/dates.ts` | New month-calendar helpers. |
| `src/lib/equipment.ts` | `EQUIPMENTS` + `EQUIPMENT_LABEL`. |
| `src/types.ts` | `Equipment`, `RemoteFood`, `FoodProvider`, `Exercise.equipment`. |

## Code Context

```typescript
// src/lib/foodProviders.ts
export const PROVIDERS: FoodProvider[]        // [offProvider, usdaProvider]
searchFoods(query, signal?): Promise<RemoteFood[]>          // OFF first; USDA if <5; throws only if ALL error
lookupBarcodeChained(code, signal?): Promise<RemoteFood|null>  // first hit; throws only if ALL error
upsertRemoteFood(p: RemoteFood): Promise<Id>   // dedup by offId = barcode ?? `${source}:${sourceId}`
remoteFoodKey(p: RemoteFood): string

// src/types.ts
type Equipment = 'barbell'|'dumbbell'|'machine'|'cable'|'bodyweight'|'other'
interface RemoteFood extends MacroSet { source:'off'|'usda'; sourceId:string; barcode?:string; name:string; brand?:string; servingG?:number; servingLabel?:string }

// src/lib/finishSession.ts
rescoreSession(sessionId: Id): Promise<number|null>   // recompute e1rm/points/PRs, UPDATE existing scoreEvent, rank += (new-old), carry streak

// src/lib/dates.ts
monthGrid(s): string[]   // 42 date-strings, Monday-first
startOfMonth(s) / addMonths(s,n) / monthLabel(s) / sameMonth(a,b) / WEEKDAY_LABELS
```

**Non-obvious**: USDA branded values are per-100g (verified). `rescoreSession` reconstructs streak weeks via `round((event.streakMult-1)/SCORING.streakStep)` so `scoreSession` reproduces the stored multiplier. Editing writes to SYNCED tables WITHOUT `withSyncTrackingSuspended` (correct — real data), unlike AI caches.

## Resume Instructions

1. `npm install && npm test` → expect **154 passed** (13 files).
2. `npm run build` → `tsc --noEmit && vite build`, expect `✓ built`.
3. **Check the in-flight review**: open `/workflows` (task `wfi2iqdh7`) or re-run the review script under `.../workflows/scripts/review-past-workout-equipment-*.js`. Read its `confirmed` findings; apply any real ones (most-severe first) and re-run steps 1–2.
4. Exercise manually (`npx vite preview`): Workout → History → tap a calendar day → tap a session → edit a set / move the date → confirm points + calendar update. Add exercise → equipment filter + create with equipment. Diet → search a whole food ("chicken breast raw") → USDA row appears (needs online + key).
5. When the user says push: `git push origin main` → verify CI `success` and the live `assets/index-*.js` hash matches `dist/`.

## Setup Required

- `.env` → `VITE_USDA_KEY=<free data.gov key>` for full USDA rate limit (else `DEMO_KEY`). For deploy, add repo secret `VITE_USDA_KEY` (already wired in `deploy.yml`).
- Gemini AI features need a device-local key in Settings → AI Coach (unchanged from prior session).

## Warnings

- **Never add device-local caches to `backup.ts` TABLES**, never write the Gemini key to Dexie (see ROUTEMAP Invariants).
- **Food dedup gap (accepted, low)**: a USDA *branded search* result and an OFF result for the same product can save as two rows when barcode formats differ (UPC-12 vs EAN-13). Scoped out; the scan path already dedups via `canonicalGtin`.
- Equipment is per-**Exercise**, not per-set: switching gear = pick/filter a different variant, not a toggle on one shared exercise. No `SetRow.equipment` exists.
- Pre-existing invariants still apply — see `ROUTEMAP.md` Invariants (Node 18 floor/CI 22, `workbox-build` 7.1.1, `parseRouteId` not `Number()`, `orderBy` by date not id, deterministic seed ids, HashRouter).
