import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CachedRow } from '../src/shared/types'

const client = vi.hoisted(() => ({
  budgetDegraded: vi.fn(),
  graphql: vi.fn(),
  restGet: vi.fn(),
  restSend: vi.fn(),
}))

const projects = vi.hoisted(() => ({ extractBoardFields: vi.fn() }))

const store = vi.hoisted(() => ({
  rows: [] as CachedRow[],
  clearCachedRows: vi.fn(),
  clearPendingDrafts: vi.fn(),
  clearSearchedRows: vi.fn(),
  getCachedRow: vi.fn(),
  getCachedRows: vi.fn(),
  hasPendingDraft: vi.fn(),
  pruneCachedRows: vi.fn(),
  putCachedRows: vi.fn(),
  removeCachedRow: vi.fn(),
  repoConfig: vi.fn(),
  updateCachedRow: vi.fn(),
}))

vi.mock('../src/main/github/client', () => ({
  budgetDegraded: client.budgetDegraded,
  graphql: client.graphql,
  isProjectScopeError: () => false,
  restGet: client.restGet,
  restSend: client.restSend,
}))

vi.mock('../src/main/github/projects', () => projects)

vi.mock('../src/main/store', () => ({
  ...store,
  settings: () => ({ get: () => ({ repo: { repo: 'owner/repo' } }) }),
}))

const activity = await import('../src/main/activity')

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function row(kind: 'issue' | 'pullRequest', nodeId: string, number: number): CachedRow {
  return {
    kind,
    repo: 'owner/repo',
    issueNumber: number,
    nodeId,
    title: nodeId,
    state: 'open',
    commentCount: 0,
    updatedAt: '2026-01-01T00:00:00Z',
    hydratedAt: '2026-01-01T00:00:00Z',
    linkedIssues: kind === 'pullRequest' ? [] : undefined,
  }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
  store.rows = []
  for (const mock of Object.values(client)) mock.mockReset()
  projects.extractBoardFields.mockReset()
  for (const value of Object.values(store)) if (typeof value === 'function' && 'mockReset' in value) value.mockReset()
  client.budgetDegraded.mockReturnValue(false)
  client.graphql.mockResolvedValue({
    search: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
  })
  client.restGet.mockResolvedValue({ status: 304, pollInterval: 1, data: null })
  store.getCachedRows.mockImplementation(() => store.rows)
  store.getCachedRow.mockImplementation((nodeId: string) => store.rows.find((item) => item.nodeId === nodeId))
  store.hasPendingDraft.mockReturnValue(false)
  activity.reset()
})

afterEach(() => {
  activity.stop()
  vi.useRealTimers()
})

describe('GitHub activity loops', () => {
  it('does not let a stopped in-flight poll schedule another loop', async () => {
    const first = deferred<{ status: number; pollInterval: number; data: null }>()
    const second = deferred<{ status: number; pollInterval: number; data: null }>()
    client.restGet
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
      .mockResolvedValue({ status: 304, pollInterval: 1, data: null })

    activity.start()
    activity.start()
    first.resolve({ status: 304, pollInterval: 1, data: null })
    second.resolve({ status: 304, pollInterval: 1, data: null })
    await flush()

    expect(client.restGet).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1000)
    expect(client.restGet).toHaveBeenCalledTimes(3)
  })

  it('reconciles with lightweight discovery and skips unchanged rows', async () => {
    store.rows = [row('issue', 'issue-node', 1), row('pullRequest', 'pr-node', 2)]
    client.graphql.mockImplementation(async (query: string, variables: { q?: string }) => ({
      search: {
        nodes: variables.q?.startsWith('is:issue')
          ? [{ id: 'issue-node', number: 1, updatedAt: '2026-01-01T00:00:00Z' }]
          : [{ id: 'pr-node', number: 2, updatedAt: '2026-01-01T00:00:00Z' }],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    }))

    activity.start()
    await flush()

    expect(client.graphql).toHaveBeenCalledTimes(2)
    for (const [query] of client.graphql.mock.calls) {
      expect(query).not.toContain('projectItems')
      expect(query).not.toContain('comments(')
    }
  })

  it('hydrates a notification timestamp only once even when the feed ETag changes', async () => {
    store.rows = [row('issue', 'issue-node', 1)]
    const notification = {
      id: 'thread-1',
      unread: true,
      updated_at: '2026-01-01T00:00:01Z',
      subject: { title: 'Issue', url: 'https://api.github.com/repos/owner/repo/issues/1', type: 'Issue' },
      repository: { full_name: 'owner/repo' },
    }
    client.restGet
      .mockResolvedValueOnce({ status: 200, etag: 'one', pollInterval: 1, data: [notification] })
      .mockResolvedValueOnce({ status: 200, etag: 'two', pollInterval: 1, data: [notification] })
    client.graphql.mockImplementation(async (query: string, variables: { q?: string }) => {
      if (query.includes('x0: repository')) {
        return {
          x0: {
            issue: {
              id: 'issue-node',
              number: 1,
              title: 'Issue',
              author: { login: 'author' },
              assignees: { nodes: [] },
              state: 'OPEN',
              updatedAt: '2026-01-01T00:00:00Z',
              repository: { nameWithOwner: 'owner/repo' },
              comments: { totalCount: 0, nodes: [] },
              projectItems: { nodes: [] },
            },
          },
        }
      }
      return {
        search: {
          nodes: variables.q?.startsWith('is:issue')
            ? [{ id: 'issue-node', number: 1, updatedAt: '2026-01-01T00:00:00Z' }]
            : [],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      }
    })

    activity.start()
    await flush()
    await vi.advanceTimersByTimeAsync(1000)
    await flush()

    const hydrationQueries = client.graphql.mock.calls.filter(([query]) => query.includes('x0: repository'))
    expect(hydrationQueries).toHaveLength(1)
  })

  it('hydrates linked issue board statuses for pull request filters', async () => {
    store.repoConfig.mockReturnValue({
      repo: 'owner/repo',
      path: '',
      useWorktrees: false,
      board: {
        projectId: 'project-1',
        projectTitle: 'Board',
        statusFieldId: 'status-field',
        snoozeFieldId: 'snooze-field',
        statusOptions: {},
      },
    })
    projects.extractBoardFields.mockReturnValue({ status: 'Inbox' })
    client.graphql.mockImplementation(async (query: string, variables: { q?: string }) => {
      if (query.includes('x0: repository')) {
        return {
          x0: {
            pullRequest: {
              id: 'pr-node',
              number: 2,
              title: 'External contribution',
              author: { login: 'contributor' },
              assignees: { nodes: [] },
              state: 'OPEN',
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-01T00:00:00Z',
              isDraft: false,
              reviewDecision: null,
              reviewRequests: { nodes: [] },
              repository: { nameWithOwner: 'owner/repo' },
              comments: { totalCount: 0, nodes: [] },
              closingIssuesReferences: {
                nodes: [
                  {
                    number: 12,
                    projectItems: {
                      nodes: [{ project: { id: 'project-1' }, fieldValues: { nodes: [] } }],
                    },
                  },
                ],
              },
            },
          },
        }
      }
      return {
        search: {
          nodes: variables.q?.startsWith('is:pr')
            ? [{ id: 'pr-node', number: 2, updatedAt: '2026-01-01T00:00:00Z' }]
            : [],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      }
    })

    activity.start()
    await flush()

    expect(store.putCachedRows).toHaveBeenCalledWith([
      expect.objectContaining({
        nodeId: 'pr-node',
        linkedIssues: [{ number: 12, workflowStatus: 'Inbox' }],
      }),
    ])
  })
})
