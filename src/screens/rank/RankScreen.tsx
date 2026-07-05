import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Flame, CalendarDays, ChevronDown, ChevronUp, Info } from 'lucide-react'
import { db } from '../../db/db'
import { rankForPoints, rankLabel, SEASON_DAYS, TIERS } from '../../lib/ranks'
import RankBadge from '../../components/RankBadge'
import { addDays, daysBetween, fmtDate, localDateStr } from '../../lib/dates'

export default function RankScreen() {
  const rankState = useLiveQuery(() => db.rankState.get(1))
  const events = useLiveQuery(() =>
    db.scoreEvents.orderBy('id').reverse().limit(20).toArray(),
  ) ?? []
  const pastSeasons = useLiveQuery(() => db.seasons.orderBy('startDate').reverse().toArray()) ?? []
  const [showInfo, setShowInfo] = useState(false)

  if (!rankState) return null

  const info = rankForPoints(rankState.points)
  const seasonEnd = addDays(rankState.seasonStart, SEASON_DAYS - 1)
  const daysLeft = Math.max(0, daysBetween(localDateStr(), seasonEnd))

  return (
    <div className="pt-4">
      <h1 className="mb-4 font-display text-3xl font-bold">Rank</h1>

      <div className="flex flex-col items-center rounded-2xl border border-edge bg-card p-6">
        <RankBadge tier={info.tier} size={120} />
        <p className="mt-2 font-display text-3xl font-bold" style={{ color: info.tier.color }}>
          {rankLabel(info.tier)}
        </p>
        <p className="num text-lg font-semibold text-sub">{Math.round(rankState.points)} pts</p>

        {info.next && (
          <div className="mt-3 w-full max-w-xs">
            <div className="h-2.5 overflow-hidden rounded-full bg-muted/40">
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{ width: `${info.progress * 100}%`, backgroundColor: info.tier.color }}
              />
            </div>
            <p className="num mt-1 text-center text-xs text-sub">
              {Math.max(0, Math.ceil(info.next.threshold - rankState.points))} pts to {rankLabel(info.next)}
            </p>
          </div>
        )}

        <div className="mt-4 flex gap-3 text-sm font-medium">
          <span className="flex items-center gap-1.5 rounded-full bg-muted/40 px-3 py-1.5">
            <Flame size={15} className="text-primary" />
            <span className="num">{rankState.streakWeeks}</span> wk streak
          </span>
          <span className="flex items-center gap-1.5 rounded-full bg-muted/40 px-3 py-1.5">
            <CalendarDays size={15} className="text-sub" />
            Season {rankState.seasonId} · <span className="num">{daysLeft}</span>d left
          </span>
        </div>
      </div>

      <button
        onClick={() => setShowInfo(s => !s)}
        className="mt-3 flex w-full items-center justify-between rounded-2xl border border-edge bg-card px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 font-medium">
          <Info size={18} className="text-sub" /> How scoring works
        </span>
        {showInfo ? <ChevronUp size={18} className="text-sub" /> : <ChevronDown size={18} className="text-sub" />}
      </button>
      {showInfo && (
        <div className="mt-2 space-y-2 rounded-2xl border border-edge bg-card p-4 text-sm leading-relaxed text-sub">
          <p>
            <b className="text-ink">Volume load</b> (sets × reps × weight ÷ your bodyweight) is the base — it is
            the standard scientific proxy for training stimulus, with a proven dose–response for muscle growth.
          </p>
          <p>
            <b className="text-ink">Intensity weighting</b>: each set is scaled by how heavy it is relative to
            your estimated 1-rep max (Epley formula). Sets under 30% of your max score almost nothing — junk
            volume doesn't build muscle, and it doesn't build points either.
          </p>
          <p>
            <b className="text-ink">PR bonuses</b> (+25 per e1RM record, +10 per volume record, max 75):
            progressive overload — beating your previous best — is the mechanism of adaptation, so it pays extra.
          </p>
          <p>
            <b className="text-ink">Streak multiplier</b> (+5% per consecutive week hitting your weekly session
            target, max +30%): consistency is the single best predictor of results, so it multiplies everything.
          </p>
          <p>
            <b className="text-ink">Caps</b>: max 6 scored sets per exercise, 24 per session, 150 base points —
            diminishing returns are real, and grinding endless easy sets won't rank you up. A second session the
            same day counts 25%. After 7 rest days points decay 3%/day (max −25%). Seasons last 12 weeks; you
            restart with 20% carryover.
          </p>
        </div>
      )}

      <h2 className="mb-2 mt-6 font-display text-xl font-semibold">Recent scores</h2>
      {events.length === 0 && (
        <p className="py-4 text-sm text-sub">Finish a workout to earn your first points.</p>
      )}
      <div className="space-y-1.5">
        {events.map(e => (
          <div key={e.id} className="flex items-center gap-3 rounded-xl bg-card px-4 py-2.5">
            <span className="flex-1 text-sm font-medium">{fmtDate(e.date)}</span>
            {e.prBonus > 0 && (
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">
                PR +{e.prBonus}
              </span>
            )}
            <span className="num font-display text-lg font-bold text-primary">+{e.total}</span>
          </div>
        ))}
      </div>

      {pastSeasons.length > 0 && (
        <>
          <h2 className="mb-2 mt-6 font-display text-xl font-semibold">Past seasons</h2>
          <div className="space-y-1.5">
            {pastSeasons.map(s => (
              <div key={s.id} className="flex items-center gap-3 rounded-xl bg-card px-4 py-2.5">
                <span className="flex-1 text-sm font-medium">Season {s.seasonId}</span>
                <span className="text-sm text-sub">{s.finalRank}</span>
                <span className="num text-sm font-semibold">{s.finalPoints} pts</span>
              </div>
            ))}
          </div>
        </>
      )}

      <h2 className="mb-2 mt-6 font-display text-xl font-semibold">All ranks</h2>
      <div className="grid grid-cols-2 gap-1.5 pb-4">
        {TIERS.map(t => (
          <div
            key={`${t.rank}${t.sub}`}
            className={`num flex items-center justify-between rounded-lg px-3 py-1.5 text-sm ${
              t === info.tier ? 'bg-muted/60 font-bold' : 'bg-card text-sub'
            }`}
          >
            <span style={{ color: t.color }}>{rankLabel(t)}</span>
            <span>{t.threshold}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
