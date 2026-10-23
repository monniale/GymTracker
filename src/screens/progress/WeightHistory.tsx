import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, ChevronDown, Plus, Trash2, TrendingDown, TrendingUp, Minus, Flag, Award } from 'lucide-react'
import { db, deleteWithTombstone } from '../../db/db'
import { localDateStr, fmtDate, monthLabel, startOfMonth, parseLocalDate, MONTH_NAMES } from '../../lib/dates'
import { useLocalToday } from '../../lib/hooks'
import {
  inRange, movingAverage, weeklyRate, buildWeightStory, dateMs,
  type WeightRange, type WeightBadge, type StoryEntry,
} from '../../lib/bodyweight'
import { LineChart, refLineInReach, type ChartPoint } from '../../components/Charts'
import Sheet from '../../components/Sheet'
import NumberStepper from '../../components/NumberStepper'
import GoalFields from '../settings/GoalFields'
import { goalStatus, type GoalStatus } from '../../lib/goalStatus'
import { t, tp, fmtNum } from '../../i18n'

const GREEN = '#22C55E'
/** Goal reference line on the chart (tailwind `primary`). */
const GOAL = '#F97316'
const RANGES: { id: WeightRange; label: string }[] = [
  { id: '1m', label: t('progress.weight.range1m') },
  { id: '3m', label: t('progress.weight.range3m') },
  { id: '6m', label: t('progress.weight.range6m') },
  { id: '1y', label: t('progress.weight.range1y') },
  { id: 'all', label: t('progress.weight.rangeAll') },
]
/** Months shown expanded by default; older ones open on tap so a long history stays scannable. */
const OPEN_MONTHS = 2

const round1 = (v: number) => Math.round(v * 10) / 10
/** One decimal in the UI language ("75.4" / "75,4"). */
const fmt1 = (v: number) => fmtNum(v, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${fmt1(Math.abs(v))}`

function shortDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`
}

