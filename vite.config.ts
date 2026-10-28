import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

/** Short commit SHA of this build: CI's GITHUB_SHA, else local git. */
function buildSha(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'unknown'
  }
}

export default defineConfig(({ mode }) => {
  // `vite build --mode android` = the Capacitor bundle (dist-android/, copied into the APK by `cap sync`):
  // relative base (served from https://localhost/) and no service worker / web manifest.
  const android = mode === 'android'
  // GitHub Pages serves at /<repo-name>/ — override with BASE_PATH=/ for Netlify etc.
  const base = android ? './' : (process.env.BASE_PATH ?? '/GymTracker/')

  return {
    base,
    build: {
      ...(android ? { outDir: 'dist-android', emptyOutDir: true } : {}),
      rollupOptions: {
        output: {
          // The Claude SDK (lib/ai/anthropic.ts imports it dynamically) gets a stable chunk name so
          // the service worker can leave it out of the precache: only people who pick Claude load it.
          // Named here rather than with `manualChunks`: a manual chunk also swallows Rollup's shared
          // helpers (modulepreload, commonjs), which makes the entry chunk import it at startup.
          // Named: the chunk holding the SDK's index (with its own dependencies, e.g.
          // @opentelemetry/api) and the SDK's tiny Node-only shims (they import it; a browser never
          // loads them). A chunk that also holds app code or a Rollup helper (a `\0` virtual
          // module) keeps its generic name, so it stays precached; scripts/check-pwa-dist.mjs fails
          // the build if a precached chunk imports a named one statically.
          chunkFileNames(info) {
            const ids = info.moduleIds
            const inSdk = (id: string) => id.includes('/node_modules/@anthropic-ai/sdk/')
            const sdk = ids.some(id => inSdk(id) && /\/sdk\/index\.m?js$/.test(id)) || (ids.length > 0 && ids.every(inSdk))
            const foreign = ids.some(id => !id.includes('/node_modules/'))
            return sdk && !foreign ? 'assets/anthropic-sdk-[hash].js' : 'assets/[name]-[hash].js'
          },
        },
      },
    },
    // Build stamp shown at the bottom of Settings (typed in src/vite-env.d.ts). Same in both modes.
    define: {
      __APP_VERSION__: JSON.stringify(version),
      __BUILD_SHA__: JSON.stringify(buildSha()),
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    },
    plugins: [
      react(),
      VitePWA({
        disable: android,
        registerType: 'autoUpdate',
        includeAssets: ['apple-touch-icon.png'],
        workbox: {
          globPatterns: ['**/*.{js,css,html,png,svg,woff2,json}'],
          // The web demo backup (lib/demoData.ts, ~380 KB) is fetched only when someone taps
          // "Try with demo data": keep it out of the precache every visitor downloads.
          // Same for the Claude SDK chunk (~340 KB): fetched on first use, then runtime-cached below.
          globIgnores: ['**/demo-backup.json', '**/assets/anthropic-sdk-*.js'],
          // Exercise animations (opt-in, Settings) load from the dataset repo at a pinned commit:
          // keep the ones already seen for offline use. CORS responses only (the <img> asks
          // with crossOrigin), so no opaque entries inflate the storage quota. Thumbnails are
          // ~9 KB, GIFs ~125 KB: capped at about 5 MB and 10 MB.
          runtimeCaching: [{
            urlPattern: /^https:\/\/raw\.githubusercontent\.com\/hasaneyldrm\/exercises-dataset\/[0-9a-f]+\/images\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'exercise-thumbs',
              expiration: { maxEntries: 600, maxAgeSeconds: 90 * 86_400 },
              cacheableResponse: { statuses: [200] },
            },
          }, {
            urlPattern: /^https:\/\/raw\.githubusercontent\.com\/hasaneyldrm\/exercises-dataset\/[0-9a-f]+\/videos\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'exercise-gifs',
              expiration: { maxEntries: 80, maxAgeSeconds: 90 * 86_400 },
              cacheableResponse: { statuses: [200] },
            },
          }, {
            // The Claude SDK chunks left out of the precache above (the SDK plus two shims a
            // browser never loads). Hashed file names, so a cached copy is never stale; six
            // entries cover an update.
            urlPattern: /\/assets\/anthropic-sdk-[\w-]+\.js$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'anthropic-sdk',
              expiration: { maxEntries: 6 },
              cacheableResponse: { statuses: [200] },
            },
          }],
        },
        manifest: {
          name: 'GymTracker',
          short_name: 'GymTracker',
          description: 'Personal workout, nutrition and ranking tracker',
          display: 'standalone',
          orientation: 'portrait',
          start_url: base,
          scope: base,
          theme_color: '#0B0F14',
          background_color: '#0B0F14',
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
      }),
    ],
  }
})
