import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeftRight, BookOpen, History, Search, StickyNote } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { db } from '../../db/db'
import Sheet from '../../components/Sheet'
import ExerciseThumb from '../../components/library/ExerciseThumb'
import ExerciseDetailSheet from '../../components/library/ExerciseDetailSheet'
import ExercisePicker from './ExercisePicker'
import {
  addLibraryExercise, filterLibrary, libEquipment, libMatchesGroup, libMuscleGroup, libraryIdOf, matchesQuery,
  targetGroup, targetLabel, useExerciseLibrary,
  type ExerciseLibrary, type LibraryExercise,
} from '../../lib/exerciseLibrary'
import { EQUIPMENT_LABEL, muscleGroupLabel } from '../../lib/equipment'
import { exerciseDisplayName } from '../../lib/exerciseNames'
import type { SessionItem } from '../../lib/sessionItems'
import { t } from '../../i18n'
import type { Equipment, Exercise, Id, MuscleGroup, Session, WorkoutTemplate } from '../../types'

/** Most swap candidates listed (my exercises first, then the library). */
const MAX_CANDIDATES = 30

/** "Also update the template" would put `toId` on a second line of the template (nothing written). */
export class SwapTemplateConflict extends Error {
  constructor() {
    super('swap target is already another line of the template')
    this.name = 'SwapTemplateConflict'
  }
}

/**
 * Swap the exercise of a live-session card for `toId`, for this session only.
 * - An added exercise (not a template line) is replaced in `Session.extraExerciseIds`, keeping
 *   its place (`sessionItems` never resolves added exercises through swaps). When it already
 *   has logged sets, `{ from, to }` is also appended to `Session.swaps`, only so those sets stay
 *   on a swapped-out card.
 * - A template line appends `{ from, to }` to `Session.swaps`; `sessionItems` applies the list
 *   in order and keeps a swapped-out exercise that has logged sets as a 0-target card.
 * - `updateTemplate` (template lines only): the template line written for this card now uses
 *   `toId` too (items mapped, `updatedAt` stamped like TemplateEditor). The session then gets a
 *   swap entry only when `from` already has logged sets (to keep them on a swapped-out card), and
 *   one more when an earlier swap would move the rewritten line away from `toId` (swapping back
 *   to the original): that entry brings the line back to `toId`. It throws `SwapTemplateConflict`
 *   (and writes nothing) when `toId` is already another line of the template, e.g. a line that
 *   was swapped away for this session: two lines would name it and the extra swap entry would
 *   undo that other line's swap.
 */
export async function swapSessionExercise(
  session: Pick<Session, 'id' | 'extraExerciseIds' | 'swaps'>,
  item: Pick<SessionItem, 'exerciseId' | 'swappedFrom'>,
  toId: Id,
  opts: {
    /** The card is one of the template's lines (the first `template.items.length` items). */
    fromTemplate: boolean
    /** This session already has sets of `item.exerciseId`. */
    hasLogged: boolean
    template?: Pick<WorkoutTemplate, 'id' | 'items'>
    updateTemplate?: boolean
  },
): Promise<void> {
  const from = item.exerciseId
  if (from === toId) return
  const sid = session.id!
  const tpl = opts.template
  const rewriteTemplate = !!opts.updateTemplate && opts.fromTemplate && tpl?.id !== undefined
  const origin = item.swappedFrom ?? from
  if (rewriteTemplate && tpl!.items.some(it => it.exerciseId !== origin && it.exerciseId === toId)) {
    throw new SwapTemplateConflict()
  }
  const swaps = session.swaps ?? []
  const addSwap = { swaps: [...swaps, { from, to: toId }] }
  await db.transaction('rw', db.sessions, db.templates, async () => {
    if (!opts.fromTemplate && session.extraExerciseIds.includes(from)) {
      const extras = session.extraExerciseIds.map(id => (id === from ? toId : id))
      await db.sessions.update(sid, {
        extraExerciseIds: extras.filter((id, i) => extras.indexOf(id) === i),
        ...(opts.hasLogged ? addSwap : {}),
      })
    } else if (!rewriteTemplate) {
      await db.sessions.update(sid, addSwap)
    } else {
      // A rewritten template line already shows `toId`; a swap entry is then only needed to keep
      // the swapped-out exercise's logged sets on a card, plus one that brings the line back to
      // `toId` when earlier entries would resolve it elsewhere (e.g. swapping back to A after A→B).
      const next = opts.hasLogged ? [...addSwap.swaps] : [...swaps]
      let lands = toId
      for (const s of next) if (s.from === lands && s.from !== s.to) lands = s.to
      if (lands !== toId) next.push({ from: lands, to: toId })
      if (next.length !== swaps.length) await db.sessions.update(sid, { swaps: next })
    }
    if (rewriteTemplate && tpl?.id !== undefined) {
      await db.templates.update(tpl.id, {
        items: tpl.items.map(it => (it.exerciseId === origin ? { ...it, exerciseId: toId } : it)),
        updatedAt: Date.now(),
      })
    }
  })
}