/** Progress › Bodyweight: the whole weigh-in history — trend chart, stats and a month-by-month story. */
export default function WeightHistory() {
  const today = useLocalToday()
  const [range, setRange] = useState<WeightRange>('3m')
  const [editing, setEditing] = useState<{ date: string; weightKg: number; isNew: boolean } | null>(null)
  const [goalOpen, setGoalOpen] = useState(false)
  // Months whose open state the user flipped from the default.
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set())
  const flip = (month: string) =>
    setToggled(t => {
      const next = new Set(t)
      if (!next.delete(month)) next.add(month)
      return next
    })

  const log = useLiveQuery(() => db.bodyLog.orderBy('date').toArray())
  const settings = useLiveQuery(() => db.settings.get(1))
  const workoutsByMonth = useLiveQuery(async () => {
    const map = new Map<string, number>()
    const sessions = await db.sessions.toArray()
    for (const s of sessions) {
      if (s.endedAt === undefined) continue
      const m = startOfMonth(localDateStr(new Date(s.startedAt)))
      map.set(m, (map.get(m) ?? 0) + 1)
    }
    return map
  })

  const entries = useMemo(() => log ?? [], [log])
  const story = useMemo(() => buildWeightStory(entries), [entries])
  const shown = useMemo(() => inRange(entries, range, today), [entries, range, today])
  const trend = useMemo(() => {
    const avg = new Map(movingAverage(entries).map(a => [a.date, a.avg]))
    return shown.map<ChartPoint>(e => ({ x: dateMs(e.date), y: avg.get(e.date) ?? e.weightKg, label: shortDate(dateMs(e.date)) }))
  }, [entries, shown])
  const points = shown.map<ChartPoint>(e => ({ x: dateMs(e.date), y: e.weightKg, label: shortDate(dateMs(e.date)) }))

  const first = entries[0]
  const latest = entries[entries.length - 1]
  const rate = weeklyRate(entries, today)
  const lowest = entries.reduce<typeof first | undefined>((m, e) => (!m || e.weightKg < m.weightKg ? e : m), undefined)
  const highest = entries.reduce<typeof first | undefined>((m, e) => (!m || e.weightKg > m.weightKg ? e : m), undefined)
  const goal: GoalStatus = settings ? goalStatus(entries, settings, today) : { kind: 'none' }
  const showTrend = points.length > 2
  // The chart drops a goal line too far from the plotted data; the legend follows it.
  const goalOnChart = goal.kind !== 'none'
    && refLineInReach([...points, ...(showTrend ? trend : [])].map(p => p.y), goal.goalKg)
  const rangeChange = shown.length > 1 ? round1(shown[shown.length - 1].weightKg - shown[0].weightKg) : null

  async function save(date: string, weightKg: number) {
    const w = round1(weightKg)
    await db.bodyLog.put({ date, weightKg: w })
    // The newest weigh-in is the bodyweight the rank score uses.
    if (!latest || date >= latest.date) await db.settings.update(1, { bodyweightKg: w })
    setEditing(null)
  }

  async function remove(date: string) {
    if (!window.confirm(t('progress.weight.deleteConfirm', { date: fmtDate(date) }))) return
    await deleteWithTombstone('bodyLog', date)
    const newest = await db.bodyLog.orderBy('date').last()
    if (latest?.date === date && newest) await db.settings.update(1, { bodyweightKg: newest.weightKg })
    setEditing(null)
  }

  return (
    <div className="pt-4">
      <div className="mb-4 flex items-center gap-2">
        <Link
          to="/progress"
          aria-label={t('common.back')}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sub active:bg-muted/40"
        >
          <ChevronLeft size={24} />
        </Link>
        <h1 className="min-w-0 flex-1 truncate font-display text-3xl font-bold">{t('progress.weight.title')}</h1>
        <button
          onClick={() => setEditing({ date: today, weightKg: latest?.weightKg ?? 75, isNew: true })}
          aria-label={t('progress.weight.logAria')}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary active:bg-primary/30"
        >
          <Plus size={20} />
        </button>
      </div>

      {log === undefined ? null : entries.length === 0 ? (
        <div className="rounded-2xl border border-edge bg-card p-6 text-center">
          <p className="text-sm text-sub">{t('progress.weight.empty')}</p>
          <button
            onClick={() => setEditing({ date: today, weightKg: 75, isNew: true })}
            className="mt-4 rounded-2xl bg-primary px-5 py-3 font-display text-lg font-bold text-bg active:opacity-90"
          >
            {t('progress.weight.logWeight')}
          </button>
        </div>
      ) : (
        <>
          {/* Summary */}
          <section className="rounded-2xl border border-edge bg-card p-4">
            <p className="text-xs text-sub">{t('progress.weight.latest', { date: fmtDate(latest.date) })}</p>
            <p className="num font-display text-4xl font-bold">{fmt1(latest.weightKg)} kg</p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Stat
                label={t('progress.weight.since', { date: shortDate(dateMs(first.date)) })}
                value={entries.length > 1 ? `${signed(round1(latest.weightKg - first.weightKg))} kg` : '—'}
              />
              <Stat label={t('progress.weight.trend4w')} value={rate === null ? '—' : t('progress.weight.perWeek', { value: signed(rate) })} />
              <Stat label={t('progress.weight.lowest')} value={lowest ? `${fmt1(lowest.weightKg)} kg` : '—'} hint={lowest ? shortDate(dateMs(lowest.date)) : undefined} />
              <Stat label={t('progress.weight.highest')} value={highest ? `${fmt1(highest.weightKg)} kg` : '—'} hint={highest ? shortDate(dateMs(highest.date)) : undefined} />
              {settings && <GoalStat goal={goal} onOpen={() => setGoalOpen(true)} />}
            </div>
          </section>

          {/* Chart */}
          <section className="mt-4 rounded-2xl border border-edge bg-card p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-1" role="tablist" aria-label={t('progress.weight.rangeAria')}>
                {RANGES.map(r => (
                  <button
                    key={r.id}
                    role="tab"
                    aria-selected={range === r.id}
                    onClick={() => setRange(r.id)}
                    className={`min-h-[36px] whitespace-nowrap rounded-lg px-2.5 text-xs font-semibold ${
                      range === r.id ? 'bg-primary/15 text-primary' : 'text-sub active:bg-muted/40'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              {rangeChange !== null && (
                <span className="num whitespace-nowrap text-sm font-semibold text-sub">{signed(rangeChange)} kg</span>
              )}
            </div>
            {points.length > 0 ? (
              <>
                <LineChart
                  points={points}
                  trend={showTrend ? trend : undefined}
                  color={GREEN}
                  height={180}
                  yFmt={fmt1}
                  xFmt={shortDate}
                  refLine={goal.kind === 'none' ? undefined : { y: goal.goalKg, color: GOAL, label: t('progress.weight.goalLine', { value: fmt1(goal.goalKg) }) }}
                />
                <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-sub">
                  <span className="flex items-center gap-1.5 whitespace-nowrap">
                    <span className="h-0.5 w-4 rounded-full" style={{ background: GREEN }} /> {t('progress.weight.weighIns')}
                  </span>
                  {showTrend && (
                    <span className="flex items-center gap-1.5 whitespace-nowrap">
                      <span className="w-4 border-t-2 border-dashed border-sub" /> {t('progress.weight.average7')}
                    </span>
                  )}
                  {goalOnChart && (
                    <span className="flex items-center gap-1.5 whitespace-nowrap">
                      <span className="w-4 border-t-2 border-dashed" style={{ borderColor: GOAL }} /> {t('progress.weight.goal')}
                    </span>
                  )}
                </p>
              </>
            ) : (
              <p className="py-6 text-center text-sm text-sub">{t('progress.weight.noneInRange')}</p>
            )}
          </section>

          {/* Story */}
          <h2 className="mb-2 mt-6 font-display text-xl font-semibold">{t('common.history')}</h2>
          <div className="space-y-4">
            {story.map((m, i) => {
              const workouts = workoutsByMonth?.get(m.month) ?? 0
              const open = (i < OPEN_MONTHS) !== toggled.has(m.month)
              return (
                <section key={m.month} className="rounded-2xl border border-edge bg-card">
                  <button
                    onClick={() => flip(m.month)}
                    aria-expanded={open}
                    className={`flex w-full items-center gap-3 px-4 py-3 text-left ${open ? 'border-b border-edge/60' : ''}`}
                  >
                    <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <h3 className="font-display text-lg font-semibold">{monthLabel(m.month)}</h3>
                      <p className="num whitespace-nowrap text-xs text-sub">
                        <span className={m.change < 0 ? 'text-accent' : ''}>{signed(m.change)} kg</span>
                        {' · '}{t('progress.weight.monthAvg', { value: fmt1(m.avg) })}
                        {workouts > 0 && ` · ${tp('units.workouts', workouts)}`}
                      </p>
                    </div>
                    <ChevronDown size={18} className={`shrink-0 text-sub transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
                  </button>
                  {open && (
                    <ul>
                      {m.entries.map(e => (
                        <StoryRow key={e.date} entry={e} onEdit={() => setEditing({ date: e.date, weightKg: e.weightKg, isNew: false })} />
                      ))}
                    </ul>
                  )}
                </section>
              )
            })}
          </div>
        </>
      )}

      <EntrySheet
        editing={editing}
        today={today}
        onClose={() => setEditing(null)}
        onSave={save}
        onDelete={remove}
        exists={date => entries.some(e => e.date === date)}
      />

      <Sheet open={goalOpen && !!settings} onClose={() => setGoalOpen(false)} title={t('progress.weight.goalSheet')}>
        {/* Same current weight as the goal stat: the newest weigh-in, else settings.bodyweightKg. */}
        {settings && <GoalFields settings={settings} currentKg={latest?.weightKg} />}
      </Sheet>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-xs text-sub">{label}</p>
      <p className="num truncate font-display text-lg font-semibold">
        {value}
        {hint && <span className="ml-1.5 text-xs font-normal text-sub">{hint}</span>}
      </p>
    </div>
  )
}

