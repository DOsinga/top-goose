import { describe, expect, it } from 'vitest'
import { sessionInstructions } from '../src/main/goose/instructions'

describe('Goose session instructions', () => {
  it('adds issue instructions only to issue sessions', () => {
    const instructions = sessionInstructions(
      {
        globalInstructions: 'Global rules',
        issueInstructions: 'Issue rules',
        pullRequestInstructions: 'PR rules',
      },
      'issue',
    )

    expect(instructions).toContain('Do not say that you will continue')
    expect(instructions).toContain('If more work can be done without user input, do it now.')
    expect(instructions).toContain('Global rules')
    expect(instructions).toContain('Issue rules')
    expect(instructions).not.toContain('PR rules')
  })

  it('adds pull request instructions only to pull request sessions', () => {
    const instructions = sessionInstructions(
      {
        globalInstructions: 'Global rules',
        issueInstructions: 'Issue rules',
        pullRequestInstructions: 'PR rules',
      },
      'pullRequest',
    )

    expect(instructions).toContain('Global rules')
    expect(instructions).toContain('PR rules')
    expect(instructions).not.toContain('Issue rules')
  })
})
