# Graph Report - GymTracker  (2026-10-12)

## Corpus Check
- 154 files · ~102,199 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 24 file(s) not represented in the graph (top: .xml 14, (none) 3, .properties 2)

## Summary
- 1343 nodes · 4122 edges · 62 communities (53 shown, 9 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 209 edges (avg confidence: 0.9)
- Token cost: 138,266 input · 0 output

## Community Hubs (Navigation)
- Android Java Plugins
- Dexie Data Model
- Backup & GitHub Sync
- Workout UI Components
- Test Suite & Tooling
- Session Scoring & Dates
- App Shell & Ranking
- Gemini AI Client
- NPM Dependencies
- Rest Timer (Web)
- Emulator Smoke Script
- Build & Deploy Config
- Workout Logging & Plates
- Charts & Achievements
- Reminder Resync Engine
- AI Report Cards
- PWA Icons & Entry
- Macro Completion AI
- Notification Prefs
- Food Logging & Dedup
- Android Runbook & Identity
- Back Button & Keep-Awake
- Native Rest Timer Bridge
- Project Docs & Workflow
- Diet Day & Progress Ring
- Notification Health
- Notifications Settings UI
- Diet Briefings
- Barcode Scan Sheet
- USDA Provider
- Device Settings Controls
- Native Init & Daily Checks
- RestTimer Plugin Interface
- Notification Planner Core
- TS Config
- Reminder Categories
- Food Provider Chain
- Settings Form Controls
- Channels & Device Status
- AI Store & Settings
- CDP Eval Tool
- TS Node Config
- Android Template Tests
- Barcode Scanning (ML Kit/zxing)
- Build Scripts & Outputs
- Workout Weight Suggestions
- Planner Data Gathering
- Android Env & Release Scripts
- Food Substitution AI
- README & Pages Hosting
- Notification Engine Tests
- Notification ID Scheme
- Routes & Tab Bar
- Open Food Facts Client
- App Info
- Native File Share

## God Nodes (most connected - your core abstractions)
1. `localDateStr()` - 50 edges
2. `react` - 35 edges
3. `db` - 34 edges
4. `parseLocalDate()` - 32 edges
5. `Vitest unit-test suite (~326 tests)` - 30 edges
6. `ANDROID.md — Android runbook` - 30 edges
7. `Id` - 29 edges
8. `vitest` - 28 edges
9. `addDays()` - 28 edges
10. `useNotifyStore` - 28 edges

## Surprising Connections (you probably didn't know these)
- `Build stamp (__APP_VERSION__, __BUILD_SHA__, __BUILD_TIME__)` --references--> `getAppInfo()`  [INFERRED]
  ROUTEMAP.md → src/native/appInfo.ts
- `AI workout coach + opening-weight suggestions` --references--> `generateCoachNote()`  [INFERRED]
  ROUTEMAP.md → src/lib/gemini.ts
- `AI workout coach + opening-weight suggestions` --references--> `generateWeightPlan()`  [INFERRED]
  ROUTEMAP.md → src/lib/gemini.ts
- `AI diet coach + macro-completion / food-swap` --references--> `generateMacroSuggestion()`  [INFERRED]
  ROUTEMAP.md → src/lib/gemini.ts
- `AI diet coach + macro-completion / food-swap` --references--> `generateSubstitution()`  [INFERRED]
  ROUTEMAP.md → src/lib/gemini.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **FoodProvider registry: OFF + USDA search / barcode / upsert flow** — src_types_foodprovider, src_lib_foodproviders_providers, src_lib_off_offprovider, src_lib_usda_usdaprovider, src_lib_foodproviders_searchfoods, src_lib_foodproviders_lookupbarcodechained, src_lib_foodproviders_upsertremotefood [EXTRACTED 1.00]
- **Past-workout calendar → edit → rescore flow** — src_screens_workout_history_history, src_screens_workout_pastworkout_pastworkout, src_lib_dates_monthgrid, src_lib_finishsession_rescoresession, src_lib_scoring_scoresession, src_types_scoreevent [EXTRACTED 1.00]
- **GymTracker app icon set (same barbell artwork for iOS and PWA manifest)** — public_apple_touch_icon, public_icons_icon_192, public_icons_icon_512, public_icons_maskable_512 [INFERRED 0.85]
- **Brand palette hard-coded in icon pixels, Tailwind tokens and PWA metadata** — public_apple_touch_icon_brand_palette, public_apple_touch_icon, tailwind_config, vite_config, index [INFERRED 0.85]
- **PWA install icon set declared in the VitePWA config** — vite_config, public_icons_icon_192, public_icons_icon_512, public_icons_maskable_512, public_apple_touch_icon [EXTRACTED 1.00]
- **PWA app icon set (manifest icons + iOS touch icon)** — public_icons_icon_512, public_icons_icon_192, public_icons_maskable_512, public_apple_touch_icon, vite_config [EXTRACTED 1.00]
- **Duplicated brand colour constants (#0B0F14 background, #F97316 primary)** — public_icons_icon_512_brand_palette, public_icons_icon_512, tailwind_config, vite_config [INFERRED 0.85]
- **Brand palette duplicated across icon pixels, PWA manifest and Tailwind theme** — public_icons_maskable_512, public_icons_maskable_512_brand_palette, vite_config, tailwind_config [INFERRED 0.85]
- **Native/PWA boundary enforcement (isNative gate + boundary test + dist check)** — routemap_invariant_native_pwa_split, src_native_platform_isnative, src_lib_nativeboundary_test, scripts_check_pwa_dist, android_dual_build_outputs [INFERRED 0.95]
- **Reminder resync pipeline (gather → plan → diff → schedule → cleanup)** — src_lib_notifydata_gatherplannerdata, src_lib_notifyplanner_plannotifications, src_lib_notifyplanner_diffschedules, src_lib_notifyplanner_plancleanup, src_native_notifications_resyncnow, src_native_notifications_requestresync [EXTRACTED 1.00]
- **Phone data-loss guards (identity, signing key, no-uninstall updates, debug isolation, migration)** — routemap_invariant_identity_permanent, android_permanent_identity, android_signing_key_backup, android_update_flow, android_debug_sync_isolation, android_data_migration [INFERRED 0.85]

## Communities (62 total, 9 thin omitted)

### Community 0 - "Android Java Plugins"
Cohesion: 0.06
Nodes (7): Check, DeviceSettingsPlugin, MainActivity, RestTimerController, State, RestTimerPlugin, RestTimerReceiver

### Community 1 - "Dexie Data Model"
Cohesion: 0.09
Nodes (50): Data model & persistence, dirtyListeners, GymDB, markDirty(), onDataReplaced(), replacedListeners, DEFAULT_SETTINGS, ROWS (+42 more)

### Community 2 - "Backup & GitHub Sync"
Cohesion: 0.09
Nodes (49): JSON backup export/import, GitHub snapshot sync (private repo via PAT), applyTables(), BackupFile, collectTables(), exportBackup(), importBackup(), TableDump (+41 more)

### Community 3 - "Workout UI Components"
Cohesion: 0.11
Nodes (36): Equipment variants (equipment on Exercise), dexie-react-hooks, lucide-react, react, react-router-dom, Workout subsystem, NumberStepper(), Props (+28 more)

### Community 4 - "Test Suite & Tooling"
Cohesion: 0.06
Nodes (28): dexie, fake-indexeddb, vitest, Vitest unit-test suite (~326 tests), BASELINE, errors, REGISTER, Row (+20 more)

### Community 5 - "Session Scoring & Dates"
Cohesion: 0.13
Nodes (37): BriefingExercise, gatherWorkoutBriefing(), briefing(), exercise(), WorkoutBriefing, addDays(), addMonths(), DAY_NAMES (+29 more)

### Community 6 - "App Shell & Ranking"
Cohesion: 0.12
Nodes (33): Rainbow-Six-style ranking (Copper III → Champion), Gamification & progress modules, App(), Confetti(), Props, RankBadge(), TabBar(), db (+25 more)

### Community 7 - "Gemini AI Client"
Cohesion: 0.08
Nodes (32): CATEGORIES, cleanMacroItem(), COACH_NOTE_SCHEMA, COACH_SYSTEM_PROMPT, DIET_SYSTEM_PROMPT, errorDetail(), GeminiError, GeminiErrorKind (+24 more)

### Community 8 - "NPM Dependencies"
Cohesion: 0.05
Nodes (37): dependencies, barcode-detector, @capacitor/android, @capacitor/app, @capacitor-community/keep-awake, @capacitor/core, @capacitor/filesystem, @capacitor/haptics (+29 more)

### Community 9 - "Rest Timer (Web)"
Cohesion: 0.12
Nodes (20): Rest timer (auto-start, timestamp-based, wake lock), RestTimerBar(), AudioCtor, beep(), getCtx(), unlockAudio(), fmtDuration(), useNow() (+12 more)

### Community 10 - "Emulator Smoke Script"
Cohesion: 0.16
Nodes (29): alarms(), app_pid(), ash(), attach(), back(), cdp(), CDP_PORT, check() (+21 more)

### Community 11 - "Build & Deploy Config"
Cohesion: 0.09
Nodes (26): Android toolchain (Node ≥ 22, JDK 21 with javac, SDK 36), build-deploy job, VITE_USDA_KEY (USDA API key secret), name, overrides, workbox-build, private, type (+18 more)

### Community 12 - "Workout Logging & Plates"
Cohesion: 0.11
Nodes (23): Workout logging (templates, supersets, one-tap sets, warm-ups, plate calculator), PlanExercise, DEFAULT_BAR_KG, DEFAULT_PLATES, formatPlates(), platesPerSide(), warmupRamp(), PrevSet (+15 more)

### Community 13 - "Charts & Achievements"
Cohesion: 0.14
Nodes (24): BandBars(), BarChart(), ChartPoint, LineChart(), niceRange(), Sparkline(), AchievementDef, ACHIEVEMENTS (+16 more)

### Community 14 - "Reminder Resync Engine"
Cohesion: 0.12
Nodes (25): decodeNid(), diffSchedules(), isManagedId(), PendingLike, planCleanup(), planHorizon(), ResyncResult, atMsOf() (+17 more)

### Community 15 - "AI Report Cards"
Cohesion: 0.16
Nodes (24): ActionButton(), AiReportCard(), AiReportCardProps, Header(), LoadingView(), NoteView(), renderCoachNote(), Status (+16 more)

### Community 16 - "PWA Icons & Entry"
Cohesion: 0.13
Nodes (16): index.html — PWA entry document, Orange dumbbell (barbell) glyph, icon-192.png (GymTracker app icon, 192x192), Orange dumbbell glyph (bar with two plates per side), PWA app icon (192x192 manifest icon), icon-512.png (GymTracker app icon, 512x512), Orange dumbbell glyph (logo mark), maskable-512.png (maskable PWA icon) (+8 more)

### Community 17 - "Macro Completion AI"
Cohesion: 0.14
Nodes (22): AddButton(), AddStatus, MacroCompletionCard(), add(), generate(), renderNote(), WorkoutPlanBriefing, CandidateFood (+14 more)

### Community 18 - "Notification Prefs"
Cohesion: 0.14
Nodes (22): ALERT_MODES, DEFAULT_NOTIFY_PREFS, DEFAULT_REST_ALERT, HHMM, isHHMM(), IsoWeekday, isWeekday(), MEALS (+14 more)

### Community 19 - "Food Logging & Dedup"
Cohesion: 0.19
Nodes (23): Food dedup gap: USDA branded search vs OFF (UPC-12 vs EAN-13), remoteFoodKey(), upsertRemoteFood(), logFood(), recipePer100(), AddFoodSheet(), onScannedProduct(), CustomTab() (+15 more)

### Community 20 - "Android Runbook & Identity"
Cohesion: 0.14
Nodes (11): ANDROID.md — Android runbook, Capacitor 8 Android wrapper (same React codebase), Native rest timer limitations, S25-like emulator AVD (360 CSS px), Sideload install on the Galaxy S25, Versioning: versionName = package.json version, versionCode = git commit count, config, version (+3 more)

### Community 21 - "Back Button & Keep-Awake"
Cohesion: 0.18
Nodes (19): @capacitor-community/keep-awake, Android shell: back button, keep-awake, haptics, backDepth(), Entry, popBack(), pushBack(), stack, historyIdx() (+11 more)

### Community 22 - "Native Rest Timer Bridge"
Cohesion: 0.21
Nodes (18): Native rest timer bridge, isAndroid, adopt(), applyToNative(), bridgeAction(), fromNative(), nativeStartOptions(), onRestPrefs() (+10 more)

### Community 23 - "Project Docs & Workflow"
Cohesion: 0.20
Nodes (15): CLAUDE.md — project instructions, Verification gate: npm run build + npm test, deploy.yml — Deploy to GitHub Pages workflow, HANDOFF.md — food-DB providers, past-workout calendar, equipment variants, Adversarial review workflow, Past-workout calendar + editing, Rescore rank drift (accepted limitation), ROUTEMAP.md — module index (+7 more)

### Community 24 - "Diet Day & Progress Ring"
Cohesion: 0.16
Nodes (19): ProgressRing(), Props, deleteWithTombstone(), useLocalToday(), removeSavedMeal(), DietDay(), copyYesterday(), saveAsMeal() (+11 more)

### Community 25 - "Notification Health"
Cohesion: 0.15
Nodes (17): CATEGORY_CHANNEL, CATEGORY_KEYS, CategoryKey, categoryOn(), enabledCategoryCount(), HealthItem, healthItems(), isMuted() (+9 more)

### Community 26 - "Notifications Settings UI"
Cohesion: 0.15
Nodes (20): One UI notification setup, requestNotificationPermission(), sendTestReminder(), allowNotifications(), CardProps, Details(), ensurePermission(), FooterButtons() (+12 more)

### Community 27 - "Diet Briefings"
Cohesion: 0.23
Nodes (20): buildCandidates(), DietBriefing, gatherDietBriefing(), gatherMacroCompletionBriefing(), gatherSubstitutionBriefing(), gatherWeekNutrition(), isTrainingDay(), MacroCompletionBriefing (+12 more)

### Community 28 - "Barcode Scan Sheet"
Cohesion: 0.24
Nodes (14): Diet & nutrition subsystem, BarcodeScanSheet(), accept(), start(), startNative(), stopStream(), Mode, normalizeScannedEan() (+6 more)

### Community 29 - "USDA Provider"
Cohesion: 0.18
Nodes (13): Props, canonicalGtin(), ENERGY_KCAL_NUMS, FdcFood, FdcNutrient, fdcSearch(), kcalPer100(), lookupUsdaBarcode() (+5 more)

### Community 30 - "Device Settings Controls"
Cohesion: 0.21
Nodes (17): openDeviceSettings(), openExactAlarmSettings(), ActionButton(), IssueRow(), MutedChip(), Segment(), useAction(), dayWord() (+9 more)

### Community 31 - "Native Init & Daily Checks"
Cohesion: 0.24
Nodes (16): runDailyChecksOnce(), withSyncLock(), armMidnightTimer(), dailyChecks(), engines, initNative(), initNativeEarly(), onMidnight() (+8 more)

### Community 32 - "RestTimer Plugin Interface"
Cohesion: 0.12
Nodes (7): @capacitor/core, RestTimer, RestTimerEvent, RestTimerPlugin, RestTimerStartOptions, RestTimerState, RestTimerWeb

### Community 33 - "Notification Planner Core"
Cohesion: 0.14
Nodes (15): byTime(), CAT, CHANNEL_FOR, MAX_SCHEDULED, NotificationSpec, PlannerInput, planNotifications(), REMINDER_ROUTES (+7 more)

### Community 34 - "TS Config"
Cohesion: 0.11
Nodes (17): compilerOptions, isolatedModules, jsx, lib, module, moduleResolution, noEmit, noFallthroughCasesInSwitch (+9 more)

### Community 35 - "Reminder Categories"
Cohesion: 0.13
Nodes (15): anyReminderEnabled(), CAT_ID, Category, EPOCH_UTC, KEEPALIVE_TIME, MEAL_ORDER, MEAL_SLOT, OPEN_SESSION_AFTER_MS (+7 more)

### Community 36 - "Food Provider Chain"
Cohesion: 0.21
Nodes (11): Multi-provider food databases (OFF + USDA), USDA FoodData Central (FDC), lookupAcross(), ProviderRun, PROVIDERS, safeSearch(), searchAcross(), searchFoods() (+3 more)

### Community 37 - "Settings Form Controls"
Cohesion: 0.35
Nodes (17): useNotifyStore, Select(), Switch(), SwitchRow(), TimeInput(), Card(), CardTitle(), FieldRow() (+9 more)

### Community 38 - "Channels & Device Status"
Cohesion: 0.19
Nodes (10): Android reminder engine (notifications), DeviceSettings, DeviceSettingsPlugin, DeviceSettingsTarget, DeviceStatusRaw, getDeviceStatus(), refreshPermissionCache(), loadNativeStatus() (+2 more)

### Community 39 - "AI Store & Settings"
Cohesion: 0.29
Nodes (11): zustand, AiStore, useAiStore, AiModel, pickDefaultModel(), AiSection(), ConnectedView(), ConnectView() (+3 more)

### Community 40 - "CDP Eval Tool"
Cohesion: 0.18
Nodes (5): args, ExprError, opt, pageTarget(), Session

### Community 41 - "TS Node Config"
Cohesion: 0.14
Nodes (13): compilerOptions, isolatedModules, lib, module, moduleResolution, noEmit, noUnusedLocals, noUnusedParameters (+5 more)

### Community 43 - "Barcode Scanning (ML Kit/zxing)"
Cohesion: 0.24
Nodes (10): ML Kit scanner with zxing fallback, Camera barcode scanner (zxing WASM), Diet tracking (meal log, training/rest-day macro targets, recipes, water), Open Food Facts (OFF), @capacitor-mlkit/barcode-scanning, zxing-wasm, ensureScannerModule(), message() (+2 more)

### Community 44 - "Build Scripts & Outputs"
Cohesion: 0.21
Nodes (12): Dual build outputs: dist/ (Pages PWA) vs dist-android/, Emulator smoke test (checks 1–10), scripts, android:debug, android:open, android:release, build, build:android (+4 more)

### Community 45 - "Workout Weight Suggestions"
Cohesion: 0.27
Nodes (11): formatWorkoutPlanBriefing(), gatherWorkoutPlanBriefing(), generateWeightPlan(), RawExercisePlan, clampReps(), generateAndCacheWorkoutPlan(), snapWeight(), useWorkoutPlan() (+3 more)

### Community 46 - "Planner Data Gathering"
Cohesion: 0.32
Nodes (11): gatherPlannerData(), MEALS, atLocal(), atLocalMinutes(), hhmmMinutes(), isoWeekday(), nextRecapDate(), planCandidates() (+3 more)

### Community 47 - "Android Env & Release Scripts"
Cohesion: 0.24
Nodes (8): ANDROID_HOME, ANDROID_SDK_ROOT, PATH, env.sh script, die(), gradle(), release.sh script, verify()

### Community 48 - "Food Substitution AI"
Cohesion: 0.31
Nodes (8): run(), errMsg(), formatSubstitutionBriefing(), generateSubstitution(), FoodDataEditor(), MiniField(), SwapSuggestion(), run()

### Community 49 - "README & Pages Hosting"
Cohesion: 0.24
Nodes (8): GitHub Pages (static hosting), deploy, README.md — GymTracker overview, Alternative deploy (gh-pages branch / Netlify Drop), iPhone install via Safari Add to Home Screen, iOS PWA limits, Progress tracking (e1RM/volume charts, muscle volume, PR wall, strength standards), gh-pages

### Community 50 - "Notification Engine Tests"
Cohesion: 0.20
Nodes (5): PlannerData, h, Ln, load(), NOW

### Community 51 - "Notification ID Scheme"
Cohesion: 0.33
Nodes (5): @capacitor/local-notifications, dayIdx(), LEAD_MS, nid(), spec()

### Community 52 - "Routes & Tab Bar"
Cohesion: 0.57
Nodes (4): App shell & routing, KNOWN_ROUTES, TAB_ROUTES, TabRoute

### Community 53 - "Open Food Facts Client"
Cohesion: 0.60
Nodes (5): lookupBarcode(), mapProduct(), num(), round1(), searchOff()

## Ambiguous Edges - Review These
- `Offline-first, all data on device (IndexedDB)` → `GitHub snapshot sync (private repo via PAT)`  [AMBIGUOUS]
  README.md · relation: conceptually_related_to

## Knowledge Gaps
- **15 isolated node(s):** `@fontsource/barlow-condensed`, `@types/node`, `@types/react`, `@types/react-dom`, `autoprefixer` (+10 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 332 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Native (Android / Capacitor) module group` connect `Android Runbook & Identity` to `Android Java Plugins`, `Workout UI Components`, `Test Suite & Tooling`, `Channels & Device Status`, `CDP Eval Tool`, `Rest Timer (Web)`, `Emulator Smoke Script`, `Barcode Scanning (ML Kit/zxing)`, `Build & Deploy Config`, `Android Env & Release Scripts`, `PWA Icons & Entry`, `Back Button & Keep-Awake`, `Native Rest Timer Bridge`, `Project Docs & Workflow`, `App Info`, `Device Settings Controls`?**
  _High betweenness centrality (0.137) - this node is a cross-community bridge._
- **What connects `@fontsource/barlow-condensed`, `@types/node`, `@types/react` to the rest of the system?**
  _15 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Android Java Plugins` be split into smaller, more focused modules?**
  _Cohesion score 0.05516596540439458 - nodes in this community are weakly interconnected._
- **Why does `vitest` connect `Test Suite & Tooling` to `Dexie Data Model`, `Notification Planner Core`, `Session Scoring & Dates`, `Gemini AI Client`, `Build & Deploy Config`, `Workout Logging & Plates`, `Charts & Achievements`, `Macro Completion AI`, `Notification Prefs`, `Notification Engine Tests`, `Routes & Tab Bar`, `Back Button & Keep-Awake`, `Native Rest Timer Bridge`, `Notification Health`, `Barcode Scan Sheet`, `USDA Provider`?**
  _High betweenness centrality (0.045) - this node is a cross-community bridge._
- **Should `Dexie Data Model` be split into smaller, more focused modules?**
  _Cohesion score 0.08680555555555555 - nodes in this community are weakly interconnected._
- **Why does `react` connect `Workout UI Components` to `Backup & GitHub Sync`, `Session Scoring & Dates`, `App Shell & Ranking`, `Rest Timer (Web)`, `Build & Deploy Config`, `Workout Logging & Plates`, `Charts & Achievements`, `AI Report Cards`, `Macro Completion AI`, `Food Logging & Dedup`, `Back Button & Keep-Awake`, `Diet Day & Progress Ring`, `Notifications Settings UI`, `Barcode Scan Sheet`, `Device Settings Controls`, `Channels & Device Status`, `AI Store & Settings`, `Workout Weight Suggestions`, `Food Substitution AI`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `Offline-first, all data on device (IndexedDB)` and `GitHub snapshot sync (private repo via PAT)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._