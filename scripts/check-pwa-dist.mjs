#!/usr/bin/env node
// PWA regression check for the GitHub Pages build (ROUTEMAP invariant 14). No dependencies.
//   npm run build && node scripts/check-pwa-dist.mjs
// Fails (exit 1) when:
//  - dist/sw.js, dist/registerSW.js or dist/manifest.webmanifest is missing,
//  - dist/index.html does not reference the Pages base (/GymTracker/, or $BASE_PATH),
//  - any dist/assets/*.js registers a Capacitor plugin, i.e. a native chunk leaked into the PWA
//    (native code must sit behind `isNative` from src/native/platform.ts so Rollup drops it).
// Prints the service-worker precache entry count and byte total next to the pre-Android baseline.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const DIST = 'dist'
const BASE = process.env.BASE_PATH ?? '/GymTracker/'
/** Pages build of commit 00625b7 (before the Android work), measured the same way. */
const BASELINE = { entries: 31, bytes: 931014 }
const PLUGINS = 'LocalNotifications|Haptics|App|Filesystem|Share|SplashScreen|KeepAwake|BarcodeScanner|RestTimer|DeviceSettings'
// Unminified `registerPlugin("Haptics"` or minified `t("Haptics",{web:…})` / `t("DeviceSettings")`.
const REGISTER = new RegExp(`(?:registerPlugin|[\\w$])\\(\\s*["'\`](${PLUGINS})["'\`]\\s*(?:\\)|,\\s*\\{)`, 'g')

const errors = []
for (const f of ['index.html', 'sw.js', 'registerSW.js', 'manifest.webmanifest'])
  if (!existsSync(join(DIST, f))) errors.push(`missing ${DIST}/${f}`)

if (existsSync(join(DIST, 'index.html'))) {
  const html = readFileSync(join(DIST, 'index.html'), 'utf8')
  if (!html.includes(`${BASE}assets/`)) errors.push(`${DIST}/index.html does not load assets from ${BASE}`)
  if (!html.includes('manifest.webmanifest')) errors.push(`${DIST}/index.html does not link the web manifest`)
}

const assets = existsSync(join(DIST, 'assets')) ? readdirSync(join(DIST, 'assets')).filter(f => f.endsWith('.js')) : []
if (!assets.length) errors.push(`no ${DIST}/assets/*.js`)
for (const f of assets) {
  const js = readFileSync(join(DIST, 'assets', f), 'utf8')
  const hits = [...new Set([...js.matchAll(REGISTER)].map(m => m[1]))]
  if (hits.length) errors.push(`${DIST}/assets/${f} registers native plugin(s): ${hits.join(', ')}`)
}

if (existsSync(join(DIST, 'sw.js'))) {
  const sw = readFileSync(join(DIST, 'sw.js'), 'utf8')
  const urls = [...sw.matchAll(/\burl:\s*"([^"]+)"/g)].map(m => m[1])
  let bytes = 0
  for (const u of urls) {
    try {
      bytes += statSync(join(DIST, u)).size
    } catch {
      errors.push(`precache entry ${u} missing from ${DIST}/`)
    }
  }
  if (!urls.length) errors.push(`${DIST}/sw.js has no precache entries`)
  const kib = n => `${(n / 1024).toFixed(1)} KiB`
  console.log(
    `precache: ${urls.length} entries, ${kib(bytes)} ` +
      `(baseline ${BASELINE.entries} entries, ${kib(BASELINE.bytes)}; Δ ${urls.length - BASELINE.entries} entries, ${kib(bytes - BASELINE.bytes)})`,
  )
}

if (errors.length) {
  for (const e of errors) console.error(`✗ ${e}`)
  process.exit(1)
}
console.log(`✓ PWA dist OK: base ${BASE}, service worker + manifest present, no native plugin in ${assets.length} JS chunk(s)`)
