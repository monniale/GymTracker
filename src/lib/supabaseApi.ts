import { t } from '../i18n'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './supabaseConfig'

/**
 * Minimal Supabase client for cloud sync: GoTrue (email OTP sign-in, token refresh) and
 * PostgREST (the `rows` table + the `push_rows` function), over plain `fetch` like githubApi.ts.
 * No SDK: the bundle stays small and self-hosted, and the WebView needs no OAuth redirect.
 */

export type SbErrorKind = 'auth' | 'bad-code' | 'rate-limit' | 'paused' | 'network' | 'other'

export class SbError extends Error {
  constructor(message: string, public status: number, public kind: SbErrorKind) {
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
  if (res.status === 401 || res.status === 403) throw new SbError(t('data.cloud.auth'), res.status, 'auth')
  if (res.status === 429) throw new SbError(t('data.cloud.rateLimit'), 429, 'rate-limit')
  // A free project paused for inactivity answers 540 (and 503 while resuming).
  if (res.status === 540 || res.status === 503) throw new SbError(t('data.cloud.paused'), res.status, 'paused')
  if (res.status === 400 && /otp|token|expired|invalid/i.test(detail)) throw new SbError(t('data.cloud.badCode'), 400, 'bad-code')
  throw new SbError(t('data.cloud.error', { status: res.status, detail: detail.slice(0, 80) }), res.status, 'other')
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

/** Exchange the emailed code for a session. */
export async function verifyOtp(email: string, code: string): Promise<SbSession> {
  const res = await sb('/auth/v1/verify', { method: 'POST', body: JSON.stringify({ type: 'email', email, token: code.trim() }) })
  return parseSession(await res.json())
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
