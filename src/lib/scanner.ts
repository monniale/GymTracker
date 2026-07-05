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

/** EAN-8/EAN-13 checksum validation for manual entry. */
export function validEan(code: string): boolean {
  if (!/^(\d{8}|\d{13})$/.test(code)) return false
  const digits = code.split('').map(Number)
  const check = digits.pop()!
  const sum = digits
    .reverse()
    .reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0)
  return (10 - (sum % 10)) % 10 === check
}
