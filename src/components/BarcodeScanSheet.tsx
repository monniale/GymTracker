import { useEffect, useRef, useState } from 'react'
import { Flashlight, Keyboard, Loader2, ScanBarcode } from 'lucide-react'
import Sheet from './Sheet'
import { createDetector, prepareScanner } from '../lib/scanner'
import { normalizeScannedEan, validEan } from '../lib/ean'
import { lookupBarcodeChained } from '../lib/foodProviders'
import { beep } from '../lib/audio'
import { isNative } from '../native/platform'
import { haptic } from '../native/haptics'
import { t } from '../i18n'
import type { RemoteFood } from '../types'

type Mode = 'starting' | 'scanning' | 'lookup' | 'manual'

interface Props {
  open: boolean
  onClose: () => void
  onProduct: (p: RemoteFood) => void
}

/**
 * Camera EAN scanner with manual-entry fallback. iOS quirks handled per the
 * platform brief: `ideal` facingMode (never `exact`), stream restart on
 * foreground (iOS kills tracks on backgrounding), permission prompt appears
 * roughly once per launch in standalone mode, playsInline+muted required.
 * Android app: the Google code scanner (ML Kit, src/native/barcode.ts) first;
 * the zxing camera path is the fallback when it is unavailable.
 */
export default function BarcodeScanSheet({ open, onClose, onProduct }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const lastCode = useRef<string | null>(null)
  const [mode, setMode] = useState<Mode>('starting')
  const [error, setError] = useState<string | null>(null)
  const [torchOn, setTorchOn] = useState(false)
  const [hasTorch, setHasTorch] = useState(false)
  const [manualCode, setManualCode] = useState('')
  // Android: ML Kit engine until it proves unavailable (then zxing for this sheet's lifetime).
  const fallbackRef = useRef(false)
  const [webFallback, setWebFallback] = useState(false)
  const nativeEngine = isNative && !webFallback
  const nativeAbandoned = useRef(false) // "Type the barcode instead" while the scanner was starting
  const [installing, setInstalling] = useState(false)
  const [attempt, setAttempt] = useState(0) // "Scan again" re-runs the open effect

  async function accept(code: string) {
    stopStream()
    setMode('lookup')
    setError(null)
    try {
      const product = await lookupBarcodeChained(code)
      if (product) {
        onProduct(product)
        return
      }
      setError(t('components.barcode.notFound', { code }))
      setManualCode(code)
      setMode('manual')
    } catch {
      setError(t('components.barcode.unreachable'))
      setManualCode(code)
      setMode('manual')
    }
  }

  function stopStream() {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }

  useEffect(() => {
    if (!open) return
    let cancelled = false
    let interval: ReturnType<typeof setInterval> | undefined
    if (!isNative || fallbackRef.current) prepareScanner()
    setMode('starting')
    setError(null)
    lastCode.current = null
    nativeAbandoned.current = false

    /** true = handled by the native scanner; false = fall through to the zxing path. */
    async function startNative(): Promise<boolean> {
      if (!isNative) return false // compile-time dead on the web: keeps the plugin chunk out of dist/
      const { scanBarcodeNative } = await import('../native/barcode')
      const r = await scanBarcodeNative(s => {
        if (!cancelled) setInstalling(s === 'installing')
      })
      if (cancelled || nativeAbandoned.current) return true
      setInstalling(false)
      if (r.kind === 'canceled') {
        setMode('manual') // offers "Scan again" + typing the number
        return true
      }
      if (r.kind === 'code') {
        haptic('scan')
        const ean = normalizeScannedEan(r.code)
        if (ean) {
          void accept(ean)
        } else {
          setManualCode(r.code.replace(/\D/g, '').slice(0, 13))
          setError(t('components.barcode.unrecognised'))
          setMode('manual')
        }
        return true
      }
      console.warn('[scanner] native scanner unavailable, using the camera fallback:', r.reason)
      fallbackRef.current = true
      setWebFallback(true)
      prepareScanner()
      // Let the <video> element of the camera view mount before the stream is attached.
      for (let i = 0; !videoRef.current && i < 20 && !cancelled; i++) await new Promise(res => setTimeout(res, 50))
      return false
    }

    async function start() {
      if (isNative && !fallbackRef.current && (await startNative())) return
      if (cancelled) return
      if (!navigator.mediaDevices?.getUserMedia) {
        setMode('manual')
        setError(t('components.barcode.noCamera'))
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        })
        if (cancelled) {
          stream.getTracks().forEach(t => t.stop())
          return
        }
        streamRef.current = stream
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play().catch(() => {})
        setMode('scanning')

        const track = stream.getVideoTracks()[0]
        const caps = track.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean }
        setHasTorch(!!caps?.torch)
        track.addEventListener('ended', () => {
          if (!cancelled && document.visibilityState === 'visible') void start()
        })

        const detector = createDetector()
        let busy = false
        interval = setInterval(async () => {
          if (busy || cancelled || !video || video.readyState < 2) return
          busy = true
          try {
            const results = await detector.detect(video)
            const code = results[0]?.rawValue
            if (code) {
              // Require two consecutive identical reads to kill misreads.
              if (lastCode.current === code) {
                clearInterval(interval)
                beep(1)
                void accept(code)
              } else {
                lastCode.current = code
              }
            }
          } catch {
            // Detector hiccup on a frame — keep scanning.
          }
          busy = false
        }, 150)
      } catch (e) {
        if (cancelled) return
        const name = (e as Error).name
        setMode('manual')
        setError(
          name === 'NotAllowedError'
            ? isNative
              ? t('components.barcode.denied')
              : t('components.barcode.deniedIos')
            : t('components.barcode.unavailable'),
        )
      }
    }

    void start()
    const onVisibility = () => {
      if (isNative && !fallbackRef.current) return // the ML Kit scanner is its own activity
      if (document.visibilityState === 'hidden') stopStream()
      else if (!cancelled) void start()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      if (interval) clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
      stopStream()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, attempt])

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    const next = !torchOn
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] })
      setTorchOn(next)
    } catch {
      setHasTorch(false)
    }
  }

  const manualValid = validEan(manualCode.trim())

  return (
    <Sheet open={open} onClose={onClose} title={t('components.barcode.title')}>
      {nativeEngine && mode === 'starting' && (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-sub">
          <Loader2 size={24} className="animate-spin" />
          <p className="text-sm">{installing ? t('components.barcode.installing') : t('components.barcode.opening')}</p>
        </div>
      )}
      {!nativeEngine && (mode === 'starting' || mode === 'scanning') && (
        <div className="relative overflow-hidden rounded-2xl bg-black">
          <video ref={videoRef} playsInline muted autoPlay className="h-64 w-full object-cover" />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-24 w-64 rounded-lg border-2 border-primary/80" />
          </div>
          {mode === 'starting' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
              <Loader2 size={28} className="animate-spin text-sub" />
            </div>
          )}
          {hasTorch && (
            <button
              onClick={toggleTorch}
              aria-label={t('components.barcode.torch')}
              aria-pressed={torchOn}
              className={`absolute bottom-3 right-3 flex h-11 w-11 items-center justify-center rounded-full ${
                torchOn ? 'bg-primary text-bg' : 'bg-black/60 text-ink'
              }`}
            >
              <Flashlight size={20} />
            </button>
          )}
        </div>
      )}
      {mode === 'scanning' && (
        <p className="mt-2 text-center text-xs text-sub">
          {t('components.barcode.hold')}
        </p>
      )}
      {mode === 'lookup' && (
        <div className="flex items-center justify-center gap-2 py-10 text-sub">
          <Loader2 size={20} className="animate-spin" /> {t('components.barcode.lookingUp')}
        </div>
      )}

      {mode !== 'manual' && mode !== 'lookup' && (
        <button
          onClick={() => {
            nativeAbandoned.current = true
            setInstalling(false)
            stopStream()
            setMode('manual')
          }}
          className="mt-3 flex w-full items-center justify-center gap-2 py-2 text-sm font-medium text-sub active:text-ink"
        >
          <Keyboard size={16} /> {t('components.barcode.typeInstead')}
        </button>
      )}

      {mode === 'manual' && nativeEngine && (
        <button
          onClick={() => setAttempt(a => a + 1)}
          className="mb-3 flex min-h-[48px] w-full items-center justify-center gap-2 whitespace-nowrap rounded-2xl bg-primary/15 font-display text-lg font-bold text-primary active:bg-primary/30"
        >
          <ScanBarcode size={20} /> {t('components.barcode.scanAgain')}
        </button>
      )}

      {mode === 'manual' && (
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-sub">
              {t('components.barcode.number')}
            </span>
            <input
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={13}
              value={manualCode}
              onChange={e => setManualCode(e.target.value.replace(/\D/g, ''))}
              placeholder={t('components.barcode.example')}
              className="num min-h-[48px] w-full rounded-xl bg-card px-3 text-base"
              autoFocus={!nativeEngine}
            />
          </label>
          {manualCode.length >= 8 && !manualValid && (
            <p className="text-xs text-danger">{t('components.barcode.badChecksum')}</p>
          )}
          <button
            onClick={() => accept(manualCode.trim())}
            disabled={!manualValid}
            className="w-full rounded-2xl bg-primary py-3.5 font-display text-lg font-bold text-bg active:opacity-90 disabled:opacity-40"
          >
            {t('components.barcode.lookUp')}
          </button>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-sub">{error}</p>}
    </Sheet>
  )
}
