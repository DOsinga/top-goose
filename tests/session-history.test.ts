import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CachedRow } from '../src/shared/types'

const store = vi.hoisted(() => ({
  sessions: [] as Record<string, unknown>[],
  cachedRows: new Map<string, CachedRow>(),
  getCachedRow: vi.fn(),
  listIssueSessions: vi.fn(),
  putSearchedRows: vi.fn(),
  saveIssueSession: vi.fn(),
}))
const client = vi.hoisted(() => ({ graphql: vi.fn() }))
const goose = vi.hoisted(() => ({ sessionInfo: vi.fn() }))

vi.mock('../src/main/store', () => ({
  getCachedRow: store.getCachedRow,
  listIssueSessions: store.listIssueSessions,
  putSearchedRows: store.putSearchedRows,
  saveIssueSession: store.saveIssueSession,
}))
vi.mock('../src/main/github/client', () => ({ graphql: client.graphql }))
vi.mock('../src/main/goose/acp', () => ({ acp: { sessionInfo: goose.sessionInfo } }))

const { listSessionHistory } = await import('../src/main/sessionHistory')

beforeEach(() => {
  for (const mock of [...Object.values(store), ...Object.values(client), ...Object.values(goose)]) {
    if (typeof mock === 'function' && 'mockReset' in mock) mock.mockReset()
  }
  store.sessions = []
  store.cachedRows = new Map()
  store.getCachedRow.mockImplementation((nodeId: string) => store.cachedRows.get(nodeId))
  store.listIssueSessions.mockImplementation(() => store.sessions)
  client.graphql.mockResolvedValue({ nodes: [] })
  goose.sessionInfo.mockResolvedValue(null)
})

describe('Goose session history', () => {
  it('backfills old sessions, registers closed conversations, and sorts by Goose activity', async () => {
    store.sessions = [
      {
        issueNodeId: 'ISSUE',
        host: 'github.com',
        account: 'DOsinga',
        repo: 'owner/repo',
        issueNumber: 7,
        sessionId: '20260824_2',
      },
      {
        issueNodeId: 'PR',
        kind: 'pullRequest',
        host: 'github.com',
        account: 'DOsinga',
        repo: 'owner/repo',
        issueNumber: 8,
        sessionId: '20260901_1',
        title: 'Cached PR title',
        createdAt: '2026-09-01T00:00:01Z',
        lastUsedAt: '2026-09-02T00:00:00Z',
      },
    ]
    client.graphql.mockResolvedValue({
      nodes: [
        {
          __typename: 'Issue',
          id: 'ISSUE',
          number: 7,
          title: 'Closed issue title',
          repository: { nameWithOwner: 'owner/repo' },
        },
      ],
    })
    goose.sessionInfo.mockResolvedValue({
      sessionId: '20260824_2',
      title: 'Goose title',
      updatedAt: '2026-09-03T00:00:00Z',
      _meta: { createdAt: '2026-08-24T12:00:00Z' },
    })

    const rows = await listSessionHistory()

    expect(rows.map((row) => row.nodeId)).toEqual(['ISSUE', 'PR'])
    expect(rows[0]).toMatchObject({ title: 'Closed issue title', lastUsedAt: '2026-09-03T00:00:00Z' })
    expect(store.saveIssueSession).toHaveBeenCalledWith(
      expect.objectContaining({
        issueNodeId: 'ISSUE',
        title: 'Closed issue title',
        createdAt: '2026-08-24T12:00:00Z',
        lastUsedAt: '2026-09-03T00:00:00Z',
      }),
    )
    expect(store.putSearchedRows).toHaveBeenCalledWith([
      expect.objectContaining({ nodeId: 'ISSUE', kind: 'issue', state: 'unknown' }),
      expect.objectContaining({ nodeId: 'PR', kind: 'pullRequest', state: 'unknown' }),
    ])
  })

  it('falls back to the date in a legacy session ID when Goose metadata is unavailable', async () => {
    store.sessions = [
      {
        issueNodeId: 'ISSUE',
        host: 'github.com',
        account: 'DOsinga',
        repo: 'owner/repo',
        issueNumber: 7,
        sessionId: '20260824_2',
        title: 'Issue title',
      },
    ]

    const rows = await listSessionHistory()

    expect(rows[0].lastUsedAt).toBe('2026-08-24T00:00:02.000Z')
    expect(store.saveIssueSession).toHaveBeenCalledWith(
      expect.not.objectContaining({ lastUsedAt: expect.anything() }),
    )
  })
})