/** Full-width last row of the stats grid: goal weight + time to goal, or a "Set a goal" button. */
function GoalStat({ goal, onOpen }: { goal: GoalStatus; onOpen: () => void }) {
  if (goal.kind === 'none') {
    return (
      <div className="col-span-2 min-w-0">
        <p className="truncate text-xs text-sub">{t('progress.weight.goal')}</p>
        <button
          onClick={onOpen}
          className="min-h-[44px] whitespace-nowrap font-display text-lg font-semibold text-primary active:opacity-70"
        >
          {t('progress.weight.goalSet')}
        </button>
      </div>
    )
  }
  const sub = goal.kind === 'reached'
    ? t('progress.weight.goalReached')
    : goal.kind === 'offTrack'
      ? t('progress.weight.goalNotOnTrack')
      : goal.kind === 'far'
        ? t('progress.weight.goalFar')
        : t('progress.weight.goalEta', { n: fmtNum(goal.weeks) })
  return (
    <div className="col-span-2 flex min-w-0 items-end justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-xs text-sub">{t('progress.weight.goal')}</p>
        <p className="num truncate font-display text-lg font-semibold">{fmt1(goal.goalKg)} kg</p>
        <p className={`num truncate text-xs ${goal.kind === 'reached' ? 'font-semibold text-accent' : 'text-sub'}`}>{sub}</p>
      </div>
      <button
        onClick={onOpen}
        className="min-h-[44px] shrink-0 whitespace-nowrap px-1 text-sm font-semibold text-primary active:opacity-70"
      >
        {t('progress.weight.goalEdit')}
      </button>
    </div>
  )
}

