import { getLang } from './uiStore'

/**
 * Italian names of the built-in catalog (`ROWS` in src/db/seed.ts), keyed by the English name.
 * The names Italian gyms actually use: many lifts keep their English name (Hip Thrust, Leg Press,
 * Lat Machine…), the classics have Italian ones (Panca piana, Stacco da terra, Lento avanti…).
 * Every catalog name has an entry (exerciseNames.test.ts checks it against the seed).
 */
const IT: Record<string, string> = {
  // Chest
  'Bench Press': 'Panca piana',
  'Incline Bench Press': 'Panca inclinata',
  'Dumbbell Bench Press': 'Panca piana con manubri',
  'Incline Dumbbell Press': 'Panca inclinata con manubri',
  'Chest Press Machine': 'Chest Press',
  'Chest Fly': 'Croci con manubri',
  'Cable Crossover': 'Croci ai cavi',
  'Pec Deck': 'Pec Deck',
  'Push-Up': 'Piegamenti',
  'Dips': 'Dip',
  // Back
  'Deadlift': 'Stacco da terra',
  'Pull-Up': 'Trazioni',
  'Chin-Up': 'Trazioni supine',
  'Lat Pulldown': 'Lat Machine',
  'Barbell Row': 'Rematore con bilanciere',
  'Dumbbell Row': 'Rematore con manubrio',
  'Seated Cable Row': 'Pulley basso',
  'T-Bar Row': 'Rematore T-bar',
  'Straight-Arm Pulldown': 'Pullover al cavo',
  'Back Extension': 'Iperestensioni',
  // Shoulders
  'Overhead Press': 'Lento avanti',
  'Seated Dumbbell Press': 'Lento con manubri',
  'Arnold Press': 'Arnold Press',
  'Lateral Raise': 'Alzate laterali',
  'Cable Lateral Raise': 'Alzate laterali ai cavi',
  'Front Raise': 'Alzate frontali',
  'Rear Delt Fly': 'Alzate posteriori',
  'Face Pull': 'Face Pull',
  'Upright Row': 'Tirate al mento',
  'Shrug': 'Scrollate',
  // Biceps
  'Barbell Curl': 'Curl con bilanciere',
  'Dumbbell Curl': 'Curl con manubri',
  'Hammer Curl': 'Hammer Curl',
  'Incline Dumbbell Curl': 'Curl su panca inclinata',
  'Preacher Curl': 'Curl alla panca Scott',
  'Cable Curl': 'Curl ai cavi',
  // Triceps
  'Close-Grip Bench Press': 'Panca presa stretta',
  'Skull Crusher': 'French Press',
  'Triceps Pushdown': 'Pushdown ai cavi',
  'Overhead Triceps Extension': 'Estensioni sopra la testa ai cavi',
  'Triceps Dip Machine': 'Dip Machine',
  // Legs
  'Squat': 'Squat',
  'Front Squat': 'Front Squat',
  'Goblet Squat': 'Goblet Squat',
  'Leg Press': 'Leg Press',
  'Hack Squat': 'Hack Squat',
  'Romanian Deadlift': 'Stacco rumeno',
  'Sumo Deadlift': 'Stacco sumo',
  'Leg Extension': 'Leg Extension',
  'Leg Curl': 'Leg Curl',
  'Bulgarian Split Squat': 'Squat bulgaro',
  'Walking Lunge': 'Affondi in camminata',
  'Standing Calf Raise': 'Calf in piedi',
  'Seated Calf Raise': 'Calf da seduto',
  // Glutes
  'Hip Thrust': 'Hip Thrust',
  'Glute Kickback': 'Kickback ai cavi',
  'Hip Abduction': 'Abductor Machine',
  // Core
  'Plank': 'Plank',
  'Crunch': 'Crunch',
  'Cable Crunch': 'Crunch ai cavi',
  'Hanging Leg Raise': 'Leg raise alla sbarra',
  'Russian Twist': 'Russian Twist',
  'Ab Wheel Rollout': 'Ruota addominale',
  // Cardio
  'Treadmill Run': 'Tapis roulant',
  'Rowing Machine': 'Vogatore',
  'Stationary Bike': 'Cyclette',
  'Jump Rope': 'Salto con la corda',
}

/** English catalog names translated (the keys of the map above). */
export const CATALOG_NAMES_TRANSLATED: readonly string[] = Object.keys(IT)

/**
 * Display names for the built-in exercise catalog. The database keeps the English names (they are
 * synced data and the seed's identity); screens show `exerciseDisplayName(name)`, which translates a
 * catalog name into the UI language and leaves custom names alone. Never store its result.
 */
export function exerciseDisplayName(name: string): string {
  if (getLang() !== 'it') return name
  return IT[name] ?? name
}
