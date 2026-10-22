#!/usr/bin/env node
// Builds public/exercise-library.json from hasaneyldrm/exercises-dataset (data: MIT).
//
//   gh api repos/hasaneyldrm/exercises-dataset/commits/main --jq .sha      # pick a commit
//   curl -sfLo /tmp/exercises.json https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/<sha>/data/exercises.json
//   node scripts/build-exercise-library.mjs /tmp/exercises.json <sha>
//
// Keeps only what the app shows: name, body part, equipment, target + secondary muscles, the
// English and Italian steps and the media file stem. The media (GIFs, thumbnails) is © Gym visual
// and is never copied into the repo; the app can load it from the dataset repo at the pinned
// commit, only when the user turns on "Exercise animations" (Settings).
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const [src, sha] = process.argv.slice(2)
if (!src || !/^[0-9a-f]{40}$/.test(sha ?? '')) {
  console.error('usage: node scripts/build-exercise-library.mjs <exercises.json> <40-char commit sha>')
  process.exit(1)
}

const LICENSE = `MIT License

Copyright (c) 2026 Hasan Emir Yıldırım

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation and data files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`

const rows = JSON.parse(readFileSync(src, 'utf8'))

/** "barbell bench press" → "Barbell Bench Press"; fixes the dataset's "45в°" mojibake. */
function titleCase(name) {
  return name
    .replace(/в°/g, '°')
    .replace(/(^|[\s(/-])([a-z])/g, (_, sep, c) => sep + c.toUpperCase())
    .replace(/\bV\. (\d)/g, 'v. $1')
    .replace(/\bEz\b/g, 'EZ')
}

const clean = steps => (steps ?? []).map(s => String(s).trim()).filter(Boolean)

const seen = new Map()
const exercises = rows
  .slice()
  .sort((a, b) => a.id.localeCompare(b.id))
  .map(r => {
    let name = titleCase(r.name.trim())
    // Six names appear twice (different media/instructions): number the later one.
    const n = (seen.get(name) ?? 0) + 1
    seen.set(name, n)
    if (n > 1) name = `${name} (${n})`
    return [
      r.id,
      name,
      r.body_part,
      r.equipment,
      r.target,
      [...new Set(r.secondary_muscles ?? [])],
      clean(r.instruction_steps?.en),
      clean(r.instruction_steps?.it),
      `${r.id}-${r.media_id}`,
    ]
  })

const out = {
  source: `https://github.com/hasaneyldrm/exercises-dataset/tree/${sha}`,
  license: LICENSE,
  media: {
    base: `https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/${sha}/`,
    attribution: '© Gym visual — https://gymvisual.com/',
  },
  fields: ['id', 'name', 'bodyPart', 'equipment', 'target', 'secondary', 'stepsEn', 'stepsIt', 'media'],
  exercises,
}

const dest = fileURLToPath(new URL('../public/exercise-library.json', import.meta.url))
writeFileSync(dest, JSON.stringify(out) + '\n')
console.log(`${exercises.length} exercises → ${dest}`)
