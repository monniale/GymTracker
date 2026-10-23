import { useRef, useState } from 'react'
import { Camera, Loader2, Sparkles, Trash2, X } from 'lucide-react'
import NumberStepper from '../../components/NumberStepper'
import { errMsg } from '../../components/AiReportCard'
import { useAiStore, aiRequestOpts } from '../../lib/aiStore'
import { generateMealEstimate, type InlineImage } from '../../lib/gemini'
import { downscaleImage, estimateTotals, saveEstimatedItems } from '../../lib/mealEstimate'
import { macrosFor } from '../../lib/nutrition'
import { t, fmtNum } from '../../i18n'
import type { Id, MealEstimate, MealEstimateItem } from '../../types'

const CONFIDENCE_STYLE: Record<MealEstimate['confidence'], string> = {
  low: 'bg-danger/15 text-danger',
  medium: 'bg-primary/15 text-primary',
  high: 'bg-accent/15 text-accent',
}

const round = (n: number) => fmtNum(Math.round(n))

/**
 * Add food › Estimate: describe a takeaway meal (and optionally photograph it), Gemini splits it into
 * items with estimated grams and per-100 g macros, the user fixes the grams and logs (or plans) them.
 * The photo is only sent with the request, never stored.
 */
export default function EstimateTab({ add, planning, onDone }: {
  add: (foodId: Id, grams: number) => Promise<void>
  planning: boolean
  onDone: () => void
}) {
  const apiKey = useAiStore(s => s.apiKey)
  const fileRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [photo, setPhoto] = useState<{ image: InlineImage; url: string } | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'saving'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [estimate, setEstimate] = useState<MealEstimate | null>(null)

  if (!apiKey) {
    return (
      <div className="rounded-xl border border-dashed border-edge p-4 text-center text-sm text-sub">
        <Sparkles size={20} className="mx-auto mb-2 text-primary" aria-hidden />
        {t('diet.estimate.noKey')}
      </div>
    )
  }

  async function pickPhoto(file: File | undefined) {
    if (!file) return
    setError(null)
    try {
      const image = await downscaleImage(file)
      setPhoto({ image, url: `data:${image.mimeType};base64,${image.data}` })
    } catch {
      setError(t('diet.estimate.photoFailed'))
    }
  }

  async function run() {
    if (!navigator.onLine) {
      setError(t('diet.estimate.offline'))
      return
    }
    setStatus('loading')
    setError(null)
    try {
      const result = await generateMealEstimate(text, photo?.image ?? null, aiRequestOpts())
      if (result.items.length === 0) setError(t('diet.estimate.empty'))
      setEstimate(result.items.length > 0 ? result : null)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setStatus('idle')
    }
  }

  async function save() {
    if (!estimate) return
    setStatus('saving')
    setError(null)
    try {
      await saveEstimatedItems(estimate.items, add)
      onDone()
    } catch {
      setError(t('diet.estimate.saveFailed'))
      setStatus('idle')
    }
  }

  const setItems = (fn: (items: MealEstimateItem[]) => MealEstimateItem[]) =>
    setEstimate(e => (e ? { ...e, items: fn(e.items) } : e))

  const canRun = (text.trim().length > 0 || !!photo) && status === 'idle'
  const total = estimate ? estimateTotals(estimate.items) : null

  return (
    <div className="space-y-3">
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={3}
        placeholder={t('diet.estimate.placeholder')}
        className="w-full rounded-xl bg-card p-3 text-base"
      />
      <div className="flex items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={e => { void pickPhoto(e.target.files?.[0]); e.target.value = '' }}
        />
        {photo ? (
          <div className="relative h-14 w-14 shrink-0">
            <img src={photo.url} alt={t('diet.estimate.photoAlt')} className="h-14 w-14 rounded-lg object-cover" />
            <button
              onClick={() => setPhoto(null)}
              aria-label={t('diet.estimate.removePhoto')}
              className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-muted text-ink"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => fileRef.current?.click()}
            className="flex min-h-[48px] shrink-0 items-center gap-2 whitespace-nowrap rounded-xl bg-muted/40 px-3 text-sm font-semibold text-sub active:bg-muted"
          >
            <Camera size={18} /> {t('diet.estimate.photo')}
          </button>
        )}
        <button
          onClick={() => void run()}
          disabled={!canRun}
          className="flex min-h-[48px] min-w-0 flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-3 font-display text-lg font-bold text-bg active:opacity-90 disabled:opacity-40"
        >
          {status === 'loading' ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
          <span className="truncate">{status === 'loading' ? t('diet.estimate.estimating') : t('diet.estimate.estimate')}</span>
        </button>
      </div>

      {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}

      {estimate && total && (
        <div className="space-y-2">
          <div className="rounded-xl bg-card p-3">
            <div className="mb-1 flex items-center gap-2">
              <span className="num min-w-0 flex-1 font-display text-2xl font-bold">{round(total.kcal)} kcal</span>
              <span className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${CONFIDENCE_STYLE[estimate.confidence]}`}>
                {t(`diet.estimate.confidence.${estimate.confidence}`)}
              </span>
            </div>
            <p className="num text-sm text-sub">
              {t('diet.estimate.macros', { p: round(total.protein), c: round(total.carbs), f: round(total.fat) })}
            </p>
            {estimate.headline && <p className="mt-1 text-xs text-sub">{estimate.headline}</p>}
          </div>

          {estimate.items.map((item, idx) => {
            const m = macrosFor(item, item.grams)
            return (
              <div key={`${item.name}-${idx}`} className="rounded-xl bg-card px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.name}</span>
                  <button
                    onClick={() => setItems(list => list.filter((_, i) => i !== idx))}
                    aria-label={t('diet.recipe.removeAria', { name: item.name })}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sub active:bg-muted/40"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="num text-xs text-sub">
                    {t('diet.estimate.itemMacros', { kcal: round(m.kcal), p: round(m.protein), c: round(m.carbs), f: round(m.fat) })}
                  </span>
                  <NumberStepper
                    compact
                    value={item.grams}
                    onChange={v => setItems(list => list.map((x, i) => (i === idx ? { ...x, grams: Math.round(v) } : x)))}
                    step={10}
                    min={0}
                    max={3000}
                    unit="g"
                  />
                </div>
                {item.note && <p className="mt-0.5 text-[11px] text-sub">{item.note}</p>}
              </div>
            )
          })}

          <p className="text-[11px] text-sub">{t('diet.estimate.disclaimer')}</p>
          <button
            onClick={() => void save()}
            disabled={status !== 'idle' || estimate.items.every(i => i.grams <= 0)}
            className="w-full rounded-2xl bg-primary py-3.5 font-display text-lg font-bold text-bg active:opacity-90 disabled:opacity-40"
          >
            {planning ? t('diet.estimate.addToPlan') : t('diet.estimate.logMeal')}
          </button>
        </div>
      )}
    </div>
  )
}
