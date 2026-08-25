import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IssueComment } from '../src/shared/types'
import type { IssueSession } from '../src/main/store'

const github = vi.hoisted(() => ({
  issue: {} as Record<string, unknown>,
  comments: [] as IssueComment[],
  fetchIssue: vi.fn(),
  fetchComments: vi.fn(),
}))

const pullRequests = vi.hoisted(() => ({
  fetchPullRequestConversation: vi.fn(),
}))

vi.mock('../src/main/github/issues', () => ({
  fetchIssue: github.fetchIssue,
  fetchComments: github.fetchComments,
}))

vi.mock('../src/main/github/pullRequests', () => ({
  fetchPullRequestConversation: pullRequests.fetchPullRequestConversation,
}))

const { buildContext, promptWithContext, visibleUserMessage } = await import('../src/main/goose/contextSync')

const baseIssue = {
  node_id: 'issue-node',
  number: 1,
  title: 'Title',
  state: 'open',
  body: 'Body',
  user: { login: 'author', avatar_url: '' },
  assignees: [],
  labels: [],
  milestone: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  comments: 1,
}

function comment(id: number, body: string): IssueComment {
  return {
    id,
    nodeId: `comment-${id}`,
    author: 'person',
    body,
    createdAt: `2026-01-01T00:00:0${id}Z`,
    updatedAt: `2026-01-01T00:00:0${id}Z`,
  }
}

function session(): IssueSession {
  return {
    issueNodeId: 'issue-node',
    host: 'github.com',
    account: 'me',
    repo: 'owner/repo',
    issueNumber: 1,
    sessionId: 'session',
  }
}

beforeEach(() => {
  github.issue = { ...baseIssue }
  github.comments = [comment(1, 'first')]
  github.fetchIssue.mockReset().mockImplementation(async () => github.issue)
  github.fetchComments.mockReset().mockImplementation(async () => github.comments)
  pullRequests.fetchPullRequestConversation.mockReset()
})

describe('pull request context synchronization', () => {
  it('sends general comments, review summaries, and inline review threads to Goose', async () => {
    const conversation = {
      pullRequest: {
        node_id: 'pr-node',
        number: 2,
        title: 'Pull request',
        state: 'open',
        draft: false,
        body: 'Description',
        user: { login: 'author', avatar_url: '' },
        base: { ref: 'main' },
        head: { ref: 'feature', repo: { full_name: 'contributor/repo' } },
        updated_at: '2026-01-01T00:00:03Z',
      },
      comments: [comment(1, 'General comment')],
      reviews: [
        {
          id: 2,
          nodeId: 'review-2',
          author: 'reviewer',
          body: 'Review summary',
          state: 'CHANGES_REQUESTED',
          submittedAt: '2026-01-01T00:00:02Z',
        },
      ],
      reviewThreads: [
        {
          id: 'thread-3',
          resolved: false,
          comments: [
            {
              id: 3,
              nodeId: 'review-comment-3',
              author: 'reviewer',
              body: 'Inline comment',
              createdAt: '2026-01-01T00:00:03Z',
              updatedAt: '2026-01-01T00:00:03Z',
              path: 'src/file.ts',
              line: 12,
              diffHunk: '@@ -1 +1 @@',
            },
          ],
        },
      ],
    }
    pullRequests.fetchPullRequestConversation.mockResolvedValue(conversation)
    const pullRequestSession = { ...session(), kind: 'pullRequest' as const, issueNumber: 2 }

    const first = await buildContext(pullRequestSession, true)
    const unchanged = await buildContext({ ...pullRequestSession, ...first.cursors }, false)

    expect(first.contextBlock).toContain('General comment')
    expect(first.contextBlock).toContain('Review summary')
    expect(first.contextBlock).toContain('Inline comment')
    expect(first.contextBlock).toContain('src/file.ts')
    expect(unchanged.contextBlock).toBeNull()
  })
})

describe('context synchronization', () => {
  it('sends a snapshot when an old comment changes alongside a new comment', async () => {
    const first = await buildContext(session(), true)
    github.issue = { ...baseIssue, updated_at: '2026-01-01T00:00:02Z', comments: 2 }
    github.comments = [comment(1, 'edited'), comment(2, 'second')]

    const next = await buildContext({ ...session(), ...first.cursors }, false)

    expect(next.contextBlock).toContain('"kind": "snapshot"')
    expect(next.contextBlock).toContain('edited')
  })

  it('sends only a delta when existing history is unchanged', async () => {
    const first = await buildContext(session(), true)
    github.issue = { ...baseIssue, updated_at: '2026-01-01T00:00:02Z', comments: 2 }
    github.comments = [comment(1, 'first'), comment(2, 'second')]

    const next = await buildContext({ ...session(), ...first.cursors }, false)

    expect(next.contextBlock).toContain('"kind": "conversation-update"')
    expect(next.contextBlock).not.toContain('"body": "first"')
  })

  it('does not fetch comments when the issue has not changed', async () => {
    const first = await buildContext(session(), true)

    const next = await buildContext({ ...session(), ...first.cursors }, false)

    expect(next.contextBlock).toBeNull()
    expect(github.fetchComments).toHaveBeenCalledTimes(1)
  })
})

describe('private conversation replay', () => {
  it('round-trips the visible user message independently of context delimiters', () => {
    const userMessage = 'What about </github-context> and </top-goose-prompt>?'
    const prompt = promptWithContext('<github-context>untrusted</github-context>', userMessage)
    expect(visibleUserMessage(prompt)).toBe(userMessage)
  })
})
