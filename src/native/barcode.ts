import {
  BarcodeFormat,
  BarcodeScanner,
  GoogleBarcodeScannerModuleInstallState as InstallState,
} from '@capacitor-mlkit/barcode-scanning'
import type { PluginListenerHandle } from '@capacitor/core'

/**
 * Google code scanner (ML Kit, Play services UI). Needs no CAMERA permission. On failure the
 * caller falls back to the zxing getUserMedia scanner (BarcodeScanSheet).
 */
export type NativeScanResult =
  | { kind: 'code'; code: string; format: string }
  | { kind: 'canceled' }
  | { kind: 'unavailable'; reason: string }

/** A sideloaded APK gets no install-time module download (that is Play-only): fetch it on demand. */
const INSTALL_TIMEOUT_MS = 60_000

function message(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'object' && e !== null && 'message' in e) return String((e as { message: unknown }).message)
  return String(e)
}

async function ensureScannerModule(onState?: (s: 'checking' | 'installing') => void): Promise<void> {
  onState?.('checking')
  if ((await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable()).available) return
  onState?.('installing')

  let handle: PluginListenerHandle | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  // Key off `state` only: the plugin's `progress` integer-divides and stays near 0.
  const done = new Promise<void>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Timed out downloading the scanner.')), INSTALL_TIMEOUT_MS)
    void BarcodeScanner.addListener('googleBarcodeScannerModuleInstallProgress', e => {
      if (e.state === InstallState.COMPLETED) resolve()
      else if (e.state === InstallState.FAILED) reject(new Error('Scanner download failed.'))
      else if (e.state === InstallState.CANCELED) reject(new Error('Scanner download canceled.'))
    }).then(h => (handle = h))
  })
  done.catch(() => {}) // observed below; avoids an unhandled rejection if it settles early
  try {
    try {
      await BarcodeScanner.installGoogleBarcodeScannerModule() // only STARTS the install
    } catch (e) {
      if (/already installed/i.test(message(e))) return
      throw e
    }
    await done
  } finally {
    clearTimeout(timer)
    await handle?.remove().catch(() => {})
  }
}

export async function scanBarcodeNative(onState?: (s: 'checking' | 'installing') => void): Promise<NativeScanResult> {
  try {
    await ensureScannerModule(onState)
  } catch (e) {
    return { kind: 'unavailable', reason: message(e) }
  }
  try {
    const { barcodes } = await BarcodeScanner.scan({
      formats: [BarcodeFormat.Ean13, BarcodeFormat.Ean8, BarcodeFormat.UpcA],
    })
    const b = barcodes[0]
    const code = b?.rawValue ?? b?.displayValue
    if (!code) return { kind: 'canceled' }
    return { kind: 'code', code, format: String(b.format) }
  } catch (e) {
    // The plugin rejects "scan canceled." when the user backs out of the scanner.
    if (/^scan canceled/i.test(message(e))) return { kind: 'canceled' }
    return { kind: 'unavailable', reason: message(e) }
  }
}
