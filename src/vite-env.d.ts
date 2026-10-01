/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** USDA FoodData Central API key (from .env / CI secret; falls back to DEMO_KEY). */
  readonly VITE_USDA_KEY?: string
}

/** Build stamp injected by `define` in vite.config.ts. */
declare const __APP_VERSION__: string
declare const __BUILD_SHA__: string
/** ISO timestamp of the build. */
declare const __BUILD_TIME__: string

declare module '*.wasm?url' {
  const src: string
  export default src
}
