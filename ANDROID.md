# GymTracker for Android — runbook

The Android app is the same React codebase wrapped by **Capacitor 8** (`android/` + `src/native/`), sideloaded on a Samsung Galaxy S25 (One UI 8.5 / Android 16). The GitHub Pages PWA is unchanged and keeps deploying from `main`. Module map and rules: [`ROUTEMAP.md`](ROUTEMAP.md) (section *Native (Android / Capacitor)*, invariants 14–18).

> **Permanent identity:** appId `io.github.monniale.gymtracker`, WebView origin `https://localhost` (no `server` block in `capacitor.config.ts`), and the release key in `~/.android-keys/gymtracker/`. Changing any of them means a new app with empty storage: every workout on the phone is lost.

## 1. Toolchain (one time)

- **Node ≥ 22** (`@capacitor/cli` 8.5.2). The PWA alone still builds on Node 18+.
- **JDK 21 with `javac`**: Temurin 21 at `~/opt/jdk-21`. The distro `openjdk-21-jre` has no compiler.
- **Android SDK** at `~/Android/Sdk`: `platform-tools`, `platforms;android-36`, `build-tools;36.0.0`, plus `emulator` and `system-images;android-36;google_apis;x86_64` for the smoke test. AGP may fetch build-tools 35.0.0 on the first build; that is expected.
- `. scripts/android/env.sh` sets `ANDROID_HOME`, picks a JDK with `javac` and puts `adb`, `apksigner`, `aapt2` and `emulator` on `PATH`.
- **Samsung over USB:** udev rule `SUBSYSTEM=="usb", ATTR{idVendor}=="04e8", MODE="0660", GROUP="plugdev", TAG+="uaccess"` in `/etc/udev/rules.d/51-android.rules`.

## 2. Build

| Command | Output |
|---|---|
| `npm run build` | `dist/`: the Pages PWA (base `/GymTracker/`, service worker). Check it with `node scripts/check-pwa-dist.mjs`. |
| `npm run build:android` | `dist-android/`: base `./`, no service worker or manifest. Also type-checks `vite.config.ts` and `capacitor.config.ts`. |
| `npm run cap:sync` | the above, then `cap sync android` (copies into `android/app/src/main/assets/public`) |
| `npm run android:debug` | `android/app/build/outputs/apk/debug/gymtracker-<ver>-<code>-debug.apk`: appId `…gymtracker.debug`, launcher name "GymTracker (debug)", debug key, WebView inspectable |
| `scripts/android/release.sh` | `android/app/build/outputs/apk/release/gymtracker-<ver>-<code>-release.apk`: the **only** way to build for the phone |

- **versionName** = `package.json` `version`. **versionCode** = `git rev-list --count HEAD`; override it with `GT_VERSION_CODE=N scripts/android/release.sh` (Gradle: `-PgtVersionCode=N`).
- `release.sh` refuses to run when:
  - a tracked file is uncommitted;
  - the versionCode is lower than the last release it built (`~/.android-keys/gymtracker/last-version-code`);
  - the synced config has a live-reload `server` block or an inspectable WebView.

  It then runs `npm test`, builds, signs (v2 + v3 + v4 `.idsig`) and verifies the result with `apksigner`, `zipalign -P 16` and `aapt2`. `scripts/android/release.sh --verify <apk> [code]` re-runs only the checks.
- Never use `npx cap build android`: it produces v1-only signatures, which targetSdk 36 rejects.
- Live reload (`npx cap run android -l --host <ip>`, with `vite --mode android`) is for debug builds only, because it changes the origin. Run `npm run cap:sync` afterwards: a release build fails on a leftover `server` block.
- A one-off inspectable release: `CAP_WEBVIEW_DEBUG=1 npm run cap:sync`, then `cd android && ./gradlew assembleRelease -PallowInspectableRelease`. It exposes the PAT and Gemini key over USB, so do not keep it installed.
- Launcher icons: `scripts/android/icons.sh` (from `assets/logo.png`).

## 3. Signing key — back it up now

- Files: `~/.android-keys/gymtracker/gymtracker-release.jks` and `keystore.properties` (path, alias and passwords). Gradle reads the properties from `$KEYSTORE_PROPERTIES` or that default path. Without them, debug builds still work and release builds refuse to run.
- **Keep an offline copy of the `.jks` and the password in a password manager.** Without the same key, an update cannot install over the existing app. The only way out is to uninstall, which **deletes all data on the phone**.
- Never commit, copy into the repo or print these files (`.gitignore` blocks `*.jks`, `*.keystore` and `keystore.properties`).

