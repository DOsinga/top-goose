import { describe, expect, it } from 'vitest'
import type { IssueDetail } from '../src/shared/types'
import {
  insertMention,
  matchingMentions,
  mentionAtCursor,
  mentionCandidates,
} from '../src/renderer/src/mentions'

function issue(): IssueDetail {
  return {
    repo: 'owner/repo',
    issueNumber: 1,
    nodeId: 'issue',
    title: 'Issue',
    state: 'open',
    author: 'outside-author',
    assignees: ['DOsinga', 'outside-assignee'],
    labels: [],
    body: '',
    bodyUpdatedAt: '2026-01-01T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    comments: [
      {
        id: 1,
        nodeId: 'comment',
        author: 'Outside-Author',
        body: '',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 2,
        nodeId: 'comment-2',
        author: 'commenter',
        body: '',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ],
    linkedPullRequests: [],
    availableStatuses: [],
  }
}

describe('mention candidates', () => {
  it('combines the core team and conversation participants without duplicates', () => {
    const candidates = mentionCandidates(issue())

    expect(candidates.find((candidate) => candidate.login === 'DOsinga')?.core).toBe(true)
    expect(candidates.filter((candidate) => candidate.login.toLowerCase() === 'outside-author')).toHaveLength(1)
    expect(candidates.find((candidate) => candidate.login === 'outside-assignee')?.core).toBe(false)
    expect(candidates.find((candidate) => candidate.login === 'commenter')?.core).toBe(false)
  })

  it('matches names and GitHub logins', () => {
    const candidates = mentionCandidates(issue())

    expect(matchingMentions(candidates, 'douwe').map((candidate) => candidate.login)).toContain('DOsinga')
    expect(matchingMentions(candidates, 'comment').map((candidate) => candidate.login)).toEqual(['commenter'])
  })
})

describe('mention editing', () => {
  it('finds a mention at the cursor but ignores email addresses', () => {
    expect(mentionAtCursor('hello @dou', 10)).toEqual({ start: 6, end: 10, query: 'dou' })
    expect(mentionAtCursor('mail@example', 12)).toBeNull()
  })

  it('replaces the active query with a GitHub login', () => {
    const range = mentionAtCursor('hello @dou', 10)!
    expect(insertMention('hello @dou', range, 'DOsinga')).toEqual({
      text: 'hello @DOsinga ',
      cursor: 15,
    })
  })
})
