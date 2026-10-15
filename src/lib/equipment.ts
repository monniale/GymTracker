import { t } from '../i18n'
import type { Equipment, MuscleGroup } from '../types'

/** Ordered equipment options for selectors/filters. */
export const EQUIPMENTS: Equipment[] = ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'other']

/** Equipment names in the UI language (built at load; a language change reloads the app). */
export const EQUIPMENT_LABEL: Record<Equipment, string> = {
  barbell: t('lib.equipment.barbell'),
  dumbbell: t('lib.equipment.dumbbell'),
  machine: t('lib.equipment.machine'),
  cable: t('lib.equipment.cable'),
  bodyweight: t('lib.equipment.bodyweight'),
  other: t('lib.equipment.other'),
}

/** A muscle group in the UI language, for display ("legs" → "Legs" / "Gambe"). The stored value stays the key. */
export function muscleGroupLabel(group: MuscleGroup): string {
  return t(`lib.muscles.${group}`)
}
