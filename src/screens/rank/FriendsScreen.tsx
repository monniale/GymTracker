import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, ChevronLeft, Loader2, Pencil, RefreshCw, Share2, UserPlus, X } from 'lucide-react'
import { db } from '../../db/db'
import { useCloudStore } from '../../lib/cloudSync'
import { cloudConfigured } from '../../lib/supabaseConfig'
import {
  addFriend, answerRequest, inviteLink, loadFriends, loadProfile, normalizeFriendCode, setDisplayName,
  socialErrorText, unfriend,
} from '../../lib/social'
import { collectPublicStats, commonLifts, currentView, withMyStats } from '../../lib/socialStats'
import { rankForPoints, rankLabel } from '../../lib/ranks'
import { exerciseDisplayName } from '../../lib/exerciseNames'
import { fmtDateTime } from '../../lib/dates'
import type { FriendEntry } from '../../lib/supabaseApi'
import RankBadge from '../../components/RankBadge'
import Sheet from '../../components/Sheet'
import { isNative } from '../../native/platform'
import { t, tp, fmtNum } from '../../i18n'

/** Shares a link: Web Share when the browser has it (not the Android WebView), else the clipboard. */
async function shareInvite(url: string): Promise<'shared' | 'copied'> {
  const text = t('social.invite.shareText')
  if (!isNative && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: text, text, url })
      return 'shared'
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return 'shared'
    }
  }
  await navigator.clipboard.writeText(url)
  return 'copied'
}

/** `/rank/friends`: your name and invite link, friend requests, the season board and comparisons. */
export default function FriendsScreen() {
  const session = useCloudStore(s => s.session)
  const profile = useCloudStore(s => s.profile)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const signedIn = cloudConfigured() && session !== null

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      await loadProfile()
      if (useCloudStore.getState().profile) await loadFriends()
    } catch (e) {
      setError(socialErrorText(e))
    } finally {
      setLoading(false)
      setLoaded(true)
    }
  }

  useEffect(() => {
    if (signedIn) void refresh()
  }, [signedIn])

  return (
    <div className="pt-4">
      <div className="mb-4 flex items-center gap-2">
        <Link
          to="/rank"
          aria-label={t('common.back')}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sub active:bg-muted/40"
        >
          <ChevronLeft size={24} />
        </Link>
        <h1 className="min-w-0 flex-1 truncate font-display text-3xl font-bold">{t('social.screen.title')}</h1>
        {signedIn && profile && (
          <button
            onClick={() => void refresh()}
            disabled={loading}
            aria-label={t('social.screen.refresh')}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sub active:bg-muted/40"
          >
            <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
          </button>
        )}
      </div>

      {!signedIn ? (
        <div className="rounded-2xl border border-edge bg-card p-4">
          <p className="text-sm text-sub">{t('social.screen.signInFirst')}</p>
          <Link
            to="/settings"
            state={{ focus: 'sync' }}
            className="mt-3 flex w-full items-center justify-center rounded-2xl bg-primary py-3 font-display text-lg font-bold text-bg active:opacity-90"
          >
            {t('social.screen.openSettings')}
          </Link>
        </div>
      ) : !profile ? (
        !loaded ? <Loader2 size={24} className="mx-auto animate-spin text-sub" /> : <NameForm />
      ) : (
        <>
          <ProfileCard />
          <AddFriend />
          <Requests />
          <Board />
        </>
      )}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      <p className="mt-6 pb-4 text-xs text-sub">{t('social.screen.privacy')}</p>
    </div>
  )
}

function NameForm({ initial = '', onDone }: { initial?: string; onDone?: () => void }) {
  const [name, setName] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const valid = name.trim().length >= 1 && name.trim().length <= 30

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await setDisplayName(name)
      await loadFriends()
      onDone?.()
    } catch (e) {
      setError(socialErrorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-edge bg-card p-4">
      {!initial && <p className="text-sm text-sub">{t('social.profile.intro')}</p>}
      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-sub">{t('social.profile.name')}</span>
        <input
          type="text"
          value={name}
          maxLength={30}
          autoComplete="nickname"
          onChange={e => setName(e.target.value)}
          className="min-h-[48px] w-full rounded-xl bg-surface px-3 text-base"
        />
      </label>
      <button
        onClick={() => void save()}
        disabled={busy || !valid}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 font-display text-lg font-bold text-bg active:opacity-90 disabled:opacity-40"
      >
        {busy && <Loader2 size={18} className="animate-spin" />} {t('social.profile.save')}
      </button>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  )
}

