import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, withSyncTrackingSuspended } from '../db/db'
import { useAiStore } from '../lib/aiStore'
import { gatherWorkoutBriefing, formatBriefing } from '../lib/coachBriefing'
import { generateCoachNote } from '../lib/gemini'
import AiReportCard, { renderCoachNote } from './AiReportCard'
import type { CoachNote, Id } from '../types'

export default function CoachCard({ sessionId }: { sessionId: Id }) {
  const cached = useLiveQuery(async () => (await db.coachNotes.get(sessionId)) ?? null, [sessionId])
  const cachedNote = cached === undefined ? undefined : cached ? cached.note : null

  async function generate(): Promise<CoachNote> {
    const briefing = await gatherWorkoutBriefing(sessionId)
    if (!briefing) throw new Error('This session has no data to review.')
    const { apiKey, model } = useAiStore.getState()
    return generateCoachNote(formatBriefing(briefing), { apiKey: apiKey!, model })
  }

  async function save(note: CoachNote) {
    const model = useAiStore.getState().model
    await withSyncTrackingSuspended(() =>
      db.coachNotes.put({ sessionId, note, model, generatedAt: Date.now() }),
    )
  }

  return (
    <AiReportCard
      title="Coach’s note"
      resetKey={String(sessionId)}
      cachedNote={cachedNote}
      generate={generate}
      save={save}
      renderNote={renderCoachNote}
      autoGenerate
      noKeyHint={
        <>
          Get an AI coaching note on every workout.{' '}
          <Link to="/settings" className="font-semibold text-primary">
            Add a free Gemini key
          </Link>{' '}
          in Settings.
        </>
      }
    />
  )
}
