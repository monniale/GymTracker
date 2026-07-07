import { db } from '../db/db'
import { localDateStr, mondayOf, addDays, parseLocalDate } from './dates'
import { dayTargets, totalsForLogs } from './nutrition'
import type { Id } from '../types'

export const QUEST_BONUS = 15

export interface QuestDef {
  id: string
  label: string
  target: number
  /** current progress for the given week */
  measure: (weekMonday: string) => Promise<number>
}

async function sessionsInWeek(weekMonday: string) {
  const start = parseLocalDate(weekMonday).getTime()
  return db.sessions
    .where('startedAt').between(start, start + 7 * 86_400_000)
    .filter(s => s.endedAt !== undefined)
    .toArray()
}

const POOL: QuestDef[] = [
  {
    id: 'sessions',
    label: 'Finish 3 sessions',
    target: 3,
    measure: async w => (await sessionsInWeek(w)).length,
  },
  {
    id: 'legs-2',
    label: 'Train legs or glutes twice',
    target: 2,
    measure: async w => {
      const sessions = await sessionsInWeek(w)
      const legEx = new Set<Id>(
        (await db.exercises.filter(e => e.muscleGroup === 'legs' || e.muscleGroup === 'glutes').toArray())
          .map(e => e.id!),
      )
      let count = 0
      for (const s of sessions) {
        const sets = await db.sets.where('sessionId').equals(s.id!).toArray()
        if (sets.some(x => !x.isWarmup && legEx.has(x.exerciseId))) count++
      }
      return count
    },
  },
  {
    id: 'prs-2',
    label: 'Set 2 personal records',
    target: 2,
    measure: async w => {
      const days = Array.from({ length: 7 }, (_, i) => addDays(w, i))
      const events = await db.scoreEvents.where('date').anyOf(days).toArray()
      return events.reduce(
        (acc, e) => acc + e.breakdown.filter(b => b.e1rmPr || b.volumePr).length,
        0,
      )
    },
  },
  {
    id: 'protein-5',
    label: 'Hit your protein target on 5 days',
    target: 5,
    measure: async w => {
      const settings = await db.settings.get(1)
      if (!settings) return 0
      const days = Array.from({ length: 7 }, (_, i) => addDays(w, i))
      const logs = await db.foodLogs.where('date').anyOf(days).toArray()
      const foods = new Map((await db.foods.toArray()).map(f => [f.id!, f]))
      const overrides = new Map(
        (await db.dayTypes.where('date').anyOf(days).toArray()).map(d => [d.date, d.type]),
      )
      const sessions = await sessionsInWeek(w)
      const trained = new Set(sessions.map(s => localDateStr(new Date(s.startedAt))))
      let hit = 0
      for (const d of days) {
        const dayLogs = logs.filter(l => l.date === d)
        if (dayLogs.length === 0) continue
        const isTraining = overrides.has(d) ? overrides.get(d) === 'training' : trained.has(d)
        if (totalsForLogs(dayLogs, foods).protein >= dayTargets(settings, isTraining).protein) hit++
      }
      return hit
    },
  },
  {
    id: 'volume-15k',
    label: 'Move 15,000 kg of volume',
    target: 15_000,
    measure: async w => {
      const sessions = await sessionsInWeek(w)
      let vol = 0
      for (const s of sessions) {
        const sets = await db.sets.where('sessionId').equals(s.id!).toArray()
        vol += sets.filter(x => !x.isWarmup).reduce((a, x) => a + x.weightKg * x.reps, 0)
      }
      return Math.round(vol)
    },
  },
  {
    id: 'log-food-5',
    label: 'Log your food on 5 days',
    target: 5,
    measure: async w => {
      const days = Array.from({ length: 7 }, (_, i) => addDays(w, i))
      const logs = await db.foodLogs.where('date').anyOf(days).toArray()
      return new Set(logs.map(l => l.date)).size
    },
  },
]

/** djb2 — deterministic, testable (no Math.random). */
function hash(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h
}

/** Two deterministic quests per week, seeded by the week's Monday date. */
export function questsForWeek(weekMonday: string): QuestDef[] {
  const h = hash(weekMonday)
  const first = h % POOL.length
  const second = (first + 1 + (Math.floor(h / POOL.length) % (POOL.length - 1))) % POOL.length
  return [POOL[first], POOL[second]]
}

export interface QuestStatus {
  def: QuestDef
  current: number
  done: boolean
}

/**
 * Evaluates this week's quests, awards +15 pts per fresh completion (recorded
 * as a labeled score event), and returns display status. Idempotent.
 */
export async function evaluateQuests(): Promise<{ statuses: QuestStatus[]; fresh: QuestDef[] }> {
  const weekMonday = mondayOf(localDateStr())
  const defs = questsForWeek(weekMonday)
  let state = await db.quests.get(weekMonday)
  if (!state) {
    state = { weekKey: weekMonday, quests: defs.map(d => ({ id: d.id, done: false })) }
    await db.quests.put(state)
  }

  const statuses: QuestStatus[] = []
  const fresh: QuestDef[] = []
  for (const def of defs) {
    const entry = state.quests.find(q => q.id === def.id) ?? { id: def.id, done: false }
    const current = await def.measure(weekMonday)
    const nowDone = entry.done || current >= def.target
    if (nowDone && !entry.done) {
      entry.awardedAt = Date.now()
      entry.done = true
      fresh.push(def)
      await db.transaction('rw', db.rankState, db.scoreEvents, db.quests, async () => {
        const rs = await db.rankState.get(1)
        if (rs) {
          rs.points += QUEST_BONUS
          await db.rankState.put(rs)
        }
        await db.scoreEvents.add({
          label: `Quest: ${def.label}`,
          date: localDateStr(),
          basePoints: 0,
          prBonus: 0,
          streakMult: 1,
          dayFactor: 1,
          total: QUEST_BONUS,
          breakdown: [],
        })
        const st = await db.quests.get(weekMonday)
        if (st) {
          const e = st.quests.find(q => q.id === def.id)
          if (e) {
            e.done = true
            e.awardedAt = entry.awardedAt
          } else {
            st.quests.push(entry)
          }
          await db.quests.put(st)
        }
      })
    }
    statuses.push({ def, current: Math.min(current, def.target), done: nowDone })
  }
  return { statuses, fresh }
}
