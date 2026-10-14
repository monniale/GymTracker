import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ChevronDown,
  Info,
  RefreshCw,
  Send,
  Settings2,
} from 'lucide-react'
import { useNotifyStore } from '../../lib/notifyStore'
import type { IsoWeekday, NotifyPrefs } from '../../lib/notifyPrefs'
import type { MealType } from '../../types'
import { fmtDate, fmtDateTime } from '../../lib/dates'
import { useNativeStatus } from '../status'
import type { NativeStatus } from '../status'
import { openDeviceSettings } from '../deviceSettings'
import { haptic } from '../haptics'
import {
  getScheduledSummary,
  openExactAlarmSettings,
  requestNotificationPermission,
  requestResync,
  sendTestReminder,
} from '../notifications'
import {
  ActionButton,
  IssueRow,
  MutedChip,
  Segment,
  Select,
  Switch,
  SwitchRow,
  TimeInput,
  useAction,
} from './controls'
import {
  CATEGORY_CHANNEL,
  CATEGORY_KEYS,
  CHANNEL,
  bucketLabel,
  categoryOn,
  enabledCategoryCount,
  healthItems,
  isMuted,
  isSamsung,
  mutedCategories,
  notificationsState,
  recapWithWhen,
  remindersActive,
  throughDate,
} from './notifyHealth'
import type { CategoryKey, HealthItem } from './notifyHealth'

/**
 * Settings › Notifications (Android only; lazy-loaded behind `isNative`). Everything here is
 * device-local (`useNotifyStore`, localStorage) — never Dexie, never synced. Prefs changes
 * re-plan the reminders through the engine's own store subscription.
 */

type Status = NativeStatus | null
type Refresh = () => Promise<void>

/** Ask for POST_NOTIFICATIONS (only ever from a tap), then re-read the status. */
async function allowNotifications(refresh: Refresh): Promise<string> {
  useNotifyStore.getState().markPermissionAsked()
  let result: string = 'denied'
  try {
    result = await requestNotificationPermission()
  } finally {
    await refresh()
  }
  return result
}

/** Turning a category on asks for the permission first when Android can still show the prompt. */
function ensurePermission(status: Status, refresh: Refresh): void {
  if (status && notificationsState(status) === 'prompt') void allowNotifications(refresh).catch(() => {})
}

export default function NotificationsSection() {
  const { status, refresh } = useNativeStatus()
  const prefs = useNotifyStore(s => s.prefs)
  const rest = useNotifyStore(s => s.rest)
  const samsungDone = useNotifyStore(s => s.samsungNeverSleepingDone)
  const items = status
    ? healthItems(status, { remindersActive: remindersActive(prefs), samsungDone, countdown: rest.countdown })
    : []
  // Reminder categories Android drops silently; their chips live in the collapsed Reminders card.
  const muted = mutedCategories(status, prefs).length
  const ready = !!status && !items.some(i => i.required) && muted === 0

  return (
    <section className="mb-4 rounded-2xl border border-edge bg-card p-4">
      <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-sub">
        <Bell size={14} className={ready ? 'text-accent' : ''} /> Notifications
      </h2>
      <HealthPanel status={status} items={items} muted={muted} refresh={refresh} />
      <ScheduleLine status={status} />
      <RemindersCard status={status} muted={muted} refresh={refresh} />
      <FooterButtons status={status} refresh={refresh} />
      <div className="mt-3 border-t border-edge/50 pt-2">
        <HapticsRow />
      </div>
    </section>
  )
}

// ── Health ───────────────────────────────────────────────────────────────────────────────

