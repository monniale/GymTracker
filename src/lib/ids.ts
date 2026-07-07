import type { Id } from '../types'

/** Route params carry legacy integer ids and UUID strings alike. */
export function parseRouteId(param: string | undefined): Id {
  if (!param) return ''
  return /^\d+$/.test(param) ? Number(param) : param
}
