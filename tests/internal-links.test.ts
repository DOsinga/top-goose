import { describe, expect, it } from 'vitest'
import { conversationUrl, shouldNavigateInside } from '../src/renderer/src/internalLinks'

describe('internal conversation links', () => {
  it('builds issue and pull request URLs', () => {
    expect(conversationUrl({ kind: 'issue', repo: 'owner/repo', issueNumber: 12 })).toBe(
      'https://github.com/owner/repo/issues/12',
    )
    expect(conversationUrl({ kind: 'pullRequest', repo: 'owner/repo', issueNumber: 13 })).toBe(
      'https://github.com/owner/repo/pull/13',
    )
  })

  it('leaves modified clicks for the browser', () => {
    expect(shouldNavigateInside({ metaKey: false, ctrlKey: false })).toBe(true)
    expect(shouldNavigateInside({ metaKey: true, ctrlKey: false })).toBe(false)
    expect(shouldNavigateInside({ metaKey: false, ctrlKey: true })).toBe(false)
  })
})