function badgeView(b: WeightBadge): { label: string; Icon: typeof Flag } {
  switch (b.kind) {
    case 'start': return { label: t('progress.weight.badgeStart'), Icon: Flag }
    case 'low': return { label: t('progress.weight.badgeLow'), Icon: TrendingDown }
    case 'high': return { label: t('progress.weight.badgeHigh'), Icon: TrendingUp }
    case 'milestone':
      return { label: t('progress.weight.badgeMilestone', { kg: `${b.kg > 0 ? '+' : '−'}${fmtNum(Math.abs(b.kg))}` }), Icon: Award }
  }
}

function StoryRow({ entry, onEdit }: { entry: StoryEntry; onEdit: () => void }) {
  const d = entry.delta
  const DeltaIcon = d === null || d === 0 ? Minus : d < 0 ? TrendingDown : TrendingUp
  return (
    <li className="border-b border-edge/40 last:border-b-0">
      <button onClick={onEdit} className="w-full px-4 py-3 text-left active:bg-muted/30">
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 truncate text-sm">{fmtDate(entry.date)}</p>
          {d !== null && (
            <span className={`num flex shrink-0 items-center gap-0.5 whitespace-nowrap text-xs font-semibold ${d < 0 ? 'text-accent' : 'text-sub'}`}>
              <DeltaIcon size={13} aria-hidden /> {signed(d)}
            </span>
          )}
          <span className="num w-[4.5rem] shrink-0 text-right font-display text-lg font-semibold">
            {fmt1(entry.weightKg)}
          </span>
        </div>
        {/* Own full-width row: a badge never squeezes the date or overlaps the numbers. */}
        {entry.badges.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {entry.badges.map((b, i) => {
              const { label, Icon } = badgeView(b)
              return (
                <span
                  key={i}
                  className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary"
                >
                  <Icon size={11} aria-hidden /> {label}
                </span>
              )
            })}
          </div>
        )}
      </button>
    </li>
  )
}

function EntrySheet({
  editing, today, onClose, onSave, onDelete, exists,
}: {
  editing: { date: string; weightKg: number; isNew: boolean } | null
  today: string
  onClose: () => void
  onSave: (date: string, weightKg: number) => void
  onDelete: (date: string) => void
  exists: (date: string) => boolean
}) {
  const [date, setDate] = useState(today)
  const [weight, setWeight] = useState(75)
  const [openedFor, setOpenedFor] = useState<typeof editing>(null)
  // Re-seed the fields each time the sheet opens for a different target.
  if (editing !== openedFor) {
    setOpenedFor(editing)
    if (editing) {
      setDate(editing.date)
      setWeight(editing.weightKg)
    }
  }
  const replacing = !!editing?.isNew && exists(date)
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today && !Number.isNaN(parseLocalDate(date).getTime())

  return (
    <Sheet
      open={editing !== null}
      onClose={onClose}
      title={editing?.isNew ? t('progress.weight.sheetNew') : t('progress.weight.sheetEdit', { date: editing ? fmtDate(editing.date) : '' })}
    >
      {editing?.isNew && (
        <label className="mb-4 block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-sub">{t('progress.weight.date')}</span>
          <input
            type="date"
            value={date}
            max={today}
            onChange={e => setDate(e.target.value)}
            className="num min-h-[48px] w-full rounded-xl bg-card px-3 text-base"
          />
          {replacing && <span className="mt-1 block text-xs text-sub">{t('progress.weight.replaces')}</span>}
        </label>
      )}
      <div className="flex justify-center">
        <NumberStepper label={t('progress.weight.weight')} value={weight} onChange={setWeight} step={0.1} min={30} max={300} unit="kg" />
      </div>
      <button
        onClick={() => onSave(date, weight)}
        disabled={!validDate}
        className="mt-4 w-full rounded-2xl bg-primary py-3.5 font-display text-lg font-bold text-bg active:opacity-90 disabled:opacity-40"
      >
        {t('common.save')}
      </button>
      {editing && !editing.isNew && (
        <button
          onClick={() => onDelete(editing.date)}
          className="mt-2 flex w-full items-center justify-center gap-1.5 py-3 text-sm font-semibold text-danger"
        >
          <Trash2 size={15} /> {t('progress.weight.delete')}
        </button>
      )}
    </Sheet>
  )
}
