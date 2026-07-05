/**
 * Web Audio beep for the rest timer. iOS Safari only allows audio after a user
 * gesture, so unlockAudio() must be called from a tap handler (Start workout,
 * the sound toggle) before beep() can make noise.
 */

type AudioCtor = typeof AudioContext
let ctx: AudioContext | null = null

function getCtx(): AudioContext | null {
  if (ctx) return ctx
  const Ctor: AudioCtor | undefined =
    window.AudioContext ?? (window as { webkitAudioContext?: AudioCtor }).webkitAudioContext
  if (!Ctor) return null
  ctx = new Ctor()
  return ctx
}

export function unlockAudio(): void {
  const c = getCtx()
  if (!c) return
  if (c.state === 'suspended') void c.resume()
  // Play one silent sample to satisfy the iOS gesture requirement.
  const buf = c.createBuffer(1, 1, 22050)
  const src = c.createBufferSource()
  src.buffer = buf
  src.connect(c.destination)
  src.start(0)
}

export function beep(pulses = 3): void {
  const c = getCtx()
  if (!c) return
  if (c.state === 'suspended') void c.resume()
  const t0 = c.currentTime + 0.02
  for (let i = 0; i < pulses; i++) {
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.type = 'sine'
    osc.frequency.value = 880
    const start = t0 + i * 0.25
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(0.5, start + 0.01)
    gain.gain.setValueAtTime(0.5, start + 0.12)
    gain.gain.linearRampToValueAtTime(0, start + 0.16)
    osc.connect(gain)
    gain.connect(c.destination)
    osc.start(start)
    osc.stop(start + 0.18)
  }
}
