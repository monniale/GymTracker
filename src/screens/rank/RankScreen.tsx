import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Flame, CalendarDays, ChevronDown, ChevronUp, Info, Target, Check, Lock,
  Dumbbell, Trophy, Scale, UtensilsCrossed, Zap, Medal, Ghost,
} from 'lucide-react'
import { db } from '../../db/db'
import { rankForPoints, rankLabel, translateRankLabel, SEASON_DAYS, TIERS, type RankTier } from '../../lib/ranks'
import { ACHIEVEMENTS, type AchievementDef } from '../../lib/achievements'
import { evaluateQuests, displayEventLabel, QUEST_BONUS, type QuestStatus } from '../../lib/quests'
import { exerciseDisplayName } from '../../lib/exerciseNames'
import RankBadge from '../../components/RankBadge'
import RankParticles from '../../components/RankParticles'
import Sheet from '../../components/Sheet'
import { addDays, daysBetween, fmtDate, localDateStr } from '../../lib/dates'
import { t, tp, fmtNum } from '../../i18n'
import type { Season } from '../../types'

const ICONS: Record<AchievementDef['icon'], typeof Dumbbell> = {
  dumbbell: Dumbbell,
  flame: Flame,
  trophy: Trophy,
  scale: Scale,
  utensils: UtensilsCrossed,
  zap: Zap,
  medal: Medal,
}

/** A message with `**bold**` spans (the scoring explainer's lead-ins). */
function Rich({ text }: { text: string }) {
  return <>{text.split('**').map((part, i) => (i % 2 === 1 ? <b key={i} className="text-ink">{part}</b> : part))}</>
}

