import { useState } from 'react'
import { Cable, CircleDot, Cog, Dumbbell, HeartPulse, PersonStanding } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useUiStore } from '../../lib/uiStore'
import { mediaUrls, type ExerciseLibrary, type LibraryExercise } from '../../lib/exerciseLibrary'
import type { Equipment, MuscleGroup } from '../../types'

const EQUIPMENT_ICON: Record<Equipment, LucideIcon> = {
  barbell: Dumbbell,
  dumbbell: Dumbbell,
  machine: Cog,
  cable: Cable,
  bodyweight: PersonStanding,
  other: CircleDot,
}

interface Props {
  library: ExerciseLibrary | null
  lib?: LibraryExercise
  equipment?: Equipment
  group: MuscleGroup
}

/**
 * A row's 48 px thumbnail: the dataset's image when "Exercise animations" is on (Settings) and the
 * row has a library entry, else an equipment icon. A failed image falls back to the icon.
 */
export default function ExerciseThumb({ library, lib, equipment, group }: Props) {
  const showMedia = useUiStore(s => s.showExerciseMedia)
  const [broken, setBroken] = useState(false)
  if (showMedia && library && lib && !broken) {
    return (
      <img
        src={mediaUrls(library, lib).thumb}
        alt=""
        loading="lazy"
        crossOrigin="anonymous"
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className="h-12 w-12 shrink-0 rounded-lg bg-white object-cover"
      />
    )
  }
  const Icon = group === 'cardio' ? HeartPulse : EQUIPMENT_ICON[equipment ?? 'other']
  return (
    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted/40 text-sub" aria-hidden>
      <Icon size={22} />
    </span>
  )
}
