/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** USDA FoodData Central API key (from .env / CI secret; falls back to DEMO_KEY). */
  readonly VITE_USDA_KEY?: string
}

declare module '*.wasm?url' {
  const src: string
  export default src
}
