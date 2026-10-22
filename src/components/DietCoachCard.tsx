import { useRef } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useAiStore, aiRequestOpts } from '../lib/aiStore'
import { gatherDietBriefing, formatDietBriefing } from '../lib/dietReport'
import { currentNote, judgementsFor, saveJudgement } from '../lib/coachHistory'
import { generateDietNote } from '../lib/gemini'
import AiReportCard, { renderCoachNote, HistoryLink, GeminiKeyHint } from './AiReportCard'
import { t } from '../i18n'
import type { CoachNote } from '../types'

export default function DietCoachCard({ date }: { date: string }) {
  const cachedNote = useLiveQuery(() => currentNote('diet', date), [date])
  const stored = useLiveQuery(async () => (await judgementsFor('diet', date)).length, [date]) ?? 0
  // The model that answered (the chosen one or a free fallback), stored with the report.
  const usedModel = useRef('')

  async function generate(): Promise<CoachNote> {
    const briefing = await gatherDietBriefing(date)
    if (!briefing) throw new Error(t('components.dietCoach.noFood'))
    return generateDietNote(formatDietBriefing(briefing), aiRequestOpts(m => { usedModel.current = m }))
  }

  async function save(note: CoachNote) {
    await saveJudgement({ kind: 'diet', date, note, model: usedModel.current || useAiStore.getState().model })
  }

  return (
    <AiReportCard
      title={t('components.dietCoach.title')}
      resetKey={date}
      cachedNote={cachedNote}
      generate={generate}
      save={save}
      renderNote={renderCoachNote}
      autoGenerate={false}
      generateLabel={t('components.dietCoach.generate')}
      footer={<HistoryLink kind="diet" earlier={stored - 1} />}
      noKeyHint={<GeminiKeyHint pitch={t('components.dietCoach.noKey')} />}
    />
  )
}
