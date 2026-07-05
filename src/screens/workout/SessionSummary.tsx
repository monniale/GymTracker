import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { TrendingUp, Award, Medal, Target } from 'lucide-react'
import { db } from '../../db/db'
import { rankForPoints, rankLabel } from '../../lib/ranks'
import { checkAchievements, type AchievementDef } from '../../lib/achievements'
import { evaluateQuests, QUEST_BONUS, type QuestDef } from '../../lib/quests'
import RankBadge from '../../components/RankBadge'
import Confetti from '../../components/Confetti'
import { fmtDuration } from '../../lib/dates'

export default function SessionSummary() {
  const { id } = useParams()
  const sid = Number(id)
  const [unlocked, setUnlocked] = useState<AchievementDef[]>([])
  const [questsDone, setQuestsDone] = useState<QuestDef[]>([])

  useEffect(() => {
    void (async () => {
      const fresh = await checkAchievements()
      const { fresh: quests } = await evaluateQuests()
      setUnlocked(u => (u.length ? u : fresh))
      setQuestsDone(q => (q.length ? q : quests))
    })()
  }, [sid])
  const session = useLiveQuery(() => db.sessions.get(sid), [sid])
  const event = useLiveQuery(() => db.scoreEvents.where('sessionId').equals(sid).first(), [sid])
  const sets = useLiveQuery(() => db.sets.where('sessionId').equals(sid).toArray(), [sid]) ?? []
  const rankState = useLiveQuery(() => db.rankState.get(1))

  if (!session || !event || !rankState) return null

  const after = rankForPoints(rankState.points)
  const before = rankForPoints(Math.max(0, rankState.points - event.total))
  const rankedUp = after.index > before.index
  const volume = Math.round(sets.filter(s => !s.isWarmup).reduce((a, s) => a + s.weightKg * s.reps, 0))
  const duration = session.endedAt ? session.endedAt - session.startedAt : 0

  const hasPr = event.breakdown.some(b => b.e1rmPr || b.volumePr)

  return (
    <div className="pt-6 text-center">
      <Confetti fire={hasPr || rankedUp || unlocked.length > 0} />
      <p className="font-display text-lg font-semibold text-sub">{session.name} complete</p>
      <p className="num mt-1 font-display text-6xl font-bold text-primary">+{event.total}</p>
      <p className="text-sm font-medium text-sub">points</p>

      <div className="mt-4 flex flex-col items-center">
        {rankedUp && (
          <p className="mb-1 font-display text-xl font-bold uppercase tracking-wide text-accent">
            Rank up!
          </p>
        )}
        <RankBadge tier={after.tier} size={rankedUp ? 110 : 80} />
        <p className="mt-1 font-display text-2xl font-bold" style={{ color: after.tier.color }}>
          {rankLabel(after.tier)}
        </p>
        {after.next && (
          <div className="mt-2 w-56">
            <div className="h-2 overflow-hidden rounded-full bg-muted/40">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-700"
                style={{ width: `${after.progress * 100}%` }}
              />
            </div>
            <p className="num mt-1 text-xs text-sub">
              {Math.max(0, Math.ceil(after.next.threshold - rankState.points))} pts to{' '}
              {rankLabel(after.next)}
            </p>
          </div>
        )}
      </div>

      <div className="num mx-auto mt-5 flex max-w-xs justify-center gap-6 text-sm text-sub">
        <span>{sets.length} sets</span>
        <span>{volume.toLocaleString()} kg volume</span>
        <span>{fmtDuration(duration)}</span>
      </div>

      {(unlocked.length > 0 || questsDone.length > 0) && (
        <div className="mt-4 space-y-1.5">
          {unlocked.map(a => (
            <div key={a.id} className="flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-4 py-2.5 text-left">
              <Medal size={18} className="shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-primary">Achievement unlocked!</p>
                <p className="truncate text-sm">{a.name} — {a.desc}</p>
              </div>
            </div>
          ))}
          {questsDone.map(q => (
            <div key={q.id} className="flex items-center gap-2 rounded-xl border border-accent/40 bg-accent/10 px-4 py-2.5 text-left">
              <Target size={18} className="shrink-0 text-accent" />
              <p className="min-w-0 flex-1 truncate text-sm">
                <b className="text-accent">Quest complete:</b> {q.label}
              </p>
              <span className="num text-sm font-bold text-accent">+{QUEST_BONUS}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 space-y-2 text-left">
        <div className="rounded-2xl border border-edge bg-card p-4">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-sub">
            <TrendingUp size={16} /> Score breakdown
          </p>
          <div className="num space-y-1 text-sm">
            <Row label="Base (volume × intensity ÷ bodyweight)" value={event.basePoints.toFixed(1)} />
            <Row label={`Streak multiplier`} value={`×${event.streakMult.toFixed(2)}`} />
            {event.dayFactor < 1 && <Row label="Extra session today" value={`×${event.dayFactor}`} />}
            <Row label="PR bonus" value={`+${event.prBonus}`} />
            <div className="border-t border-edge/60 pt-1">
              <Row label="Total" value={String(event.total)} bold />
            </div>
          </div>
        </div>

        {event.breakdown.map(b => (
          <div key={b.exerciseId} className="flex items-center gap-2 rounded-xl bg-card px-4 py-2.5">
            <span className="min-w-0 flex-1 truncate font-medium">{b.exerciseName}</span>
            {b.e1rmPr && (
              <span className="flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">
                <Award size={12} /> e1RM PR
              </span>
            )}
            {b.volumePr && (
              <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent">
                Vol PR
              </span>
            )}
            <span className="num text-sm font-semibold text-sub">{b.setPoints.toFixed(1)}</span>
          </div>
        ))}
      </div>

      <Link
        to="/workout"
        className="mt-6 block w-full rounded-2xl bg-primary py-4 text-center font-display text-xl font-bold text-bg active:opacity-90"
      >
        Done
      </Link>
    </div>
  )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-bold text-ink' : 'text-sub'}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}
