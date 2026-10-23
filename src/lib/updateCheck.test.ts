import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  RELEASES_LATEST_URL,
  UpdateCheckError,
  compareVersionCodes,
  fetchLatestRelease,
  latestReleaseFrom,
  parseApkName,
  parseReleaseTag,
  updateView,
} from './updateCheck'

const DL = 'https://github.com/monniale/GymTracker/releases/download'

const asset = (tag: string, name: string, id: number) => ({
  url: `https://api.github.com/repos/monniale/GymTracker/releases/assets/${id}`,
  id,
  node_id: `RA_kwDO${id}`,
  name,
  label: '',
  uploader: { login: 'monniale', id: 1, type: 'User' },
  content_type: name.endsWith('.apk') ? 'application/vnd.android.package-archive' : 'application/octet-stream',
  state: 'uploaded',
  size: 12_345_678,
  download_count: 3,
  created_at: '2026-10-20T18:01:02Z',
  updated_at: '2026-10-20T18:01:09Z',
  browser_download_url: `${DL}/${encodeURIComponent(tag)}/${name}`,
})

// Shape of GitHub's GET /repos/{owner}/{repo}/releases/latest response (trimmed).
function release(over: Record<string, unknown> = {}, names?: string[]) {
  const tag = (over.tag_name as string | undefined) ?? 'v1.0.0+131'
  const files = names ?? [
    'gymtracker-1.0.0-131-release.apk',
    'gymtracker-1.0.0-131-release.apk.idsig',
    'SHA256SUMS',
  ]
  return {
    url: 'https://api.github.com/repos/monniale/GymTracker/releases/170000000',
    assets_url: 'https://api.github.com/repos/monniale/GymTracker/releases/170000000/assets',
    html_url: `https://github.com/monniale/GymTracker/releases/tag/${encodeURIComponent(tag)}`,
    id: 170000000,
    author: { login: 'monniale', id: 1, type: 'User' },
    node_id: 'RE_kwDOabc',
    tag_name: tag,
    target_commitish: '25ac454',
    name: 'GymTracker 1.0.0 (131)',
    draft: false,
    prerelease: false,
    created_at: '2026-10-20T17:59:00Z',
    published_at: '2026-10-20T18:01:10Z',
    assets: files.map((n, i) => asset(tag, n, 300000000 + i)),
    tarball_url: `https://api.github.com/repos/monniale/GymTracker/tarball/${tag}`,
    zipball_url: `https://api.github.com/repos/monniale/GymTracker/zipball/${tag}`,
    body: 'Install over the current app.',
    ...over,
  }
}

describe('parseReleaseTag / parseApkName', () => {
  it('parses the contract names', () => {
    expect(parseReleaseTag('v1.0.0+131')).toEqual({ versionName: '1.0.0', versionCode: 131 })
    expect(parseApkName('gymtracker-1.2.10-80-release.apk')).toEqual({ versionName: '1.2.10', versionCode: 80 })
  })

  it('rejects anything else', () => {
    expect(parseReleaseTag('1.0.0+131')).toBeNull()
    expect(parseReleaseTag('v1.0.0')).toBeNull()
    expect(parseReleaseTag('v1.0+131')).toBeNull()
    expect(parseReleaseTag('v1.0.0+131-debug')).toBeNull()
    expect(parseApkName('gymtracker-1.0.0-131-debug.apk')).toBeNull()
    expect(parseApkName('gymtracker-1.0.0-131-release.apk.idsig')).toBeNull()
    expect(parseApkName('app-release.apk')).toBeNull()
  })
})

