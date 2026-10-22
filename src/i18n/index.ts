import { useUiStore, getLang, type Lang } from '../lib/uiStore'
import { en } from './en'
import { it } from './it'
import type { Plural, PluralKey, StringKey, Vars } from './types'

/**
 * UI translations, no library.
 *
 * - Dictionaries: `src/i18n/<lang>/<namespace>.ts`. English (`en/`) defines the keys; Italian
 *   (`it/`) is typed against it, so a missing or extra key is a compile error. Keys are
 *   `namespace.screen.element` in camelCase; shared verbs live in `common`, units and counted
 *   nouns in `units`.
 * - `t('workout.home.title', { name })` fills `{name}` placeholders; `tp('units.sets', n)` picks the
 *   plural form for `n` (and fills `{n}`).
 * - `t`/`tp` read the language when called. Changing the language reloads the app
 *   (`setLanguage` in Settings), so module-level constants built with `t()` are fine too.
 * - Stored data stays English (exercise names in the DB, score-event labels, season ranks):
 *   translate them at display time.
 */

export type { Lang } from '../lib/uiStore'
export type Key = StringKey<typeof en>
export type PluralMessageKey = PluralKey<typeof en>

const DICTS = { en, it } as const

function lookup(dict: unknown, key: string): unknown {
  let node: unknown = dict
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return node
}

function fill(template: string, vars?: Vars): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m))
}

function message(lang: Lang, key: string): unknown {
  const own = lookup(DICTS[lang], key)
  return own !== undefined && own !== '' ? own : lookup(en, key)
}

const pluralRules = new Map<Lang, Intl.PluralRules>()
function pluralCategory(lang: Lang, n: number): 'one' | 'other' {
  let rules = pluralRules.get(lang)
  if (!rules) {
    rules = new Intl.PluralRules(lang)
    pluralRules.set(lang, rules)
  }
  return rules.select(n) === 'one' ? 'one' : 'other'
}

export interface Translator {
  lang: Lang
  t: (key: Key, vars?: Vars) => string
  tp: (key: PluralMessageKey, n: number, vars?: Vars) => string
  /** Number in the language's format ("1,234.5" / "1.234,5"). */
  fmtNum: (n: number, opts?: Intl.NumberFormatOptions) => string
}

/** A translator fixed to one language (pure code that gets the language passed in, e.g. the planner). */
export function bindT(lang: Lang): Translator {
  return {
    lang,
    t: (key, vars) => {
      const m = message(lang, key)
      return typeof m === 'string' ? fill(m, vars) : key
    },
    tp: (key, n, vars) => {
      const m = message(lang, key) as Plural | undefined
      if (!m || typeof m !== 'object') return key
      return fill(m[pluralCategory(lang, n)] ?? m.other, { n: fmtNumIn(lang, n), ...vars })
    },
    fmtNum: (n, opts) => fmtNumIn(lang, n, opts),
  }
}

function fmtNumIn(lang: Lang, n: number, opts?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(lang === 'it' ? 'it-IT' : 'en-US', opts).format(n)
}

/** Translate with the current language. */
export function t(key: Key, vars?: Vars): string {
  return bindT(getLang()).t(key, vars)
}

/** Pluralized translation with the current language; `{n}` is filled with the formatted count. */
export function tp(key: PluralMessageKey, n: number, vars?: Vars): string {
  return bindT(getLang()).tp(key, n, vars)
}

/** Number formatting in the current language. */
export function fmtNum(n: number, opts?: Intl.NumberFormatOptions): string {
  return fmtNumIn(getLang(), n, opts)
}

/** React: the translator for the current language (re-renders if it changes). */
export function useT(): Translator {
  const lang = useUiStore(s => s.language)
  return bindT(lang)
}

/** `<html lang>` for screen readers and hyphenation. */
export function setDocumentLang(lang: Lang = getLang()): void {
  if (typeof document !== 'undefined') document.documentElement.lang = lang
}
