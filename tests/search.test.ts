import { beforeEach, describe, expect, it, vi } from 'vitest'

const github = vi.hoisted(() => ({ restGet: vi.fn() }))

vi.mock('../src/main/github/client', () => ({ restGet: github.restGet }))

const { searchConversations } = await import('../src/main/github/search')

beforeEach(() => github.restGet.mockReset())

describe('GitHub conversation search', () => {
  it('scopes the query to the configured repo and returns issues and pull requests', async () => {
    github.restGet.mockResolvedValue({
      status: 200,
      data: {
        items: [
          {
            node_id: 'issue-node',
            number: 12,
            title: 'Issue result',
            state: 'closed',
            user: { login: 'issue-author' },
            assignees: [{ login: 'assignee' }],
            comments: 3,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-02T00:00:00Z',
            repository_url: 'https://api.github.com/repos/owner/repo',
          },
          {
            node_id: 'pr-node',
            number: 34,
            title: 'Pull request result',
            state: 'open',
            user: { login: 'pr-author' },
            assignees: [],
            comments: 4,
            created_at: '2026-02-01T00:00:00Z',
            updated_at: '2026-02-02T00:00:00Z',
            repository_url: 'https://api.github.com/repos/owner/repo',
            pull_request: {},
          },
        ],
      },
    })

    const results = await searchConversations('owner/repo', 'session crash')

    const request = new URL(github.restGet.mock.calls[0][0], 'https://api.github.com')
    expect(request.searchParams.get('q')).toBe('repo:owner/repo session crash')
    expect(request.searchParams.get('per_page')).toBe('50')
    expect(results).toEqual([
      expect.objectContaining({
        kind: 'issue',
        nodeId: 'issue-node',
        issueNumber: 12,
        state: 'closed',
        assignees: ['assignee'],
      }),
      expect.objectContaining({
        kind: 'pullRequest',
        nodeId: 'pr-node',
        issueNumber: 34,
        state: 'open',
      }),
    ])
  })
})
