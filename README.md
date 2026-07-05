# GymTracker

Personal workout + nutrition PWA, built for one user. Installs on iPhone from Safari
("Add to Home Screen"), runs fully offline, and keeps **all data on the device**
(IndexedDB) — the only network call is the Open Food Facts food search.

## Features

- **Workouts**: templates (exercises × sets × reps × rest), one-tap set logging
  pre-filled from your last session, mid-session exercise additions, warm-up flag, history.
- **Rest timer**: auto-starts when a set is logged, ±15s, optional beep (Web Audio),
  survives backgrounding/relaunch (timestamp-based), screen wake lock during sessions.
- **Diet**: daily log by meal, Open Food Facts search (cached locally for offline reuse),
  custom foods, editable macro data (your overrides always win), saved meals,
  copy-yesterday, calorie/macro target rings.
- **Ranking**: Rainbow-Six-style tiers (Copper III → Champion) driven by an
  evidence-based score: volume load ÷ bodyweight, weighted by relative intensity
  (% of estimated 1RM, Epley), PR bonuses for progressive overload, weekly-consistency
  streak multiplier, junk-volume caps, idle decay, 12-week seasons.
- **Backup**: JSON export (iOS share sheet) / import in Settings.

## Development

```bash
npm install
npm run dev        # dev server
npm test           # scoring engine unit tests
npm run build      # typecheck + production build (dist/)
npm run preview    # serve the production build locally
```

Node 18+ is fine (Vite 5 / Tailwind 3.4 are pinned for that).

## Deploy (GitHub Pages)

The app is preconfigured for `https://<user>.github.io/GymTracker/`.

1. Create an empty GitHub repo named **GymTracker** (the name must match the
   `base` path in `vite.config.ts` — change it there if you pick another name).
2. Push:
   ```bash
   git remote add origin git@github.com:<user>/GymTracker.git
   git push -u origin main
   ```
3. In the repo: **Settings → Pages → Source: GitHub Actions**.
4. The included workflow (`.github/workflows/deploy.yml`) builds and deploys on
   every push to `main`.

Alternative without CI: `npm run deploy` (uses the `gh-pages` branch; set Pages
source to that branch), or drag `dist/` onto https://app.netlify.com/drop
(build with `BASE_PATH=/ npm run build` first).

## Install on iPhone

1. Open the deployed URL in **Safari**.
2. Share → **Add to Home Screen**.
3. Launch from the icon: standalone, offline-capable, data stays on the phone.

### iOS PWA limits (by design of iOS)

- The timer beep only plays while the app is on screen — the wake lock keeps the
  screen on during a session precisely for this.
- No vibration API, no push-free local notifications on iOS.
- Export a backup now and then: if you delete the app icon or wipe Safari
  website data, IndexedDB goes with it.
