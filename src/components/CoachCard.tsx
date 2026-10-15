import { useRef } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useAiStore, aiRequestOpts } from '../lib/aiStore'
import { gatherWorkoutBriefing, formatBriefing } from '../lib/coachBriefing'
import { currentNote, judgementsFor, saveJudgement } from '../lib/coachHistory'
import { generateCoachNote } from '../lib/gemini'
import AiReportCard, { renderCoachNote, HistoryLink, GeminiKeyHint } from './AiReportCard'
import { t } from '../i18n'
import type { CoachNote, Id } from '../types'

/**
 * `autoGenerate`: write the note on first view (the summary right after finishing). Off for
 * old reports, so opening one never spends quota or re-creates a verdict the user deleted.
 */
export default function CoachCard({ sessionId, autoGenerate = true }: { sessionId: Id; autoGenerate?: boolean }) {
  const cachedNote = useLiveQuery(() => currentNote('workout', sessionId), [sessionId])
  const stored = useLiveQuery(async () => (await judgementsFor('workout', sessionId)).length, [sessionId]) ?? 0
  // The model that answered (the chosen one or a free fallback), stored with the verdict.
  const usedModel = useRef('')

  async function generate(): Promise<CoachNote> {
    const briefing = await gatherWorkoutBriefing(sessionId)
    if (!briefing) throw new Error(t('components.coach.noData'))
    return generateCoachNote(formatBriefing(briefing), aiRequestOpts(m => { usedModel.current = m }))
  }

  async function save(note: CoachNote) {
    await saveJudgement({ kind: 'workout', sessionId, note, model: usedModel.current || useAiStore.getState().model })
  }

  return (
    <AiReportCard
      title={t('components.coach.title')}
      resetKey={String(sessionId)}
      cachedNote={cachedNote}
      generate={generate}
      save={save}
      renderNote={renderCoachNote}
      autoGenerate={autoGenerate}
      generateLabel={t('components.coach.generate')}
      footer={<HistoryLink kind="workout" earlier={stored - 1} />}
      noKeyHint={<GeminiKeyHint pitch={t('components.coach.noKey')} />}
    />
  )
}
