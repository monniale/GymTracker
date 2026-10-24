import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { TrendingUp, Award, Medal, Target, Share2, Loader2 } from 'lucide-react'
import { db } from '../../db/db'
import { parseRouteId } from '../../lib/ids'
import { rankForPoints, rankLabel } from '../../lib/ranks'
import { checkAchievements, type AchievementDef } from '../../lib/achievements'
import { evaluateQuests, QUEST_BONUS, type QuestDef } from '../../lib/quests'
import RankBadge, { emblemUrl } from '../../components/RankBadge'
import RankParticles from '../../components/RankParticles'
import Confetti from '../../components/Confetti'
import CoachCard from '../../components/CoachCard'
import { fmtDuration, fmtDateTime, localDateStr } from '../../lib/dates'
import { sessionCardModel, renderSessionCard, shareImage, cardFileName, loadCardFonts } from '../../lib/shareCard'
import { isCardioSet, cardioSessionTotals, cardioMinutes, fmtCardioSet } from '../../lib/cardio'
import { haptic } from '../../native/haptics'
import { exerciseDisplayName } from '../../lib/exerciseNames'
import { effectiveLoad } from '../../lib/load'
import { t, tp, fmtNum } from '../../i18n'
import type { Exercise, Id, ScoreEvent, Session, SetRow } from '../../types'

