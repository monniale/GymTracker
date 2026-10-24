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
  /** Errors shared by every AI provider (lib/ai/*, lib/aiStore.ts). */
  provider: {
    network: 'Network unreachable — check your connection.',
    auth: 'The AI key was rejected — check it in Settings.',
    badKey: 'That AI key is not valid — check it in Settings.',
    rateLimit: 'Rate limit reached — try again later.',
    blocked: 'The model could not generate a response — try again.',
    empty: 'The model returned an empty response — try again.',
    http: 'AI request failed ({status})',
    noKey: 'Connect an AI model in Settings first.',
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
