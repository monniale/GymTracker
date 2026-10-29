import { t } from '../i18n'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './supabaseConfig'

/**
 * Minimal Supabase client for cloud sync: GoTrue (email OTP sign-in, token refresh) and
 * PostgREST (the `rows` table + the `push_rows` function), over plain `fetch` like githubApi.ts.
 * No SDK: the bundle stays small and self-hosted, and the WebView needs no OAuth redirect.
 */

export type SbErrorKind = 'auth' | 'bad-code' | 'rate-limit' | 'paused' | 'network' | 'other'

export class SbError extends Error {
  /** `detail`: the server's own message (e.g. a database function's `raise exception` text). */
  constructor(message: string, public status: number, public kind: SbErrorKind, public detail = '') {
    super(message)
    this.name = 'SbError'
  }
}

/** A signed-in user's tokens, as GoTrue returns them (`expires_at` in epoch seconds). */
export interface SbSession {
  access_token: string
  refresh_token: string
  expires_at: number
  user: { id: string; email?: string }
}

/** One synced row, the shape of the `rows` table. */
export interface CloudRow {
  tbl: string
  id: string
  data: Record<string, unknown>
  updated_at: number
  deleted: boolean
  server_seq?: number
}

async function sb(path: string, init: RequestInit, token?: string): Promise<Response> {
  let res: Response
  try {
    res = await fetch(`${SUPABASE_URL}${path}`, {
      ...init,
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token ?? SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    })
  } catch {
    throw new SbError(t('data.cloud.network'), 0, 'network')
  }
  if (res.ok) return res
  const detail = await errorDetail(res)
  if (res.status === 401 || res.status === 403) throw new SbError(t('data.cloud.auth'), res.status, 'auth', detail)
  if (res.status === 429) throw new SbError(t('data.cloud.rateLimit'), 429, 'rate-limit')
  // A free project paused for inactivity answers 540 (and 503 while resuming).
  if (res.status === 540 || res.status === 503) throw new SbError(t('data.cloud.paused'), res.status, 'paused')
  if (res.status === 400 && /otp|token|expired|invalid/i.test(detail)) throw new SbError(t('data.cloud.badCode'), 400, 'bad-code')
  throw new SbError(t('data.cloud.error', { status: res.status, detail: detail.slice(0, 80) }), res.status, 'other', detail)
}

async function errorDetail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { msg?: string; message?: string; error_description?: string; error?: string | { message?: string } }
    const err = typeof body.error === 'string' ? body.error : body.error?.message
    return body.msg ?? body.message ?? body.error_description ?? err ?? ''
  } catch {
    return ''
  }
}

/* ------------------------------ auth (GoTrue) ------------------------------ */

/** Email a one-time code (the project's "Magic Link" template must include {{ .Token }}). */
export async function requestOtp(email: string): Promise<void> {
  await sb('/auth/v1/otp', { method: 'POST', body: JSON.stringify({ email, create_user: true }) })
}

/**
 * Exchange what the email carried for a session: the 6-digit code (a template with {{ .Token }},
 * which needs custom SMTP on the free plan), or the default "Sign in" link pasted whole — its
 * `token` query parameter is the token hash GoTrue verifies without any redirect.
 */
export async function verifyOtp(email: string, codeOrLink: string): Promise<SbSession> {
  const link = parseSignInLink(codeOrLink)
  const body = link
    ? { type: link.type, token_hash: link.tokenHash }
    : { type: 'email', email, token: codeOrLink.replace(/\s+/g, '') }
  const res = await sb('/auth/v1/verify', { method: 'POST', body: JSON.stringify(body) })
  return parseSession(await res.json())
}

/** `…/auth/v1/verify?token=<hash>&type=magiclink&redirect_to=…` → its hash and type; null for a code. */
export function parseSignInLink(text: string): { tokenHash: string; type: string } | null {
  const m = /https?:\/\/\S+/.exec(text.trim())
  if (!m) return null
  try {
    const url = new URL(m[0])
    const tokenHash = url.searchParams.get('token') ?? url.searchParams.get('token_hash')
    if (!tokenHash) return null
    return { tokenHash, type: url.searchParams.get('type') ?? 'magiclink' }
  } catch {
    return null
  }
}