export default function RankScreen() {
  const rankState = useLiveQuery(() => db.rankState.get(1))
  // Newest first by day (invariant 10: UUID ids don't sort by time).
  const events = useLiveQuery(() =>
    db.scoreEvents.orderBy('date').reverse().limit(20).toArray(),
  ) ?? []
  const pastSeasons = useLiveQuery(() => db.seasons.orderBy('startDate').reverse().toArray()) ?? []
  const [showInfo, setShowInfo] = useState(false)
  const [preview, setPreview] = useState<RankTier | null>(null)
  const [quests, setQuests] = useState<QuestStatus[]>([])
  const unlockedIds = useLiveQuery(
    async () => new Map((await db.achievements.toArray()).map(a => [a.id, a.unlockedAt])),
  )

  useEffect(() => {
    void evaluateQuests().then(r => setQuests(r.statuses))
  }, [])

  // Ghost race: points earned by this day-of-season, this season vs last.
  const ghost = useLiveQuery(async () => {
    const state = await db.rankState.get(1)
    if (!state) return null
    const prev = await db.seasons.orderBy('startDate').last()
    if (!prev || prev.seasonId !== state.seasonId - 1) return null
    const dayN = daysBetween(state.seasonStart, localDateStr())
    const cutoff = addDays(prev.startDate, dayN)
    const events = await db.scoreEvents.toArray()
    const ghostPts = events
      .filter(e => e.date >= prev.startDate && e.date <= cutoff)
      .reduce((a, e) => a + e.total, 0)
    const currentPts = events
      .filter(e => e.date >= state.seasonStart)
      .reduce((a, e) => a + e.total, 0)
    return { dayN: dayN + 1, ghostPts, currentPts }
  })

  if (!rankState) return null

  const info = rankForPoints(rankState.points)
  const seasonEnd = addDays(rankState.seasonStart, SEASON_DAYS - 1)
  const daysLeft = Math.max(0, daysBetween(localDateStr(), seasonEnd))

  return (
    <div className="pt-4">
      <h1 className="mb-4 font-display text-3xl font-bold">{t('rank.screen.title')}</h1>

      <div className="flex flex-col items-center rounded-2xl border border-edge bg-card p-6">
        <div className="relative" style={{ width: 120, height: 120 }}>
          <RankParticles tier={info.tier} size={120} />
          <RankBadge tier={info.tier} size={120} />
        </div>
        <p className="mt-2 font-display text-3xl font-bold" style={{ color: info.tier.color }}>
          {rankLabel(info.tier)}
        </p>
        <p className="num text-lg font-semibold text-sub">{tp('units.pts', Math.round(rankState.points))}</p>

        {info.next && (
          <div className="mt-3 w-full max-w-xs">
            <div className="h-2.5 overflow-hidden rounded-full bg-muted/40">
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{ width: `${info.progress * 100}%`, backgroundColor: info.tier.color }}
              />
            </div>
            <p className="num mt-1 text-center text-xs text-sub">
              {tp('rank.screen.toNext', Math.max(0, Math.ceil(info.next.threshold - rankState.points)), { rank: rankLabel(info.next) })}
            </p>
          </div>
        )}

        {/* Chips never break inside; on narrow phones the second one drops below. */}
        <div className="mt-4 flex flex-wrap justify-center gap-2 text-sm font-medium">
          <span className="flex items-center gap-1.5 whitespace-nowrap rounded-full bg-muted/40 px-3 py-1.5">
            <Flame size={15} className="shrink-0 text-primary" />
            <span className="num">{tp('rank.screen.streak', rankState.streakWeeks)}</span>
          </span>
          <span className="flex items-center gap-1.5 whitespace-nowrap rounded-full bg-muted/40 px-3 py-1.5">
            <CalendarDays size={15} className="shrink-0 text-sub" />
            <span className="num">{tp('rank.screen.seasonLeft', daysLeft, { season: rankState.seasonId })}</span>
          </span>
        </div>

        {ghost && (
          <p className="num mt-3 flex items-center gap-1.5 text-xs font-medium text-sub">
            <Ghost size={14} />
            {t('rank.screen.ghostNow', { day: ghost.dayN, pts: tp('units.pts', ghost.currentPts) })}{' '}
            <span className={ghost.currentPts >= ghost.ghostPts ? 'text-accent' : 'text-danger'}>
              {t('rank.screen.ghostLast', { pts: fmtNum(ghost.ghostPts) })}
            </span>
          </p>
        )}
      </div>

      {quests.length > 0 && (
        <div className="mt-3 rounded-2xl border border-edge bg-card p-4">
          <h2 className="mb-2 flex flex-wrap items-center gap-x-2 font-display text-lg font-semibold">
            <Target size={17} className="shrink-0 text-accent" /> {t('rank.quests.title')}
            <span className="num ml-auto whitespace-nowrap text-xs font-medium text-sub">{t('rank.quests.bonusEach', { n: QUEST_BONUS })}</span>
          </h2>
          <div className="space-y-2.5">
            {quests.map(q => (
              <div key={q.def.id}>
                <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                  <span className={`font-medium ${q.done ? 'text-accent' : ''}`}>
                    {q.done && <Check size={14} className="mr-1 inline" />}
                    {q.def.label}
                  </span>
                  <span className="num shrink-0 whitespace-nowrap text-xs text-sub">
                    {fmtNum(q.current)} / {fmtNum(q.def.target)}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted/40">
                  <div
                    className={`h-full rounded-full transition-[width] duration-500 ${
                      q.done ? 'bg-accent' : 'bg-primary'
                    }`}
                    style={{ width: `${Math.min(100, (q.current / q.def.target) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={() => setShowInfo(s => !s)}
        className="mt-3 flex w-full items-center justify-between rounded-2xl border border-edge bg-card px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 font-medium">
          <Info size={18} className="text-sub" /> {t('rank.scoring.toggle')}
        </span>
        {showInfo ? <ChevronUp size={18} className="text-sub" /> : <ChevronDown size={18} className="text-sub" />}
      </button>
      {showInfo && (
        <div className="mt-2 space-y-2 rounded-2xl border border-edge bg-card p-4 text-sm leading-relaxed text-sub">
          <p><Rich text={t('rank.scoring.volume')} /></p>
          <p><Rich text={t('rank.scoring.intensity')} /></p>
          <p><Rich text={t('rank.scoring.prBonus')} /></p>
          <p><Rich text={t('rank.scoring.streak')} /></p>
          <p><Rich text={t('rank.scoring.caps')} /></p>
        </div>
      )}

      <h2 className="mb-2 mt-6 font-display text-xl font-semibold">{t('rank.recent.title')}</h2>
      {events.length === 0 && (
        <p className="py-4 text-sm text-sub">{t('rank.recent.empty')}</p>
      )}
      <div className="space-y-1.5">
        {events.map(e => (
          <div key={e.id} className="flex items-center gap-3 rounded-xl bg-card px-4 py-2.5">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {e.label !== undefined ? displayEventLabel(e.label) : fmtDate(e.date)}
            </span>
            {e.prBonus > 0 && (
              <span className="shrink-0 whitespace-nowrap rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">
                PR +{e.prBonus}
              </span>
            )}
            <span className="num shrink-0 font-display text-lg font-bold text-primary">+{e.total}</span>
          </div>
        ))}
      </div>

      <h2 className="mb-2 mt-6 font-display text-xl font-semibold">{t('rank.achievements.title')}</h2>
      <div className="grid grid-cols-2 gap-2">
        {ACHIEVEMENTS.map(a => {
          const unlockedAt = unlockedIds?.get(a.id)
          const Icon = ICONS[a.icon]
          return (
            <div
              key={a.id}
              className={`flex items-center gap-2 rounded-xl border p-3 ${
                unlockedAt ? 'border-primary/40 bg-card' : 'border-edge bg-card opacity-45'
              }`}
            >
              {unlockedAt ? (
                <Icon size={20} className="shrink-0 text-primary" />
              ) : (
                <Lock size={18} className="shrink-0 text-sub" />
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{a.name}</p>
                <p className="truncate text-[11px] text-sub">{a.desc}</p>
              </div>
            </div>
          )
        })}
      </div>

      {pastSeasons.length > 0 && (
        <>
          <h2 className="mb-2 mt-6 font-display text-xl font-semibold">{t('rank.seasons.title')}</h2>
          <div className="space-y-1.5">
            {pastSeasons.map(s => <SeasonRow key={s.id} season={s} />)}
          </div>
        </>
      )}

      <h2 className="mb-2 mt-6 font-display text-xl font-semibold">{t('rank.tiers.title')}</h2>
      <div className="grid grid-cols-2 gap-1.5 pb-4">
        {TIERS.map(tier => (
          <button
            key={`${tier.rank}${tier.sub}`}
            onClick={() => setPreview(tier)}
            className={`num flex min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-left text-sm ${
              tier === info.tier ? 'bg-muted/60 font-bold' : 'bg-card text-sub'
            }`}
          >
            <RankBadge tier={tier} size={44} />
            <span className="min-w-0">
              <span className="block truncate" style={{ color: tier.color }}>{rankLabel(tier)}</span>
              <span className="block whitespace-nowrap text-xs">{tp('units.pts', tier.threshold)}</span>
            </span>
          </button>
        ))}
      </div>
      <Sheet open={preview !== null} onClose={() => setPreview(null)} title={preview ? rankLabel(preview) : ''}>
        {preview && (
          <div className="flex flex-col items-center pb-4">
            <div className="relative my-6" style={{ width: 180, height: 180 }}>
              <RankParticles tier={preview} size={180} bleed={36} />
              <RankBadge tier={preview} size={180} />
            </div>
            <p className="num font-display text-2xl font-bold" style={{ color: preview.color }}>
              {tp('units.pts', preview.threshold)}
            </p>
            <p className="num mt-1 text-sm text-sub">
              {rankState.points >= preview.threshold
                ? t('rank.tiers.reached')
                : tp('rank.tiers.toGo', Math.ceil(preview.threshold - rankState.points))}
            </p>
          </div>
        )}
      </Sheet>
    </div>
  )
}

function SeasonRow({ season }: { season: Season }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-xl bg-card">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left"
      >
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{t('rank.seasons.season', { season: season.seasonId })}</span>
        <span className="shrink-0 whitespace-nowrap text-sm text-sub">{translateRankLabel(season.finalRank)}</span>
        <span className="num shrink-0 whitespace-nowrap text-sm font-semibold">{tp('units.pts', season.finalPoints)}</span>
        {open ? <ChevronUp size={16} className="text-sub" /> : <ChevronDown size={16} className="text-sub" />}
      </button>
      {open && season.recap && (
        <div className="num flex flex-wrap justify-between gap-x-3 gap-y-1 border-t border-edge/60 px-4 py-2.5 text-xs text-sub">
          <span className="whitespace-nowrap">{tp('rank.seasons.sessions', season.recap.sessions)}</span>
          <span className="whitespace-nowrap">{t('rank.seasons.lifted', { kg: fmtNum(season.recap.totalVolumeKg) })}</span>
          {season.recap.bestLift && (
            <span>
              {t('rank.seasons.best', {
                name: exerciseDisplayName(season.recap.bestLift.exerciseName),
                e1rm: fmtNum(season.recap.bestLift.e1rm),
              })}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
