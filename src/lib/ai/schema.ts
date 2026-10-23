import type { JsonSchema } from './provider'

/**
 * Conversions from the shared JSON Schemas (schemas.ts) to what each API accepts.
 * Every conversion returns a new object and keeps key order, so a request body
 * serializes the same way every time.
 */

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Gemini `responseSchema` (OpenAPI subset): drops `additionalProperties` and
 * `$schema`, and turns a `[T, 'null']` type into `T` + `nullable: true`.
 * The shared schemas already sit inside the subset, so for them this is a deep copy.
 */
export function toGeminiSchema(s: JsonSchema): unknown {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(s)) {
    if (k === 'additionalProperties' || k === '$schema') continue
    if (k === 'type' && Array.isArray(v)) {
      const types = v.filter(t => t !== 'null')
      out.type = types.length === 1 ? types[0] : types
      if (types.length < v.length) out.nullable = true
    } else if (k === 'properties' && isObject(v)) {
      out.properties = Object.fromEntries(
        Object.entries(v).map(([name, p]) => [name, toGeminiSchema(p as JsonSchema)]),
      )
    } else if (k === 'items' && isObject(v)) {
      out.items = toGeminiSchema(v as JsonSchema)
    } else {
      out[k] = Array.isArray(v) ? [...v] : v
    }
  }
  return out
}

/** String formats OpenAI structured outputs accept; any other `format` is dropped. */
const STRICT_STRING_FORMATS = new Set([
  'date-time', 'time', 'date', 'duration', 'email', 'hostname', 'ipv4', 'ipv6', 'uuid',
])

/** Validation keywords strict mode may reject; the parsers clamp values anyway. */
const STRIPPED = new Set(['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'nullable', '$schema'])

/**
 * Strict structured-output schema (OpenAI `strict: true`): every object gets
 * `additionalProperties: false` and lists every property in `required`; a
 * property that was optional becomes nullable (`type: [T, 'null']`, `null` added
 * to its enum). The parsers already treat a non-string or null field as absent.
 */
export function toStrictSchema(s: JsonSchema): JsonSchema {
  const out: JsonSchema = {}
  for (const [k, v] of Object.entries(s)) {
    if (STRIPPED.has(k)) continue
    if (k === 'format' && !(typeof v === 'string' && STRICT_STRING_FORMATS.has(v))) continue
    if (k === 'properties' || k === 'required' || k === 'additionalProperties') continue
    if (k === 'items' && isObject(v)) out.items = toStrictSchema(v as JsonSchema)
    else if ((k === 'anyOf' || k === 'oneOf') && Array.isArray(v)) out.anyOf = v.map(x => toStrictSchema(x as JsonSchema))
    else if (k === 'type' && Array.isArray(v)) out.type = [...v]
    else out[k] = Array.isArray(v) ? [...v] : v
  }
  if (s.nullable === true) makeNullable(out)
  const isObj = s.type === 'object' || (Array.isArray(s.type) && s.type.includes('object')) || isObject(s.properties)
  if (isObj) {
    const props = s.properties ?? {}
    const required = new Set(s.required ?? [])
    out.properties = Object.fromEntries(Object.entries(props).map(([name, p]) => {
      const strict = toStrictSchema(p)
      if (!required.has(name)) makeNullable(strict)
      return [name, strict]
    }))
    out.required = Object.keys(props)
    out.additionalProperties = false
  }
  return out
}

/** Lets a strict schema accept `null` too. */
function makeNullable(s: JsonSchema): void {
  if (typeof s.type === 'string') s.type = s.type === 'null' ? 'null' : [s.type, 'null']
  else if (Array.isArray(s.type)) { if (!s.type.includes('null')) s.type = [...s.type, 'null'] }
  else {
    // No type (e.g. anyOf): wrap it so null is one of the options.
    const inner = { ...s }
    for (const k of Object.keys(s)) delete s[k]
    s.anyOf = [inner, { type: 'null' }]
    return
  }
  if (Array.isArray(s.enum) && !s.enum.includes(null as unknown as string)) {
    s.enum = [...s.enum, null] as unknown as (string | number)[]
  }
}

/** One prompt line asking for JSON matching `s`, for servers without schema support. */
export function schemaPromptLine(s: JsonSchema): string {
  return `Reply with ONLY one JSON object (no prose, no code fences) that matches this JSON Schema: ${JSON.stringify(s)}`
}
