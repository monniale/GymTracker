import { Suspense, lazy, useEffect, useState } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ensureSeeded } from './db/seed'
import { runDailyChecksOnce } from './lib/season'
import { checkAchievements } from './lib/achievements'
import { installSyncTriggers, withSyncLock, syncOnEvent } from './lib/sync'
import { evaluateQuests } from './lib/quests'
import { backfillCoachHistory } from './lib/coachHistory'
import TabBar from './components/TabBar'
import RestTimerBar from './components/RestTimerBar'
import WorkoutHome from './screens/workout/WorkoutHome'
import TemplateEditor from './screens/workout/TemplateEditor'
import ActiveSession from './screens/workout/ActiveSession'
import SessionSummary from './screens/workout/SessionSummary'
import History from './screens/workout/History'
import ExerciseLibrary from './screens/workout/ExerciseLibrary'
import PastWorkout from './screens/workout/PastWorkout'
import Programs from './screens/workout/Programs'
import ImportShare from './screens/ImportShare'
import DietDay from './screens/diet/DietDay'
import ProgressScreen from './screens/progress/ProgressScreen'
import WeightHistory from './screens/progress/WeightHistory'
import CoachHistory from './screens/progress/CoachHistory'
import WeekReview from './screens/progress/WeekReview'
import ExerciseHistory from './screens/progress/ExerciseHistory'
import RankScreen from './screens/rank/RankScreen'
import FriendsScreen from './screens/rank/FriendsScreen'
import InviteScreen from './screens/InviteScreen'
import SettingsScreen from './screens/settings/SettingsScreen'
import AdminPointsScreen from './screens/settings/AdminPointsScreen'
import { isNative } from './native/platform'

// Android-only router companion (back button, notification taps, keep-awake). Gated at module
// level so Rollup drops the chunk from the Pages build (ROUTEMAP invariant 14).
const NativeShell = isNative ? lazy(() => import('./native/NativeShell')) : null

export default function App() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    void (async () => {
      await ensureSeeded()
      await runDailyChecksOnce()
      setReady(true)
      if (isNative) {
        void import('./native/init')
          .then(m => m.initNative())
          .catch(e => console.error('[native] init failed', e))
      }
      // Post-launch, non-blocking: catch up on unlocks/quest awards + sync.
      void checkAchievements()
      void evaluateQuests()
      // One-time copy of this device's cached coach verdicts into the synced history,
      // queued ahead of the launch sync so it pushes them.
      void withSyncLock(backfillCoachHistory).catch(e => console.error('[coach] backfill failed', e))
      installSyncTriggers()
      syncOnEvent('launch')
    })()
  }, [])

  if (!ready) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <span className="font-display text-2xl font-semibold text-sub">GymTracker</span>
      </div>
    )
  }

  return (
    <HashRouter>
      <div className="mx-auto min-h-dvh max-w-lg px-4 pt-safe pb-44">
        <Routes>
          <Route path="/" element={<Navigate to="/workout" replace />} />
          <Route path="/workout" element={<WorkoutHome />} />
          <Route path="/workout/template/:id" element={<TemplateEditor />} />
          <Route path="/workout/session" element={<ActiveSession />} />
          <Route path="/workout/summary/:id" element={<SessionSummary />} />
          <Route path="/workout/history" element={<History />} />
          <Route path="/workout/exercises" element={<ExerciseLibrary />} />
          <Route path="/workout/past/:id" element={<PastWorkout />} />
          <Route path="/workout/programs" element={<Programs />} />
          <Route path="/diet" element={<DietDay />} />
          <Route path="/progress" element={<ProgressScreen />} />
          <Route path="/progress/bodyweight" element={<WeightHistory />} />
          <Route path="/progress/coach" element={<CoachHistory />} />
          <Route path="/progress/week" element={<WeekReview />} />
          <Route path="/progress/exercise/:id" element={<ExerciseHistory />} />
          <Route path="/rank" element={<RankScreen />} />
          <Route path="/rank/friends" element={<FriendsScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="/settings/points" element={<AdminPointsScreen />} />
          {/* Shared template / program links (`#/import?t=…`, src/lib/shareTemplate.ts). Not a native route. */}
          <Route path="/import" element={<ImportShare />} />
          <Route path="/invite/:code" element={<InviteScreen />} />
          <Route path="*" element={<Navigate to="/workout" replace />} />
        </Routes>
      </div>
      <div className="fixed inset-x-0 bottom-0 z-40">
        <RestTimerBar />
        <TabBar />
      </div>
      {NativeShell && (
        <Suspense fallback={null}>
          <NativeShell />
        </Suspense>
      )}
    </HashRouter>
  )
}