describe('latestReleaseFrom', () => {
  it('reads a release that follows the contract', () => {
    const r = latestReleaseFrom(release())
    expect(r).toEqual({
      tag: 'v1.0.0+131',
      versionName: '1.0.0',
      versionCode: 131,
      apkUrl: `${DL}/v1.0.0%2B131/gymtracker-1.0.0-131-release.apk`,
      idsigUrl: `${DL}/v1.0.0%2B131/gymtracker-1.0.0-131-release.apk.idsig`,
      htmlUrl: 'https://github.com/monniale/GymTracker/releases/tag/v1.0.0%2B131',
      publishedAt: '2026-10-20T18:01:10Z',
    })
  })

  it('trusts the APK asset name over a disagreeing tag', () => {
    const r = latestReleaseFrom(release({ tag_name: 'v1.0.0+130' }, [
      'SHA256SUMS',
      'gymtracker-1.0.1-132-release.apk',
    ]))
    expect(r).toMatchObject({ tag: 'v1.0.0+130', versionName: '1.0.1', versionCode: 132 })
    expect(r?.apkUrl).toMatch(/gymtracker-1\.0\.1-132-release\.apk$/)
  })

  it('ignores drafts and prereleases', () => {
    expect(latestReleaseFrom(release({ prerelease: true }))).toBeNull()
    expect(latestReleaseFrom(release({ draft: true }))).toBeNull()
  })

  it('is null without an APK asset', () => {
    expect(latestReleaseFrom(release({}, ['SHA256SUMS']))).toBeNull()
    expect(latestReleaseFrom(release({}, []))).toBeNull()
    expect(latestReleaseFrom(release({ assets: undefined }))).toBeNull()
  })

  it('falls back to the tag for an APK with an odd name', () => {
    const r = latestReleaseFrom(release({ tag_name: 'v1.1.0+140' }, ['app-release.apk']))
    expect(r).toMatchObject({ versionName: '1.1.0', versionCode: 140 })
    expect(r?.apkUrl).toMatch(/app-release\.apk$/)
    expect(r?.idsigUrl).toBeUndefined()
  })

  it('is null for an odd APK name and an odd tag', () => {
    expect(latestReleaseFrom(release({ tag_name: 'latest' }, ['app-release.apk']))).toBeNull()
  })

  it('finds the idsig only for the chosen APK', () => {
    const r = latestReleaseFrom(release({}, [
      'gymtracker-1.0.0-130-release.apk.idsig',
      'gymtracker-1.0.0-131-release.apk',
    ]))
    expect(r?.versionCode).toBe(131)
    expect(r?.idsigUrl).toBeUndefined()
  })

  it('survives junk input', () => {
    expect(latestReleaseFrom(null)).toBeNull()
    expect(latestReleaseFrom('nope')).toBeNull()
    expect(latestReleaseFrom([])).toBeNull()
    expect(latestReleaseFrom({ message: 'Not Found' })).toBeNull()
    expect(latestReleaseFrom(release({ assets: [null, 1, { name: 7 }, { name: 'x.apk' }] }))).toBeNull()
  })
})

describe('compareVersionCodes', () => {
  it('compares versionCodes', () => {
    expect(compareVersionCodes('79', 80)).toBe('newer')
    expect(compareVersionCodes('80', 80)).toBe('same')
    expect(compareVersionCodes('81', 80)).toBe('older')
  })

  it('treats a string and a number the same', () => {
    expect(compareVersionCodes('79', 80)).toBe(compareVersionCodes(79, 80))
    expect(compareVersionCodes(80, 80)).toBe('same')
  })

  it('is unknown without a usable installed code', () => {
    expect(compareVersionCodes('', 80)).toBe('unknown')
    expect(compareVersionCodes(undefined, 80)).toBe('unknown')
    expect(compareVersionCodes(Number.NaN, 80)).toBe('unknown')
    expect(compareVersionCodes('abc', 80)).toBe('unknown')
    // A versionName (debug builds carry `-debug`) is never a versionCode.
    expect(compareVersionCodes('1.0.0-debug', 80)).toBe('unknown')
  })
})

describe('updateView', () => {
  const latest = { versionCode: 131 }

  it('compares the installed versionCode, never the versionName', () => {
    // A debug install: `-debug` name, numeric build.
    expect(updateView({ version: '1.0.0-debug', build: '131' }, latest)).toBe('upToDate')
    expect(updateView({ version: '1.0.0-debug', build: '130' }, latest)).toBe('available')
    // The name says older, the code says same: the code wins.
    expect(updateView({ version: '0.9.0', build: '131' }, latest)).toBe('upToDate')
    expect(updateView({ version: '9.9.9', build: '130' }, latest)).toBe('available')
  })

  it('treats an older release as up to date', () => {
    expect(updateView({ version: '1.0.0', build: '140' }, latest)).toBe('upToDate')
  })

  it('is unknown (download link shown) when the build is unusable', () => {
    expect(updateView({ version: '1.0.0', build: '' }, latest)).toBe('unknown')
    expect(updateView({ version: '1.0.0', build: 'abc' }, latest)).toBe('unknown')
  })

  it('is none without a release', () => {
    expect(updateView({ version: '1.0.0', build: '131' }, null)).toBe('none')
  })

  it('is pending until the installed version has loaded', () => {
    expect(updateView(null, latest)).toBe('pending')
    expect(updateView(null, null)).toBe('pending')
  })
})

