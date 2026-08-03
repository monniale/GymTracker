# GymTracker — project instructions

**Read [`ROUTEMAP.md`](ROUTEMAP.md) first.** It is the module index for this repo. Use its **Task → files** table to load **only** the files the current task needs. Do **not** scan `src/` blindly — it is ~10k lines across 66 files and will exhaust the context budget.

- Before any schema / sync / scoring / AI change, read the **Invariants** section of `ROUTEMAP.md`.
- When you add, rename, or remove a module — or change an invariant — update the matching one-line row in `ROUTEMAP.md` (and its Task→files table) as part of that change. Keep it to one line per module.

Stack: React + TS + Vite + Tailwind + Dexie, static PWA on GitHub Pages (no backend). Verify with `npm run build` (`tsc --noEmit && vite build`) and `npm test`. Deploy = `git push origin main`.
