import { Link } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import ExerciseBrowser from '../../components/library/ExerciseBrowser'
import { useExerciseLibrary } from '../../lib/exerciseLibrary'
import { useT } from '../../i18n'

/** `/workout/exercises`: browse my exercises and the exercise library; add one to a template. */
export default function ExerciseLibrary() {
  const { t, fmtNum } = useT()
  const { library } = useExerciseLibrary()

  return (
    <div className="pt-4">
      <div className="mb-4 flex items-center gap-2">
        <Link
          to="/workout"
          aria-label={t('common.back')}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sub active:bg-muted/40"
        >
          <ChevronLeft size={24} />
        </Link>
        <div className="min-w-0">
          <h1 className="truncate font-display text-3xl font-bold">{t('library.screen.title')}</h1>
          {library && (
            <p className="truncate text-sm text-sub">{t('library.screen.subtitle', { n: fmtNum(library.exercises.length) })}</p>
          )}
        </div>
      </div>

      <ExerciseBrowser mode="browse" />

      <p className="mt-6 text-center text-[11px] text-sub">{t('library.screen.credit')}</p>
    </div>
  )
}
