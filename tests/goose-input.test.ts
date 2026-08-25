import { describe, expect, it } from 'vitest'
import { shouldSubmitGoosePrompt } from '../src/renderer/src/gooseInput'

describe('Goose prompt keyboard shortcut', () => {
  it('submits on Enter', () => {
    expect(shouldSubmitGoosePrompt('Enter', false, false)).toBe(true)
  })

  it('keeps Shift-Enter and composing input in the textarea', () => {
    expect(shouldSubmitGoosePrompt('Enter', true, false)).toBe(false)
    expect(shouldSubmitGoosePrompt('Enter', false, true)).toBe(false)
  })
})