## 4. Install on the S25

1. **Phone setup** (once, and again before each update session if One UI re-enables Auto Blocker):
   - Settings › Security and privacy › **Auto Blocker → Off**. It blocks sideloading and USB commands.
   - Settings › About phone › Software information › tap **Build number** 7×, then Developer options › **USB debugging** on.
2. `adb devices` (accept the RSA prompt on the phone), then `adb install -r android/app/build/outputs/apk/release/gymtracker-<ver>-<code>-release.apk`.
   - Alternative: copy the APK to *Download* over USB, open it in My Files and allow "Install unknown apps" for My Files.
3. **Play Protect** may show "App scan recommended" or "Send app for security check": choose scan, then install. The app declares no SMS, accessibility or notification-listener permissions.

## 5. Move your data over — before you log anything

The app starts empty: its storage (origin `https://localhost`) is separate from the PWA's (`monniale.github.io`).

1. **In the PWA, on the old phone or in Chrome:**
   1. Finish or discard any running workout. An open session would arrive orphaned, with no Resume banner.
   2. Settings › Sync › **Sync now**.
   3. Settings › Data › **Export** a JSON backup as a fallback.
2. **In the app, first thing** (the Workout tab shows a *Restore your data* card until you choose):
   - **Connect GitHub Sync** (recommended). Use the same repo, with the PAT from your password manager or a new fine-grained token for the phone (it can be revoked on its own). If Sync asks how to combine, choose **"Use cloud data (replace this device)"**. If you already logged something on the phone, "Merge both" keeps it: the untouched defaults (settings, exercise catalog, rank) carry no edit time and never win over the cloud copy, but anything you changed on the phone does.
   - or **Import a backup** (Settings › Data › Import): the JSON from step 1.
3. Re-enter the **Gemini key** and pick the model. Both are device-local and never synced. Coach's notes and diet reports sync with your data (Progress › Coach history); AI weight and macro suggestions regenerate on demand, which uses quota.
4. **Settings › Notifications** (prefs start at their defaults):
   1. Allow notifications.
   2. Battery → Unrestricted.
   3. Add GymTracker to **Never sleeping apps**, then tick it off in the app.
   4. Optional: Developer options › Live notifications for all apps (status-bar countdown).
   5. Test with the phone locked: Settings › Rest timer › **Test rest (15 s)**, and **Send test reminder (15 s)**.
5. **Retire the PWA:** long-press its home-screen icon › Uninstall. Its data stays in Chrome as a cold fallback. If you keep it, disconnect Sync there so two copies do not diverge.

## 6. Updates

Commit → `scripts/android/release.sh` → `adb install -r <apk>`. This needs the same key and a versionCode ≥ the installed one. **Never uninstall** the app (it deletes all data).

## 7. Emulator and smoke test

- **Debug builds must never connect to the real sync repo (`gymtracker-data`).** A debug build is a separate app, but it pushes test data to whatever repo it is connected to. Use a throwaway repo with its own PAT. `smoke.sh` aborts when the debug app is connected to `gymtracker-data`.
- S25-like AVD (1080 px wide at 480 dpi = 360 CSS px), kept in the gitignored `.android-test/`:
  ```sh
  . scripts/android/env.sh
  export ANDROID_USER_HOME=$PWD/.android-test ANDROID_AVD_HOME=$PWD/.android-test/avd
  echo no | avdmanager create avd -n s25ish -k "system-images;android-36;google_apis;x86_64" -d pixel_9 --force
  sed -i 's/^hw.lcd.height=.*/hw.lcd.height=2340/; s/^hw.lcd.density=.*/hw.lcd.density=480/' $ANDROID_AVD_HOME/s25ish.avd/config.ini
  emulator -avd s25ish -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -no-snapshot -port 5584 &
  export ANDROID_SERIAL=emulator-5584; adb wait-for-device
  until [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = 1 ]; do sleep 2; done
  ```
- `npm run android:debug && scripts/android/smoke.sh` runs checks 1–10 of the spec automatically. Use `--only "7 8"` for a subset; logs go to `.android-test/smoke-*/`. The checks:
  1. cold launch and no crash;
  2. origin, platform and no service worker;
  3. layout at 360 and 320 px, plus font scale (sizes unchanged, page not reloaded);
  4. insets;
  5. channels;
  6. exact alarms without appops;
  7. rest timer, foreground and background;
  8. process death;
  9. reminders planned, fired and tap-routed;
  10. back button.

  The run reinstalls the debug APK and clears its data (`--keep-data` to keep them). It never needs the release key.