function HealthPanel({
  status,
  items,
  muted,
  refresh,
}: {
  status: Status
  items: HealthItem[]
  muted: number
  refresh: Refresh
}) {
  const [open, setOpen] = useState(false)
  if (!status)
    return (
      <div className="flex min-h-[48px] items-center rounded-xl bg-surface px-3 text-sm text-sub">
        Checking notification settings…
      </div>
    )

  const required = items.filter(i => i.required).length
  const tips = items.length - required
  const warn = required > 0 || muted > 0
  return (
    <div className="rounded-xl bg-surface">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex min-h-[48px] w-full items-center gap-2.5 px-3 text-left"
      >
        {warn ? (
          <AlertTriangle size={18} className="shrink-0 text-danger" />
        ) : (
          <CheckCircle2 size={18} className="shrink-0 text-accent" />
        )}
        <span className="min-w-0 flex-1">
          <span className={`block text-sm font-semibold ${warn ? 'text-danger' : ''}`}>
            {required
              ? `${required} thing${required === 1 ? '' : 's'} need${required === 1 ? 's' : ''} attention`
              : muted
                ? `${muted} reminder type${muted === 1 ? ' is' : 's are'} muted in Android`
                : 'Notifications ready'}
          </span>
          {tips > 0 && <span className="block text-xs text-sub">{tips === 1 ? '1 optional tip' : `${tips} optional tips`}</span>}
        </span>
        <ChevronDown size={18} className={`shrink-0 text-sub transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="space-y-2 border-t border-edge/50 p-2">
          {items.map(i => (
            <HealthRow key={i.id} item={i} refresh={refresh} />
          ))}
          <Details status={status} />
        </div>
      )}
    </div>
  )
}

function HealthRow({ item, refresh }: { item: HealthItem; refresh: Refresh }) {
  const setSamsungDone = useNotifyStore(s => s.setSamsungNeverSleepingDone)
  switch (item.id) {
    case 'notifications':
      return (
        <IssueRow
          title={
            item.state === 'prompt'
              ? 'Notifications not allowed yet'
              : item.state === 'denied'
                ? 'Notifications are blocked'
                : 'Notifications are off for GymTracker'
          }
          hint="Needed for reminders and for the rest alert with the screen off."
        >
          {item.state === 'prompt' ? (
            <ActionButton onClick={() => allowNotifications(refresh)}>Allow</ActionButton>
          ) : (
            <ActionButton onClick={() => openDeviceSettings('app_notifications')}>Open settings</ActionButton>
          )}
        </IssueRow>
      )
    case 'exact':
      return (
        <IssueRow title="Exact timing is off" hint="Reminders and the rest alert may arrive late.">
          <ActionButton onClick={() => openExactAlarmSettings()}>Fix</ActionButton>
        </IssueRow>
      )
    case 'battery':
      return item.state === 'restricted' ? (
        <IssueRow
          title="Battery: Restricted"
          hint="Restricted apps lose their reminders. Open App info › Battery and choose Unrestricted."
        >
          <ActionButton onClick={() => openDeviceSettings('app_details')}>Open</ActionButton>
        </IssueRow>
      ) : (
        <IssueRow title="Battery: Optimised" hint="Set GymTracker to Unrestricted so Android doesn't hold back reminders.">
          <ActionButton onClick={() => openDeviceSettings('battery_request')}>Allow</ActionButton>
        </IssueRow>
      )
    case 'samsung':
      return (
        <IssueRow
          title="Add to Never sleeping apps"
          hint="One UI puts apps you haven't opened for a few days to sleep, and sleeping apps lose their alarms. Android can't report this setting, so tick it off once GymTracker is on the list."
        >
          <ActionButton onClick={() => openDeviceSettings('samsung_never_sleeping')}>Open list</ActionButton>
          <ActionButton tone="quiet" onClick={() => setSamsungDone(true)}>
            Done
          </ActionButton>
        </IssueRow>
      )
    case 'promotion':
      return (
        <IssueRow
          tone="info"
          title="Live countdown in the status bar"
          hint="Optional: shows the rest countdown as a live chip. On One UI you may also need Developer options › Live notifications for all apps."
        >
          <ActionButton tone="quiet" onClick={() => openDeviceSettings('promotion')}>
            Settings
          </ActionButton>
        </IssueRow>
      )
  }
}

/** Diagnostics for when something misbehaves; kept out of the way. */
function Details({ status }: { status: NativeStatus }) {
  const [open, setOpen] = useState(false)
  const lastResync = useNotifyStore(s => s.lastResync)
  const samsungDone = useNotifyStore(s => s.samsungNeverSleepingDone)
  const setSamsungDone = useNotifyStore(s => s.setSamsungNeverSleepingDone)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  useEffect(() => {
    if (!open) return
    let alive = true
    void navigator.storage
      ?.persisted?.()
      .then(p => alive && setPersisted(p))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [open])

  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-[36px] items-center gap-1.5 px-1 text-xs font-medium text-sub"
      >
        <Info size={13} /> Details
      </button>
    )

  const n = notificationsState(status)
  const bucket = bucketLabel(status.standbyBucket)
  return (
    <div className="space-y-0.5 px-1 pb-1 text-xs leading-relaxed text-sub">
      <p>
        Notifications {n === 'ok' ? 'allowed' : n === 'prompt' ? 'not asked' : n} · exact timing{' '}
        {status.exact ? 'on' : 'off'}
      </p>
      <p>
        Battery {status.backgroundRestricted ? 'restricted' : status.ignoringBattery ? 'unrestricted' : 'optimised'}
        {bucket && <> · standby {bucket}</>}
        {persisted !== null && <> · storage {persisted ? 'persistent' : 'best effort'}</>}
      </p>
      <p>
        {status.manufacturer || 'Android'} · API {status.sdkInt} · live countdown{' '}
        {status.promotedAllowed ? 'allowed' : 'not allowed'}
      </p>
      {lastResync && (
        <p>
          Last plan {fmtDateTime(lastResync.at)} ({lastResync.reason}) ·{' '}
          {lastResync.skipped ? `skipped: ${lastResync.skipped}` : `${lastResync.scheduled} scheduled`}
          {!lastResync.exact && ' · inexact'}
        </p>
      )}
      {lastResync?.error && <p className="text-danger">Error: {lastResync.error}</p>}
      {isSamsung(status) && samsungDone && (
        <p>
          Never sleeping apps: ticked off ·{' '}
          <button type="button" onClick={() => setSamsungDone(false)} className="font-semibold text-primary">
            Undo
          </button>
        </p>
      )}
    </div>
  )
}

// ── Schedule summary ─────────────────────────────────────────────────────────────────────

interface Summary {
  count: number
  next?: { atMs: number; title: string }
  horizon?: number
}

function dayWord(date: string): string {
  const d = fmtDate(date)
  return d === 'Today' || d === 'Tomorrow' ? d.toLowerCase() : d
}

function ScheduleLine({ status }: { status: Status }) {
  const prefs = useNotifyStore(s => s.prefs)
  const lastResync = useNotifyStore(s => s.lastResync)
  const [summary, setSummary] = useState<Summary | null>(null)
  const resyncAt = lastResync?.at
  useEffect(() => {
    let alive = true
    void getScheduledSummary()
      .then(s => alive && setSummary(s))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [resyncAt])

  const blocked = !!status && notificationsState(status) !== 'ok'
  const horizon = summary?.horizon ?? lastResync?.horizon
  let main: React.ReactNode
  if (!prefs.enabled) main = 'Reminders are off.'
  else if (blocked) main = "Reminders can't be scheduled until notifications are allowed."
  else if (!summary) main = null
  else if (summary.count === 0) main = remindersActive(prefs) ? 'Nothing scheduled right now.' : 'No reminders turned on.'
  else
    main = (
      <>
        <span className="block font-semibold text-ink">
          {horizon ? `Reminders scheduled through ${dayWord(throughDate(horizon))}` : `${summary.count} reminders scheduled`}
        </span>
        {summary.next && (
          <span className="block truncate">
            Next: {fmtDateTime(summary.next.atMs)} — {summary.next.title}
          </span>
        )}
        <span className="block">Opening the app extends the plan.</span>
      </>
    )
  const keepAliveMuted = !blocked && remindersActive(prefs) && isMuted(status?.channels, CHANNEL.status)

  return (
    <div className="mt-3 space-y-2 px-1">
      {main && <p className="text-xs leading-relaxed text-sub">{main}</p>}
      {keepAliveMuted && (
        <IssueRow title="“Open GymTracker” notices are muted" hint="They tell you when the reminder plan is about to run out.">
          <ActionButton onClick={() => openDeviceSettings('channel', CHANNEL.status)}>Open</ActionButton>
        </IssueRow>
      )}
      {lastResync?.error && <p className="text-xs text-danger">Last re-plan failed: {lastResync.error}</p>}
    </div>
  )
}

// ── Reminders ────────────────────────────────────────────────────────────────────────────

const WEEKDAYS: { d: IsoWeekday; short: string; long: string }[] = [
  { d: 1, short: 'M', long: 'Monday' },
  { d: 2, short: 'T', long: 'Tuesday' },
  { d: 3, short: 'W', long: 'Wednesday' },
  { d: 4, short: 'T', long: 'Thursday' },
  { d: 5, short: 'F', long: 'Friday' },
  { d: 6, short: 'S', long: 'Saturday' },
  { d: 7, short: 'S', long: 'Sunday' },
]

const MEALS: { meal: MealType; label: string }[] = [
  { meal: 'breakfast', label: 'Breakfast' },
  { meal: 'lunch', label: 'Lunch' },
  { meal: 'snack', label: 'Snack' },
  { meal: 'dinner', label: 'Dinner' },
]

const WATER_EVERY: { value: NotifyPrefs['water']['intervalMin']; label: string }[] = [
  { value: 60, label: '1 h' },
  { value: 90, label: '1.5 h' },
  { value: 120, label: '2 h' },
  { value: 180, label: '3 h' },
]

const RECAP_WHEN: { value: NotifyPrefs['recap']['when']; title: string; sub: string }[] = [
  { value: 'monday-morning', title: 'Monday', sub: 'Last week' },
  { value: 'sunday-evening', title: 'Sunday', sub: 'This week so far' },
]

function RemindersCard({ status, muted, refresh }: { status: Status; muted: number; refresh: Refresh }) {
  const [open, setOpen] = useState(muted > 0)
  // The status loads after the first render: open the card (with its "Muted in Android" chips)
  // once a muted category shows up.
  const anyMuted = muted > 0
  useEffect(() => {
    if (anyMuted) setOpen(true)
  }, [anyMuted])
  const prefs = useNotifyStore(s => s.prefs)
  const setPrefs = useNotifyStore(s => s.setPrefs)
  const on = enabledCategoryCount(prefs)
  const sub = !prefs.enabled ? 'All off' : on === 0 ? 'None turned on' : `${on} of ${CATEGORY_KEYS.length} on`

  /** Update prefs; when this turns something on, ask for the permission first if possible. */
  const update = (fn: (p: NotifyPrefs) => NotifyPrefs, turningOn = false) => {
    if (turningOn) ensurePermission(status, refresh)
    setPrefs(fn)
  }

  return (
    <div className="mt-3">
      <div className="flex items-center gap-2 rounded-xl bg-surface pl-1 pr-3">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className="flex min-h-[52px] min-w-0 flex-1 items-center gap-2 px-2 text-left"
        >
          <ChevronDown size={18} className={`shrink-0 text-sub transition-transform ${open ? '' : '-rotate-90'}`} />
          <span className="min-w-0">
            <span className="block text-sm font-semibold">Reminders</span>
            <span className="block truncate text-xs text-sub">
              {sub}
              {anyMuted && <span className="text-danger"> · {muted} muted in Android</span>}
            </span>
          </span>
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={prefs.enabled}
          aria-label="All reminders"
          onClick={() => update(p => ({ ...p, enabled: !p.enabled }), !prefs.enabled)}
          className="flex min-h-[48px] shrink-0 items-center"
        >
          <Switch on={prefs.enabled} />
        </button>
      </div>

      {open &&
        (prefs.enabled ? (
          <div className="mt-2 space-y-2">
            <WorkoutCard status={status} update={update} />
            <MealsCard status={status} update={update} />
            <WaterCard status={status} update={update} />
            <RankCard status={status} update={update} />
            <RecapCard status={status} update={update} />
            <WeighInCard status={status} update={update} />
          </div>
        ) : (
          <p className="mt-2 px-1 text-xs text-sub">Turn reminders on to choose which ones you get.</p>
        ))}
    </div>
  )
}

type Update = (fn: (p: NotifyPrefs) => NotifyPrefs, turningOn?: boolean) => void
interface CardProps {
  status: Status
  update: Update
}

/** One category: header (title or switch) + "Muted in Android" chip + body. */
function Card({
  k,
  status,
  header,
  children,
}: {
  k: CategoryKey
  status: Status
  header: React.ReactNode
  children?: React.ReactNode
}) {
  const prefs = useNotifyStore(s => s.prefs)
  // A muted channel only matters once notifications are allowed at all (the health row covers that).
  const muted =
    !!status && notificationsState(status) === 'ok' && categoryOn(prefs, k) && isMuted(status.channels, CATEGORY_CHANNEL[k])
  return (
    <div className="rounded-xl bg-surface px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        {header}
        {muted && <MutedChip channelId={CATEGORY_CHANNEL[k]} />}
      </div>
      {children && <div className="mt-1 space-y-1 pb-1">{children}</div>}
    </div>
  )
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return <p className="flex min-h-[36px] items-center text-xs font-semibold uppercase tracking-wide text-sub">{children}</p>
}

/** A label + trailing controls; each control wraps (right-aligned) on its own on narrow phones. */
function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <span className="mr-auto text-sm text-sub">{label}</span>
      {children}
    </div>
  )
}

function WorkoutCard({ status, update }: CardProps) {
  const w = useNotifyStore(s => s.prefs.workout)
  const set = (patch: Partial<NotifyPrefs['workout']>, turningOn = false) =>
    update(p => ({ ...p, workout: { ...p.workout, ...patch } }), turningOn)
  return (
    <Card
      k="workout"
      status={status}
      header={
        <SwitchRow
          label="Training days"
          hint="Unless you've already trained that day"
          on={w.enabled}
          onChange={v => set({ enabled: v }, v)}
        />
      }
    >
      {w.enabled && (
        <>
          <div className="grid grid-cols-7 gap-1 pt-1">
            {WEEKDAYS.map(({ d, short, long }) => {
              const active = w.days.includes(d)
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={active}
                  aria-label={long}
                  onClick={() => set({ days: active ? w.days.filter(x => x !== d) : [...w.days, d] })}
                  className={`h-9 min-w-0 rounded-lg text-sm font-semibold ${
                    active ? 'bg-primary/15 text-primary' : 'bg-card text-sub'
                  }`}
                >
                  {short}
                </button>
              )
            })}
          </div>
          {w.days.length === 0 && <p className="text-xs text-primary">Pick the days you train.</p>}
          <FieldRow label="Remind at">
            <TimeInput label="Training reminder time" value={w.time} onChange={time => set({ time })} />
          </FieldRow>
          <SwitchRow
            label="Skip once the weekly target is met"
            on={w.skipWhenTargetMet}
            onChange={v => set({ skipWhenTargetMet: v })}
          />
        </>
      )}
      <SwitchRow
        label="Workout left open"
        hint="Nudge 3 h after starting if it's still running"
        on={w.openSessionNudge}
        onChange={v => set({ openSessionNudge: v }, v)}
      />
    </Card>
  )
}

function MealsCard({ status, update }: CardProps) {
  const meals = useNotifyStore(s => s.prefs.meals)
  const set = (meal: MealType, patch: Partial<NotifyPrefs['meals'][MealType]>, turningOn = false) =>
    update(p => ({ ...p, meals: { ...p.meals, [meal]: { ...p.meals[meal], ...patch } } }), turningOn)
  return (
    <Card k="meals" status={status} header={<CardTitle>Meals</CardTitle>}>
      {MEALS.map(({ meal, label }) => (
        <div key={meal} className="flex flex-wrap items-center justify-end gap-x-2">
          <SwitchRow
            label={label}
            basis="basis-24"
            on={meals[meal].enabled}
            onChange={v => set(meal, { enabled: v }, v)}
          />
          <TimeInput
            label={`${label} reminder time`}
            value={meals[meal].time}
            disabled={!meals[meal].enabled}
            onChange={time => set(meal, { time })}
          />
        </div>
      ))}
      <p className="text-xs text-sub">Skipped when that meal is already logged.</p>
    </Card>
  )
}

function WaterCard({ status, update }: CardProps) {
  const water = useNotifyStore(s => s.prefs.water)
  const set = (patch: Partial<NotifyPrefs['water']>, turningOn = false) =>
    update(p => ({ ...p, water: { ...p.water, ...patch } }), turningOn)
  return (
    <Card
      k="water"
      status={status}
      header={<SwitchRow label="Water" on={water.enabled} onChange={v => set({ enabled: v }, v)} />}
    >
      {water.enabled && (
        <>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <label className="min-w-0">
              <span className="mb-0.5 block text-xs text-sub">From</span>
              <TimeInput label="Water reminders from" value={water.start} onChange={start => set({ start })} className="w-full" />
            </label>
            <label className="min-w-0">
              <span className="mb-0.5 block text-xs text-sub">To</span>
              <TimeInput label="Water reminders until" value={water.end} onChange={end => set({ end })} className="w-full" />
            </label>
          </div>
          <FieldRow label="Every">
            <Select label="Water reminder interval" value={water.intervalMin} options={WATER_EVERY} onChange={intervalMin => set({ intervalMin })} />
          </FieldRow>
        </>
      )}
    </Card>
  )
}

function RankCard({ status, update }: CardProps) {
  const r = useNotifyStore(s => s.prefs.rank)
  const set = (patch: Partial<NotifyPrefs['rank']>, turningOn = false) =>
    update(p => ({ ...p, rank: { ...p.rank, ...patch } }), turningOn)
  return (
    <Card k="rank" status={status} header={<CardTitle>Rank &amp; streak</CardTitle>}>
      <div className="flex flex-wrap items-center justify-end gap-x-2">
        <SwitchRow
          label="Rank decay"
          basis="basis-36"
          hint="The day before idle decay starts"
          on={r.decayWarning}
          onChange={v => set({ decayWarning: v }, v)}
        />
        <TimeInput label="Rank decay warning time" value={r.decayTime} disabled={!r.decayWarning} onChange={decayTime => set({ decayTime })} />
      </div>
      <div className="flex flex-wrap items-center justify-end gap-x-2">
        <SwitchRow
          label="Streak at risk"
          basis="basis-36"
          hint="When the weekly target is still open"
          on={r.streakWarning}
          onChange={v => set({ streakWarning: v }, v)}
        />
        <TimeInput label="Streak warning time" value={r.streakTime} disabled={!r.streakWarning} onChange={streakTime => set({ streakTime })} />
      </div>
    </Card>
  )
}

function RecapCard({ status, update }: CardProps) {
  const r = useNotifyStore(s => s.prefs.recap)
  const set = (fn: (r: NotifyPrefs['recap']) => NotifyPrefs['recap'], turningOn = false) =>
    update(p => ({ ...p, recap: fn(p.recap) }), turningOn)
  return (
    <Card
      k="recap"
      status={status}
      header={<SwitchRow label="Weekly recap" on={r.enabled} onChange={v => set(x => ({ ...x, enabled: v }), v)} />}
    >
      {r.enabled && (
        <>
          <div className="pt-1">
            <Segment
              label="Weekly recap day"
              value={r.when}
              options={RECAP_WHEN}
              onChange={when => set(x => recapWithWhen(x, when))}
            />
          </div>
          <FieldRow label="At">
            <TimeInput label="Weekly recap time" value={r.time} onChange={time => set(x => ({ ...x, time }))} />
          </FieldRow>
        </>
      )}
    </Card>
  )
}

function WeighInCard({ status, update }: CardProps) {
  const wi = useNotifyStore(s => s.prefs.weighIn)
  const set = (patch: Partial<NotifyPrefs['weighIn']>, turningOn = false) =>
    update(p => ({ ...p, weighIn: { ...p.weighIn, ...patch } }), turningOn)
  return (
    <Card
      k="weighIn"
      status={status}
      header={
        <SwitchRow
          label="Weigh-in"
          hint="Weekly; skipped if you've logged your weight that day"
          on={wi.enabled}
          onChange={v => set({ enabled: v }, v)}
        />
      }
    >
      {wi.enabled && (
        <FieldRow label="On">
          <Select
            label="Weigh-in day"
            value={wi.weekday}
            options={WEEKDAYS.map(x => ({ value: x.d, label: x.long }))}
            onChange={weekday => set({ weekday })}
          />
          <TimeInput label="Weigh-in time" value={wi.time} onChange={time => set({ time })} />
        </FieldRow>
      )}
    </Card>
  )
}

// ── Footer ───────────────────────────────────────────────────────────────────────────────

function FooterButtons({ status, refresh }: { status: Status; refresh: Refresh }) {
  const lastResync = useNotifyStore(s => s.lastResync)
  const [msg, setMsg] = useState<string | null>(null)
  const [replanFrom, setReplanFrom] = useState<number | null>(null)
  const [testing, runTest] = useAction()

  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => setMsg(null), 20_000)
    return () => clearTimeout(t)
  }, [msg])

  function sendTest() {
    runTest(async () => {
      let state = status ? notificationsState(status) : 'ok'
      if (state === 'prompt') state = (await allowNotifications(refresh)) === 'granted' ? 'ok' : 'denied'
      if (state !== 'ok') {
        setMsg('Notifications are blocked — fix that above first.')
        return
      }
      try {
        await sendTestReminder(15)
        setMsg('Test reminder in 15 s — lock your phone now.')
      } catch (e) {
        // e.g. notifications switched off in Android since the status was read
        setMsg(e instanceof Error ? e.message : 'Could not schedule the test reminder.')
      }
    })
  }

  const replanned = replanFrom !== null && !!lastResync && lastResync.at >= replanFrom
  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={sendTest}
          disabled={testing}
          className="flex min-h-[44px] shrink-0 grow items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-primary/15 px-3 text-sm font-semibold text-primary active:bg-primary/30 disabled:opacity-50"
        >
          <Send size={16} /> Send test reminder (15 s)
        </button>
        <button
          type="button"
          onClick={() => {
            setReplanFrom(Date.now())
            setMsg(null)
            requestResync('manual', { full: true })
          }}
          className="flex min-h-[44px] shrink-0 grow items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-muted/40 px-3 text-sm font-semibold active:bg-muted"
        >
          <RefreshCw size={16} className={replanFrom !== null && !replanned ? 'animate-spin' : ''} /> Reschedule now
        </button>
        <button
          type="button"
          onClick={() => void openDeviceSettings('app_notifications').catch(() => {})}
          className="flex min-h-[44px] shrink-0 grow items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-muted/40 px-3 text-sm font-semibold active:bg-muted"
        >
          <Settings2 size={16} /> All notification settings
        </button>
      </div>
      {msg && <p className="mt-2 text-xs text-sub">{msg}</p>}
      {replanned && lastResync && !msg && (
        <p className="mt-2 text-xs text-sub">
          {lastResync.error
            ? `Re-plan failed: ${lastResync.error}`
            : lastResync.skipped
              ? `Nothing scheduled (${lastResync.skipped === 'permission' ? 'notifications not allowed' : lastResync.skipped}).`
              : `Rescheduled ${lastResync.scheduled} reminder${lastResync.scheduled === 1 ? '' : 's'}.`}
        </p>
      )}
    </div>
  )
}

function HapticsRow() {
  const haptics = useNotifyStore(s => s.haptics)
  const setHaptics = useNotifyStore(s => s.setHaptics)
  return (
    <SwitchRow
      label="Haptics"
      hint="Vibrate when you log a set, finish a workout or scan"
      on={haptics}
      onChange={v => {
        setHaptics(v)
        if (v) haptic('tap') // feedback once it is on
      }}
    />
  )
}
