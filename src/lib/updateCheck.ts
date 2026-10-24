// In-app update check for the Android build (pure: no Capacitor, no i18n).
//
// Release naming contract, written by `scripts/android/release.sh --publish`
// and documented in ANDROID.md:
//   - tag:    v<versionName>+<versionCode>              e.g. v1.0.0+131
//   - title:  GymTracker <versionName> (<versionCode>)
//   - assets: gymtracker-<versionName>-<versionCode>-release.apk
//             gymtracker-<versionName>-<versionCode>-release.apk.idsig
//             SHA256SUMS
//
// The client trusts the APK asset name first (it is what gets installed) and
// falls back to the tag only when an `.apk` asset exists whose name does not
// follow the contract. Only the versionCode is compared: debug builds suffix
// their versionName with `-debug`, so names are not comparable.
//
// The GitHub API is called unauthenticated (60 requests/hour/IP), so the
// check is manual and its result is cached by the caller.

export const RELEASES_LATEST_URL = 'https://api.github.com/repos/monniale/GymTracker/releases/latest'

export interface ReleaseInfo {
  tag: string
  versionName: string
  versionCode: number
  apkUrl: string
  idsigUrl?: string
  htmlUrl: string
  publishedAt: string
}

const TAG_RE = /^v(\d+\.\d+\.\d+)\+(\d+)$/
const APK_RE = /^gymtracker-(\d+\.\d+\.\d+)-(\d+)-release\.apk$/

function parseWith(re: RegExp, s: string): { versionName: string; versionCode: number } | null {
  const m = re.exec(s)
  if (!m) return null
  const versionCode = Number(m[2])
  if (!Number.isSafeInteger(versionCode)) return null
  return { versionName: m[1], versionCode }
}

export function parseReleaseTag(tag: string): { versionName: string; versionCode: number } | null {
  return typeof tag === 'string' ? parseWith(TAG_RE, tag) : null
}

export function parseApkName(name: string): { versionName: string; versionCode: number } | null {
  return typeof name === 'string' ? parseWith(APK_RE, name) : null
}

interface Asset { name: string; url: string }

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function assetsOf(rel: Record<string, unknown>): Asset[] {
  if (!Array.isArray(rel.assets)) return []
  const out: Asset[] = []
  for (const a of rel.assets) {
    if (!a || typeof a !== 'object') continue
    const r = a as Record<string, unknown>
    const name = str(r.name)
    const url = str(r.browser_download_url)
    if (name && url) out.push({ name, url })
  }
  return out
}

/** Parses GitHub's `GET /releases/latest` JSON. Null when it is not a usable published release with an APK. */
export function latestReleaseFrom(json: unknown): ReleaseInfo | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null
  const rel = json as Record<string, unknown>
  if (rel.draft === true || rel.prerelease === true) return null

  const tag = str(rel.tag_name)
  const assets = assetsOf(rel)

  let apk: Asset | undefined
  let version: { versionName: string; versionCode: number } | null = null
  for (const a of assets) {
    const v = parseApkName(a.name)
    if (v) { apk = a; version = v; break }
  }
  if (!apk) {
    // An APK that does not follow the naming contract: take its version from the tag.
    apk = assets.find((a) => a.name.toLowerCase().endsWith('.apk'))
    if (!apk) return null
    version = parseReleaseTag(tag)
    if (!version) return null
  }
  if (!version) return null

  const apkName = apk.name
  const idsig = assets.find((a) => a.name === `${apkName}.idsig`)
  return {
    tag,
    versionName: version.versionName,
    versionCode: version.versionCode,
    apkUrl: apk.url,
    ...(idsig ? { idsigUrl: idsig.url } : {}),
    htmlUrl: str(rel.html_url),
    publishedAt: str(rel.published_at),
  }
}

/** 'newer' means a newer release is available than the installed build. */
export type UpdateStatus = 'newer' | 'same' | 'older' | 'unknown'

export function compareVersionCodes(installed: string | number | undefined, latest: number): UpdateStatus {
  if (installed === undefined || installed === null) return 'unknown'
  const s = typeof installed === 'number' ? String(installed) : installed.trim()
  if (!/^\d+$/.test(s)) return 'unknown'
  const code = Number(s)
  if (!Number.isSafeInteger(code) || !Number.isFinite(latest)) return 'unknown'
  if (latest > code) return 'newer'
  if (latest === code) return 'same'
  return 'older'
}

/**
 * What Settings › Updates shows for the installed build and the cached latest release:
 * - 'pending':   the installed versionCode has not loaded yet (show no result, so a cached
 *                release never flashes as an update)
 * - 'none':      no release published (or never checked successfully)
 * - 'available': the release has a higher versionCode than the installed build
 * - 'upToDate':  same or older versionCode
 * - 'unknown':   the installed versionCode is unusable (e.g. `build: ''` when the plugin
 *                failed): show the release with its download link
 * Only `installed.build` (the versionCode) is compared, never the versionName.
 */
export type UpdateView = 'pending' | 'none' | 'available' | 'upToDate' | 'unknown'

export function updateView(
  installed: { version: string; build: string } | null,
  latest: Pick<ReleaseInfo, 'versionCode'> | null,
): UpdateView {
  if (installed === null) return 'pending'
  if (latest === null) return 'none'
  const status = compareVersionCodes(installed.build || undefined, latest.versionCode)
  if (status === 'newer') return 'available'
  if (status === 'unknown') return 'unknown'
  return 'upToDate'
}

export class UpdateCheckError extends Error {
  constructor(public kind: 'rate-limit' | 'network' | 'http', public status = 0) {
    super(status ? `update check failed: ${kind} (${status})` : `update check failed: ${kind}`)
    this.name = 'UpdateCheckError'
  }
}

/** Fetches the latest published release. Null when the repo has no (usable) release yet. */
export async function fetchLatestRelease(fetchFn: typeof fetch = fetch, signal?: AbortSignal): Promise<ReleaseInfo | null> {
  let res: Response
  try {
    res = await fetchFn(RELEASES_LATEST_URL, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal,
    })
  } catch (e) {
    // An abort is the caller's decision, not a network failure: let it through.
    if (signal?.aborted) throw e
    throw new UpdateCheckError('network')
  }
  if (res.status === 404) return null
  if (res.status === 403 || res.status === 429) throw new UpdateCheckError('rate-limit', res.status)
  if (!res.ok) throw new UpdateCheckError('http', res.status)
  let json: unknown
  try {
    json = await res.json()
  } catch {
    throw new UpdateCheckError('http', res.status)
  }
  return latestReleaseFrom(json)
}
