# Handoff: Cloud sync (Supabase) live, first real run pending

**Goal**: Get the new Supabase cloud sync working end to end on the owner's phone (Android APK) and browser, with the GitHub snapshot kept as a daily backup.

## Status

**Done**
- Exercise library + body map + muscle heatmap (#12), AI meal estimate (#13), round 2 features (#14–#23) — all merged and deployed.
- Cloud sync on Supabase (#34, merged): row-level outbox + `push_rows` LWW upsert, email OTP / pasted-link sign-in, first-sync choice (merge / use cloud / overwrite cloud), daily keep-alive workflow, GitHub snapshot becomes a daily backup when signed in.
- Sign-in survives leaving Settings for an hour (#36, merged).
- Releases: `v1.1.0+110` and `v1.1.0+116` (latest, includes #36) on GitHub Releases.
- Owner did: created the Supabase project, ran `supabase/migrations/0001_rows.sql` (after dropping the first version), set the repo secrets `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` / `VITE_USDA_KEY`, redeployed the site, set up custom SMTP and a 6-digit-code email template (`{{ .Token }}`, no link).

**Not yet confirmed**
- A successful first sync: the `rows` table was still empty after the owner's first attempt (they tapped the link in the mail app, which signed in the browser, not the APK).

## Next steps
1. Ask the owner whether signing in **inside the APK** with the 6-digit code worked and whether `public.rows` now has rows (Supabase › Table Editor). If not, get the error text shown under Settings › Cloud sync.
2. Then sign in on the website (same code flow) and confirm it pulls the phone's data.
3. Remind the owner: Authentication › Sign In / Providers › turn off "Allow new users to sign up" once both devices are signed in; Site URL = `https://monniale.github.io/GymTracker/`.
4. Optional polish: the hint under the code box (`settings.cloud.codeHint`, en + it) still mentions pasting a link; shorten it to code-only now that the email has no link.

## Key files
- `src/lib/cloudSync.ts` — store (`gymtracker-cloud`), sign-in, `cloudSyncNow`, `applyCloudRows`, `cloudInitialSync`, `consumeAuthRedirect`
- `src/lib/supabaseApi.ts` — plain-fetch GoTrue/PostgREST client, `parseSignInLink`
- `src/db/outbox.ts` + the middleware in `src/db/db.ts` — row outbox (localStorage `gymtracker-cloud-outbox`)
- `src/lib/cloudFixups.ts` — award dedup, rank points, food FK remap after a pull
- `src/screens/settings/CloudSyncSection.tsx` — the UI
- `src/lib/sync.ts` `syncOnEvent` — routes launch/foreground/write to cloud vs GitHub
- `supabase/migrations/0001_rows.sql`, `.github/workflows/keepalive.yml`
- ROUTEMAP.md › "Cloud sync (Supabase)" and invariants 1, 3, 15

## Warnings
- Merging to `main` deploys the website. Android ships only via `scripts/android/release.sh --publish` (signs locally; key in `~/.android-keys/gymtracker/`). Never change appId/origin/key; never uninstall the app on the phone.
- `.env` holds the real Supabase URL/anon key and USDA key (gitignored). The URL must be bare `https://<ref>.supabase.co` — the dashboard shows it with `/rest/v1/`, which breaks every call.
- The `rows` table now may hold real data: schema changes go in a new `0002_….sql` with `alter table`, never drop.
- Writing GitHub secrets (`gh secret set`) is blocked for the agent; the owner runs those.
- Debug/emulator builds must not sign in to the real Supabase account (`scripts/android/smoke.sh` aborts if they do).
- Eight open Dependabot PRs (#26–#35) include major bumps (TypeScript 7, lucide 1.x, dexie-react-hooks 4): don't merge them blindly.