export default function SessionSummary() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const isReport = params.get('report') === '1'
  const sid = parseRouteId(id)
  const [unlocked, setUnlocked] = useState<AchievementDef[]>([])
  const [questsDone, setQuestsDone] = useState<QuestDef[]>([])

  useEffect(() => {
    if (isReport) return // viewing an old report: no celebratory side effects
    void (async () => {
      const fresh = await checkAchievements()
      const { fresh: quests } = await evaluateQuests()
      setUnlocked(u => (u.length ? u : fresh))
      setQuestsDone(q => (q.length ? q : quests))
    })()
  }, [sid, isReport])
  const session = useLiveQuery(() => db.sessions.get(sid), [sid])
  const event = useLiveQuery(() => db.scoreEvents.where('sessionId').equals(sid).first(), [sid])
  const sets = useLiveQuery(() => db.sets.where('sessionId').equals(sid).toArray(), [sid]) ?? []
  const rankState = useLiveQuery(() => db.rankState.get(1))
  // Cardio exercises earn no points, so they aren't in the score breakdown: list them separately.
  const cardioIds = [...new Set(sets.filter(isCardioSet).map(s => String(s.exerciseId)))]
  // The session's exercises: cardio names, and the bodyweight factor of bodyweight sets for the volume.
  const exMap = useLiveQuery(() => exercisesOf(sets), [[...new Set(sets.map(s => String(s.exerciseId)))].join('|')])
  const cardioNames = new Map(cardioIds.map(id => {
    const ex = exMap?.get(sets.find(s => String(s.exerciseId) === id)!.exerciseId)
    return [id, ex ? exerciseDisplayName(ex.name) : t('workout.summary.cardio')]
  }))

  // Android: a success buzz for a PR or rank-up, judged on first load (never in report mode).
  // Delayed so it lands as its own buzz after Finish's, which would otherwise supersede it.
  // The timer is cleared only on unmount: the live queries re-fire (quest bonus points) meanwhile.
  const buzzedFor = useRef<Id | null>(null)
  const buzzTimer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(buzzTimer.current), [])
  useEffect(() => {
    if (isReport || !event || !rankState || buzzedFor.current === sid) return
    buzzedFor.current = sid
    const up =
      rankForPoints(rankState.points).index > rankForPoints(Math.max(0, rankState.points - event.total)).index
    if (up || event.breakdown.some(b => b.e1rmPr || b.volumePr)) {
      buzzTimer.current = setTimeout(() => haptic('success'), 600)
    }
  }, [sid, isReport, event, rankState])

  if (!session || !event || !rankState) return null

  const after = rankForPoints(rankState.points)
  const before = rankForPoints(Math.max(0, rankState.points - event.total))
  const rankedUp = after.index > before.index
  const volume = Math.round(
    sets.filter(s => !s.isWarmup).reduce((a, s) => a + effectiveLoad(s, exMap?.get(s.exerciseId), session) * s.reps, 0),
  )
  const strengthSets = sets.filter(s => !isCardioSet(s)).length
  const cardio = cardioSessionTotals(sets)
  const duration = session.endedAt ? session.endedAt - session.startedAt : 0

  const hasPr = event.breakdown.some(b => b.e1rmPr || b.volumePr)

  return (
    <div className="pt-6 text-center">
      <Confetti fire={!isReport && (hasPr || rankedUp || unlocked.length > 0)} />
      {isReport ? (
        <>
          <p className="font-display text-2xl font-bold">{session.name}</p>
          <p className="mt-1 text-sm text-sub">{fmtDateTime(session.startedAt)}</p>
        </>
      ) : (
        <>
          <p className="font-display text-lg font-semibold text-sub">{t('workout.summary.complete', { name: session.name })}</p>
          <p className="num mt-1 font-display text-6xl font-bold text-primary">+{event.total}</p>
          <p className="text-sm font-medium text-sub">{tp('workout.summary.points', event.total)}</p>
        </>
      )}

      {!isReport && (
        <div className="mt-4 flex flex-col items-center">
          {rankedUp && (
            <p className="mb-1 font-display text-xl font-bold uppercase tracking-wide text-accent">
              {t('workout.summary.rankUp')}
            </p>
          )}
          <div className="relative" style={{ width: rankedUp ? 110 : 80, height: rankedUp ? 110 : 80 }}>
            {rankedUp && <RankParticles tier={after.tier} size={110} />}
            <RankBadge tier={after.tier} size={rankedUp ? 110 : 80} />
          </div>
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
                {tp('workout.summary.ptsTo', Math.max(0, Math.ceil(after.next.threshold - rankState.points)), {
                  rank: rankLabel(after.next),
                })}
              </p>
            </div>
          )}
        </div>
      )}

      <div className="num mx-auto mt-5 flex max-w-xs flex-wrap justify-center gap-x-6 gap-y-1 text-sm text-sub">
        {strengthSets > 0 && <span className="whitespace-nowrap">{tp('units.sets', strengthSets)}</span>}
        {strengthSets > 0 && <span className="whitespace-nowrap">{t('workout.summary.volume', { kg: fmtNum(volume) })}</span>}
        {cardio.sets > 0 && <span className="whitespace-nowrap">{tp('workout.summary.cardioMin', cardioMinutes(cardio.durationSec))}</span>}
        <span className="whitespace-nowrap">{fmtDuration(duration)}</span>
      </div>

      {(unlocked.length > 0 || questsDone.length > 0) && (
        <div className="mt-4 space-y-1.5">
          {unlocked.map(a => (
            <div key={a.id} className="flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-4 py-2.5 text-left">
              <Medal size={18} className="shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-primary">{t('workout.summary.achievement')}</p>
                <p className="truncate text-sm">{a.name} — {a.desc}</p>
              </div>
            </div>
          ))}
          {questsDone.map(q => (
            <div key={q.id} className="flex items-center gap-2 rounded-xl border border-accent/40 bg-accent/10 px-4 py-2.5 text-left">
              <Target size={18} className="shrink-0 text-accent" />
              <p className="min-w-0 flex-1 truncate text-sm">
                <b className="text-accent">{t('workout.summary.quest')}</b> {q.label}
              </p>
              <span className="num text-sm font-bold text-accent">+{QUEST_BONUS}</span>
            </div>
          ))}
        </div>
      )}

      <CoachCard sessionId={sid} autoGenerate={!isReport} />

      <div className="mt-6 space-y-2 text-left">
        <div className="rounded-2xl border border-edge bg-card p-4">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-sub">
            <TrendingUp size={16} /> {t('workout.summary.breakdown')}
          </p>
          <div className="num space-y-1 text-sm">
            <Row label={t('workout.summary.base')} value={event.basePoints.toFixed(1)} />
            <Row label={t('workout.summary.streak')} value={`×${event.streakMult.toFixed(2)}`} />
            {event.dayFactor < 1 && <Row label={t('workout.summary.extraSession')} value={`×${event.dayFactor}`} />}
            <Row label={t('workout.summary.prBonus')} value={`+${event.prBonus}`} />
            <div className="border-t border-edge/60 pt-1">
              <Row label={t('workout.summary.total')} value={String(event.total)} bold />
            </div>
          </div>
        </div>

        {event.breakdown.map(b => (
          <div key={b.exerciseId} className="flex items-center gap-2 rounded-xl bg-card px-4 py-2.5">
            <span className="min-w-0 flex-1 truncate font-medium">{exerciseDisplayName(b.exerciseName)}</span>
            {b.e1rmPr && (
              <span className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">
                <Award size={12} /> {t('workout.summary.e1rmPr')}
              </span>
            )}
            {b.volumePr && (
              <span className="shrink-0 whitespace-nowrap rounded-full bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent">
                {t('workout.summary.volPr')}
              </span>
            )}
            <span className="num shrink-0 text-sm font-semibold text-sub">{b.setPoints.toFixed(1)}</span>
          </div>
        ))}

        {cardioIds.map(id => (
          <div key={id} className="flex items-center gap-2 rounded-xl bg-card px-4 py-2.5">
            <span className="min-w-0 flex-1 truncate font-medium">{cardioNames.get(id)}</span>
            <span className="num shrink-0 whitespace-nowrap text-sm text-sub">
              {fmtCardioSet(cardioSessionTotals(sets.filter(s => String(s.exerciseId) === id)))}
            </span>
            <span className="shrink-0 whitespace-nowrap rounded-full bg-muted/40 px-2 py-0.5 text-xs font-semibold text-sub">
              {t('workout.summary.noPts')}
            </span>
          </div>
        ))}
      </div>

      <ShareCardButton
        session={session}
        event={event}
        sets={sets}
        exercises={exMap}
        rankPoints={rankState.points}
        streakWeeks={rankState.streakWeeks}
        fresh={!isReport}
      />

      <Link
        to={isReport ? '/workout/history' : '/workout'}
        className="mt-3 block w-full rounded-2xl bg-primary py-4 text-center font-display text-xl font-bold text-bg active:opacity-90"
      >
        {isReport ? t('workout.summary.backToHistory') : t('common.done')}
      </Link>
    </div>
  )
}

