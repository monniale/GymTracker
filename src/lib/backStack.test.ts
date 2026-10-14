import { describe, it, expect, beforeEach, vi } from 'vitest'
import { pushBack, popBack, backDepth } from './backStack'

describe('backStack', () => {
  beforeEach(() => {
    while (popBack()) {
      // drain whatever a previous test left behind
    }
  })

  it('pops in LIFO order', () => {
    const calls: string[] = []
    pushBack(() => calls.push('a'))
    pushBack(() => calls.push('b'))
    pushBack(() => calls.push('c'))
    expect(backDepth()).toBe(3)
    expect(popBack()).toBe(true)
    expect(popBack()).toBe(true)
    expect(calls).toEqual(['c', 'b'])
    expect(backDepth()).toBe(1)
  })

  it('returns false when empty and calls nothing', () => {
    expect(backDepth()).toBe(0)
    expect(popBack()).toBe(false)
  })

  it('unregistering a middle entry keeps the others in order', () => {
    const calls: string[] = []
    pushBack(() => calls.push('a'))
    const offB = pushBack(() => calls.push('b'))
    pushBack(() => calls.push('c'))
    offB()
    expect(backDepth()).toBe(2)
    popBack()
    popBack()
    expect(calls).toEqual(['c', 'a'])
  })

  it('invokes the closer exactly once per pop; a later unregister is a no-op', () => {
    const a = vi.fn()
    const b = vi.fn()
    pushBack(a)
    const offB = pushBack(b)
    expect(popBack()).toBe(true)
    // The sheet's effect cleanup runs after it closed: must not remove the sheet below it.
    offB()
    offB()
    expect(b).toHaveBeenCalledTimes(1)
    expect(a).not.toHaveBeenCalled()
    expect(backDepth()).toBe(1)
    expect(popBack()).toBe(true)
    expect(a).toHaveBeenCalledTimes(1)
    expect(popBack()).toBe(false)
  })

  it('the same closer registered twice is two independent entries', () => {
    const close = vi.fn()
    const off1 = pushBack(close)
    pushBack(close)
    off1()
    expect(backDepth()).toBe(1)
    popBack()
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('a throwing closer still counts as handled and is removed', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    pushBack(() => {
      throw new Error('boom')
    })
    expect(popBack()).toBe(true)
    expect(backDepth()).toBe(0)
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
})
