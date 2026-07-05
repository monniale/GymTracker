import { useEffect, useRef, useState } from 'react'
import { Flashlight, Keyboard, Loader2 } from 'lucide-react'
import Sheet from './Sheet'
import { createDetector, prepareScanner, validEan } from '../lib/scanner'
import { lookupBarcode, type OffProduct } from '../lib/off'
import { beep } from '../lib/audio'

type Mode = 'starting' | 'scanning' | 'lookup' | 'manual'

interface Props {
  open: boolean
  onClose: () => void
  onProduct: (p: OffProduct) => void
}

/**
 * Camera EAN scanner with manual-entry fallback. iOS quirks handled per the
 * platform brief: `ideal` facingMode (never `exact`), stream restart on
 * foreground (iOS kills tracks on backgrounding), permission prompt appears
 * roughly once per launch in standalone mode, playsInline+muted required.
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

  async function accept(code: string) {
    stopStream()
    setMode('lookup')
    setError(null)
    try {
      const product = await lookupBarcode(code)
      if (product) {
        onProduct(product)
        return
      }
      setError(`No product found for ${code}. Check the number or add it as a custom food.`)
      setManualCode(code)
      setMode('manual')
    } catch {
      setError('Food database unreachable — check your connection.')
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
    prepareScanner()
    setMode('starting')
    setError(null)
    lastCode.current = null

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setMode('manual')
        setError('Camera not available here — type the barcode instead.')
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
            ? 'Camera permission denied — type the barcode below. (iOS asks again after you close and reopen the app.)'
            : 'Camera unavailable — type the barcode below.',
        )
      }
    }

    void start()
    const onVisibility = () => {
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
  }, [open])

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
    <Sheet open={open} onClose={onClose} title="Scan barcode">
      {(mode === 'starting' || mode === 'scanning') && (
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
              aria-label="Toggle flashlight"
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
          Hold the barcode ~10–15 cm from the camera.
        </p>
      )}
      {mode === 'lookup' && (
        <div className="flex items-center justify-center gap-2 py-10 text-sub">
          <Loader2 size={20} className="animate-spin" /> Looking up product…
        </div>
      )}

      {mode !== 'manual' && mode !== 'lookup' && (
        <button
          onClick={() => {
            stopStream()
            setMode('manual')
          }}
          className="mt-3 flex w-full items-center justify-center gap-2 py-2 text-sm font-medium text-sub active:text-ink"
        >
          <Keyboard size={16} /> Type the barcode instead
        </button>
      )}

      {mode === 'manual' && (
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-sub">
              Barcode number (EAN-8 / EAN-13)
            </span>
            <input
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={13}
              value={manualCode}
              onChange={e => setManualCode(e.target.value.replace(/\D/g, ''))}
              placeholder="e.g. 3017620422003"
              className="num min-h-[48px] w-full rounded-xl bg-card px-3 text-base"
              autoFocus
            />
          </label>
          {manualCode.length >= 8 && !manualValid && (
            <p className="text-xs text-danger">Not a valid EAN checksum — double-check the digits.</p>
          )}
          <button
            onClick={() => accept(manualCode.trim())}
            disabled={!manualValid}
            className="w-full rounded-2xl bg-primary py-3.5 font-display text-lg font-bold text-bg active:opacity-90 disabled:opacity-40"
          >
            Look up
          </button>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-sub">{error}</p>}
    </Sheet>
  )
}
