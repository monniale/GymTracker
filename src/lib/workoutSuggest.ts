/**
 * F2: at the start of a workout, ask Gemini for opening weights & reps for the
 * whole session and cache them by sessionId (device-local, never synced). The
 * offline progression engine (suggestNext/draftFor in ActiveSession) is always
 * the instant baseline; this only ever UPGRADES it. Any failure — no key,
 * offline, rate-limit, bad JSON — silently leaves the cache empty so the app
 * falls back to the prebuilt logic with no error surfaced to the user.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, withSyncTrackingSuspended } from '../db/db'
import { useAiStore } from './aiStore'
import { gatherWorkoutPlanBriefing, formatWorkoutPlanBriefing } from './coachBriefing'
import { generateWeightPlan } from './gemini'
import { SCORING } from './scoring'
import type { ExercisePlan, Id, PlannedSet } from '../types'

/** Snap an AI weight to a loadable increment and clamp to a sane ceiling. */
export function snapWeight(w: number, stepKg: number, maxKg: number): number {
  if (!(w > 0)) return 0
  const step = stepKg > 0 ? stepKg : 2.5
  const snapped = Math.round((Math.round(w / step) * step) * 100) / 100
  return Math.min(snapped, maxKg)
}

function clampReps(r: number): number {
  return Math.min(100, Math.max(1, Math.round(r)))
}

/** Generate a whole-session plan and cache it. Never throws (silent fallback). */
export async function generateAndCacheWorkoutPlan(sessionId: Id): Promise<void> {
  const { apiKey, model } = useAiStore.getState()
  if (!apiKey || !navigator.onLine) return
  try {
    const briefing = await gatherWorkoutPlanBriefing(sessionId)
    if (!briefing || briefing.exercises.length === 0) return
    const raw = await generateWeightPlan(formatWorkoutPlanBriefing(briefing), { apiKey, model })

    const byRef = new Map(briefing.exercises.map(e => [e.ref, e]))
    const maxKg = Math.min(600, briefing.bodyweightKg * SCORING.maxWeightBwMult)
    const plan: ExercisePlan[] = []
    for (const entry of raw.plan) {
      const ex = byRef.get(entry.ref)
      if (!ex) continue // ignore refs the model invented
      const sets = entry.sets.map(s => ({
        weightKg: snapWeight(s.weightKg, ex.stepKg, maxKg),
        reps: clampReps(s.reps),
      }))
      if (sets.length > 0) plan.push({ exerciseId: ex.exerciseId, sets, note: entry.note })
    }
    if (plan.length === 0) return // nothing usable → keep offline baseline

    await withSyncTrackingSuspended(() =>
      db.workoutSuggestions.put({ sessionId, plan, model, generatedAt: Date.now() }),
    )
  } catch {
    // No key / offline / rate-limit / bad response — stay on the offline baseline.
  }
}

export interface WorkoutPlanResult {
  /** AI opening sets per exercise, keyed by String(exerciseId). Empty until ready. */
  planByExercise: Map<string, PlannedSet[]>
  /** A generation request is in flight for this session. */
  generating: boolean
}

/**
 * Fire the plan generation exactly once per session (when a key is set and
 * online) and expose the cached plan as a lookup map. When no plan is available
 * for an exercise, the map simply has no entry and the caller uses its offline
 * default — the mandatory fallback is inherent.
 */
export function useWorkoutPlan(sessionId: Id | null | undefined): WorkoutPlanResult {
  const apiKey = useAiStore(s => s.apiKey)
  const cached = useLiveQuery(
    async () => (sessionId != null ? (await db.workoutSuggestions.get(sessionId)) ?? null : null),
    [sessionId],
  )
  const attemptedRef = useRef<Id | null>(null)
  const [generating, setGenerating] = useState(false)
  const [online, setOnline] = useState(() => navigator.onLine)

  // Track connectivity so a session started offline still gets its AI plan once
  // the network returns (mirrors AiReportCard's re-arm-on-online behaviour).
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  useEffect(() => {
    if (sessionId == null) return
    if (cached === undefined) return // cache still loading
    if (cached) return // already have a plan
    if (!apiKey || !online) return
    if (attemptedRef.current === sessionId) return
    attemptedRef.current = sessionId
    setGenerating(true)
    void generateAndCacheWorkoutPlan(sessionId).finally(() => setGenerating(false))
  }, [sessionId, cached, apiKey, online])

  const planByExercise = useMemo(() => {
    const map = new Map<string, PlannedSet[]>()
    if (cached) for (const e of cached.plan) map.set(String(e.exerciseId), e.sets)
    return map
  }, [cached])

  return { planByExercise, generating }
}
