/**
 * Pure EAN helpers (no wasm, no DOM) so they are unit-testable and shared by the zxing web
 * scanner (`scanner.ts` re-exports `validEan`) and the Android ML Kit scanner.
 */

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

/**
 * Normalizes a scanned code to a valid EAN-8/EAN-13, or null. Non-digits are stripped and a
 * 12-digit UPC-A gets a leading '0' (UPC-A is EAN-13 with a leading zero; Open Food Facts keys
 * products by the 13-digit form).
 */
export function normalizeScannedEan(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  const code = digits.length === 12 ? `0${digits}` : digits
  return validEan(code) ? code : null
}
