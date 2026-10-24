# Translating GymTracker

GymTracker ships in English and Italian. This guide explains how the strings work, how to fix a translation, and how to add a third language.

The app has no translation library. Every string lives in a typed TypeScript file under `src/i18n/`. You need Node and `npm install`. See `CONTRIBUTING.md` for the full setup.

## How strings work

### Dictionaries and namespaces

Each language has one folder: `src/i18n/en/` and `src/i18n/it/`. A folder holds 14 namespace files plus an `index.ts`:

`ai`, `common`, `components`, `data`, `diet`, `library`, `lib`, `native`, `notify`, `progress`, `rank`, `settings`, `units`, `workout`.

- `common` holds shared words, such as "Save" and "Cancel".
- `units` holds units and counted nouns, such as "3 sets".
- The other namespaces follow the screens and modules of the app.

A key is the dotted path to a message: `namespace.screen.element`, in camelCase. For example, `common.save` or `lib.dates.dayMonth`.

### English is the source of the keys

English defines every key. Each English namespace file exports a plain object `as const`. `src/i18n/en/index.ts` joins them into `en` and exports the type `Dict`, the shape every other language must match.

Every Italian namespace file is typed against English:

```ts
import type { Dict } from '../en'

const common: Dict['common'] = {
  save: 'Salva',
  cancel: 'Annulla',
  // ...
}

export default common
```

So a missing key or an extra key is a compile error. `npm run build` and `npx tsc --noEmit` report it. Note that `npm test` runs vitest, which does not type-check.

The comments in the English files explain where a message appears. Read them before you translate.

### `t()` and `tp()`

`src/i18n/index.ts` exports the functions that screens use:

- `t('library.browser.addNamed', { name })` returns a message and fills its `{placeholders}`. The English message is `'Add {name}'`, so `{name}` is replaced by the value of `name`.
- `tp('units.sets', n)` returns a pluralized message. A plural message is an object with two forms, `{ one, other }`. `tp` picks the form with the language's `Intl.PluralRules`, then fills `{n}` with the formatted number.
- `fmtNum(n)` formats a number in the language's style ("1,234.5" or "1.234,5").
- `useT()` gives the same functions inside a React component.

Example of a plural message, from `src/i18n/it/units.ts`:

```ts
workouts: { one: '{n} allenamento', other: '{n} allenamenti' },
```

The `one` form may leave out `{n}` (for example "un giorno"). It must never add a placeholder that English does not have.

Dates are built from dictionary messages too. Weekday and month names live in the `lib.dates` section of the `lib` namespace.

### Fallback to English

If a plain `t()` message in the current language is an empty string `''`, `t()` shows the English message instead. This works only for messages without `{placeholders}`. A message with placeholders cannot be `''`: the placeholder check in `src/i18n/i18n.test.ts` fails. Plural forms (`one` and `other`) must never be `''`: `tp()` does not fall back, and it shows an empty string. To leave any message for later, the safest choice is to copy the English text. Do not leave a key out: that is a compile error.

If a key does not exist at all, `t()` returns the key itself.

### Changing the language

The language is a device-local setting. It is stored in `localStorage` (`src/lib/uiStore.ts`) and is never synced. The user changes it in Settings, in `LanguageSection` (`src/screens/settings/SettingsScreen.tsx`). The app then reloads, so every screen, date and reminder follows the new language. On the first run, `defaultLang()` picks the language from the phone.

## Rules

1. **Stored data stays English.** The database keeps app data in English. The app translates it only on screen. This applies to:
   - catalog exercise names, shown with `exerciseDisplayName` (`src/lib/exerciseNames.ts`);
   - score-event labels, shown with `displayEventLabel` (`src/lib/quests.ts`);
   - rank labels, stored with `rankLabelEn` and shown with `translateRankLabel` (`src/lib/ranks.ts`);
   - quest labels, which keep an English `labelEn`.

   Text sent to Gemini as data also stays English. Default names the user can edit (a new template, a freestyle session, a saved meal) are written in the UI language, because they are user content. See invariant 19 in `ROUTEMAP.md`.
2. **Keep every `{placeholder}`.** Do not rename, translate or remove one. You may move it inside the sentence. `src/i18n/i18n.test.ts` checks this.
3. **Keep text short.** Every screen must fit a phone 320 px wide. Labels on buttons and chips have very little room. If your language is longer than English, prefer a shorter word over a literal translation.
4. **Never put literal text in JSX.** All visible text, and every `aria-label`, `placeholder`, `title` and `alt`, must come from `t()` or `tp()`. `src/i18n/stringGuard.test.ts` fails on hard-coded copy in `src/screens`, `src/components` and `src/native/ui`. Brand names and units such as "kg" are allowed.

## Fix or improve a translation

1. Find the text in the app. Search for it in `src/i18n/it/` to find its key.
2. Read the same key in `src/i18n/en/<namespace>.ts`. Its comment explains the context.
3. Edit the message in `src/i18n/it/<namespace>.ts`. Change only the text, never the key.
4. Run the checks:

   ```sh
   npm test
   npx tsc --noEmit
   ```

