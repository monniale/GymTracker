import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, Info, Plus, Search, PersonStanding, X } from 'lucide-react'
import { db } from '../../db/db'
import { EQUIPMENTS, EQUIPMENT_LABEL, MUSCLE_GROUPS, muscleGroupLabel } from '../../lib/equipment'
import { exerciseDisplayName } from '../../lib/exerciseNames'
import { defaultTemplateItem } from '../../lib/cardio'
import {
  addLibraryExercise, filterLibrary, libEquipment, libMatchesGroup, libMuscleGroup, libraryIdOf, matchesQuery,
  targetCounts, targetGroup, targetLabel, useExerciseLibrary,
  type ExerciseLibrary, type LibraryExercise, type LibraryFilter,
} from '../../lib/exerciseLibrary'
import ChipScroller from '../ChipScroller'
import ExerciseThumb from './ExerciseThumb'
import ExerciseDetailSheet from './ExerciseDetailSheet'
import BodyMap, { type BodyTarget } from './BodyMap'
import { useT } from '../../i18n'
import type { Equipment, Exercise, MuscleGroup, WorkoutTemplate } from '../../types'

/** Library rows rendered per "Show more" step (1,300 rows at once would stall a phone). */
const PAGE = 40

interface Props {
  /** 'pick': tap one of my exercises to pick it, "+" adds a library one. 'browse': rows open the detail. */
  mode: 'pick' | 'browse'
  onPick?: (exercise: Exercise) => void
  /** Pick mode: the "create custom exercise" block, shown when nothing has exactly the typed name. */
  renderCreate?: (query: string) => ReactNode
  /** Called on every search edit (the picker resets its create form). */
  onQueryChange?: (query: string) => void
}

interface MineRow {
  e: Exercise
  label: string
  lib?: LibraryExercise
}

type Detail = { lib?: LibraryExercise; exercise?: Exercise }

/**
 * Search + filter the user's exercises and the exercise library together (OpenGym-style): muscle
 * group and equipment chips, a body map for target muscles, thumbnails, and a detail sheet with
 * instructions. Shared by the "Add exercise" picker and the Exercises screen.
 */