function ProfileCard() {
  const profile = useCloudStore(s => s.profile)!
  const [editing, setEditing] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  if (editing) {
    return <NameForm initial={profile.displayName} onDone={() => setEditing(false)} />
  }
  return (
    <div className="rounded-2xl border border-edge bg-card p-4">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-sub">{t('social.profile.youAppearAs')}</p>
          <p className="truncate font-display text-xl font-bold">{profile.displayName}</p>
        </div>
        <button
          onClick={() => setEditing(true)}
          aria-label={t('social.profile.edit')}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sub active:bg-muted/40"
        >
          <Pencil size={18} />
        </button>
      </div>
      <p className="mt-2 text-sm text-sub">
        {t('social.profile.yourCode')} <span className="num font-semibold tracking-widest text-ink">{profile.friendCode}</span>
      </p>
      <button
        onClick={() => {
          setMsg(null)
          void shareInvite(inviteLink(profile.friendCode))
            .then(r => r === 'copied' && setMsg(t('social.invite.copied')))
            .catch(e => setMsg((e as Error).message))
        }}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3 font-display text-lg font-bold text-bg active:opacity-90"
      >
        <Share2 size={18} /> {t('social.invite.button')}
      </button>
      {msg && <p className="mt-2 text-xs text-sub">{msg}</p>}
    </div>
  )
}