describe('release.sh naming matches the parser', () => {
  const sh = readFileSync(new URL('../../scripts/android/release.sh', import.meta.url), 'utf8')
  const fill = (tpl: string) => tpl.split('$VERSION').join('1.0.0').split('$CODE').join('131')

  it('the tag template parses', () => {
    const m = /^TAG="([^"]+)"$/m.exec(sh)
    expect(m).not.toBeNull()
    expect(parseReleaseTag(fill(m![1]))).toEqual({ versionName: '1.0.0', versionCode: 131 })
  })

  it('the APK template parses', () => {
    const m = /^APK=\S*\/(gymtracker-\S+\.apk)$/m.exec(sh)
    expect(m).not.toBeNull()
    expect(parseApkName(fill(m![1]))).toEqual({ versionName: '1.0.0', versionCode: 131 })
  })
})

describe('fetchLatestRelease', () => {
  const respond = (status: number, body: unknown = {}) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

  it('GETs the latest release without auth and parses it', async () => {
    const f = respond(200, release())
    const r = await fetchLatestRelease(f as unknown as typeof fetch)
    expect(r?.versionCode).toBe(131)
    expect(f).toHaveBeenCalledTimes(1)
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(RELEASES_LATEST_URL)
    const headers = init.headers as Record<string, string>
    expect(headers.Accept).toBe('application/vnd.github+json')
    expect(headers['X-GitHub-Api-Version']).toBe('2022-11-28')
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('authorization')
  })

  it('passes the abort signal through', async () => {
    const f = respond(200, release())
    const ctl = new AbortController()
    await fetchLatestRelease(f as unknown as typeof fetch, ctl.signal)
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(init.signal).toBe(ctl.signal)
  })

  it('is null on 404 (no release yet)', async () => {
    await expect(fetchLatestRelease(respond(404, { message: 'Not Found' }) as unknown as typeof fetch)).resolves.toBeNull()
  })

  it.each([403, 429])('maps %i to rate-limit', async (status) => {
    const err = await fetchLatestRelease(respond(status, { message: 'API rate limit exceeded' }) as unknown as typeof fetch)
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(UpdateCheckError)
    expect(err).toMatchObject({ kind: 'rate-limit', status })
  })

  it('maps other errors to http with the status', async () => {
    const err = await fetchLatestRelease(respond(500) as unknown as typeof fetch).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(UpdateCheckError)
    expect(err).toMatchObject({ kind: 'http', status: 500 })
  })

  it('rethrows an abort unchanged', async () => {
    const ctl = new AbortController()
    const abortErr = new DOMException('The operation was aborted.', 'AbortError')
    const f = vi.fn(async () => {
      ctl.abort()
      throw abortErr
    })
    const err = await fetchLatestRelease(f as unknown as typeof fetch, ctl.signal).catch((e: unknown) => e)
    expect(err).toBe(abortErr)
    expect(err).not.toBeInstanceOf(UpdateCheckError)
  })

  it('maps an unparseable 200 body to http 200', async () => {
    const f = vi.fn(async () => new Response('not json', { status: 200 }))
    const err = await fetchLatestRelease(f as unknown as typeof fetch).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(UpdateCheckError)
    expect(err).toMatchObject({ kind: 'http', status: 200 })
  })

  it('maps a thrown fetch to network', async () => {
    const f = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    const err = await fetchLatestRelease(f as unknown as typeof fetch).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(UpdateCheckError)
    expect(err).toMatchObject({ kind: 'network', status: 0 })
  })
})
