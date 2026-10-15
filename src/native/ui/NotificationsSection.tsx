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
import { addDays, fmtDate, fmtDateTime, localDateStr } from '../../lib/dates'
import { fmtNum, t, tp } from '../../i18n'
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
        <Bell size={14} className={ready ? 'text-accent' : ''} /> {t('native.notifications.title')}
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
        {t('native.notifications.checking')}
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
              ? tp('native.notifications.health.needAttention', required)
              : muted
                ? tp('native.notifications.health.mutedTypes', muted)
                : t('native.notifications.health.ready')}
          </span>
          {tips > 0 && <span className="block text-xs text-sub">{tp('native.notifications.health.tips', tips)}</span>}
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
              ? t('native.notifications.issue.notAllowedYet')
              : item.state === 'denied'
                ? t('native.notifications.issue.blocked')
                : t('native.notifications.issue.offForApp')
          }
          hint={t('native.notifications.issue.notificationsHint')}
        >
          {item.state === 'prompt' ? (
            <ActionButton onClick={() => allowNotifications(refresh)}>{t('native.actions.allow')}</ActionButton>
          ) : (
            <ActionButton onClick={() => openDeviceSettings('app_notifications')}>{t('native.actions.openSettings')}</ActionButton>
          )}
        </IssueRow>
      )
    case 'exact':
      return (
        <IssueRow title={t('native.notifications.issue.exactOff')} hint={t('native.notifications.issue.exactHint')}>
          <ActionButton onClick={() => openExactAlarmSettings()}>{t('native.actions.fix')}</ActionButton>
        </IssueRow>
      )
    case 'battery':
      return item.state === 'restricted' ? (
        <IssueRow
          title={t('native.notifications.issue.batteryRestricted')}
          hint={t('native.notifications.issue.batteryRestrictedHint')}
        >
          <ActionButton onClick={() => openDeviceSettings('app_details')}>{t('native.actions.open')}</ActionButton>
        </IssueRow>
      ) : (
        <IssueRow
          title={t('native.notifications.issue.batteryOptimised')}
          hint={t('native.notifications.issue.batteryOptimisedHint')}
        >
          <ActionButton onClick={() => openDeviceSettings('battery_request')}>{t('native.actions.allow')}</ActionButton>
        </IssueRow>
      )
    case 'samsung':
      return (
        <IssueRow
          title={t('native.notifications.issue.samsung')}
          hint={t('native.notifications.issue.samsungHint')}
        >
          <ActionButton onClick={() => openDeviceSettings('samsung_never_sleeping')}>{t('native.actions.openList')}</ActionButton>
          <ActionButton tone="quiet" onClick={() => setSamsungDone(true)}>
            {t('common.done')}
          </ActionButton>
        </IssueRow>
      )
    case 'promotion':
      return (
        <IssueRow
          tone="info"
          title={t('native.notifications.issue.promotion')}
          hint={t('native.notifications.issue.promotionHint')}
        >
          <ActionButton tone="quiet" onClick={() => openDeviceSettings('promotion')}>
            {t('native.actions.settings')}
          </ActionButton>
        </IssueRow>
      )
  }
}

