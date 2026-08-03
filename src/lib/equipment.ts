import type { Equipment } from '../types'

/** Ordered equipment options for selectors/filters. */
export const EQUIPMENTS: Equipment[] = ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'other']

export const EQUIPMENT_LABEL: Record<Equipment, string> = {
  barbell: 'Barbell',
  dumbbell: 'Dumbbell',
  machine: 'Machine',
  cable: 'Cable',
  bodyweight: 'Bodyweight',
  other: 'Other',
}
