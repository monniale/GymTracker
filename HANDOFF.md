# Handoff: nine features built, PRs waiting to be opened

**Generated**: 2026-10-15
**Branches**: nine stacked feature branches, all pushed to `origin`; `main` is unchanged (`826b0d6`)
**Status**: all nine features from `docs/FEATURE_PLAN.md` are built, reviewed and pushed. **The PRs are not opened yet**: the GitHub MCP has no token and `gh` is not installed.

## Start here

1. Read [`ROUTEMAP.md`](ROUTEMAP.md) (module index + **Invariants**, now 19 of them). Load only the files a task needs; never scan `src/` blindly.
2. `git branch -a` → `feat/01-training-heatmap` … `feat/09-italian`. Each branch builds on the previous one.

## The stack (merge in this order)

| # | Branch | PR base | Feature |
|---|--------|---------|---------|
| 1 | `feat/01-training-heatmap` | `main` | Progress consistency heatmap |
| 2 | `feat/02-rep-range-prs` | 01 | 1/3/5/8/10/12 RM table |
| 3 | `feat/03-share-card` | 02 | Workout card PNG (web share / Android share sheet) |
| 4 | `feat/04-meal-plan` | 03 | Plan tomorrow's meals (**Dexie v9** `plannedFoods`) |
| 5 | `feat/05-week-review` | 04 | `/progress/week` + weekly AI review |
| 6 | `feat/06-cardio` | 05 | Cardio sets (time + distance, no rank points) |
| 7 | `feat/07-csv-import` | 06 | Strong / Hevy CSV import |
| 8 | `feat/08-android-widget` | 07 | Android home-screen widget (**native**) |
| 9 | `feat/09-italian` | 08 | Full English / Italian (**native**) |

Fixes from the code reviews were committed on the branch that owns the code and merged upward (so later branches contain merge commits from earlier ones). Merge the PRs in order with a merge commit; GitHub retargets the next PR when the base branch is deleted.

## Opening the PRs

PR titles and descriptions are ready in `~/.claude/projects/-mnt-hdd-GymTracker/pr-drafts/` (`01.md`…`09.md`, `index.txt`). Once the owner runs `sudo apt install gh && gh auth login`, run `~/.claude/projects/-mnt-hdd-GymTracker/pr-drafts/create-prs.sh`. It skips PRs that already exist.

## Owner decisions (do not re-ask)

- One PR per feature, **stacked** (owner, 2026-10-15).
- Cardio earns **no** rank points; it counts for the streak and the weekly target (`cardioBonusPoints()` returns 0).
- No real Strong/Hevy export was available: the import is built from the documented formats.
- Italian covers everything. "streak" and "rank" stay as loanwords in Italian.

## What is left

- Open the PRs (above), then merge in order. Merging `main` deploys the website.
- After the merge: `scripts/android/release.sh` for a signed APK (features 3, 8 and 9 change native code), install over the old app, never uninstall.
- Try a **real Strong or Hevy export** with Settings › Data › Import.

## Verification done

- Every branch: `tsc` (app + node), `npm test` (468 on `feat/09-italian`, string guard enforced), `npm run build` + `check-pwa-dist.mjs`.
- Headless Chrome (puppeteer-core in the session scratchpad, `vite preview --port 4317`) at 360 and 320 px for every new screen; Italian pass over every route.
- Emulator (`.android-test/` AVD `s25ish`, see ANDROID.md §7): `smoke.sh` 46/46 on the widget build; `SMOKE_LANG=it smoke.sh --only "1 2 3 4"` 18/18; widget pin/tap/update, Android share sheet, Italian rest-timer notifications and per-app locale checked by hand.
- Three code reviews (features 1–5, 6–8, i18n): no high-severity bugs; every medium/low finding fixed except the cosmetic ones listed in the PR descriptions.

## Warnings

- Agent worktrees (`isolation: worktree`) start from **main**, not the current branch, and their tests get picked up by `npm test` in the main tree while they exist (see memory `agent-worktrees-start-from-main`).
- `npm run android:debug` runs `cap sync`, which may rewrite `android/capacitor.settings.gradle`; restore it with `git checkout` if it shows up modified.
- `orderBy('id')` on synced tables is wrong (UUIDs): order by `date`/`startedAt` (invariant 10).
- Never connect a debug/emulator build to the real `gymtracker-data` sync repo; never change the appId, the WebView origin or the signing key.