/** One-word states of the diagnostics lines. */
type DetailWord =
  | 'allowed'
  | 'notAsked'
  | 'denied'
  | 'off'
  | 'on'
  | 'restricted'
  | 'unrestricted'
  | 'optimised'
  | 'persistent'
  | 'bestEffort'
  | 'notAllowed'
  | 'inexact'

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
        <Info size={13} /> {t('native.notifications.details.button')}
      </button>
    )

  const n = notificationsState(status)
  const bucket = bucketLabel(status.standbyBucket)
  const d = (key: DetailWord) => t(`native.notifications.details.${key}`)
  const notifState: Record<typeof n, DetailWord> = { ok: 'allowed', prompt: 'notAsked', denied: 'denied', off: 'off' }
  return (
    <div className="space-y-0.5 px-1 pb-1 text-xs leading-relaxed text-sub">
      <p>
        {t('native.notifications.details.notifications', {
          state: d(notifState[n]),
          exact: d(status.exact ? 'on' : 'off'),
        })}
      </p>
      <p>
        {t('native.notifications.details.battery', {
          state: d(status.backgroundRestricted ? 'restricted' : status.ignoringBattery ? 'unrestricted' : 'optimised'),
        })}
        {bucket && <> · {t('native.notifications.details.standby', { bucket })}</>}
        {persisted !== null && (
          <> · {t('native.notifications.details.storage', { state: d(persisted ? 'persistent' : 'bestEffort') })}</>
        )}
      </p>
      <p>
        {t('native.notifications.details.device', {
          maker: status.manufacturer || 'Android',
          sdk: status.sdkInt,
          state: d(status.promotedAllowed ? 'allowed' : 'notAllowed'),
        })}
      </p>
      {lastResync && (
        <p>
          {t('native.notifications.details.lastPlan', { when: fmtDateTime(lastResync.at), reason: lastResync.reason })} ·{' '}
          {lastResync.skipped
            ? t('native.notifications.details.skipped', { reason: lastResync.skipped })
            : tp('native.notifications.details.scheduled', lastResync.scheduled)}
          {!lastResync.exact && ` · ${d('inexact')}`}
        </p>
      )}
      {lastResync?.error && (
        <p className="text-danger">{t('native.notifications.details.error', { error: lastResync.error })}</p>
      )}
      {isSamsung(status) && samsungDone && (
        <p>
          {t('native.notifications.details.samsungDone')} ·{' '}
          <button type="button" onClick={() => setSamsungDone(false)} className="font-semibold text-primary">
            {t('native.actions.undo')}
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
  const today = localDateStr()
  if (date === today) return t('native.notifications.schedule.today')
  if (date === addDays(today, 1)) return t('native.notifications.schedule.tomorrow')
  return fmtDate(date)
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
  if (!prefs.enabled) main = t('native.notifications.schedule.off')
  else if (blocked) main = t('native.notifications.schedule.blocked')
  else if (!summary) main = null
  else if (summary.count === 0)
    main = remindersActive(prefs) ? t('native.notifications.schedule.nothing') : t('native.notifications.schedule.noneOn')
  else
    main = (
      <>
        <span className="block font-semibold text-ink">
          {horizon
            ? t('native.notifications.schedule.through', { day: dayWord(throughDate(horizon)) })
            : tp('native.notifications.schedule.count', summary.count)}
        </span>
        {summary.next && (
          <span className="block truncate">
            {t('native.notifications.schedule.next', { when: fmtDateTime(summary.next.atMs), title: summary.next.title })}
          </span>
        )}
        <span className="block">{t('native.notifications.schedule.extends')}</span>
      </>
    )
  const keepAliveMuted = !blocked && remindersActive(prefs) && isMuted(status?.channels, CHANNEL.status)

  return (
    <div className="mt-3 space-y-2 px-1">
      {main && <p className="text-xs leading-relaxed text-sub">{main}</p>}
      {keepAliveMuted && (
        <IssueRow
          title={t('native.notifications.schedule.keepAliveMuted')}
          hint={t('native.notifications.schedule.keepAliveHint')}
        >
          <ActionButton onClick={() => openDeviceSettings('channel', CHANNEL.status)}>{t('native.actions.open')}</ActionButton>
        </IssueRow>
      )}
      {lastResync?.error && (
        <p className="text-xs text-danger">{t('native.notifications.schedule.replanFailed', { error: lastResync.error })}</p>
      )}
    </div>
  )
}

// ── Reminders ────────────────────────────────────────────────────────────────────────────

// Built with t() at module load: changing the language reloads the app.
const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
const WEEKDAYS: { d: IsoWeekday; short: string; long: string }[] = WEEKDAY_KEYS.map((k, i) => ({
  d: (i + 1) as IsoWeekday,
  short: t(`native.notifications.weekday.${k}Short`),
  long: t(`native.notifications.weekday.${k}`),
}))

const MEALS: { meal: MealType; label: string }[] = (['breakfast', 'lunch', 'snack', 'dinner'] as const).map(meal => ({
  meal,
  label: t(`native.notifications.meals.${meal}`),
}))

const WATER_EVERY: { value: NotifyPrefs['water']['intervalMin']; label: string }[] = ([60, 90, 120, 180] as const).map(
  value => ({ value, label: t('native.notifications.water.hours', { n: fmtNum(value / 60) }) }),
)

const RECAP_WHEN: { value: NotifyPrefs['recap']['when']; title: string; sub: string }[] = [
  {
    value: 'monday-morning',
    title: t('native.notifications.recap.monday'),
    sub: t('native.notifications.recap.mondaySub'),
  },
  {
    value: 'sunday-evening',
    title: t('native.notifications.recap.sunday'),
    sub: t('native.notifications.recap.sundaySub'),
  },
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
  const sub = !prefs.enabled
    ? t('native.notifications.reminders.allOff')
    : on === 0
      ? t('native.notifications.reminders.noneOn')
      : t('native.notifications.reminders.countOn', { on, total: CATEGORY_KEYS.length })

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
            <span className="block text-sm font-semibold">{t('native.notifications.reminders.title')}</span>
            <span className="block truncate text-xs text-sub">
              {sub}
              {anyMuted && <span className="text-danger"> · {tp('native.notifications.reminders.muted', muted)}</span>}
            </span>
          </span>
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={prefs.enabled}
          aria-label={t('native.notifications.reminders.allSwitch')}
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
          <p className="mt-2 px-1 text-xs text-sub">{t('native.notifications.reminders.turnOnHint')}</p>
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
          label={t('native.notifications.workout.label')}
          hint={t('native.notifications.workout.hint')}
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
          {w.days.length === 0 && <p className="text-xs text-primary">{t('native.notifications.workout.pickDays')}</p>}
          <FieldRow label={t('native.notifications.workout.remindAt')}>
            <TimeInput label={t('native.notifications.workout.timeLabel')} value={w.time} onChange={time => set({ time })} />
          </FieldRow>
          <SwitchRow
            label={t('native.notifications.workout.skipTarget')}
            on={w.skipWhenTargetMet}
            onChange={v => set({ skipWhenTargetMet: v })}
          />
        </>
      )}
      <SwitchRow
        label={t('native.notifications.workout.openSession')}
        hint={t('native.notifications.workout.openSessionHint')}
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
    <Card k="meals" status={status} header={<CardTitle>{t('native.notifications.meals.title')}</CardTitle>}>
      {MEALS.map(({ meal, label }) => (
        <div key={meal} className="flex flex-wrap items-center justify-end gap-x-2">
          <SwitchRow
            label={label}
            basis="basis-24"
            on={meals[meal].enabled}
            onChange={v => set(meal, { enabled: v }, v)}
          />
          <TimeInput
            label={t('native.notifications.meals.timeLabel', { meal: label })}
            value={meals[meal].time}
            disabled={!meals[meal].enabled}
            onChange={time => set(meal, { time })}
          />
        </div>
      ))}
      <p className="text-xs text-sub">{t('native.notifications.meals.skipped')}</p>
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
      header={
        <SwitchRow label={t('native.notifications.water.label')} on={water.enabled} onChange={v => set({ enabled: v }, v)} />
      }
    >
      {water.enabled && (
        <>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <label className="min-w-0">
              <span className="mb-0.5 block text-xs text-sub">{t('native.notifications.water.from')}</span>
              <TimeInput
                label={t('native.notifications.water.fromLabel')}
                value={water.start}
                onChange={start => set({ start })}
                className="w-full"
              />
            </label>
            <label className="min-w-0">
              <span className="mb-0.5 block text-xs text-sub">{t('native.notifications.water.to')}</span>
              <TimeInput
                label={t('native.notifications.water.toLabel')}
                value={water.end}
                onChange={end => set({ end })}
                className="w-full"
              />
            </label>
          </div>
          <FieldRow label={t('native.notifications.water.every')}>
            <Select
              label={t('native.notifications.water.everyLabel')}
              value={water.intervalMin}
              options={WATER_EVERY}
              onChange={intervalMin => set({ intervalMin })}
            />
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
    <Card k="rank" status={status} header={<CardTitle>{t('native.notifications.rank.title')}</CardTitle>}>
      <div className="flex flex-wrap items-center justify-end gap-x-2">
        <SwitchRow
          label={t('native.notifications.rank.decay')}
          basis="basis-36"
          hint={t('native.notifications.rank.decayHint')}
          on={r.decayWarning}
          onChange={v => set({ decayWarning: v }, v)}
        />
        <TimeInput
          label={t('native.notifications.rank.decayTime')}
          value={r.decayTime}
          disabled={!r.decayWarning}
          onChange={decayTime => set({ decayTime })}
        />
      </div>
      <div className="flex flex-wrap items-center justify-end gap-x-2">
        <SwitchRow
          label={t('native.notifications.rank.streak')}
          basis="basis-36"
          hint={t('native.notifications.rank.streakHint')}
          on={r.streakWarning}
          onChange={v => set({ streakWarning: v }, v)}
        />
        <TimeInput
          label={t('native.notifications.rank.streakTime')}
          value={r.streakTime}
          disabled={!r.streakWarning}
          onChange={streakTime => set({ streakTime })}
        />
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
      header={
        <SwitchRow
          label={t('native.notifications.recap.label')}
          on={r.enabled}
          onChange={v => set(x => ({ ...x, enabled: v }), v)}
        />
      }
    >
      {r.enabled && (
        <>
          <div className="pt-1">
            <Segment
              label={t('native.notifications.recap.dayLabel')}
              value={r.when}
              options={RECAP_WHEN}
              onChange={when => set(x => recapWithWhen(x, when))}
            />
          </div>
          <FieldRow label={t('native.notifications.recap.at')}>
            <TimeInput
              label={t('native.notifications.recap.timeLabel')}
              value={r.time}
              onChange={time => set(x => ({ ...x, time }))}
            />
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
          label={t('native.notifications.weighIn.label')}
          hint={t('native.notifications.weighIn.hint')}
          on={wi.enabled}
          onChange={v => set({ enabled: v }, v)}
        />
      }
    >
      {wi.enabled && (
        <FieldRow label={t('native.notifications.weighIn.on')}>
          <Select
            label={t('native.notifications.weighIn.dayLabel')}
            value={wi.weekday}
            options={WEEKDAYS.map(x => ({ value: x.d, label: x.long }))}
            onChange={weekday => set({ weekday })}
          />
          <TimeInput label={t('native.notifications.weighIn.timeLabel')} value={wi.time} onChange={time => set({ time })} />
        </FieldRow>
      )}
    </Card>
  )
}

// ── Footer ───────────────────────────────────────────────────────────────────────────────

/** Why a re-plan scheduled nothing, for the footer line (unknown codes as they are). */
function skippedReason(skipped: string): string {
  if (skipped === 'permission') return t('native.notifications.footer.skippedPermission')
  if (skipped === 'disabled') return t('native.notifications.footer.skippedDisabled')
  return skipped
}

function FooterButtons({ status, refresh }: { status: Status; refresh: Refresh }) {
  const lastResync = useNotifyStore(s => s.lastResync)
  const [msg, setMsg] = useState<string | null>(null)
  const [replanFrom, setReplanFrom] = useState<number | null>(null)
  const [testing, runTest] = useAction()

  useEffect(() => {
    if (!msg) return
    const timer = setTimeout(() => setMsg(null), 20_000)
    return () => clearTimeout(timer)
  }, [msg])

  function sendTest() {
    runTest(async () => {
      let state = status ? notificationsState(status) : 'ok'
      if (state === 'prompt') state = (await allowNotifications(refresh)) === 'granted' ? 'ok' : 'denied'
      if (state !== 'ok') {
        setMsg(t('native.notifications.footer.blocked'))
        return
      }
      try {
        await sendTestReminder(15)
        setMsg(t('native.notifications.footer.testSent'))
      } catch (e) {
        // e.g. notifications switched off in Android since the status was read
        setMsg(e instanceof Error ? e.message : t('native.notifications.footer.testFailed'))
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
          <Send size={16} /> {t('native.notifications.footer.sendTest')}
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
          <RefreshCw size={16} className={replanFrom !== null && !replanned ? 'animate-spin' : ''} />{' '}
          {t('native.notifications.footer.reschedule')}
        </button>
        <button
          type="button"
          onClick={() => void openDeviceSettings('app_notifications').catch(() => {})}
          className="flex min-h-[44px] shrink-0 grow items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-muted/40 px-3 text-sm font-semibold active:bg-muted"
        >
          <Settings2 size={16} /> {t('native.notifications.footer.allSettings')}
        </button>
      </div>
      {msg && <p className="mt-2 text-xs text-sub">{msg}</p>}
      {replanned && lastResync && !msg && (
        <p className="mt-2 text-xs text-sub">
          {lastResync.error
            ? t('native.notifications.footer.replanFailed', { error: lastResync.error })
            : lastResync.skipped
              ? t('native.notifications.footer.nothingScheduled', { reason: skippedReason(lastResync.skipped) })
              : tp('native.notifications.footer.rescheduled', lastResync.scheduled)}
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
      label={t('native.notifications.haptics.label')}
      hint={t('native.notifications.haptics.hint')}
      on={haptics}
      onChange={v => {
        setHaptics(v)
        if (v) haptic('tap') // feedback once it is on
      }}
    />
  )
}
