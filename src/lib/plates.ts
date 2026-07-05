export const DEFAULT_BAR_KG = 20
export const DEFAULT_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25]

/**
 * Greedy plate loading for one side of the bar.
 * Returns the plate list and any unloadable remainder (0 when exact).
 */
export function platesPerSide(
  targetKg: number,
  barKg = DEFAULT_BAR_KG,
  available = DEFAULT_PLATES,
): { plates: number[]; remainder: number } | null {
  if (targetKg <= barKg) return null
  let perSide = (targetKg - barKg) / 2
  const plates: number[] = []
  for (const p of [...available].sort((a, b) => b - a)) {
    while (perSide >= p - 1e-9) {
      plates.push(p)
      perSide = Math.round((perSide - p) * 1000) / 1000
    }
  }
  return { plates, remainder: perSide }
}

export function formatPlates(result: { plates: number[]; remainder: number }): string {
  const s = result.plates.length > 0 ? result.plates.join(' · ') : 'empty bar'
  return result.remainder > 0 ? `${s} (+${result.remainder * 2} kg unloadable)` : s
}

/**
 * Warm-up ramp toward a working weight: bar×10, 40%×5, 60%×3, 80%×1,
 * rounded to 2.5, deduped, only steps above the bar and below the work weight.
 */
export function warmupRamp(
  workingKg: number,
  barKg = DEFAULT_BAR_KG,
): { weightKg: number; reps: number }[] {
  if (workingKg < barKg * 1.5) return workingKg >= barKg ? [{ weightKg: barKg, reps: 10 }] : []
  const steps = [
    { pct: 0.4, reps: 5 },
    { pct: 0.6, reps: 3 },
    { pct: 0.8, reps: 1 },
  ]
  const ramp = [{ weightKg: barKg, reps: 10 }]
  for (const { pct, reps } of steps) {
    const w = Math.round((workingKg * pct) / 2.5) * 2.5
    if (w > barKg && w < workingKg && !ramp.some(r => r.weightKg === w)) {
      ramp.push({ weightKg: w, reps })
    }
  }
  return ramp
}