/** Renders the workout as a 1080×1350 PNG and opens the share sheet (or downloads it). */
function ShareCardButton({ session, event, sets, exercises, rankPoints, streakWeeks, fresh }: {
  session: Session
  event: ScoreEvent
  sets: SetRow[]
  exercises: Map<Id, Exercise> | undefined
  rankPoints: number
  streakWeeks: number
  fresh: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Warm the card fonts so the first tap doesn't wait for them.
  useEffect(() => {
    void loadCardFonts()
  }, [])

  async function share() {
    if (busy) return
    haptic('tap')
    setBusy(true)
    setError(null)
    try {
      const model = sessionCardModel(session, event, sets, rankPoints, {
        fresh,
        streakWeeks,
        exercises: exercises ?? (await exercisesOf(sets)),
      })
      const blob = await renderSessionCard(model, emblemUrl(model.tier))
      await shareImage(blob, cardFileName(model, localDateStr(new Date(session.startedAt))))
    } catch (e) {
      setError((e as Error)?.message || t('workout.summary.shareError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-6">
      <button
        onClick={share}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-edge bg-card py-3.5 font-display text-lg font-bold active:bg-muted/40 disabled:opacity-60"
      >
        {busy ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <Share2 size={18} aria-hidden />}
        {busy ? t('workout.summary.creating') : t('workout.summary.share')}
      </button>
      {error && <p className="mt-1.5 text-sm text-danger">{error}</p>}
    </div>
  )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${bold ? 'font-bold text-ink' : 'text-sub'}`}>
      <span className="min-w-0">{label}</span>
      <span className="shrink-0">{value}</span>
    </div>
  )
}

/** The exercises of a session's sets, by id. */
async function exercisesOf(sets: SetRow[]): Promise<Map<Id, Exercise>> {
  const rows = await db.exercises.bulkGet([...new Set(sets.map(s => s.exerciseId))])
  return new Map(rows.filter((e): e is Exercise => e !== undefined).map(e => [e.id!, e]))
}
