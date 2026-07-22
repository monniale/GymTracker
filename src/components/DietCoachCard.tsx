import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, withSyncTrackingSuspended } from '../db/db'
import { useAiStore } from '../lib/aiStore'
import { gatherDietBriefing, formatDietBriefing } from '../lib/dietReport'
import { generateDietNote } from '../lib/gemini'
import AiReportCard from './AiReportCard'
import type { CoachNote } from '../types'

export default function DietCoachCard({ date }: { date: string }) {
  const cached = useLiveQuery(async () => (await db.dietNotes.get(date)) ?? null, [date])
  const cachedNote = cached === undefined ? undefined : cached ? cached.note : null

  async function generate(): Promise<CoachNote> {
    const briefing = await gatherDietBriefing(date)
    if (!briefing) throw new Error('Log some food first to get a diet report.')
    const { apiKey, model } = useAiStore.getState()
    return generateDietNote(formatDietBriefing(briefing), { apiKey: apiKey!, model })
  }

  async function save(note: CoachNote) {
    const model = useAiStore.getState().model
    await withSyncTrackingSuspended(() =>
      db.dietNotes.put({ date, note, model, generatedAt: Date.now() }),
    )
  }

  return (
    <AiReportCard
      title="Diet report"
      resetKey={date}
      cachedNote={cachedNote}
      generate={generate}
      save={save}
      autoGenerate={false}
      generateLabel="Generate diet report"
      noKeyHint={
        <>
          Get AI feedback on your nutrition.{' '}
          <Link to="/settings" className="font-semibold text-primary">
            Add a free Gemini key
          </Link>{' '}
          in Settings.
        </>
      }
    />
  )
}