export default function ExerciseBrowser({ mode, onPick, renderCreate, onQueryChange }: Props) {
  const { t, fmtNum } = useT()
  const { library, failed, retry } = useExerciseLibrary()
  const exercises = useLiveQuery(() => db.exercises.toArray())
  const [q, setQ] = useState('')
  const [group, setGroup] = useState<MuscleGroup | 'all'>('all')
  const [equipment, setEquipment] = useState<Equipment | 'all'>('all')
  const [target, setTarget] = useState<string | null>(null)
  const [mapOpen, setMapOpen] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filter: LibraryFilter = useMemo(() => ({ query: q, group, equipment, target }), [q, group, equipment, target])
  useEffect(() => setLimit(PAGE), [filter])

  // Library id → my exercise linked to it (the first one, when two rows share an entry).
  const linkedTo = useMemo(() => {
    const map = new Map<string, Exercise>()
    for (const e of exercises ?? []) {
      const id = libraryIdOf(e)
      if (id && !map.has(id)) map.set(id, e)
    }
    return map
  }, [exercises])
  const linked = useMemo(() => new Set(linkedTo.keys()), [linkedTo])

  // My exercises: search on the stored and the shown name; a target filter matches the linked
  // entry's target, or for a custom row without a link, the target's muscle group.
  const mine: MineRow[] = useMemo(() => {
    const rows = (exercises ?? []).map(e => {
      const id = libraryIdOf(e)
      return { e, label: exerciseDisplayName(e.name), lib: id ? library?.byId.get(id) : undefined }
    })
    return rows
      .filter(({ e, label, lib }) =>
        (!q.trim() || matchesQuery(`${e.name} ${label}`, q)) &&
        (group === 'all' || e.muscleGroup === group || (!!lib && libMatchesGroup(lib, group))) &&
        (equipment === 'all' || e.equipment === equipment) &&
        (!target || (lib ? lib.target === target : targetGroup(target) === e.muscleGroup)))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [exercises, library, q, group, equipment, target])

  const libRows = useMemo(
    () => (library ? filterLibrary(library.exercises, filter).filter(lib => !linked.has(lib.id)) : []),
    [library, filter, linked],
  )
  const counts = useMemo(() => (library ? targetCounts(library.exercises, filter) : {}), [library, filter])

  const query = q.trim().toLowerCase()
  const exactMatch = !!query && (
    (exercises ?? []).some(e => e.nameLower === query || exerciseDisplayName(e.name).toLowerCase() === query) ||
    !!library?.exercises.some(lib => lib.name.toLowerCase() === query))

  const filtered = !!query || group !== 'all' || equipment !== 'all' || !!target

  function search(value: string) {
    setQ(value)
    onQueryChange?.(value)
  }

  async function pickLibrary(lib: LibraryExercise) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const e = await addLibraryExercise(lib)
      setDetail(null)
      onPick?.(e)
    } catch {
      setError(t('library.browser.addFailed'))
    } finally {
      setBusy(false)
    }
  }

  function pickMine(e: Exercise) {
    setDetail(null)
    onPick?.(e)
  }

  return (
    <div>
      <div className="mb-3 flex gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-card px-3">
          <Search size={18} className="shrink-0 text-sub" />
          <input
            value={q}
            onChange={e => search(e.target.value)}
            placeholder={t('workout.picker.search')}
            className="min-h-[48px] w-full min-w-0 text-base"
          />
        </div>
        <button
          onClick={() => setMapOpen(o => !o)}
          aria-pressed={mapOpen}
          aria-label={t('library.browser.byMuscle')}
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${
            mapOpen || target ? 'bg-primary/15 text-primary' : 'bg-card text-sub active:bg-muted'
          }`}
        >
          <PersonStanding size={22} />
        </button>
      </div>

      {mapOpen && (
        <div className="mb-3">
          <p className="mb-2 text-xs text-sub">{t('library.browser.bodyMapHint')}</p>
          <BodyMap
            counts={counts as Partial<Record<BodyTarget, number>>}
            selected={target as BodyTarget | null}
            onSelect={sel => setTarget(sel)}
            labelFor={targetLabel}
            frontLabel={t('library.browser.front')}
            backLabel={t('library.browser.back')}
          />
        </div>
      )}

      <ChipScroller className="mb-2">
        {target && (
          <button
            onClick={() => setTarget(null)}
            aria-label={t('library.browser.clearMuscle')}
            className="flex min-h-[36px] shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-primary px-3 text-sm font-medium text-bg"
          >
            {targetLabel(target)} <X size={14} />
          </button>
        )}
        <Chip active={group === 'all'} onClick={() => setGroup('all')}>{t('workout.picker.all')}</Chip>
        {MUSCLE_GROUPS.map(m => (
          <Chip key={m} active={group === m} onClick={() => setGroup(group === m ? 'all' : m)}>{muscleGroupLabel(m)}</Chip>
        ))}
      </ChipScroller>
      <ChipScroller className="mb-3">
        <Chip active={equipment === 'all'} onClick={() => setEquipment('all')}>{t('workout.picker.all')}</Chip>
        {EQUIPMENTS.map(eq => (
          <Chip key={eq} active={equipment === eq} onClick={() => setEquipment(equipment === eq ? 'all' : eq)}>
            {EQUIPMENT_LABEL[eq]}
          </Chip>
        ))}
      </ChipScroller>

      {error && (
        <p role="alert" className="mb-3 rounded-xl bg-danger/15 px-3 py-2 text-sm font-medium text-danger">{error}</p>
      )}

      {/* Wait for the library before offering "create": an exact library name would be a duplicate. */}
      {mode === 'pick' && query && !exactMatch && (library || failed) && renderCreate?.(q.trim())}

      {mine.length > 0 && (
        <SectionTitle>{`${t('library.browser.mine')} · ${fmtNum(mine.length)}`}</SectionTitle>
      )}
      <ul className="mb-4 divide-y divide-edge/50">
        {mine.map(({ e, label, lib }) => (
          <Row
            key={e.id}
            library={library}
            lib={lib}
            equipment={e.equipment}
            group={e.muscleGroup}
            title={label}
            subtitle={subtitleFor(lib, e.muscleGroup, e.equipment)}
            onOpen={() => (mode === 'pick' ? pickMine(e) : setDetail({ lib, exercise: e }))}
            action={mode === 'pick' && lib ? (
              <button
                onClick={() => setDetail({ lib, exercise: e })}
                aria-label={t('library.browser.howToNamed', { name: label })}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sub active:bg-muted/40"
              >
                <Info size={18} />
              </button>
            ) : undefined}
          />
        ))}
        {mine.length === 0 && failed && (
          <li className="py-6 text-center text-sm text-sub">
            {filtered ? t('workout.picker.noMatch') : t('workout.picker.empty')}
          </li>
        )}
      </ul>

      {library ? (
        <>
          <SectionTitle>{`${t('library.browser.library')} · ${fmtNum(libRows.length)}`}</SectionTitle>
          <ul className="divide-y divide-edge/50">
            {libRows.slice(0, limit).map(lib => (
              <Row
                key={lib.id}
                library={library}
                lib={lib}
                equipment={libEquipment(lib)}
                group={libMuscleGroup(lib)}
                title={lib.name}
                subtitle={subtitleFor(lib, libMuscleGroup(lib), libEquipment(lib))}
                onOpen={() => setDetail({ lib })}
                action={mode === 'pick' ? (
                  <button
                    onClick={() => void pickLibrary(lib)}
                    disabled={busy}
                    aria-label={t('library.browser.addNamed', { name: lib.name })}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary active:bg-primary/25 disabled:opacity-40"
                  >
                    <Plus size={20} />
                  </button>
                ) : undefined}
              />
            ))}
            {libRows.length === 0 && (
              <li className="py-6 text-center text-sm text-sub">{t('library.browser.noLibraryMatch')}</li>
            )}
          </ul>
          {libRows.length > limit && (
            <button
              onClick={() => setLimit(l => l + PAGE * 2)}
              className="mt-3 w-full rounded-xl bg-muted/40 py-3 text-sm font-semibold text-sub active:bg-muted"
            >
              {t('library.browser.showMore', { n: fmtNum(libRows.length - limit) })}
            </button>
          )}
        </>
      ) : failed ? (
        <div className="py-4 text-center text-sm text-sub">
          <p className="mb-2">{t('library.browser.loadFailed')}</p>
          <button onClick={retry} className="min-h-[44px] rounded-xl bg-muted/40 px-4 font-semibold text-ink active:bg-muted">
            {t('library.browser.retry')}
          </button>
        </div>
      ) : (
        <p className="py-4 text-center text-sm text-sub">{t('library.browser.loading')}</p>
      )}

      <ExerciseDetailSheet
        open={!!detail}
        onClose={() => setDetail(null)}
        library={library}
        lib={detail?.lib}
        exercise={detail?.exercise}
        // Browse only: a picker sheet (template editor, live workout) is not a place to leave from.
        historyExerciseId={mode === 'browse' ? (detail?.exercise ?? (detail?.lib ? linkedTo.get(detail.lib.id) : undefined))?.id : undefined}
      >
        {detail && mode === 'pick' && (
          <button
            onClick={() => (detail.exercise ? pickMine(detail.exercise) : detail.lib && void pickLibrary(detail.lib))}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-display text-lg font-bold text-bg active:opacity-90 disabled:opacity-40"
          >
            <Plus size={20} /> {t('workout.shared.addExercise')}
          </button>
        )}
        {detail && mode === 'browse' && <TemplateAdder key={detail.lib?.id ?? String(detail.exercise?.id)} detail={detail} />}
      </ExerciseDetailSheet>
    </div>
  )
}

function subtitleFor(lib: LibraryExercise | undefined, group: MuscleGroup, equipment: Equipment | undefined): string {
  const muscle = lib ? targetLabel(lib.target) : muscleGroupLabel(group)
  return equipment ? `${muscle} · ${EQUIPMENT_LABEL[equipment]}` : muscle
}

interface RowProps {
  library: ExerciseLibrary | null
  lib?: LibraryExercise
  equipment?: Equipment
  group: MuscleGroup
  title: string
  subtitle: string
  onOpen: () => void
  action?: ReactNode
}

function Row({ library, lib, equipment, group, title, subtitle, onOpen, action }: RowProps) {
  return (
    <li className="flex items-center gap-2">
      <button onClick={onOpen} className="flex min-h-[60px] min-w-0 flex-1 items-center gap-3 py-2 pl-1 text-left active:bg-muted/30">
        <ExerciseThumb library={library} lib={lib} equipment={equipment} group={group} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{title}</span>
          <span className="block truncate text-xs text-sub">{subtitle}</span>
        </span>
      </button>
      {action}
    </li>
  )
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-sub">{children}</h3>
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-[36px] shrink-0 whitespace-nowrap rounded-full px-3 text-sm font-medium ${
        active ? 'bg-primary text-bg' : 'bg-muted/40 text-sub active:bg-muted'
      }`}
    >
      {children}
    </button>
  )
}

