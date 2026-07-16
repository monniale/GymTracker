import { describe, it, expect } from 'vitest'
import { formatBriefing, type WorkoutBriefing, type BriefingExercise } from './coachBriefing'

const exercise = (p: Partial<BriefingExercise> = {}): BriefingExercise => ({
  name: 'Bench Press',
  muscleGroup: 'chest',
  sets: [
    { weightKg: 80, reps: 8 },
    { weightKg: 80, reps: 8 },
  ],
  bestE1rm: 101,
  priorBestE1rm: 100,
  e1rmPr: true,
  volumePr: false,
  strengthLevel: 'Intermediate',
  nextSuggestion: '82.5 kg for 8 reps',
  ...p,
})

const briefing = (p: Partial<WorkoutBriefing> = {}): WorkoutBriefing => ({
  sessionName: 'Push Day',
  durationMin: 42,
  totalPoints: 67,
  recentAvgPoints: 55,
  bodyweightKg: 80,
  streakWeeks: 3,
  sessionsThisWeek: 2,
  weeklyTarget: 4,
  exercises: [exercise()],
  weeklyMuscle: [{ group: 'chest', sets: 12, weeklyAvg: 9.5 }],
  ...p,
})

describe('formatBriefing', () => {
  it('shows the score against the recent average', () => {
    expect(formatBriefing(briefing())).toContain('Score: 67 pts (recent avg 55)')
  })

  it('marks a first tracked session when there is no recent average', () => {
    expect(formatBriefing(briefing({ recentAvgPoints: null }))).toContain('first tracked session')
  })

  it('surfaces PR tags, strength level, and the next suggestion', () => {
    const text = formatBriefing(briefing())
    expect(text).toContain('NEW e1RM PR')
    expect(text).toContain('level Intermediate')
    expect(text).toContain('Suggested next: 82.5 kg for 8 reps')
  })

  it('notes first-time-this-season exercises instead of a prior best', () => {
    const text = formatBriefing(briefing({ exercises: [exercise({ priorBestE1rm: null, e1rmPr: false })] }))
    expect(text).toContain('first time this season')
    expect(text).not.toContain('prior best e1RM')
  })

  it('renders the weekly muscle balance with the evidence band', () => {
    const text = formatBriefing(briefing())
    expect(text).toContain('evidence band 10-20')
    expect(text).toContain('chest: 12 sets this week (prior 8-week avg 9.5/wk)')
  })

  it('handles no logged sets in the last 8 weeks', () => {
    expect(formatBriefing(briefing({ weeklyMuscle: [] }))).toContain('no sets logged')
  })

  it('handles an exercise with no work sets', () => {
    const text = formatBriefing(briefing({ exercises: [exercise({ sets: [] })] }))
    expect(text).toContain('no work sets')
  })

  it('includes consistency and streak context', () => {
    expect(formatBriefing(briefing())).toContain('2/4 sessions this week, 3-week streak')
  })
})
