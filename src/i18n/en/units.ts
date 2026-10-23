/** Units and counted nouns. `{n}` is the number. Owned by the i18n scaffold. */
export default {
  kg: 'kg',
  km: 'km',
  m: 'm',
  min: 'min',
  sec: 's',
  kcal: 'kcal',
  g: 'g',
  ml: 'ml',
  /** Appended to a rate unit: "%/wk". */
  perWeek: '/wk',
  pts: { one: '{n} pt', other: '{n} pts' },
  points: { one: '{n} point', other: '{n} points' },
  sets: { one: '{n} set', other: '{n} sets' },
  reps: { one: '{n} rep', other: '{n} reps' },
  workouts: { one: '{n} workout', other: '{n} workouts' },
  exercises: { one: '{n} exercise', other: '{n} exercises' },
  days: { one: '{n} day', other: '{n} days' },
  weeks: { one: '{n} week', other: '{n} weeks' },
  minutes: { one: '{n} minute', other: '{n} minutes' },
} as const