/** Browse mode: append the exercise to one of the templates (adding it from the library first). */
function TemplateAdder({ detail }: { detail: Detail }) {
  const { t } = useT()
  const navigate = useNavigate()
  const templates = useLiveQuery(() => db.templates.orderBy('position').toArray())
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const [failed, setFailed] = useState(false)

  /** No template yet: make one holding this exercise and open it in the editor (to rename it). */
  async function createFirst() {
    setFailed(false)
    try {
      const e = detail.exercise ?? (detail.lib ? await addLibraryExercise(detail.lib) : undefined)
      if (!e) return
      const id = await db.templates.add({
        name: t('workout.home.newTemplateName'),
        position: 0,
        items: [defaultTemplateItem(e)],
        updatedAt: Date.now(),
      })
      navigate(`/workout/template/${id}`)
    } catch {
      setFailed(true)
    }
  }

  async function add(tpl: WorkoutTemplate) {
    setFailed(false)
    try {
      const e = detail.exercise ?? (detail.lib ? await addLibraryExercise(detail.lib) : undefined)
      if (!e) return
      if (tpl.items.some(it => String(it.exerciseId) === String(e.id))) {
        setMessage(t('library.detail.alreadyIn', { name: tpl.name }))
        return
      }
      await db.templates.update(tpl.id!, { items: [...tpl.items, defaultTemplateItem(e)], updatedAt: Date.now() })
      setMessage(t('library.detail.addedTo', { name: tpl.name }))
      setOpen(false)
    } catch {
      setFailed(true)
    }
  }

  return (
    <div>
      {failed && <p role="alert" className="mb-2 text-sm font-medium text-danger">{t('library.browser.addFailed')}</p>}
      {message && (
        <p role="status" className="mb-2 flex items-center gap-1.5 text-sm font-medium text-accent">
          <Check size={16} className="shrink-0" /> {message}
        </p>
      )}
      {!open ? (
        <button
          onClick={() => { setOpen(true); setMessage(null) }}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-display text-lg font-bold text-bg active:opacity-90"
        >
          <Plus size={20} /> {t('library.detail.addToTemplate')}
        </button>
      ) : (
        <div className="rounded-xl border border-edge bg-card p-3">
          <p className="mb-2 text-sm font-medium">{t('library.detail.chooseTemplate')}</p>
          {templates && templates.length > 0 ? (
            <div className="flex flex-col gap-2">
              {templates.map(tpl => (
                <button
                  key={tpl.id}
                  onClick={() => void add(tpl)}
                  className="min-h-[44px] truncate rounded-xl bg-muted/40 px-3 text-left font-medium active:bg-muted"
                >
                  {tpl.name}
                </button>
              ))}
            </div>
          ) : templates ? (
            <>
              <p className="mb-2 text-sm text-sub">{t('library.detail.noTemplates')}</p>
              <button
                onClick={() => void createFirst()}
                className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-primary/15 px-3 font-semibold text-primary active:bg-primary/25"
              >
                <Plus size={18} className="shrink-0" /> {t('library.detail.createFirstTemplate')}
              </button>
            </>
          ) : null}
        </div>
      )}
    </div>
  )
}
