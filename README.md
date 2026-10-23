<div align="center">

<img src="public/icons/icon-512.png" alt="GymTracker logo" width="112" />

# GymTracker

**Log your lifts, track your food, climb the ranks.**<br/>
A free, offline-first fitness app with an AI coach, for the web and Android.

<a href="https://monniale.github.io/GymTracker/"><img alt="Open the app" src="https://img.shields.io/badge/Open_the_app-F97316?style=for-the-badge&logo=googlechrome&logoColor=white" /></a>
&nbsp;
<a href="ANDROID.md"><img alt="Android app" src="https://img.shields.io/badge/Android_app-3DDC84?style=for-the-badge&logo=android&logoColor=white" /></a>

[![Deploy to GitHub Pages](https://github.com/monniale/GymTracker/actions/workflows/deploy.yml/badge.svg)](https://github.com/monniale/GymTracker/actions/workflows/deploy.yml)
[![CI](https://github.com/monniale/GymTracker/actions/workflows/ci.yml/badge.svg)](https://github.com/monniale/GymTracker/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-F97316?style=flat-square)](LICENSE)
![React](https://img.shields.io/badge/React_18-20232A?style=flat-square&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite_5-646CFF?style=flat-square&logo=vite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)
![Capacitor](https://img.shields.io/badge/Capacitor_8-119EFF?style=flat-square&logo=capacitor&logoColor=white)
![PWA](https://img.shields.io/badge/PWA-offline_ready-5A0FC8?style=flat-square&logo=pwa&logoColor=white)
![No backend](https://img.shields.io/badge/backend-none-0B0F14?style=flat-square)

[Features](#-features) · [Screenshots](#-screenshots) · [Get started](#-get-started) · [Your data](#-where-your-data-lives) · [Develop](#-develop) · [Contribute](#-contributing)

</div>

---

## ✨ Why GymTracker?

- ⚡ **Fast at the gym**: your sets are pre-filled from last time. Tap ✓ and the rest timer starts on its own.
- 📴 **Works offline**: everything is stored on your phone. No account, no sign-up, no server.
- 🏆 **Makes training a game**: ranks from Copper to Champion, 12-week seasons, streaks, quests and achievements.
- 🤖 **Has an AI coach**: bring your own free Gemini key and get a written verdict on every workout and every day of eating.
- 🔄 **Syncs on your terms**: optional sync to *your own* private GitHub repo. No one else's cloud is involved.

## 📸 Screenshots

<div align="center">
<table>
  <tr>
    <td align="center"><img src="docs/screenshots/workout.webp" width="200" alt="Workout templates" /><br/><sub><b>Your workouts</b></sub></td>
    <td align="center"><img src="docs/screenshots/session.webp" width="200" alt="Live session with rest timer" /><br/><sub><b>Live session + rest timer</b></sub></td>
    <td align="center"><img src="docs/screenshots/coach-note.webp" width="200" alt="Session summary with the AI coach's note" /><br/><sub><b>AI coach's verdict</b></sub></td>
    <td align="center"><img src="docs/screenshots/diet.webp" width="200" alt="Diet day with macro rings" /><br/><sub><b>Diet & macros</b></sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/progress.webp" width="200" alt="Progress charts" /><br/><sub><b>Progress charts</b></sub></td>
    <td align="center"><img src="docs/screenshots/rank.webp" width="200" alt="Rank and season" /><br/><sub><b>Rank & season</b></sub></td>
    <td align="center"><img src="docs/screenshots/bodyweight.webp" width="200" alt="Bodyweight history" /><br/><sub><b>Bodyweight history</b></sub></td>
    <td align="center"><img src="docs/screenshots/coach-history.webp" width="200" alt="Coach history" /><br/><sub><b>Coach history</b></sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/heatmap.webp" width="200" alt="Training heatmap of the last 26 weeks" /><br/><sub><b>Training heatmap</b></sub></td>
    <td align="center"><img src="docs/screenshots/meal-plan.webp" width="200" alt="Tomorrow's meal plan" /><br/><sub><b>Meal plan</b></sub></td>
    <td align="center"><img src="docs/screenshots/week-review.webp" width="200" alt="Weekly AI coach review" /><br/><sub><b>Week review</b></sub></td>
    <td align="center"><img src="docs/screenshots/italian.webp" width="200" alt="The rank screen in Italian" /><br/><sub><b>In Italian</b></sub></td>
  </tr>
</table>
<sub>Screenshots use made-up demo data.</sub>
</div>

## 🚀 Features

### 🏋️ Workouts
- **Templates** with sets, reps, rest times and supersets.
- **One-tap logging**: every set is pre-filled from your last session.
- **Progression suggestions**: the app tells you when to add weight, using double progression.
- **Warm-up ramps** and a **plate calculator** for barbell lifts.
- Equipment variants (barbell, dumbbell, machine, cable…), per-exercise notes, and exercises added mid-session.
- **History calendar**: open any past workout and fix a typo. Its score is recalculated.
- **Cardio sets** with time and distance. They count for your streak and weekly target, but not for rank points.
- A **shareable workout card**: a PNG of the session (points, rank, top lifts and PRs) for the share sheet.
- **Import your history from Strong or Hevy** (CSV export), with a preview before anything is saved.
- An **exercise library** of 1,300+ exercises: search, filter by muscle group or equipment, or tap a muscle on a front/back **body map**. Each exercise has its target and secondary muscles and step-by-step instructions (English or Italian). Add one to a workout in one tap. Animations are optional (Settings), loaded from GitHub.

### ⏱️ Rest timer
- Starts by itself when you log a set: a short rest after warm-ups, and it waits for the last exercise of a superset.
- Buttons for −15 s, +15 s and skip. It keeps the right time if you leave the app and come back.
- On Android it runs as a **live countdown notification** that rings even if the app is closed (details below).

### 🥗 Nutrition
- A daily log by meal, with **separate macro targets for training and rest days**. The day type is picked automatically.
- **Barcode scanner** plus food search across **Open Food Facts** and **USDA FoodData Central**.
- Custom foods, editable macros (your corrections always win), a recipe builder, saved meals and copy-yesterday.
- A water tracker and a weekly nutrition report.
- **Plan tomorrow's meals**: planned foods show next to what you ate, and one tap logs them when you eat.

### 📈 Progress
- Estimated 1RM and volume charts for every exercise, plus **rep-range PRs** (your best 1, 3, 5, 8, 10 and 12 RM, all-time and this season).
- A **training heatmap** of the last 26 weeks, with your longest run of trained weeks.
- **Weekly sets per muscle**, compared with the evidence-based 10–20 hard-sets range.
- A **PR wall** with strength-standard levels from Novice to Elite.
- **Bodyweight history**:
  - a trend chart with a 7-day average;
  - your kg-per-week rate and your lowest and highest weights;
  - a month-by-month timeline with milestones such as *"−3 kg since start"*.

### 🌍 English and Italian
- The whole app is available in **English and Italian**: screens, dates, reminders, the rest timer and the AI coach's notes. It follows your phone's language, and you can switch in Settings.

### 🏆 Rank & seasons
- Tiers from **Copper III to Champion**, driven by an evidence-based score:
  - volume relative to bodyweight, weighted by intensity (% of your estimated 1RM);
  - **PR bonuses**, a **weekly streak multiplier**, and caps on junk volume.
- **12-week seasons** with a recap and a "ghost race" against your previous season.
- Weekly quests, achievements and PR confetti 🎉

### 🤖 AI coach (Gemini, optional)
- A **coach's note after every workout** and a **diet report** for any day.
- **Suggested opening weights** before a session, ideas to **complete your macros**, and **food swaps**.
- **Fallback to other models**: if your model runs out of free quota or is down, the request is retried on your key's other free Flash models.
- A **weekly review**: the coach looks back at the whole week (training, food, bodyweight) and sets 2–3 goals for the next one.
- **Coach history**: every verdict is saved and synced, including the earlier one when you regenerate a note.

> [!NOTE]
> The AI coach uses **your own free Gemini API key** from [Google AI Studio](https://aistudio.google.com/apikey). The key stays on your device and is never synced. Only the workout and diet numbers needed for a note are sent to Google.

### 📱 Android app extras
The same app, packaged for Android with [Capacitor](https://capacitorjs.com). It is tuned for a Samsung Galaxy S25 on One UI 8.5 / Android 16 and runs on Android 7 and later.

- ⏲️ **Live rest countdown**: a countdown in the notification shade (Live Updates on Android 16), with **Skip** and **+15 s** buttons. It rings even if the app was closed.
- 🔔 **Smart reminders**: training days, meals, water, rank decay and streak warnings, a weekly recap, and weigh-ins. Each one can be switched on or off.
- 🏠 **Home-screen widget**: rank, points, streak, this week's workouts and the next one. Tap it to open the app.
- 📷 **Native barcode scanner**: Google ML Kit, with the camera scanner as a fallback.
- 🤏 **Feels native**: haptics, back-button navigation, the screen stays on during a workout, and backups export through the share sheet.

See **[ANDROID.md](ANDROID.md)** for how to build and install it.

## 🏁 Get started

### 🌐 Use it in your browser
Open **https://monniale.github.io/GymTracker/**. That's it. It works offline after the first visit.

### 📲 Install it like an app

<details>
<summary><b>iPhone (Safari)</b></summary>

1. Open the link above in **Safari**.
2. Tap **Share → Add to Home Screen**.
3. Launch it from the icon. It opens full-screen and works offline.

On iOS, sounds only play while the app is on screen, which is why it keeps the screen awake during a workout. Export a backup now and then: deleting the icon also deletes its data.
</details>

<details>
<summary><b>Android (Chrome)</b></summary>

Open the link in **Chrome**, then **⋮ → Install app**. For the full Android app with notifications, see [ANDROID.md](ANDROID.md).
</details>

### 🤖 Turn on the AI coach (optional)
1. Create a free API key at [Google AI Studio](https://aistudio.google.com/apikey).
2. In the app, go to **Settings → AI Coach** and paste it.
3. Finish a workout and your coach's note appears.

### 🔄 Sync between devices (optional)
**Settings → Sync**: connect a **private GitHub repo** with a fine-grained token, and your data syncs between your phone and your browser.

## 🔒 Where your data lives

```mermaid
flowchart TB
    subgraph phone["📱 Your device"]
        direction LR
        app["💪 GymTracker"] <--> db[("Local database<br/>(IndexedDB)")]
    end
    phone <-.->|optional sync| gh["🐙 Your private<br/>GitHub repo"]
    phone -.->|optional · your key| ai["🤖 Google<br/>Gemini"]
    phone -.->|food search| food["🥫 Open Food Facts<br/>& USDA"]
```

- **The main copy is always on your device.** The app has no server of its own and no account.
- **GitHub Sync** pushes a snapshot of your data to a repo *you* own. It's also your backup.
- **Your keys never leave the device**: the Gemini key and the GitHub token are never synced or exported.
- You can also **export or import a JSON backup** at any time from Settings.

> [!TIP]
> Moving to a new phone? Connect GitHub Sync there and choose **"Use cloud data"**, or import your JSON backup *before* logging anything new.

## 🛠️ Develop

**Tech stack:** React 18 · TypeScript · Vite 5 · Tailwind CSS 3 · Dexie (IndexedDB) · Zustand · Vitest · vite-plugin-pwa · zxing-wasm · Capacitor 8

```bash
npm install
npm run dev        # dev server with hot reload
npm test           # unit tests (Vitest)
npm run build      # type-check + production build → dist/
npm run preview    # serve the production build locally
```

The web app needs **Node 18+**. The Android build needs **Node 22+** and **JDK 21**; see [ANDROID.md](ANDROID.md).

<details>
<summary><b>📂 Project layout</b></summary>

```
src/
├── screens/      # workout · diet · progress · rank · settings
├── components/   # shared UI: charts, sheets, steppers, AI cards…
├── lib/          # scoring, sync, Gemini client, nutrition, reminders…
├── db/           # Dexie schema, seed data, backup / import
└── native/       # Android-only code (never shipped in the web build)
android/          # Capacitor Android project (Java plugins)
scripts/          # PWA build checks, Android build / release / smoke tests
```

New here? **[ROUTEMAP.md](ROUTEMAP.md)** maps every module and the rules the code relies on, such as the sync allow-list and the native/web split.
</details>

<details>
<summary><b>🚢 Deploy your own copy (GitHub Pages)</b></summary>

1. Fork this repo, or push it to a repo named **GymTracker**. The name must match `base` in `vite.config.ts`; change it there if you use another name.
2. In the repo: **Settings → Pages → Source: GitHub Actions**.
3. Push to `main`. The included workflow (`.github/workflows/deploy.yml`) builds and deploys automatically.

Without CI: run `npm run deploy` (uses the `gh-pages` branch), or build with `BASE_PATH=/ npm run build` and drag `dist/` onto [Netlify Drop](https://app.netlify.com/drop).
</details>

## 🤝 Contributing

Bug reports, translations and pull requests are welcome.

- Read **[CONTRIBUTING.md](CONTRIBUTING.md)** first: setup, the rules the code relies on, and the PR checklist.
- Want GymTracker in your language? **[docs/TRANSLATING.md](docs/TRANSLATING.md)** explains how to add one.
- Found a bug? Open an issue with the form. It asks for the build stamp shown at the bottom of Settings.
- Everyone taking part follows the **[Code of Conduct](CODE_OF_CONDUCT.md)**.
- The plan for the next features is in **[docs/FEATURE_PLAN.md](docs/FEATURE_PLAN.md)**.

## 🙏 Credits

- Exercise data (names, muscles, instructions) from **[exercises-dataset](https://github.com/hasaneyldrm/exercises-dataset)** by Hasan Emir Yıldırım (MIT; the license text ships in `public/exercise-library.json`). The optional animations are © **[Gym visual](https://gymvisual.com/)**; they are not part of this repo and load from the dataset's repo only when you turn them on.
- Food data from **[Open Food Facts](https://world.openfoodfacts.org)** and **[USDA FoodData Central](https://fdc.nal.usda.gov)**
- AI by **[Google Gemini](https://ai.google.dev)**
- Icons by **[Lucide](https://lucide.dev)** · barcode reading by **[zxing-wasm](https://github.com/Sec-ant/zxing-wasm)** and **Google ML Kit**
- The licenses of every bundled library are listed in **[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)**.

## 📄 License

GymTracker is free software under the **[MIT License](LICENSE)**. Copyright (c) 2025-2026 monniale.

<div align="center">
<br/>
<sub>Built with 🧡 for lifting heavy things and eating enough protein.</sub>
</div>