function MenuRow({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex min-h-[52px] w-full items-center gap-3 rounded-xl px-2 text-left font-medium active:bg-muted/40"
    >
      <Icon size={20} className="shrink-0 text-sub" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  )
}

/**
 * The "…" menu of a live-session exercise card: notes & settings (NoteSheet), how-to (linked
 * exercises), the exercise's history and "Swap exercise…". Mount it only while open (it loads
 * the exercise library for the how-to entry).
 */
export function CardMenuSheet({ onClose, exercise, onNotes, onSwap }: {
  onClose: () => void
  exercise: Exercise
  onNotes: () => void
  /** Absent: no swap entry (a swapped-out card). */
  onSwap?: () => void
}) {
  const navigate = useNavigate()
  const libId = libraryIdOf(exercise)
  const { library } = useExerciseLibrary()
  const lib = libId ? library?.byId.get(libId) : undefined
  const [howTo, setHowTo] = useState(false)

  return (
    <>
      <Sheet open onClose={onClose} title={exerciseDisplayName(exercise.name)}>
        <div className="space-y-1 pb-2">
          <MenuRow icon={StickyNote} label={t('workout.cardMenu.notes')} onClick={() => { onClose(); onNotes() }} />
          {lib && <MenuRow icon={BookOpen} label={t('library.howTo')} onClick={() => setHowTo(true)} />}
          <MenuRow
            icon={History}
            label={t('workout.cardMenu.history')}
            onClick={() => { onClose(); navigate(`/progress/exercise/${encodeURIComponent(String(exercise.id))}`) }}
          />
          {onSwap && (
            <MenuRow icon={ArrowLeftRight} label={t('workout.cardMenu.swap')} onClick={() => { onClose(); onSwap() }} />
          )}
        </div>
      </Sheet>
      {lib && (
        <ExerciseDetailSheet open={howTo} onClose={() => setHowTo(false)} library={library} lib={lib} exercise={exercise} />
      )}
    </>
  )
}

type Candidate =
  | { kind: 'mine'; key: string; e: Exercise; lib?: LibraryExercise; title: string; group: MuscleGroup; equipment?: Equipment }
  | { kind: 'lib'; key: string; lib: LibraryExercise; title: string; group: MuscleGroup; equipment: Equipment }

/**
 * Pure: swap candidates for `exercise`. Primary target = its library entry's target muscle,
 * else its muscle group. My exercises matching it (ExerciseBrowser's rules) come first, then
 * library entries not linked to one of my rows; within each, a different equipment first (a
 * busy rack is the usual reason to swap), then by name; capped at `MAX_CANDIDATES`.
 */
export function swapCandidates(
  exercise: Exercise,
  exercises: Exercise[],
  library: ExerciseLibrary | null,
  exclude: ReadonlySet<Id>,
  query: string,
): Candidate[] {
  const libId = libraryIdOf(exercise)
  const target = (libId ? library?.byId.get(libId) : undefined)?.target ?? null
  const group = exercise.muscleGroup
  const otherFirst = (a: Candidate, b: Candidate) =>
    Number(a.equipment === exercise.equipment) - Number(b.equipment === exercise.equipment) ||
    a.title.localeCompare(b.title)

  const linked = new Set<string>()
  const mine: Candidate[] = []
  for (const e of exercises) {
    const id = libraryIdOf(e)
    if (id) linked.add(id)
    if (e.id === undefined || exclude.has(e.id) || e.id === exercise.id) continue
    const lib = id ? library?.byId.get(id) : undefined
    const title = exerciseDisplayName(e.name)
    const matches = target
      ? (lib ? lib.target === target : targetGroup(target) === e.muscleGroup)
      : e.muscleGroup === group || (!!lib && libMatchesGroup(lib, group))
    if (matches && matchesQuery(`${e.name} ${title}`, query)) {
      mine.push({ kind: 'mine', key: `m-${e.id}`, e, lib, title, group: e.muscleGroup, equipment: e.equipment })
    }
  }
  mine.sort(otherFirst)

  const fromLib: Candidate[] = library
    ? filterLibrary(library.exercises, target
      ? { query, group: 'all', equipment: 'all', target }
      : { query, group, equipment: 'all', target: null })
      .filter(lib => !linked.has(lib.id))
      .map(lib => ({
        kind: 'lib' as const, key: `l-${lib.id}`, lib, title: lib.name, group: libMuscleGroup(lib), equipment: libEquipment(lib),
      }))
      .sort(otherFirst)
    : []

  return [...mine, ...fromLib].slice(0, MAX_CANDIDATES)
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <p className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-sub">{children}</p>
}

/**
 * "Swap exercise…": similar exercises (same target muscle, else muscle group) to do instead in
 * this session, a search box, and the full picker as a fallback. Mount it only while open.
 */
