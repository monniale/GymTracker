import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import Sheet from '../Sheet'
import { useUiStore } from '../../lib/uiStore'
import { EQUIPMENT_LABEL, muscleGroupLabel } from '../../lib/equipment'
import { exerciseDisplayName } from '../../lib/exerciseNames'
import {
  libEquipment, libMuscleGroup, mediaUrls, secondaryLabel, stepsFor, targetLabel,
  type ExerciseLibrary, type LibraryExercise,
} from '../../lib/exerciseLibrary'
import { useT } from '../../i18n'
import type { Exercise } from '../../types'

interface Props {
  open: boolean
  onClose: () => void
  library: ExerciseLibrary | null
  /** The library entry (absent for a custom exercise with no link). */
  lib?: LibraryExercise
  /** The user's row, when the detail is for one of their exercises. */
  exercise?: Exercise
  /** Action buttons under the instructions. */
  children?: ReactNode
}

/** One exercise: animation (opt-in), muscles, equipment and step-by-step instructions. */
export default function ExerciseDetailSheet({ open, onClose, library, lib, exercise, children }: Props) {
  const { t, lang } = useT()
  const showMedia = useUiStore(s => s.showExerciseMedia)
  const title = exercise ? exerciseDisplayName(exercise.name) : lib?.name ?? ''
  const group = exercise?.muscleGroup ?? (lib ? libMuscleGroup(lib) : 'other')
  const equipment = exercise?.equipment ?? (lib ? libEquipment(lib) : undefined)
  const steps = lib ? stepsFor(lib, lang) : []
  const secondary = lib ? [...new Set(lib.secondary.map(secondaryLabel))].filter(s => s !== targetLabel(lib.target)) : []

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {showMedia && library && lib && <Animation key={lib.id} src={mediaUrls(library, lib).gif} credit={library.attribution} />}

      <div className="mb-4 flex flex-wrap gap-1.5">
        {lib && (
          <span className="whitespace-nowrap rounded-full bg-primary/15 px-2.5 py-1 text-xs font-semibold text-primary">
            {targetLabel(lib.target)}
          </span>
        )}
        <span className="whitespace-nowrap rounded-full bg-muted/40 px-2.5 py-1 text-xs text-sub">{muscleGroupLabel(group)}</span>
        {equipment && (
          <span className="whitespace-nowrap rounded-full bg-muted/40 px-2.5 py-1 text-xs text-sub">{EQUIPMENT_LABEL[equipment]}</span>
        )}
      </div>

      {secondary.length > 0 && (
        <>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-sub">{t('library.detail.secondary')}</h3>
          <p className="mb-4 text-sm">{secondary.join(', ')}</p>
        </>
      )}

      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-sub">{t('library.detail.howTo')}</h3>
      {steps.length > 0 ? (
        <ol className="mb-4 space-y-2">
          {steps.map((step, i) => (
            <li key={i} className="flex gap-3 text-sm leading-snug">
              <span className="num flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted/50 text-xs font-bold text-sub">
                {i + 1}
              </span>
              <span className="min-w-0 pt-0.5">{step}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mb-4 text-sm text-sub">{t('library.detail.noSteps')}</p>
      )}

      {children}
    </Sheet>
  )
}

/** The 180×180 GIF, scaled up on a white tile like the dataset's own browser, with its credit. */
function Animation({ src, credit }: { src: string; credit: string }) {
  const { t } = useT()
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  useEffect(() => setState('loading'), [src])
  return (
    <figure className="mb-4">
      <div className="relative mx-auto flex aspect-square w-full max-w-[260px] items-center justify-center overflow-hidden rounded-2xl bg-white">
        {state !== 'failed' && (
          <img
            src={src}
            alt=""
            crossOrigin="anonymous"
            referrerPolicy="no-referrer"
            onLoad={() => setState('ready')}
            onError={() => setState('failed')}
            className={`h-full w-full object-contain ${state === 'ready' ? '' : 'opacity-0'}`}
          />
        )}
        {state !== 'ready' && (
          <p className="absolute inset-x-4 text-center text-xs text-slate-500">
            {state === 'failed' ? t('library.detail.mediaFailed') : t('library.detail.mediaLoading')}
          </p>
        )}
      </div>
      <figcaption className="mt-1 text-center text-[11px] text-sub">{credit}</figcaption>
    </figure>
  )
}
