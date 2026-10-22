/**
 * Minimal RFC 4180 CSV reader for workout-history imports: quoted fields, `""`
 * escapes, delimiters and newlines inside quotes, CRLF/LF line ends and a UTF-8
 * BOM. Strong exports use `;` in locales with a decimal comma, so the
 * delimiter is detected from the header line.
 */

export type CsvDelimiter = ',' | ';'

/** `,` or `;`, whichever appears more often outside quotes in the first line. */
export function detectDelimiter(text: string): CsvDelimiter {
  let commas = 0
  let semis = 0
  let quoted = false
  for (const ch of text.replace(/^﻿/, '')) {
    if (ch === '"') quoted = !quoted
    else if (!quoted && (ch === '\n' || ch === '\r')) break
    else if (!quoted && ch === ',') commas++
    else if (!quoted && ch === ';') semis++
  }
  return semis > commas ? ';' : ','
}

/** Rows of fields. Blank lines are dropped; fields are not trimmed. */
export function parseCsv(text: string, delimiter: CsvDelimiter = detectDelimiter(text)): string[][] {
  const src = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let i = 0

  const endRow = () => {
    row.push(field)
    field = ''
    if (row.length > 1 || row[0] !== '') rows.push(row)
    row = []
  }

  while (i < src.length) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        quoted = false
      } else {
        field += ch
      }
      i++
      continue
    }
    if (ch === '"' && field === '') {
      quoted = true
    } else if (ch === delimiter) {
      row.push(field)
      field = ''
    } else if (ch === '\r') {
      endRow()
      if (src[i + 1] === '\n') i++
    } else if (ch === '\n') {
      endRow()
    } else {
      field += ch
    }
    i++
  }
  if (field !== '' || row.length > 0) endRow()
  return rows
}
