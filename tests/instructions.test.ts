import { describe, expect, it } from 'vitest'
import { sessionInstructions } from '../src/main/goose/instructions'

describe('Goose session instructions', () => {
  it('requires work to finish in the current turn and preserves configured instructions', () => {
    const instructions = sessionInstructions('Global rules', 'Repository rules')

    expect(instructions).toContain('Do not say that you will continue')
    expect(instructions).toContain('If more work can be done without user input, do it now.')
    expect(instructions).toContain('Global rules')
    expect(instructions).toContain('Repository rules')
  })
})