- `node scripts/android/cdp-eval.mjs '<js>'` evaluates in the debug WebView after `adb forward tcp:9333 localabstract:webview_devtools_remote_$(adb shell pidof io.github.monniale.gymtracker.debug)`.
- **Semi-manual checks:**
  - **11. Shade actions:** +15 s and Skip from the rest notification move or clear the in-app timer, with the app alive and after `kill`.
  - **12. Keep-awake:** while a session is open on `/workout/session` (or a rest is running), `adb shell dumpsys window | grep KEEP_SCREEN_ON` matches, and after Finish it does not. Sample with DevTools *detached*: an attached debugger keeps the screen on by itself.
  - **13. Export:** opens the share sheet; `adb shell run-as <pkg> ls cache/exports` lists the backup.
  - **14. Import:** a backup pushed under `.android-test/` imports, and reminders re-plan.
  - **15. Update and reboot:** `adb install -r` of a newer build keeps the data and re-arms reminders; after `adb reboot` and an unlock, future reminders are back in `dumpsys alarm`.
  - **16. Doze:** `dumpsys battery unplug; dumpsys deviceidle force-idle`, and a reminder 2 min out still fires.
  - **17. Home-screen widget:** Settings › Home-screen widget › *Add to home screen* (or the launcher's widget picker) places it. It shows rank, points, streak, this week's workouts and the next template; `adb shell dumpsys appwidget` lists it. After a workout (or any change) the numbers update; a tap opens the Workout tab. *Share card* on a workout summary opens the share sheet with a PNG (`run-as <pkg> ls cache/exports`).
  - **On the S25:** the ML Kit scanner and its module download, the Live Update chip, edge-to-edge insets on the current WebView (`dumpsys webviewupdate`), and the rest alert in earbuds and on vibrate.

## 8. Known limitations

- **Reboot before the first unlock:** after a restart (including One UI's automatic night-time restart), reminders are re-armed only after the first unlock. One-shots whose time passed meanwhile are dropped, not shown late. Opening the app re-plans the rest.
- **Samsung sleeping apps:** One UI puts apps unused for about 3 days to "sleep" (alarms restricted), and after about 16 days to "deep sleep" (no notifications). Add GymTracker to *Never sleeping apps*. Reminders are planned only a few days ahead: workouts, meals, rank and weigh-in for 7 days, water for 2, plus a single recap. On the last planned day an "Open GymTracker to keep your reminders coming" notice appears. "Reminders scheduled through …" in Settings names the date of the latest planned reminder, which can be the weekly recap a week out.
- **Nothing runs while the app is closed:** sync, the daily rank checks and re-planning only happen when the app is opened or resumed. Only already-scheduled alarms fire, plus the rest-timer actions. Notification taps only navigate; they never write data.
- **Rest timer:**
  - The "Rest over" alert only fires when notifications are allowed. While the app is on screen, the in-app beep and a vibration mark the end instead (no heads-up).
  - Re-opening the app re-posts a countdown you swiped away, because the end alarm is re-armed on resume.
  - Android 16 bundles GymTracker's notifications in the shade when a reminder is still unread: the countdown then collapses into the bundle (expand it for the time, Skip and +15 s). "Rest over" and the reminders still sound, because each sits in its own app group (`gt_rest`, `gt_reminders`).
  - The Live Update status-bar chip and the One UI countdown rendering are not verified on One UI 8.5.
- **Exact timing** relies on `USE_EXACT_ALARM`. If Settings ever shows "Exact timing is off", tap Fix: alarms are then inexact and may be late.
- **Text size:** the WebView text zoom is pinned to 100 %, so the One UI font size does not apply inside the app. This keeps the 360/320 px layouts intact. Changing the font size or Bold font does not reload the app (an open sheet or a typed value survives).
- **Home-screen widget:** it shows what the app last pushed. It refreshes whenever GymTracker runs (launch, resume, any change, midnight while open), not on its own: after days without opening the app, the streak and "this week" can be out of date until the next launch.
- **Barcode scanner:** ML Kit downloads its scanner module through Play services on first use. If that fails, the camera fallback (zxing) and manual entry remain.
- **Storage:** `navigator.storage.persist()` is best effort, and Android may still clear WebView storage under extreme pressure. Keep GitHub Sync connected, or export regularly. Uninstalling deletes everything.
- **Backups:** Android cloud backup is off (`allowBackup=false`), which keeps the PAT and the Gemini key out of Google Drive. GitHub Sync and JSON export are the backups.
