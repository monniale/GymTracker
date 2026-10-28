import type { Dict } from '../en'

const units: Dict['units'] = {
  kg: 'kg',
  km: 'km',
  m: 'm',
  min: 'min',
  sec: 's',
  kcal: 'kcal',
  g: 'g',
  ml: 'ml',
  perWeek: '/sett.',
  pts: { one: '{n} pt', other: '{n} pt' },
  points: { one: '{n} punto', other: '{n} punti' },
  sets: { one: '{n} serie', other: '{n} serie' },
  reps: { one: '{n} rip.', other: '{n} rip.' },
  workouts: { one: '{n} allenamento', other: '{n} allenamenti' },
  exercises: { one: '{n} esercizio', other: '{n} esercizi' },
  days: { one: '{n} giorno', other: '{n} giorni' },
  weeks: { one: '{n} settimana', other: '{n} settimane' },
  minutes: { one: '{n} minuto', other: '{n} minuti' },
}

export default units
