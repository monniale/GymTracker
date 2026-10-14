import { Capacitor } from '@capacitor/core'

/**
 * Platform flags — the ONLY native module (with `haptics.ts`) that shared code may import
 * statically (ROUTEMAP invariant 14). Imports nothing but `@capacitor/core`.
 *
 * Compile-time guard: outside `vite build --mode android` (the Pages build, `vite` dev, vitest)
 * `import.meta.env.MODE === 'android'` is a literal `false`, so every
 * `if (isNative) … import('./native/…')` branch is dead code and Rollup drops the native chunks
 * from `dist/` (checked by `scripts/check-pwa-dist.mjs`).
 */
export const isNative: boolean = import.meta.env.MODE === 'android' && Capacitor.isNativePlatform()

export const isAndroid: boolean = isNative && Capacitor.getPlatform() === 'android'