function AddFriend() {
  const pendingInvite = useCloudStore(s => s.pendingInvite)
  const [text, setText] = useState(pendingInvite ?? '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null)
  const code = normalizeFriendCode(text)

  async function send() {
    if (!code) return
    setBusy(true)
    setMsg(null)
    try {
      const result = await addFriend(code)
      setMsg({ text: t(`social.add.result.${result}`), error: false })
      setText('')
    } catch (e) {
      setMsg({ text: socialErrorText(e), error: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 rounded-2xl border border-edge bg-card p-4">
      <h2 className="mb-2 font-display text-lg font-semibold">{t('social.add.title')}</h2>
      {pendingInvite && text === pendingInvite && <p className="mb-2 text-xs text-sub">{t('social.add.fromInvite')}</p>}
      <div className="flex gap-2">
        <input
          type="text"
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={t('social.add.placeholder')}
          autoCapitalize="characters"
          className="num min-h-[48px] min-w-0 flex-1 rounded-xl bg-surface px-3 text-base uppercase tracking-widest"
        />
        <button
          onClick={() => void send()}
          disabled={busy || !code}
          aria-label={t('social.add.send')}
          className="flex min-h-[48px] shrink-0 items-center gap-1.5 rounded-xl bg-primary px-4 font-semibold text-bg active:opacity-90 disabled:opacity-40"
        >
          {busy ? <Loader2 size={18} className="animate-spin" /> : <UserPlus size={18} />}
          {t('social.add.send')}
        </button>
      </div>
      {msg && <p className={`mt-2 text-xs ${msg.error ? 'text-danger' : 'text-sub'}`}>{msg.text}</p>}
    </div>
  )
}

function Requests() {
  const friends = useCloudStore(s => s.friends)
  const incoming = friends.filter(f => f.status === 'incoming')
  const outgoing = friends.filter(f => f.status === 'outgoing')
  const [error, setError] = useState<string | null>(null)
  if (incoming.length === 0 && outgoing.length === 0) return null

  const act = (p: Promise<void>) => {
    setError(null)
    p.catch(e => setError(socialErrorText(e)))
  }

  return (
    <div className="mt-3 rounded-2xl border border-edge bg-card p-4">
      <h2 className="mb-2 font-display text-lg font-semibold">{t('social.requests.title')}</h2>
      <div className="space-y-1.5">
        {incoming.map(f => (
          <div key={f.userId} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{f.displayName}</span>
            <button
              onClick={() => act(answerRequest(f.userId, true))}
              aria-label={t('social.requests.accept')}
              className="flex min-h-[40px] items-center gap-1 rounded-xl bg-primary px-3 text-sm font-semibold text-bg active:opacity-90"
            >
              <Check size={16} /> {t('social.requests.accept')}
            </button>
            <button
              onClick={() => act(answerRequest(f.userId, false))}
              aria-label={t('social.requests.decline')}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-sub active:bg-muted/40"
            >
              <X size={18} />
            </button>
          </div>
        ))}
        {outgoing.map(f => (
          <div key={f.userId} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{f.displayName}</span>
            <span className="shrink-0 text-xs text-sub">{t('social.requests.pending')}</span>
            <button
              onClick={() => act(unfriend(f.userId))}
              aria-label={t('social.requests.cancel')}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-sub active:bg-muted/40"
            >
              <X size={18} />
            </button>
          </div>
        ))}
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  )
}

/** The season board: you and your friends by points this season. */
function Board() {
  const board = useCloudStore(s => s.friends)
  const rank = useLiveQuery(() => db.rankState.get(1))
  const mine = useLiveQuery(() => collectPublicStats())
  const friends = withMyStats(board, mine)
  const [open, setOpen] = useState<FriendEntry | null>(null)
  if (!rank) return null
  const players = friends.filter(f => f.status === 'me' || f.status === 'friend')
  const rows = players
    .map(f => ({ f, view: f.stats ? currentView(f.stats, rank.seasonId) : null }))
    .sort((a, b) => (b.view?.points ?? -1) - (a.view?.points ?? -1))
  const me = players.find(f => f.status === 'me')

  return (
    <>
      <h2 className="mb-2 mt-6 font-display text-xl font-semibold">
        {t('social.board.title', { season: rank.seasonId })}
      </h2>
      {players.length <= 1 && <p className="mb-2 text-sm text-sub">{t('social.board.empty')}</p>}
      <div className="space-y-1.5">
        {rows.map(({ f, view }, i) => {
          const points = view?.points ?? null
          const tier = rankForPoints(points ?? 0).tier
          return (
            <button
              key={f.userId}
              onClick={() => f.status === 'friend' && setOpen(f)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left ${
                f.status === 'me' ? 'border border-primary/40 bg-card' : 'bg-card active:bg-muted/40'
              }`}
            >
              <span className="num w-5 shrink-0 text-center text-sm font-bold text-sub">{i + 1}</span>
              <RankBadge tier={tier} size={36} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">
                  {f.status === 'me' ? t('social.board.you', { name: f.displayName }) : f.displayName}
                </span>
                <span className="num block truncate text-xs text-sub">
                  {view?.sessionsSeason != null
                    ? `${tp('social.board.sessions', view.sessionsSeason)} · ${tp('rank.screen.streak', view.streakWeeks)}`
                    : t('social.board.noStats')}
                </span>
              </span>
              <span className="num shrink-0 text-right">
                <span className="block font-display text-lg font-bold" style={{ color: tier.color }}>
                  {points != null ? fmtNum(points) : '—'}
                </span>
                <span className="block text-[11px] text-sub">{points != null ? rankLabel(tier) : ''}</span>
              </span>
            </button>
          )
        })}
      </div>
      {open && me && (
        <CompareSheet me={me} friend={open} seasonId={rank.seasonId} onClose={() => setOpen(null)} />
      )}
    </>
  )
}

function CompareSheet({ me, friend, seasonId, onClose }: { me: FriendEntry; friend: FriendEntry; seasonId: number; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const mine = me.stats ? currentView(me.stats, seasonId) : null
  const theirs = friend.stats ? currentView(friend.stats, seasonId) : null
  const lifts = me.stats && friend.stats ? commonLifts(me.stats.bestLifts, friend.stats.bestLifts) : []
  const kg = (n: number | null | undefined) => (n == null ? '—' : t('social.compare.kg', { kg: fmtNum(n) }))
  const num = (n: number | null | undefined) => (n == null ? '—' : fmtNum(n))
  const rows: Array<[string, string, string, number | null | undefined, number | null | undefined]> = [
    [t('social.compare.points'), num(mine?.points), num(theirs?.points), mine?.points, theirs?.points],
    [t('social.compare.rank'),
      mine?.points != null ? rankLabel(rankForPoints(mine.points).tier) : '—',
      theirs?.points != null ? rankLabel(rankForPoints(theirs.points).tier) : '—', mine?.points, theirs?.points],
    [t('social.compare.sessionsWeek'), num(mine?.sessionsWeek), num(theirs?.sessionsWeek), mine?.sessionsWeek, theirs?.sessionsWeek],
    [t('social.compare.sessionsSeason'), num(mine?.sessionsSeason), num(theirs?.sessionsSeason), mine?.sessionsSeason, theirs?.sessionsSeason],
    [t('social.compare.streak'), num(mine?.streakWeeks), num(theirs?.streakWeeks), mine?.streakWeeks, theirs?.streakWeeks],
    [t('social.compare.volumeWeek'), kg(mine?.volumeWeekKg), kg(theirs?.volumeWeekKg), mine?.volumeWeekKg, theirs?.volumeWeekKg],
    [t('social.compare.volumeSeason'), kg(mine?.volumeSeasonKg), kg(theirs?.volumeSeasonKg), mine?.volumeSeasonKg, theirs?.volumeSeasonKg],
  ]
  const lead = (a: number | null | undefined, b: number | null | undefined, side: 'a' | 'b') =>
    a != null && b != null && (side === 'a' ? a > b : b > a) ? 'font-bold text-primary' : ''

  return (
    <Sheet open onClose={onClose} title={friend.displayName}>
      <div className="pb-4">
        <div className="mb-1 grid grid-cols-[1fr_auto_auto] gap-x-4 text-xs font-semibold uppercase tracking-wide text-sub">
          <span />
          <span className="w-20 text-right">{t('social.compare.you')}</span>
          <span className="w-20 truncate text-right">{friend.displayName}</span>
        </div>
        {rows.map(([label, a, b, na, nb]) => (
          <div key={label} className="num grid grid-cols-[1fr_auto_auto] gap-x-4 border-b border-edge/60 py-2 text-sm">
            <span className="min-w-0 truncate text-sub">{label}</span>
            <span className={`w-20 text-right ${lead(na, nb, 'a')}`}>{a}</span>
            <span className={`w-20 text-right ${lead(na, nb, 'b')}`}>{b}</span>
          </div>
        ))}

        <h3 className="mb-1 mt-5 font-display text-lg font-semibold">{t('social.compare.lifts')}</h3>
        {lifts.length === 0 && <p className="text-sm text-sub">{t('social.compare.noLifts')}</p>}
        {lifts.map(l => (
          <div key={l.key} className="num grid grid-cols-[1fr_auto_auto] gap-x-4 border-b border-edge/60 py-2 text-sm">
            <span className="min-w-0 truncate text-sub">{exerciseDisplayName(l.name)}</span>
            <span className={`w-20 text-right ${lead(l.mine, l.theirs, 'a')}`}>{kg(l.mine)}</span>
            <span className={`w-20 text-right ${lead(l.mine, l.theirs, 'b')}`}>{kg(l.theirs)}</span>
          </div>
        ))}

        {friend.stats && (
          <p className="mt-4 text-xs text-sub">
            {t('social.compare.updated', { when: fmtDateTime(Date.parse(friend.stats.updatedAt)) })}
          </p>
        )}
        <button
          onClick={() => {
            if (!window.confirm(t('social.compare.removeConfirm', { name: friend.displayName }))) return
            setError(null)
            unfriend(friend.userId).then(onClose, e => setError(socialErrorText(e)))
          }}
          className="mt-5 w-full rounded-2xl border border-danger/40 py-3 font-semibold text-danger active:bg-danger/10"
        >
          {t('social.compare.remove')}
        </button>
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      </div>
    </Sheet>
  )
}
