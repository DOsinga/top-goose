import { describe, expect, it } from 'vitest'
import { isUnsolicitedPullRequest } from '../src/shared/pullRequestFilters'
import type { CachedRow } from '../src/shared/types'

function pullRequest(overrides: Partial<CachedRow> = {}): CachedRow {
  return {
    kind: 'pullRequest',
    repo: 'owner/repo',
    issueNumber: 1,
    nodeId: 'PR_1',
    title: 'A pull request',
    author: 'external-contributor',
    state: 'open',
    commentCount: 0,
    updatedAt: '2026-01-01T00:00:00Z',
    hydratedAt: '2026-01-01T00:00:00Z',
    isDraft: false,
    linkedIssues: [],
    ...overrides,
  }
}

describe('unsolicited pull requests', () => {
  it('includes external ready pull requests with no issue or an Inbox issue', () => {
    expect(isUnsolicitedPullRequest(pullRequest())).toBe(true)
    expect(
      isUnsolicitedPullRequest(
        pullRequest({ linkedIssues: [{ number: 2, workflowStatus: 'Inbox' }] }),
      ),
    ).toBe(true)
  })

  it('skips core authors, drafts, and pull requests linked only to non-Inbox issues', () => {
    expect(isUnsolicitedPullRequest(pullRequest({ author: 'dosinga' }))).toBe(false)
    expect(isUnsolicitedPullRequest(pullRequest({ isDraft: true }))).toBe(false)
    expect(
      isUnsolicitedPullRequest(
        pullRequest({ linkedIssues: [{ number: 2, workflowStatus: 'Ready' }] }),
      ),
    ).toBe(false)
    expect(
      isUnsolicitedPullRequest(
        pullRequest({ linkedIssues: [{ number: 2 }] }),
      ),
    ).toBe(false)
  })
})
