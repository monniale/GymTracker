import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Plus, Check, Loader2 } from 'lucide-react'
import { db, withSyncTrackingSuspended } from '../db/db'
import { useAiStore, aiRequestOpts } from '../lib/aiStore'
import {
  gatherMacroCompletionBriefing,
  formatMacroCompletionBriefing,
  macroBasisSig,
} from '../lib/dietReport'
import { generateMacroSuggestion } from '../lib/gemini'
import { applyMacroSuggestion } from '../lib/foodResolve'
import type { MacroTotals } from '../lib/nutrition'
import AiReportCard, { GeminiKeyHint } from './AiReportCard'
import { t } from '../i18n'
import type { MacroSuggestion, MacroSuggestionItem } from '../types'

type AddStatus = 'idle' | 'adding' | 'added' | 'error'

/**
 * F1a: "Complete your macros" — AI suggests real foods + portions to close the
 * day's remaining macros, each tap-to-log. Manual generate; the suggestion is
 * cached per day and flagged stale once the day's remaining macros move.
 */
export default function MacroCompletionCard({ date, remaining }: { date: string; remaining: MacroTotals }) {
  const cached = useLiveQuery(async () => (await db.dietSuggestions.get(date)) ?? null, [date])
  const cachedNote = cached === undefined ? undefined : cached ? cached.suggestion : null
  const basis = macroBasisSig(remaining)
  const stale = !!cached && cached.basis !== basis

  // Only worth generating when there's a meaningful gap left to fill.
  const gap = remaining.protein > 5 || remaining.kcal > 50

  const [status, setStatus] = useState<Record<number, AddStatus>>({})
  // Bumped on every fresh suggestion so a slow add() that resolves after a
  // Regenerate can't mislabel a now-different item (its indices are stale).
  const genRef = useRef(0)
  // The model that answered (the chosen one or a free fallback), recorded with the suggestion.
  const usedModel = useRef('')

  async function generate(): Promise<MacroSuggestion> {
    const briefing = await gatherMacroCompletionBriefing(date)
    if (!briefing) throw new Error(t('components.macros.noTargets'))
    return generateMacroSuggestion(
      formatMacroCompletionBriefing(briefing),
      aiRequestOpts(m => { usedModel.current = m }),
    )
  }

  async function save(note: MacroSuggestion) {
    const model = usedModel.current || useAiStore.getState().model
    genRef.current += 1
    setStatus({}) // fresh suggestion → reset per-item add state
    await withSyncTrackingSuspended(() =>
      db.dietSuggestions.put({ date, basis, suggestion: note, model, generatedAt: Date.now() }),
    )
  }

  async function add(i: number, item: MacroSuggestionItem) {
    const gen = genRef.current
    setStatus(s => ({ ...s, [i]: 'adding' }))
    try {
      const id = await applyMacroSuggestion(item, date)
      if (genRef.current !== gen) return // list was regenerated; drop stale result
      setStatus(s => ({ ...s, [i]: id != null ? 'added' : 'error' }))
    } catch {
      if (genRef.current !== gen) return
      setStatus(s => ({ ...s, [i]: 'error' }))
    }
  }

  function renderNote(note: MacroSuggestion) {
    return (
      <>
        <p className="mt-2 font-display text-lg font-semibold text-primary">{note.headline}</p>
        {stale && (
          <p className="mt-1 text-xs text-sub">{t('components.macros.stale')}</p>
        )}
        {note.items.length === 0 ? (
          <p className="mt-2 text-sm text-sub">{t('components.macros.empty')}</p>
        ) : (
          <ul className="mt-2 space-y-2.5">
            {note.items.map((item, i) => (
              <li key={i} className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-medium">
                    {item.food}
                    {item.brand && <span className="text-sub"> · {item.brand}</span>}
                    <span className="num text-sub"> · {item.grams} g</span>
                  </p>
                  <p className="num text-xs text-sub">
                    {t('components.macros.line', { kcal: item.kcal, protein: item.protein, carbs: item.carbs, fat: item.fat })}
                  </p>
                  {item.reason && <p className="mt-0.5 text-xs text-sub/80">{item.reason}</p>}
                </div>
                <AddButton status={status[i] ?? 'idle'} onClick={() => void add(i, item)} />
              </li>
            ))}
          </ul>
        )}
      </>
    )
  }

  return (
    <AiReportCard<MacroSuggestion>
      title={t('components.macros.title')}
      resetKey={date}
      cachedNote={cachedNote}
      generate={generate}
      save={save}
      renderNote={renderNote}
      autoGenerate={false}
      canGenerate={gap}
      generateLabel={t('components.macros.generate')}
      loadingLabel={t('components.macros.loading')}
      emptyHint={t('components.macros.done')}
      noKeyHint={<GeminiKeyHint pitch={t('components.macros.noKey')} />}
    />
  )
}

function AddButton({ status, onClick }: { status: AddStatus; onClick: () => void }) {
  if (status === 'added') {
    return (
      <span className="flex h-9 shrink-0 items-center whitespace-nowrap gap-1 rounded-lg px-2 text-xs font-semibold text-accent">
        <Check size={15} /> {t('components.macros.added')}
      </span>
    )
  }
  return (
    <button
      onClick={onClick}
      disabled={status === 'adding'}
      className="flex h-9 shrink-0 items-center whitespace-nowrap gap-1 rounded-lg bg-primary/15 px-2.5 text-xs font-bold text-primary active:bg-primary/30 disabled:opacity-50"
    >
      {status === 'adding' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={15} />}
      {status === 'error' ? t('components.macros.retry') : t('common.add')}
    </button>
  )
}