/** The signed-in user behind an access token (after a redirect that only carries tokens). */
export async function getUser(token: string): Promise<{ id: string; email?: string }> {
  const res = await sb('/auth/v1/user', { method: 'GET' }, token)
  const u = (await res.json()) as { id?: string; email?: string }
  if (!u.id) throw new SbError(t('data.cloud.error', { status: 200, detail: 'no user' }), 200, 'other')
  return { id: u.id, email: u.email }
}

export async function refreshSession(refreshToken: string): Promise<SbSession> {
  const res = await sb('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: refreshToken }) })
  return parseSession(await res.json())
}

/** Best effort: a failed sign-out still forgets the session locally. */
export async function signOutRemote(token: string): Promise<void> {
  try {
    await sb('/auth/v1/logout', { method: 'POST' }, token)
  } catch {
    /* the local session is dropped regardless */
  }
}

function parseSession(raw: unknown): SbSession {
  const r = raw as Partial<SbSession> & { expires_in?: number }
  if (!r || typeof r.access_token !== 'string' || typeof r.refresh_token !== 'string' || !r.user?.id) {
    throw new SbError(t('data.cloud.error', { status: 200, detail: 'no session' }), 200, 'other')
  }
  const expiresAt = typeof r.expires_at === 'number'
    ? r.expires_at
    : Math.floor(Date.now() / 1000) + (typeof r.expires_in === 'number' ? r.expires_in : 3600)
  return { access_token: r.access_token, refresh_token: r.refresh_token, expires_at: expiresAt, user: { id: r.user.id, email: r.user.email } }
}

/* ------------------------------ rows (PostgREST) ------------------------------ */

/** Upsert rows (server-side last-write-wins); returns the user's newest `server_seq`. */
export async function pushRows(token: string, rows: CloudRow[]): Promise<number> {
  const res = await sb('/rest/v1/rpc/push_rows', {
    method: 'POST',
    body: JSON.stringify({ p: rows.map(({ tbl, id, data, updated_at, deleted }) => ({ tbl, id, data, updated_at, deleted })) }),
  }, token)
  const seq = Number(await res.json())
  return Number.isFinite(seq) ? seq : 0
}

/** Rows changed after `afterSeq`, oldest first, at most `limit`. */
export async function pullRows(token: string, afterSeq: number, limit = 1000): Promise<CloudRow[]> {
  const q = `select=tbl,id,data,updated_at,deleted,server_seq&server_seq=gt.${afterSeq}&order=server_seq.asc&limit=${limit}`
  const res = await sb(`/rest/v1/rows?${q}`, { method: 'GET' }, token)
  return (await res.json()) as CloudRow[]
}

/** The caller's permissions: `my_permissions()` in supabase/migrations/0002_permissions.sql. */
export async function fetchPermissions(token: string): Promise<string[]> {
  const res = await sb('/rest/v1/rpc/my_permissions', { method: 'POST', body: '{}' }, token)
  const list: unknown = await res.json()
  return Array.isArray(list) ? list.filter((p): p is string => typeof p === 'string') : []
}

/* ------------------------------ social (0003_social.sql) ------------------------------ */

async function rpc(token: string, fn: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const res = await sb(`/rest/v1/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) }, token)
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

/** The shared season every account plays in (`startedOn`/`endsOn` are Europe/Rome days). */
export interface GlobalSeason { id: number; startedOn: string; endsOn: string }

function parseSeason(raw: unknown): GlobalSeason {
  const r = raw as Partial<GlobalSeason> | null
  if (!r || !Number.isInteger(r.id) || typeof r.startedOn !== 'string' || typeof r.endsOn !== 'string') {
    throw new SbError(t('data.cloud.error', { status: 200, detail: 'no season' }), 200, 'other')
  }
  return { id: r.id!, startedOn: r.startedOn, endsOn: r.endsOn }
}

export async function fetchCurrentSeason(token: string): Promise<GlobalSeason> {
  return parseSeason(await rpc(token, 'current_season'))
}

/** Ends the season for everyone (the `end_season` permission); returns the new one. */
export async function endGlobalSeason(token: string): Promise<GlobalSeason> {
  return parseSeason(await rpc(token, 'end_season'))
}

export interface SocialProfile { displayName: string; friendCode: string }

function parseProfile(raw: unknown): SocialProfile | null {
  const r = raw as Partial<SocialProfile> | null
  return r && typeof r.displayName === 'string' && typeof r.friendCode === 'string'
    ? { displayName: r.displayName, friendCode: r.friendCode }
    : null
}

export async function fetchMyProfile(token: string): Promise<SocialProfile | null> {
  return parseProfile(await rpc(token, 'my_profile'))
}

export async function saveDisplayName(token: string, name: string): Promise<SocialProfile> {
  const p = parseProfile(await rpc(token, 'set_display_name', { name }))
  if (!p) throw new SbError(t('data.cloud.error', { status: 200, detail: 'no profile' }), 200, 'other')
  return p
}

export type FriendRequestResult = 'requested' | 'accepted' | 'already'

export async function sendFriendRequest(token: string, code: string): Promise<FriendRequestResult> {
  const r = await rpc(token, 'send_friend_request', { code })
  return r === 'accepted' || r === 'already' ? r : 'requested'
}

export async function answerFriendRequest(token: string, requesterId: string, accept: boolean): Promise<void> {
  await rpc(token, 'answer_friend_request', { requester_id: requesterId, accept })
}

export async function removeFriend(token: string, otherId: string): Promise<void> {
  await rpc(token, 'remove_friend', { other: otherId })
}

/** What friends see of an account: workout numbers only (src/lib/socialStats.ts). */
export interface PublicStats {
  seasonId: number
  points: number
  streakWeeks: number
  /** The Monday the week counters belong to. */
  weekStart: string
  sessionsWeek: number
  sessionsSeason: number
  volumeWeekKg: number
  volumeSeasonKg: number
  /** Best estimated 1RM per exercise; `key` matches the same exercise across accounts. */
  bestLifts: Array<{ key: string; name: string; e1rm: number }>
}

export async function publishStats(token: string, stats: PublicStats): Promise<void> {
  await rpc(token, 'publish_stats', { s: stats })
}

export type FriendStatus = 'me' | 'friend' | 'incoming' | 'outgoing'

export interface FriendEntry {
  userId: string
  displayName: string
  status: FriendStatus
  /** Only for 'me' and accepted friends who have synced at least once. */
  stats: (PublicStats & { updatedAt: string }) | null
}

export async function fetchFriendsBoard(token: string): Promise<FriendEntry[]> {
  const list = await rpc(token, 'friends_board')
  return Array.isArray(list) ? (list as FriendEntry[]) : []
}

/** One account in the admin's points list (0004_adjust_points.sql `admin_users`). */
export interface AdminUser {
  userId: string
  email: string
  displayName: string | null
  /** The season points its synced rows add up to; null before its first sync. */
  points: number | null
  seasonId: number | null
  /** Newest `updated_at` among its rows (ms). */
  lastChange: number | null
}

export async function fetchAdminUsers(token: string): Promise<AdminUser[]> {
  const list = await rpc(token, 'admin_users')
  return Array.isArray(list) ? (list as AdminUser[]) : []
}

/** Sets an account's season points (`adjust_points`); `delta` is the score event written. */
export async function adminSetPoints(token: string, userId: string, points: number): Promise<{ points: number; delta: number }> {
  return (await rpc(token, 'admin_set_points', { target_user: userId, new_points: points })) as { points: number; delta: number }
}

export interface LiveId { tbl: string; id: string; updated_at: number }

/** Every live row's key and clock (for "overwrite cloud": what to beat, what to mark deleted). */
export async function listLiveIds(token: string): Promise<LiveId[]> {
  const out: LiveId[] = []
  for (let offset = 0; ; offset += 1000) {
    const res = await sb(`/rest/v1/rows?select=tbl,id,updated_at&deleted=eq.false&order=tbl,id&limit=1000&offset=${offset}`, { method: 'GET' }, token)
    const page = (await res.json()) as LiveId[]
    out.push(...page)
    if (page.length < 1000) return out
  }
}
