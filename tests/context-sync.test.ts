import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IssueComment } from '../src/shared/types'
import type { IssueSession } from '../src/main/store'

const github = vi.hoisted(() => ({
  issue: {} as Record<string, unknown>,
  comments: [] as IssueComment[],
  fetchIssue: vi.fn(),
  fetchComments: vi.fn(),
}))

vi.mock('../src/main/github/issues', () => ({
  fetchIssue: github.fetchIssue,
  fetchComments: github.fetchComments,
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
