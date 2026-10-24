import { describe, it, expect } from 'vitest'
import { isLocalBaseUrl, usesServerFallback } from './provider'

describe('isLocalBaseUrl', () => {
  it.each([
    'http://localhost:11434/v1',
    'http://LOCALHOST:1234/v1',
    'http://gpu.localhost/v1',
    'http://mybox.local:11434/v1',
    'http://127.0.0.1:11434/v1',
    'http://127.1.2.3/v1',
    'http://0.0.0.0:8080/v1',
    'http://10.0.0.5:11434/v1',
    'http://172.16.0.1/v1',
    'http://172.31.255.254/v1',
    'http://192.168.1.20:1234/v1',
    'http://[::1]:11434/v1',
    'http://[fd12::1]/v1',
    'http://[fc00:1::2]/v1',
    'http://[fe80::1]/v1',
    '  http://localhost:11434/v1  ',
  ])('is true for %s', url => expect(isLocalBaseUrl(url)).toBe(true))

  it.each([
    'https://api.openai.com/v1',
    'https://openrouter.ai/api/v1',
    'https://10.example.com/v1',
    'https://192.168.evil.com/v1',
    'https://127.attacker.net/v1',
    'https://172.20.foo.com/v1',
    'http://172.15.0.1/v1',
    'http://172.32.0.1/v1',
    'http://11.0.0.1/v1',
    'http://[2001:db8::1]/v1',
    'http://[fd::1]/v1',
    'https://notlocalhost.com/v1',
    '',
    'not a url',
    'localhost:11434',
  ])('is false for %s', url => expect(isLocalBaseUrl(url)).toBe(false))
})

describe('usesServerFallback', () => {
  it('is true only for the Claude models with the server-side refusal fallback', () => {
    expect(usesServerFallback('claude-opus-5-5')).toBe(true)
    expect(usesServerFallback('claude-haiku-5-5')).toBe(false)
    expect(usesServerFallback('gpt-4o-mini')).toBe(false)
  })
})
