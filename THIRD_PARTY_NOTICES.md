# Third-party notices

GymTracker is released under the MIT License (see [`LICENSE`](LICENSE)).
It is built on open-source software and uses some external data and services.
This file lists them for both the web app (PWA) and the Android APK.

Versions are the ones resolved in `package-lock.json` when this file was written.
Each package's full license text is in its own repository and in its folder under `node_modules/`.
Android libraries ship their license in their Maven POM.

## 1. Bundled in the web app and the APK

These packages are shipped to users.
Their JavaScript goes into the web bundle that runs in the browser and inside the Android WebView.
On Android, the Capacitor packages also ship native code that is compiled into the APK.
`@capacitor/core` is in the web bundle too, because shared code uses it to detect the platform.
The packages marked "Android only" are left out of the GitHub Pages build at compile time and ship only in the APK.
`scripts/check-pwa-dist.mjs` checks this after `npm run build`.

| Package | Version | License | How it is used |
| --- | --- | --- | --- |
| [react](https://github.com/facebook/react) | 18.3.1 | MIT | UI library |
| [react-dom](https://github.com/facebook/react) | 18.3.1 | MIT | Renders React in the browser |
| [react-router-dom](https://github.com/remix-run/react-router) | 6.30.4 | MIT | Screen routing (`HashRouter`) |
| [zustand](https://github.com/pmndrs/zustand) | 4.5.7 | MIT | UI and preference state |
| [dexie](https://github.com/dexie/Dexie.js) | 4.4.4 | Apache-2.0 | IndexedDB database layer |
| [dexie-react-hooks](https://github.com/dexie/Dexie.js) | 1.1.7 | Apache-2.0 | Live database queries in React |
| [lucide-react](https://github.com/lucide-icons/lucide) | 0.454.0 | ISC (parts MIT, from Feather) | Icons |
| [barcode-detector](https://github.com/Sec-ant/barcode-detector) | 3.2.0 | MIT | `BarcodeDetector` ponyfill for the camera scanner |
| [zxing-wasm](https://github.com/Sec-ant/zxing-wasm) | 3.1.0 | MIT, with Apache-2.0 parts | WebAssembly barcode reader behind the ponyfill (see the note below) |
| [@anthropic-ai/sdk](https://github.com/anthropics/anthropic-sdk-typescript) | 1.1.0 | Apache-2.0 (MIT before 1.0.0) | Claude API client, loaded only when the user picks Claude as the AI provider (its own chunk, not precached) |
| [@opentelemetry/api](https://github.com/open-telemetry/opentelemetry-js) | 1.10.0 | Apache-2.0 | Dependency of `@anthropic-ai/sdk`, in the same lazily loaded chunk |
| [@fontsource/barlow](https://github.com/fontsource/font-files) | 5.2.8 | OFL-1.1 | Barlow font files, self-hosted |
| [@fontsource/barlow-condensed](https://github.com/fontsource/font-files) | 5.2.8 | OFL-1.1 | Barlow Condensed font files, self-hosted |
| [@capacitor/core](https://github.com/ionic-team/capacitor) | 8.5.2 | MIT | Platform detection (in the web bundle); native bridge on Android |
| [@capacitor/android](https://github.com/ionic-team/capacitor) | 8.5.2 | MIT | Native Capacitor Android runtime, compiled into the APK (Android only) |
| [@capacitor/app](https://github.com/ionic-team/capacitor-plugins) | 8.1.2 | MIT | Back button and app state (Android only) |
| [@capacitor/filesystem](https://github.com/ionic-team/capacitor-filesystem) | 8.1.4 | MIT | Backup files (Android only) |
| [@capacitor/haptics](https://github.com/ionic-team/capacitor-haptics) | 8.0.2 | MIT | Vibration feedback (Android only) |
| [@capacitor/local-notifications](https://github.com/ionic-team/capacitor-local-notifications) | 8.3.1 | MIT | Reminders and rest timer alerts (Android only) |
| [@capacitor/share](https://github.com/ionic-team/capacitor-plugins) | 8.0.3 | MIT | Share sheet (Android only) |
| [@capacitor/splash-screen](https://github.com/ionic-team/capacitor-plugins) | 8.0.2 | MIT | Splash screen (Android only) |
| [@capacitor-community/keep-awake](https://github.com/capacitor-community/keep-awake) | 8.0.1 | MIT | Keeps the screen on during a workout (Android only) |
| [@capacitor-mlkit/barcode-scanning](https://github.com/capawesome-team/capacitor-mlkit) | 8.2.1 | Apache-2.0 | Native barcode scanner plugin (Android only; see section 3) |

**zxing-wasm and zxing-cpp.**
zxing-wasm's own code is MIT.
Its WebAssembly binary is compiled from [zxing-cpp](https://github.com/zxing-cpp/zxing-cpp), which is Apache-2.0.
The glue file `src/cpp/ZXingWasm.cpp` in zxing-wasm is also Apache-2.0.
The app bundles only the reader build (`zxing-wasm/reader/zxing_reader.wasm`, imported in `src/lib/scanner.ts`).
The writer build, which adds [zint](https://sourceforge.net/projects/zint/) (BSD-3-Clause), is not bundled.
See the "Licenses" section of `node_modules/zxing-wasm/README.md`.

**Dexie** ships a `NOTICE` file (Copyright 2014-2017 David Fahlander).
It is in `node_modules/dexie/NOTICE`.

**Fonts.** Barlow and Barlow Condensed are Copyright 2017 The Barlow Project Authors (https://github.com/jpt/barlow).
They are licensed under the SIL Open Font License 1.1.
The font files are served from this app, not from a font CDN.

**Service worker (web only).**
The PWA service worker is generated at build time by `vite-plugin-pwa`.
It contains [Workbox](https://github.com/GoogleChrome/workbox) 7.x runtime code (MIT).
The Android build turns the service worker off.

## 2. Build-time only

These devDependencies build, type-check or test the app.
They are not shipped in the web bundle or the APK.

| Package | Version | License | How it is used |
| --- | --- | --- | --- |
| [@capacitor/cli](https://github.com/ionic-team/capacitor) | 8.5.2 | MIT | `cap sync` / `cap open` for the Android project |
| [@types/node](https://github.com/DefinitelyTyped/DefinitelyTyped) | 20.19.43 | MIT | Type definitions |
| [@types/react](https://github.com/DefinitelyTyped/DefinitelyTyped) | 18.3.31 | MIT | Type definitions |
| [@types/react-dom](https://github.com/DefinitelyTyped/DefinitelyTyped) | 18.3.7 | MIT | Type definitions |
| [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react) | 4.7.0 | MIT | React support for Vite |
| [autoprefixer](https://github.com/postcss/autoprefixer) | 10.5.2 | MIT | CSS vendor prefixes |
| [fake-indexeddb](https://github.com/dumbmatter/fakeIndexedDB) | 6.2.5 | Apache-2.0 | IndexedDB in unit tests |
| [gh-pages](https://github.com/tschaub/gh-pages) | 6.3.0 | MIT | Manual deploy script (`npm run deploy`) |
| [postcss](https://github.com/postcss/postcss) | 8.5.16 | MIT | CSS processing |
| [tailwindcss](https://github.com/tailwindlabs/tailwindcss) | 3.4.19 | MIT | Utility CSS (only the generated CSS ships) |
| [typescript](https://github.com/microsoft/TypeScript) | 5.9.3 | Apache-2.0 | Type checking |
| [vite](https://github.com/vitejs/vite) | 5.4.21 | MIT | Dev server and bundler |
| [vite-plugin-pwa](https://github.com/vite-pwa/vite-plugin-pwa) | 0.20.5 | MIT | Manifest and service worker generation (`workbox-build` pinned to 7.1.1 by `overrides`) |
| [vitest](https://github.com/vitest-dev/vitest) | 2.1.9 | MIT | Unit tests |

## 3. Android platform

The `android/` project started from the Capacitor Android template (MIT, part of [Capacitor](https://github.com/ionic-team/capacitor)).
The libraries below are not stored in this repository.
Gradle downloads them at build time and links them into the APK.

| Library | Version | License | How it is used |
| --- | --- | --- | --- |
| AndroidX (`appcompat`, `core`, `core-splashscreen`, `coordinatorlayout`, `activity`, `fragment`, `webkit`) | see `android/variables.gradle` | Apache-2.0 | Android support libraries, declared in `android/app/build.gradle` and by the Capacitor runtime |
| AndroidX CameraX (`camera-core`, `camera-camera2`, `camera-lifecycle`, `camera-view`) | 1.5.2 | Apache-2.0 | Pulled in by `@capacitor-mlkit/barcode-scanning` |
| Apache Cordova Android framework (`org.apache.cordova:framework`) | 14.0.1 | Apache-2.0 | Cordova compatibility layer of the Capacitor runtime |
| Kotlin standard library and `kotlinx-coroutines` | Kotlin 2.2.20 (`kotlin_version` in `android/variables.gradle`); kotlinx-coroutines 1.10.2 (default of `@capacitor/filesystem`) | Apache-2.0 | Used by Kotlin-based Capacitor plugins |
| Guava `listenablefuture` | 1.0 | Apache-2.0 | Pulled in by `@capacitor-mlkit/barcode-scanning` |
| `io.ionic.libs:ionfilesystem-android` | 1.1.1 | See [ion-android-filesystem](https://github.com/ionic-team/ion-android-filesystem/blob/main/LICENSE) | Pulled in by `@capacitor/filesystem` |
| Google ML Kit barcode scanning (`com.google.mlkit:barcode-scanning`) | 17.3.0 | [ML Kit Terms of Service](https://developers.google.com/ml-kit/terms) (proprietary) | Pulled in by `@capacitor-mlkit/barcode-scanning`; its client library and models are linked into the APK |
| Google code scanner (`com.google.android.gms:play-services-code-scanner`) | 16.1.0 | [ML Kit Terms of Service](https://developers.google.com/ml-kit/terms) (proprietary) | Client for the Google code scanner UI that the app uses (`src/native/barcode.ts`) |
| Other ML Kit modules, Google Play services and Firebase client libraries pulled in by ML Kit | various | ML Kit Terms of Service, Android Software Development Kit License or Apache-2.0, as stated in each POM | Transitive dependencies of ML Kit |

**Google code scanner module.**
The scanner screen itself is a Google Play services module.
Play services downloads it to the device at runtime, the first time it is needed.
This repository does not contain or redistribute that module.
It is provided by Google under Google's ML Kit and Google Play services terms.
If the module is unavailable, the app falls back to the zxing camera scanner and manual entry.

## 4. Data and services

| Source | License or terms | How it is used |
| --- | --- | --- |
| [hasaneyldrm/exercises-dataset](https://github.com/hasaneyldrm/exercises-dataset) by Hasan Emir Yıldırım | MIT | Exercise names, muscles and instructions. `scripts/build-exercise-library.mjs` builds `public/exercise-library.json` from a pinned commit. The full MIT license text ships inside that file (`license` field). |
| Exercise animations and thumbnails, © [Gym visual](https://gymvisual.com/) | Owned by Gym visual | Not part of this repository and never copied into it. The app loads them from the dataset repository at the pinned commit, only when the user turns on animations in Settings > Exercise library. |
| [Open Food Facts](https://world.openfoodfacts.org) | Database: [ODbL](https://opendatacommons.org/licenses/odbl/1-0/) | Food search and barcode lookups, fetched at runtime. Nothing from it is stored in this repository. |
| [USDA FoodData Central](https://fdc.nal.usda.gov) | Public domain (CC0 1.0) | Food search, fetched at runtime from `api.nal.usda.gov`. |
| [Google Gemini API](https://ai.google.dev) | [Gemini API Terms of Service](https://ai.google.dev/gemini-api/terms) | Optional AI coach and meal estimates. Calls go from the device to Google with the user's own API key. |
| [Anthropic Claude API](https://platform.claude.com) | [Anthropic Commercial Terms](https://www.anthropic.com/legal/commercial-terms) | Optional AI provider for the same features. Calls go from the device to `api.anthropic.com` with the user's own API key. |
| OpenAI-compatible APIs (OpenAI, OpenRouter, Groq, Mistral, or a local Ollama / LM Studio server) | Each service's own terms | Optional AI provider for the same features. Calls go from the device to the server the user picks, with the user's own key (none for a local server). |
| [GitHub REST API](https://docs.github.com/rest) | [GitHub Terms of Service](https://docs.github.com/site-policy/github-terms/github-terms-of-service) | Optional sync to the user's own private repository, with the user's own token. |
