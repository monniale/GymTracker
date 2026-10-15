import { useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { useAiStore, aiRequestOpts } from '../lib/aiStore'
import { gatherWeekBriefing, formatWeekBriefing, type WeekBriefing } from '../lib/weekBriefing'
import { currentNote, judgementsFor, saveJudgement } from '../lib/coachHistory'
import { generateWeekNote } from '../lib/gemini'
import AiReportCard, { renderCoachNote, HistoryLink } from './AiReportCard'
import type { CoachNote } from '../types'

/** Monday of the last week reviewed automatically on this device (device-local, never synced). */
const AUTO_KEY = 'gymtracker-week-review-auto'

function autoDoneFor(monday: string): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) === monday
  } catch {
    return true // no storage: never spend quota unasked
  }
}

/**
 * The weekly coach review. Manual ("Review my week"), except for the most recent
 * finished week, which generates by itself once per device: the marker is set
 * when a generation starts, so a failure or a deleted review never re-fires.
 */
export default function WeekCoachCard({ briefing, autoEligible }: { briefing: WeekBriefing; autoEligible: boolean }) {
  const { monday, finished } = briefing
  const cachedNote = useLiveQuery(() => currentNote('week', monday), [monday])
  const stored = useLiveQuery(async () => (await judgementsFor('week', monday)).length, [monday]) ?? 0
  const usedModel = useRef('')
  const loggedDays = briefing.nutrition?.loggedDays ?? 0
  const canGenerate = finished && (briefing.sessions.length > 0 || loggedDays > 0)
  const autoGenerate = useMemo(() => autoEligible && !autoDoneFor(monday), [autoEligible, monday])

  async function generate(): Promise<CoachNote> {
    // Only the auto-eligible week moves the marker: a manual review of another week must not
    // re-arm it (a deleted review of the last week would then come back by itself).
    if (autoEligible) {
      try {
        localStorage.setItem(AUTO_KEY, monday)
      } catch {
        /* storage unavailable: auto-generation is off anyway */
      }
    }
    const fresh = await gatherWeekBriefing(monday)
    return generateWeekNote(formatWeekBriefing(fresh), aiRequestOpts(m => { usedModel.current = m }))
  }

  async function save(note: CoachNote) {
    await saveJudgement({ kind: 'week', date: monday, note, model: usedModel.current || useAiStore.getState().model })
  }

  return (
    <AiReportCard
      title="Week review"
      resetKey={monday}
      cachedNote={cachedNote}
      generate={generate}
      save={save}
      renderNote={renderCoachNote}
      autoGenerate={autoGenerate}
      canGenerate={canGenerate}
      generateLabel="Review my week"
      emptyHint={finished ? 'Nothing logged this week, so there is nothing to review.' : 'Available once the week is over (after Sunday).'}
      footer={<HistoryLink kind="week" earlier={stored - 1} />}
      noKeyHint={
        <>
          Get a weekly review and next week’s focus from the AI coach.{' '}
          <Link to="/settings" className="font-semibold text-primary">
            Add a free Gemini key
          </Link>{' '}
          in Settings.
        </>
      }
    />
  )
}
