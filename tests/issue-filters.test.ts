import { describe, expect, it } from 'vitest'
import { isUnreplied } from '../src/shared/issueFilters'
import type { CachedRow } from '../src/shared/types'

function issue(overrides: Partial<CachedRow> = {}): CachedRow {
  return {
    kind: 'issue',
    repo: 'owner/repo',
    issueNumber: 1,
    nodeId: 'issue-1',
    title: 'Issue',
    author: 'contributor',
    assignees: [],
    viewerCommented: false,
    state: 'open',
    commentCount: 0,
    updatedAt: '2026-01-01T00:00:00Z',
    hydratedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('unreplied issue filter', () => {
  it('includes a conversation the user joined when someone else spoke last', () => {
    expect(
      isUnreplied(
        issue({
          viewerCommented: true,
          lastComment: { author: 'contributor', snippet: 'Any update?' },
        }),
        'dosinga',
      ),
    ).toBe(true)
  })

  it('excludes issues where the user never participated', () => {
    expect(
      isUnreplied(
        issue({
          assignees: ['DOsinga'],
          viewerCommented: false,
          lastComment: { author: 'contributor', snippet: 'Any update?' },
        }),
        'DOsinga',
      ),
    ).toBe(false)
  })

  it('excludes conversations where the user spoke last', () => {
    expect(
      isUnreplied(
        issue({
          viewerCommented: true,
          lastComment: { author: 'DOsinga', snippet: 'I will take a look.' },
        }),
        'DOsinga',
      ),
    ).toBe(false)
  })

  it('uses the issue author as the latest voice when there are no comments', () => {
    expect(isUnreplied(issue({ author: 'DOsinga' }), 'DOsinga')).toBe(false)
    expect(isUnreplied(issue({ author: 'contributor' }), 'DOsinga')).toBe(false)
  })
})