export function SwapSheet({ onClose, session, template, item, exercise, fromTemplate, hasLogged, exclude }: {
  onClose: () => void
  session: Session
  template?: WorkoutTemplate
  item: SessionItem
  exercise: Exercise
  fromTemplate: boolean
  hasLogged: boolean
  /**
   * Exercises that already have a card in this session, except swapped-out cards (swapping
   * back to one of those is allowed).
   */
  exclude: ReadonlySet<Id>
}) {
  const { library, failed } = useExerciseLibrary()
  const exercises = useLiveQuery(() => db.exercises.toArray())
  const [q, setQ] = useState('')
  const [updateTemplate, setUpdateTemplate] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const candidates = useMemo(
    () => swapCandidates(exercise, exercises ?? [], library, exclude, q),
    [exercise, exercises, library, exclude, q],
  )
  const libId = libraryIdOf(exercise)
  const target = (libId ? library?.byId.get(libId) : undefined)?.target
  const muscle = target ? targetLabel(target) : muscleGroupLabel(exercise.muscleGroup)
  const canUpdateTemplate = fromTemplate && template?.id !== undefined

  async function pick(get: () => Promise<Exercise>) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const to = await get()
      if (to.id === undefined || to.id === item.exerciseId) return onClose()
      if (exclude.has(to.id)) {
        setPickerOpen(false)
        setError(t('workout.swap.alreadyInSession'))
        return
      }
      await swapSessionExercise(session, item, to.id, {
        fromTemplate, hasLogged, template, updateTemplate: canUpdateTemplate && updateTemplate,
      })
      onClose()
    } catch (e) {
      setPickerOpen(false)
      setError(t(e instanceof SwapTemplateConflict ? 'workout.swap.alreadyInTemplate' : 'workout.swap.failed'))
    } finally {
      setBusy(false)
    }
  }

  const firstLib = candidates.findIndex(c => c.kind === 'lib')
  return (
    <>
      <Sheet open onClose={onClose} title={t('workout.swap.title', { name: exerciseDisplayName(exercise.name) })}>
        <p className="mb-2 truncate text-sm text-sub">{t('workout.swap.sameMuscle', { muscle })}</p>
        <div className="mb-2 flex min-w-0 items-center gap-2 rounded-xl bg-card px-3">
          <Search size={18} className="shrink-0 text-sub" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder={t('workout.picker.search')}
            className="min-h-[48px] w-full min-w-0 text-base"
          />
        </div>

        {canUpdateTemplate && (
          <button
            type="button"
            role="switch"
            aria-checked={updateTemplate}
            onClick={() => setUpdateTemplate(v => !v)}
            className="mb-1 flex min-h-[44px] w-full min-w-0 items-center gap-2.5 py-1 text-left"
          >
            <span
              aria-hidden
              className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors ${
                updateTemplate ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span className={`absolute left-0.5 h-5 w-5 rounded-full bg-ink shadow transition-transform ${updateTemplate ? 'translate-x-4' : ''}`} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold leading-tight">{t('workout.swap.updateTemplate')}</span>
              <span className="mt-0.5 block truncate text-xs text-sub">
                {t('workout.swap.updateTemplateHint', { name: template!.name })}
              </span>
            </span>
          </button>
        )}

        {error && (
          <p role="alert" className="mb-2 rounded-xl bg-danger/15 px-3 py-2 text-sm font-medium text-danger">{error}</p>
        )}

        <ul className="divide-y divide-edge/50">
          {candidates.map((c, i) => (
            <li key={c.key}>
              {i === 0 && c.kind === 'mine' && <SectionTitle>{t('workout.swap.mine')}</SectionTitle>}
              {i === firstLib && <SectionTitle>{t('workout.swap.library')}</SectionTitle>}
              <button
                onClick={() => void pick(c.kind === 'mine' ? async () => c.e : () => addLibraryExercise(c.lib))}
                disabled={busy}
                aria-label={t('workout.swap.pickNamed', { name: c.title })}
                className="flex min-h-[60px] w-full min-w-0 items-center gap-3 py-2 pl-1 text-left active:bg-muted/30 disabled:opacity-40"
              >
                <ExerciseThumb library={library} lib={c.lib} equipment={c.equipment} group={c.group} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{c.title}</span>
                  <span className="block truncate text-xs text-sub">
                    {[c.lib ? targetLabel(c.lib.target) : muscleGroupLabel(c.group), c.equipment && EQUIPMENT_LABEL[c.equipment]]
                      .filter(Boolean).join(' · ')}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {candidates.length === 0 && (library || failed) && (
          <p className="py-4 text-center text-sm text-sub">{t('workout.swap.none')}</p>
        )}
        {!library && !failed && <p className="py-4 text-center text-sm text-sub">{t('library.browser.loading')}</p>}

        <button
          onClick={() => setPickerOpen(true)}
          disabled={busy}
          className="mb-2 mt-3 w-full rounded-xl bg-muted/40 py-3 text-sm font-semibold text-ink active:bg-muted disabled:opacity-40"
        >
          {t('workout.swap.fullPicker')}
        </button>
      </Sheet>
      <ExercisePicker open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={e => void pick(async () => e)} />
    </>
  )
}
