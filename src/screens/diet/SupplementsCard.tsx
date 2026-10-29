import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, Pencil, Pill, Plus, Trash2 } from 'lucide-react'
import { db } from '../../db/db'
import { addSupplement, deleteSupplement, setSupplementTaken, sortSupplements, supplementLogId, updateSupplement } from '../../lib/supplements'
import { haptic } from '../../native/haptics'
import Sheet from '../../components/Sheet'
import { t } from '../../i18n'
import type { Id, Supplement } from '../../types'

/**
 * The day's supplements on the Diet screen: tick each one taken. A supplement not logged by its
 * time today shows as due, and on Android the supplement reminder fires then (notifyPlanner).
 */
export default function SupplementsCard({ date, today }: { date: string; today: string }) {
  const supplements = useLiveQuery(async () => sortSupplements(await db.supplements.toArray())) ?? []
  const taken = useLiveQuery(
    async () => new Set((await db.supplementLogs.where('date').equals(date).toArray()).map(l => l.id)),
    [date],
  ) ?? new Set<string>()
  const [managing, setManaging] = useState(false)
  const canLog = date <= today
  const nowHHMM = new Date().toTimeString().slice(0, 5)

  if (supplements.length === 0) {
    return (
      <>
        <button
          onClick={() => setManaging(true)}
          className="mb-4 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-edge text-sm font-semibold text-sub active:bg-muted/40"
        >
          <Pill size={16} aria-hidden /> {t('diet.supplements.start')}
        </button>
        {managing && <ManageSheet supplements={supplements} onClose={() => setManaging(false)} />}
      </>
    )
  }

  const done = supplements.filter(s => taken.has(supplementLogId(s.id!, date))).length
  return (
    <div className="mb-4 rounded-2xl border border-edge bg-card p-4">
      <div className="mb-2 flex items-center gap-2">
        <Pill size={17} className="shrink-0 text-accent" aria-hidden />
        <h2 className="min-w-0 flex-1 truncate font-display text-lg font-semibold">{t('diet.supplements.title')}</h2>
        <span className="num shrink-0 text-sm text-sub">{done}/{supplements.length}</span>
        <button
          onClick={() => setManaging(true)}
          aria-label={t('diet.supplements.manage')}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sub active:bg-muted/40"
        >
          <Pencil size={16} />
        </button>
      </div>
      <div className="space-y-1">
        {supplements.map(s => {
          const isTaken = taken.has(supplementLogId(s.id!, date))
          const due = !isTaken && (date < today || (date === today && nowHHMM >= s.time))
          return (
            <button
              key={s.id}
              disabled={!canLog}
              onClick={() => {
                haptic('tap')
                void setSupplementTaken(s.id!, date, !isTaken)
              }}
              aria-pressed={isTaken}
              className="flex min-h-[44px] w-full items-center gap-3 rounded-xl px-2 text-left active:bg-muted/40 disabled:opacity-60"
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${
                  isTaken ? 'border-primary bg-primary text-bg' : due ? 'border-danger' : 'border-edge'
                }`}
              >
                {isTaken && <Check size={14} strokeWidth={3} />}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {s.name}
                {s.dose && <span className="text-sub"> · {s.dose}</span>}
              </span>
              <span className={`num shrink-0 whitespace-nowrap text-xs ${due ? 'font-semibold text-danger' : 'text-sub'}`}>
                {s.time}
              </span>
            </button>
          )
        })}
      </div>
      {managing && <ManageSheet supplements={supplements} onClose={() => setManaging(false)} />}
    </div>
  )
}

interface Draft { id: Id | null; name: string; dose: string; time: string }

const EMPTY: Draft = { id: null, name: '', dose: '', time: '09:00' }

function ManageSheet({ supplements, onClose }: { supplements: Supplement[]; onClose: () => void }) {
  const [draft, setDraft] = useState<Draft | null>(supplements.length === 0 ? EMPTY : null)
  const valid = !!draft && draft.name.trim().length > 0 && /^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time)

  async function save() {
    if (!draft || !valid) return
    const fields = { name: draft.name, dose: draft.dose, time: draft.time }
    if (draft.id === null) await addSupplement(fields)
    else await updateSupplement(draft.id, fields)
    setDraft(null)
  }

  async function remove(s: Supplement) {
    if (!window.confirm(t('diet.supplements.deleteConfirm', { name: s.name }))) return
    await deleteSupplement(s.id!)
    if (draft?.id === s.id) setDraft(null)
  }

  return (
    <Sheet open onClose={onClose} title={t('diet.supplements.manageTitle')}>
      <div className="space-y-2 pb-4">
        <p className="text-sm text-sub">{t('diet.supplements.hint')}</p>
        {supplements.map(s => (
          <div key={s.id} className="flex items-center gap-2 rounded-xl bg-surface px-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{s.name}</span>
              <span className="num block truncate text-xs text-sub">
                {s.dose ? `${s.dose} · ${s.time}` : s.time}
              </span>
            </span>
            <button
              onClick={() => setDraft({ id: s.id!, name: s.name, dose: s.dose ?? '', time: s.time })}
              aria-label={t('diet.supplements.edit', { name: s.name })}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sub active:bg-muted/40"
            >
              <Pencil size={16} />
            </button>
            <button
              onClick={() => void remove(s)}
              aria-label={t('diet.supplements.delete', { name: s.name })}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-danger active:bg-danger/10"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}

        {draft ? (
          <div className="space-y-2 rounded-xl border border-edge p-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-sub">{t('diet.supplements.name')}</span>
              <input
                value={draft.name}
                maxLength={40}
                autoFocus
                placeholder={t('diet.supplements.namePlaceholder')}
                onChange={e => setDraft({ ...draft, name: e.target.value })}
                className="min-h-[44px] w-full rounded-xl bg-surface px-3 text-base"
              />
            </label>
            <div className="flex gap-2">
              <label className="min-w-0 flex-1">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-sub">{t('diet.supplements.dose')}</span>
                <input
                  value={draft.dose}
                  maxLength={20}
                  placeholder={t('diet.supplements.dosePlaceholder')}
                  onChange={e => setDraft({ ...draft, dose: e.target.value })}
                  className="min-h-[44px] w-full rounded-xl bg-surface px-3 text-base"
                />
              </label>
              <label className="w-28 shrink-0">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-sub">{t('diet.supplements.time')}</span>
                <input
                  type="time"
                  value={draft.time}
                  onChange={e => setDraft({ ...draft, time: e.target.value })}
                  className="num min-h-[44px] w-full rounded-xl bg-surface px-2 text-base"
                />
              </label>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => void save()}
                disabled={!valid}
                className="min-h-[44px] flex-1 rounded-xl bg-primary font-semibold text-bg active:opacity-90 disabled:opacity-50"
              >
                {t('diet.supplements.save')}
              </button>
              <button
                onClick={() => setDraft(null)}
                className="min-h-[44px] shrink-0 rounded-xl bg-muted/40 px-4 font-semibold active:bg-muted"
              >
                {t('diet.supplements.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setDraft(EMPTY)}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-muted/40 font-semibold active:bg-muted"
          >
            <Plus size={16} aria-hidden /> {t('diet.supplements.add')}
          </button>
        )}
      </div>
    </Sheet>
  )
}
