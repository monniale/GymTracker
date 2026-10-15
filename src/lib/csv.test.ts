import { describe, it, expect } from 'vitest'
import { parseCsv, detectDelimiter } from './csv'

describe('parseCsv', () => {
  it('reads quoted fields, escaped quotes and delimiters inside quotes', () => {
    expect(parseCsv('a,b,c\n"x, y","say ""hi""",3\n')).toEqual([['a', 'b', 'c'], ['x, y', 'say "hi"', '3']])
  })

  it('keeps newlines inside quotes and handles CRLF, a BOM and blank lines', () => {
    const text = '﻿name,notes\r\n"Bench","line 1\r\nline 2"\r\n\r\nSquat,\r\n'
    expect(parseCsv(text)).toEqual([['name', 'notes'], ['Bench', 'line 1\r\nline 2'], ['Squat', '']])
  })

  it('keeps empty fields and a last line without a newline', () => {
    expect(parseCsv('a,,c\n,,')).toEqual([['a', '', 'c'], ['', '', '']])
  })

  it('treats a quote in the middle of a field as text', () => {
    expect(parseCsv('a,b\n5\'10",x')).toEqual([['a', 'b'], ['5\'10"', 'x']])
  })

  it('reads semicolon files with decimal commas', () => {
    const text = 'Date;Weight\n2024-03-12 18:05:00;62,5\n'
    expect(detectDelimiter(text)).toBe(';')
    expect(parseCsv(text)).toEqual([['Date', 'Weight'], ['2024-03-12 18:05:00', '62,5']])
  })

  it('detects the delimiter from the header only, ignoring quoted text', () => {
    expect(detectDelimiter('"a;b;c",d,e\nx;y;z;w')).toBe(',')
    expect(detectDelimiter('a;b,c;d')).toBe(';')
  })
})
