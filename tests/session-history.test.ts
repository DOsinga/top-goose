import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CachedRow } from '../src/shared/types'

const store = vi.hoisted(() => ({
  sessions: [] as Record<string, unknown>[],
  cachedRows: new Map<string, CachedRow>(),
  getCachedRow: vi.fn(),
  listIssueSessions: vi.fn(),
  saveIssueSession: vi.fn(),
}))
const goose = vi.hoisted(() => ({ sessionInfo: vi.fn() }))

vi.mock('../src/main/store', () => ({
  getCachedRow: store.getCachedRow,
  listIssueSessions: store.listIssueSessions,
  saveIssueSession: store.saveIssueSession,
}))
vi.mock('../src/main/goose/acp', () => ({ acp: { sessionInfo: goose.sessionInfo } }))

const { listSessionHistory } = await import('../src/main/sessionHistory')

beforeEach(() => {
  for (const mock of [...Object.values(store), ...Object.values(goose)]) {
    if (typeof mock === 'function' && 'mockReset' in mock) mock.mockReset()
  }
  store.sessions = []
  store.cachedRows = new Map()
  store.getCachedRow.mockImplementation((nodeId: string) => store.cachedRows.get(nodeId))
  store.listIssueSessions.mockImplementation(() => store.sessions)
  goose.sessionInfo.mockResolvedValue(null)
})

describe('Goose session history', () => {
  it('shows only open, unsnoozed conversations and sorts by Goose activity', async () => {
    store.sessions = [
      {
        issueNodeId: 'OPEN_ISSUE',
        host: 'github.com',
        account: 'DOsinga',
        repo: 'owner/repo',
        issueNumber: 7,
        sessionId: '20260824_2',
      },
      {
        issueNodeId: 'OPEN_PR',
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
      {
        issueNodeId: 'CLOSED_ISSUE',
        host: 'github.com',
        account: 'DOsinga',
        repo: 'owner/repo',
        issueNumber: 9,
        sessionId: '20260820_1',
      },
      {
        issueNodeId: 'MERGED_PR',
        kind: 'pullRequest',
        host: 'github.com',
        account: 'DOsinga',
        repo: 'owner/repo',
        issueNumber: 10,
        sessionId: '20260821_1',
      },
      {
        issueNodeId: 'SNOOZED_ISSUE',
        host: 'github.com',
        account: 'DOsinga',
        repo: 'owner/repo',
        issueNumber: 11,
        sessionId: '20260822_1',
      },
    ]
    store.cachedRows.set('OPEN_ISSUE', cachedRow('OPEN_ISSUE', 'issue', 'Open issue title', 7))
    store.cachedRows.set('OPEN_PR', cachedRow('OPEN_PR', 'pullRequest', 'Open PR title', 8))
    store.cachedRows.set('CLOSED_ISSUE', {
      ...cachedRow('CLOSED_ISSUE', 'issue', 'Closed issue title', 9),
      state: 'closed',
    })
    store.cachedRows.set('SNOOZED_ISSUE', {
      ...cachedRow('SNOOZED_ISSUE', 'issue', 'Snoozed issue title', 11),
      snoozedUntil: '2999-01-01',
    })
    goose.sessionInfo.mockResolvedValue({
      sessionId: '20260824_2',
      updatedAt: '2026-09-03T00:00:00Z',
      _meta: { createdAt: '2026-08-24T12:00:00Z' },
    })

    const rows = await listSessionHistory()

    expect(rows.map((row) => row.nodeId)).toEqual(['OPEN_ISSUE', 'OPEN_PR'])
    expect(rows[0]).toMatchObject({ title: 'Open issue title', lastUsedAt: '2026-09-03T00:00:00Z' })
    expect(store.saveIssueSession).toHaveBeenCalledWith(
      expect.objectContaining({
        issueNodeId: 'OPEN_ISSUE',
        title: 'Open issue title',
        createdAt: '2026-08-24T12:00:00Z',
        lastUsedAt: '2026-09-03T00:00:00Z',
      }),
    )
    expect(goose.sessionInfo).toHaveBeenCalledTimes(1)
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
    store.cachedRows.set('ISSUE', cachedRow('ISSUE', 'issue', 'Issue title', 7))

    const rows = await listSessionHistory()

    expect(rows[0].lastUsedAt).toBe('2026-08-24T00:00:02.000Z')
    expect(store.saveIssueSession).toHaveBeenCalledWith(
      expect.not.objectContaining({ lastUsedAt: expect.anything() }),
    )
  })
})

function cachedRow(
  nodeId: string,
  kind: CachedRow['kind'],
  title: string,
  issueNumber: number,
): CachedRow {
  return {
    kind,
    repo: 'owner/repo',
    issueNumber,
    nodeId,
    title,
    state: 'open',
    commentCount: 0,
    updatedAt: '2026-09-01T00:00:00Z',
    hydratedAt: '2026-09-01T00:00:00Z',
  }
}
