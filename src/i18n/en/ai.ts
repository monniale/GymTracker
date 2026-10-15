/** `ai` namespace (rules in src/i18n/index.ts). Keys: screen.element, camelCase. */
export default {
  /** Errors from the Gemini client (lib/gemini.ts, lib/aiStore.ts). */
  gemini: {
    network: 'Network unreachable — check your connection.',
    requestFailed: 'Gemini request failed ({status})',
    /** Gemini's own error text (English, from Google). */
    requestFailedDetail: '{detail}',
    blocked: 'Gemini could not generate a response — try again.',
    empty: 'Gemini returned an empty response — try again.',
    noKey: 'Add a Gemini key in Settings first.',
  },
  /** Fallbacks when a coach note (workout, diet day, week) comes back incomplete. */
  note: {
    defaultHeadline: 'Session reviewed',
    cutOff: 'The coach note was cut off — tap Regenerate.',
  },
  /** Fallbacks for the macro suggestions (complete the day / swap a food). */
  macro: {
    defaultHeadline: 'Ideas to finish your day',
    cutOff: 'The suggestion was cut off — tap Regenerate.',
  },
} as const
