# Handoff: open the nine stacked PRs

**Goal**: Get the nine finished feature branches (`feat/01-training-heatmap` … `feat/09-italian`) reviewed as stacked PRs and merged into `main` in order.

**Done**: All nine features from `docs/FEATURE_PLAN.md` built, tested (468 tests, 360/320 px layouts, emulator smoke 46/46 + Italian 18/18), code-reviewed with fixes merged up the stack, pushed to `origin`, README screenshots added, PR descriptions drafted in `~/.claude/projects/-mnt-hdd-GymTracker/pr-drafts/` (`01.md`…`09.md`, `index.txt`, `create-prs.sh`)

**Next**: Once the owner has run `sudo apt install gh && gh auth login`, run `~/.claude/projects/-mnt-hdd-GymTracker/pr-drafts/create-prs.sh` (each PR targets the previous branch; branch 1 targets `main`).

**Watch out**: Merging into `main` deploys the website, so merge in order 1 → 9 only when the owner asks; afterwards a signed APK (`scripts/android/release.sh`) is needed because features 3, 8 and 9 change native code.
