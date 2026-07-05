import { useEffect, useState } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ensureSeeded } from './db/seed'
import { runDailyChecks } from './lib/season'
import TabBar from './components/TabBar'
import RestTimerBar from './components/RestTimerBar'
import WorkoutHome from './screens/workout/WorkoutHome'
import TemplateEditor from './screens/workout/TemplateEditor'
import ActiveSession from './screens/workout/ActiveSession'
import SessionSummary from './screens/workout/SessionSummary'
import History from './screens/workout/History'
import DietDay from './screens/diet/DietDay'
import ProgressScreen from './screens/progress/ProgressScreen'
import RankScreen from './screens/rank/RankScreen'
import SettingsScreen from './screens/settings/SettingsScreen'

export default function App() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    void (async () => {
      await ensureSeeded()
      await runDailyChecks()
      setReady(true)
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
          <Route path="/diet" element={<DietDay />} />
          <Route path="/progress" element={<ProgressScreen />} />
          <Route path="/rank" element={<RankScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="*" element={<Navigate to="/workout" replace />} />
        </Routes>
      </div>
      <div className="fixed inset-x-0 bottom-0 z-40">
        <RestTimerBar />
        <TabBar />
      </div>
    </HashRouter>
  )
}
