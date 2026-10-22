import type { MuscleGroup } from '../types'
import type { LibraryExercise } from './exerciseLibrary'

/** Muscles drawn on the body map: the library's target muscles, cardio excluded. */
export const BODY_TARGETS = [
  'traps', 'levator scapulae', 'delts', 'pectorals', 'serratus anterior', 'biceps', 'triceps', 'forearms', 'abs',
  'upper back', 'lats', 'spine', 'glutes', 'abductors', 'adductors', 'quads', 'hamstrings', 'calves',
] as const
export type BodyTarget = typeof BODY_TARGETS[number]

export function isBodyTarget(s: string): s is BodyTarget {
  return (BODY_TARGETS as readonly string[]).includes(s)
}

/** Body-map regions for the dataset's secondary-muscle names (unknown names draw nothing). */
const SECONDARY_REGIONS: Record<string, BodyTarget[]> = {
  'shoulders': ['delts'],
  'deltoids': ['delts'],
  'rear deltoids': ['delts'],
  'rotator cuff': ['upper back'],
  'hamstrings': ['hamstrings'],
  'quadriceps': ['quads'],
  'hip flexors': ['quads'],
  'calves': ['calves'],
  'soleus': ['calves'],
  'ankles': ['calves'],
  'ankle stabilizers': ['calves'],
  'shins': ['calves'],
  'feet': ['calves'],
  'glutes': ['glutes'],
  'groin': ['adductors'],
  'inner thighs': ['adductors'],
  'core': ['abs'],
  'abdominals': ['abs'],
  'lower abs': ['abs'],
  'obliques': ['abs'],
  'lower back': ['spine'],
  'chest': ['pectorals'],
  'upper chest': ['pectorals'],
  'triceps': ['triceps'],
  'biceps': ['biceps'],
  'brachialis': ['biceps'],
  'forearms': ['forearms'],
  'wrists': ['forearms'],
  'wrist flexors': ['forearms'],
  'wrist extensors': ['forearms'],
  'hands': ['forearms'],
  'grip muscles': ['forearms'],
  'rhomboids': ['upper back'],
  'upper back': ['upper back'],
  'back': ['lats', 'upper back'],
  'latissimus dorsi': ['lats'],
  'lats': ['lats'],
  'trapezius': ['traps'],
  'traps': ['traps'],
  'sternocleidomastoid': ['levator scapulae'],
}

/** Regions for an exercise known only by its muscle group (a custom exercise without a library link). */
const GROUP_REGIONS: Record<MuscleGroup, { primary: BodyTarget[]; secondary: BodyTarget[] }> = {
  chest: { primary: ['pectorals'], secondary: ['delts', 'triceps'] },
  back: { primary: ['lats', 'upper back'], secondary: ['biceps'] },
  shoulders: { primary: ['delts'], secondary: ['traps'] },
  biceps: { primary: ['biceps'], secondary: ['forearms'] },
  triceps: { primary: ['triceps'], secondary: [] },
  legs: { primary: ['quads', 'hamstrings'], secondary: ['glutes', 'calves'] },
  glutes: { primary: ['glutes'], secondary: ['hamstrings'] },
  core: { primary: ['abs'], secondary: [] },
  cardio: { primary: [], secondary: [] },
  other: { primary: [], secondary: [] },
}

export interface Involvement {
  primary: BodyTarget[]
  secondary: BodyTarget[]
}

/** The body areas an exercise works: its library entry's target + secondary muscles, else its group's. */
export function involvement(lib: Pick<LibraryExercise, 'target' | 'secondary'> | undefined, group: MuscleGroup): Involvement {
  if (!lib) return GROUP_REGIONS[group]
  const primary = isBodyTarget(lib.target) ? [lib.target] : []
  const secondary = [...new Set(lib.secondary.flatMap(m => SECONDARY_REGIONS[m] ?? []))].filter(r => !primary.includes(r))
  return { primary, secondary }
}

export function hasInvolvement(inv: Involvement): boolean {
  return inv.primary.length > 0 || inv.secondary.length > 0
}
