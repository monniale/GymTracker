/**
 * Minimal GitHub REST client for the sync engine. api.github.com is CORS-open
 * for any origin with Authorization headers (docs: "CORS for AJAX requests
 * from any origin"), so this runs straight from the PWA.
 */

export interface GhConfig {
  token: string
  owner: string
  repo: string
}

export type GhErrorKind = 'auth' | 'not-found' | 'conflict' | 'rate-limit' | 'network' | 'other'

export class GhError extends Error {
  constructor(message: string, public status: number, public kind: GhErrorKind) {
    super(message)
    this.name = 'GhError'
  }
}

const API = 'https://api.github.com'

async function gh(token: string, path: string, init?: RequestInit): Promise<Response> {
  let res: Response
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...init?.headers,
      },
    })
  } catch {
    throw new GhError('Network unreachable', 0, 'network')
  }
  if (res.ok || res.status === 404) return res
  if (res.status === 401) throw new GhError('Token invalid or expired', 401, 'auth')
  if (res.status === 403 || res.status === 429) {
    const remaining = res.headers.get('x-ratelimit-remaining')
    throw new GhError(
      remaining === '0' ? 'GitHub rate limit reached — try later' : 'Access forbidden (check token permissions)',
      res.status,
      remaining === '0' ? 'rate-limit' : 'auth',
    )
  }
  if (res.status === 409) throw new GhError('Remote changed underneath us', 409, 'conflict')
  if (res.status === 422) {
    const body = await res.text()
    // A stale/missing sha on PUT surfaces as 422 "does not match" on some paths.
    if (/sha/i.test(body) && /match|exist/i.test(body)) {
      throw new GhError('Remote changed underneath us', 422, 'conflict')
    }
    throw new GhError(`GitHub rejected the request (422)`, 422, 'other')
  }
  throw new GhError(`GitHub error ${res.status}`, res.status, 'other')
}

/** Unicode-safe base64 helpers (payload contains e.g. “ ” × é). */
export function encodeB64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function decodeB64(b64: string): string {
  const binary = atob(b64.replace(/\s/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

/** Validates the token and returns the authenticated username. */
export async function getAuthedUser(token: string): Promise<string> {
  const res = await gh(token, '/user')
  if (res.status === 404) throw new GhError('Token cannot read the user', 404, 'auth')
  const data = await res.json()
  return data.login as string
}

export async function repoExists(cfg: GhConfig): Promise<boolean> {
  const res = await gh(cfg.token, `/repos/${cfg.owner}/${cfg.repo}`)
  return res.status !== 404
}

export async function repoIsPrivate(cfg: GhConfig): Promise<boolean | null> {
  const res = await gh(cfg.token, `/repos/${cfg.owner}/${cfg.repo}`)
  if (res.status === 404) return null
  const data = await res.json()
  return data.private === true
}

export interface RemoteFile {
  sha: string
  text: string
}

/** Reads a file (null when absent). Uses the object media type for sha+content;
 * falls back to the raw media type for payloads beyond the 1MB inline limit. */
export async function getFile(cfg: GhConfig, path: string): Promise<RemoteFile | null> {
  const base = `/repos/${cfg.owner}/${cfg.repo}/contents/${path}`
  const res = await gh(cfg.token, base, {
    headers: { Accept: 'application/vnd.github.object+json' },
  })
  if (res.status === 404) return null
  const data = await res.json()
  const sha = data.sha as string
  if (typeof data.content === 'string' && data.content.length > 0) {
    return { sha, text: decodeB64(data.content) }
  }
  const raw = await gh(cfg.token, base, {
    headers: { Accept: 'application/vnd.github.raw+json' },
  })
  if (raw.status === 404) return null
  return { sha, text: await raw.text() }
}

/** Create/update with compare-and-swap: pass the previous sha when updating;
 * a stale sha raises GhError(kind: 'conflict'). Returns the new blob sha. */
export async function putFile(
  cfg: GhConfig,
  path: string,
  text: string,
  message: string,
  sha?: string,
): Promise<string> {
  const res = await gh(cfg.token, `/repos/${cfg.owner}/${cfg.repo}/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({ message, content: encodeB64(text), ...(sha ? { sha } : {}) }),
  })
  if (res.status === 404) throw new GhError('Repository or path not found', 404, 'not-found')
  const data = await res.json()
  return data.content.sha as string
}