5. Open the screen at 320 px wide and check that the text fits (see [Test it](#test-it)).

Italian names of catalog exercises are not in `src/i18n/`. They are in the `IT` map in `src/lib/exerciseNames.ts`, keyed by the English name. Exercise instructions from the exercise library come from an external dataset. They are not edited by hand in this repo.

If an English message is wrong, fix it in `src/i18n/en/` and check that the Italian message still matches.

## Add a new language

This checklist uses German (`de`) as an example. Replace `de` with your language's code.

**Required** items are needed for the app to compile, to offer the language, or to show it correctly. **Optional** items fall back to English when you skip them.

1. **Required: the dictionary.** Copy `src/i18n/it/` to `src/i18n/de/`. Translate the 14 namespace files. Keep the `Dict['<namespace>']` type on each one. In `src/i18n/de/index.ts`, rename the export to `de` (it is `export const it: Dict = { ... }` in the Italian file). For a message you have not translated yet, copy the English text. An empty string `''` works only for a plain message without placeholders (see "Fallback to English").
2. **Required: the language type.** In `src/lib/uiStore.ts`, add `'de'` to the `Lang` type and to the `LANGS` list.
3. **Required: the saved-choice guard.** In `src/lib/uiStore.ts`, the `merge` function of the store accepts only known languages when it reads `localStorage`. Add `'de'` to that check, or make it use `LANGS.includes`. Otherwise the app forgets the choice on reload.
4. **Required: register the dictionary.** In `src/i18n/index.ts`, import `de` and add it to `DICTS`.
5. **Required: number format.** In `src/i18n/index.ts`, `fmtNumIn` picks the `Intl.NumberFormat` locale with a ternary on `'it'`. Add the locale for your language (for example `de-DE`), ideally as a `Record<Lang, string>` map.
6. **Required: heatmap date format.** In `src/components/MuscleHeatmap.tsx`, the `dayMonth` formatter picks its locale with the same kind of ternary. Add your locale there too.
7. **Required: exercise instruction type.** In `src/lib/exerciseLibrary.ts`, `LibraryExercise.steps` is a `Record<Lang, string[]>`. It needs a key for every language, so adding `'de'` breaks the build. Make the other languages optional, for example `{ en: string[] } & Partial<Record<Lang, string[]>>`. `stepsFor` already falls back to the English steps.
8. **Required: the Settings button.** In `src/screens/settings/SettingsScreen.tsx`, `LanguageSection` renders one button per language from a list of `[code, label]` pairs. Add `['de', 'Deutsch']`. Write the label in its own language. You can also build the list from `LANGS` and a label map.
9. **Required: the tests.** In `src/i18n/i18n.test.ts`, the "dictionaries" tests compare the Italian dictionary with English: same keys, same placeholders. Run the same checks for your dictionary, ideally in a loop over every non-English dictionary.
10. **Optional: device default.** In `src/lib/uiStore.ts`, `defaultLang()` picks Italian when `navigator.language` starts with `it`. Add your language so a German phone starts in German.
11. **Optional: catalog exercise names.** `exerciseDisplayName` in `src/lib/exerciseNames.ts` translates the built-in catalog only for Italian, from the `IT` map. Add a map for your language and pick the map by language. Without it, catalog names show in English.
12. **Optional: exercise instructions.** `scripts/build-exercise-library.mjs` builds `public/exercise-library.json` from the dataset's `instruction_steps`. It keeps only the `en` and `it` steps, as the `stepsEn` and `stepsIt` columns. `parseLibrary` in `src/lib/exerciseLibrary.ts` reads those columns. If the dataset has steps in your language, add a column in both places and rebuild the file. The usage is at the top of the script. Without it, instructions show in English.
13. **Optional: AI answers.** In `src/lib/gemini.ts`, `localizedSystemPrompt` appends `ITALIAN_OUTPUT_LINE` to the system prompt when the UI is Italian. This makes Gemini answer in Italian. Add a line for your language, for example with an `outputLanguageLine(lang)` helper, and update `src/lib/gemini.test.ts`. Without it, AI notes come back in English.
14. **Optional: Android strings.** The rest-timer notification, the notification channels and the home-screen widget use Android resources. English is in `android/app/src/main/res/values/strings.xml`. Copy `android/app/src/main/res/values-it/strings.xml` to `values-de/strings.xml` and translate it. Keep every `%` format placeholder exactly as it is (`%1$s`, `%d`, `%1$d`, `%2$d`). Keep the `plurals` items. You do not need to register the language anywhere else: `setAppLanguage` in `DeviceSettingsPlugin.java` passes the language code to Android as it is. Without this file, these strings show in English.
15. **Optional: README.** Update the "English and Italian" section of `README.md` to name the new language.

The `Plural` type has only two forms, `one` and `other`. `tp` maps every other plural category to `other`. A language with more forms (such as `few` or `many`) needs a change to `Plural` in `src/i18n/types.ts` and to `pluralCategory` in `src/i18n/index.ts`. Open an issue first if your language needs this.

When you add a module or change an invariant, also update `ROUTEMAP.md`, as `CONTRIBUTING.md` explains.

## Test it

1. Run the type check, the tests and the build:

   ```sh
   npx tsc --noEmit
   npm test
   npm run build
   ```

2. Start the app with `npm run dev` and open the address it prints.
3. Go to Settings and pick your language. The app reloads in that language.
4. Open your browser's device toolbar and set the width to 320 px. Visit every screen you translated. Check that no text overflows, wraps badly or is cut off. Check dates, numbers and plurals (for example 1 workout and 2 workouts).

On Android, build a debug app and run the smoke test in your language:

```sh
npm run android:debug
SMOKE_LANG=de scripts/android/smoke.sh --only "1 2 3 4"
```

`SMOKE_LANG` switches the app's language before the checks. Checks 6 and 9 match English text, so skip them in another language. Read `ANDROID.md` first. A debug build must never connect to the real sync repo.
