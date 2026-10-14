import { describe, it, expect } from 'vitest'
import { validEan, normalizeScannedEan } from './ean'

describe('validEan', () => {
  it('accepts valid EAN-13 and EAN-8 checksums', () => {
    expect(validEan('3017620422003')).toBe(true)
    expect(validEan('4006381333931')).toBe(true)
    expect(validEan('96385074')).toBe(true)
  })

  it('rejects bad checksums and wrong lengths', () => {
    expect(validEan('3017620422004')).toBe(false)
    expect(validEan('96385075')).toBe(false)
    expect(validEan('036000291452')).toBe(false) // 12 digits: UPC-A must be normalized first
    expect(validEan('')).toBe(false)
    expect(validEan('30176204220031')).toBe(false)
  })
})

describe('normalizeScannedEan', () => {
  it('pads a 12-digit UPC-A to EAN-13', () => {
    expect(normalizeScannedEan('036000291452')).toBe('0036000291452')
  })

  it('passes a valid 13-digit and 8-digit code through', () => {
    expect(normalizeScannedEan('3017620422003')).toBe('3017620422003')
    expect(normalizeScannedEan('96385074')).toBe('96385074')
  })

  it('returns null on a bad checksum', () => {
    expect(normalizeScannedEan('3017620422004')).toBeNull()
    expect(normalizeScannedEan('036000291453')).toBeNull()
  })

  it('strips whitespace and non-digits', () => {
    expect(normalizeScannedEan(' 3017620422003\n')).toBe('3017620422003')
    expect(normalizeScannedEan('0 36000-29145 2')).toBe('0036000291452')
  })

  it('rejects empty and wrong-length input', () => {
    expect(normalizeScannedEan('')).toBeNull()
    expect(normalizeScannedEan('abc')).toBeNull()
    expect(normalizeScannedEan('12345')).toBeNull()
  })
})
