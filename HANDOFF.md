# Handoff: Round 2, onboarding (last feature) next

**Goal**: Build round 2 of docs/FEATURE_PLAN.md as stacked PRs, one per feature, merged in order by the owner.

**Done** (all open, each stacked on the previous one): #14 OSS hygiene · #15 Releases + update check · #16 demo data · #17 TDEE + goal (+ review fixes 1-4) · #18 AI providers · #19 ActiveSession split · #20 bodyweight load · #21 RPE/set types · #22 history/schedule/swap (+ review fixes) · #23 programs, presets, share links (top branch `feat/21-programs`). PR #13 is merged and deployed.

**Next**:
1. Feature 9 onboarding: `git checkout feat/21-programs && git checkout -b feat/22-onboarding`, then follow the "Feature 9 — Onboarding wizard" section of docs/FEATURE_PLAN.md. Its start step offers a program (`installPreset`), a template, CSV import, demo data (web only) and the AI step (`AiConnectForm` with the provider switch from #18).
2. In the same PR, fix the dev-only `React.StrictMode` double `ensureSeeded` BulkError at launch (src/App.tsx effect; make ensureSeeded single-flight).
3. Then the final checkpoint review of #23 + onboarding (5 lenses, 2 skeptics per finding, as for the earlier checkpoints).

**Owner action**: merge #14 → #23 in order (each merge deploys the website). Then `git checkout main && git pull && scripts/android/release.sh --publish` and install with `adb install -r`. Never uninstall the app.

**Watch out**:
- Never release from a feature branch or with a dirty tree.
- An older APK cannot read bodyweight-load data (ROUTEMAP invariant 6), so update the APK together with the website.
- Android Java needs `. scripts/android/env.sh` (JDK 21) before Gradle.
- Browser E2E scripts lived in the previous session's scratchpad and are gone; rebuild them with puppeteer-core in the new scratchpad, never in package.json.
- Small known issues, not yet fixed: Italian plate line shows "2.5" instead of "2,5"; some % copy outside scheme labels uses a normal space.
