import type { ScoreEvent } from '../types'

/**
 * Stored label of a points adjustment: the score event an admin's edit writes into an account's
 * synced rows (0004_adjust_points.sql `admin_set_points`, which writes this exact string).
 * English like every stored label (invariant 19); shown via `displayEventLabel`.
 */
export const ADJUSTMENT_LABEL = 'Points adjustment'

export function isAdjustment(e: Pick<ScoreEvent, 'sessionId' | 'label'>): boolean {
  return e.sessionId === undefined && e.label === ADJUSTMENT_LABEL
}
