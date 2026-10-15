import { describe, it, expect } from 'vitest'
import { nextTemplate } from './nextTemplate'

const t = (id: number | string, position: number) => ({ id, position, name: `T${id}` })

describe('nextTemplate', () => {
  const list = [t('c', 2), t('a', 0), t('b', 1)]

  it('rotates after the last finished template, by position', () => {
    expect(nextTemplate(list, { templateId: 'a' })?.id).toBe('b')
    expect(nextTemplate(list, { templateId: 'b' })?.id).toBe('c')
    expect(nextTemplate(list, { templateId: 'c' })?.id).toBe('a') // wraps
  })

  it('starts at the first one after a freestyle, a deleted template or no history', () => {
    expect(nextTemplate(list, { templateId: undefined })?.id).toBe('a')
    expect(nextTemplate(list, { templateId: 'gone' })?.id).toBe('a')
    expect(nextTemplate(list, undefined)?.id).toBe('a')
  })

  it('matches legacy numeric ids and handles no templates', () => {
    expect(nextTemplate([t(1, 0), t(2, 1)], { templateId: 1 })?.id).toBe(2)
    expect(nextTemplate([], { templateId: 1 })).toBeNull()
  })
})
