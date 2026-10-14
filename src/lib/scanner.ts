/**
 * EAN barcode scanning via the BarcodeDetector ponyfill (zxing-cpp WASM).
 * iOS Safari has no native BarcodeDetector (still flag-only/broken as of 2026),
 * so the ponyfill is always used. The .wasm is bundled by Vite (?url import) —
 * no CDN fetch, per the app's self-hosted policy.
 */
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'
import { BarcodeDetector, prepareZXingModule } from 'barcode-detector/ponyfill'

let prepared = false

/** Idempotent; call when the scan sheet opens to prefetch the wasm. */
export function prepareScanner(): void {
  if (prepared) return
  prepared = true
  prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) =>
        path.endsWith('.wasm') ? wasmUrl : prefix + path,
    },
    fireImmediately: true,
  })
}

export function createDetector(): BarcodeDetector {
  prepareScanner()
  return new BarcodeDetector({ formats: ['ean_13', 'ean_8'] })
}

/** Moved to the pure `ean.ts` (unit-tested); re-exported for existing callers. */
export { validEan } from './ean'
