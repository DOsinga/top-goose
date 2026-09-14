import type { SessionHistoryRow } from '../shared/types'
import { acp } from './goose/acp'
import { getCachedRow, listIssueSessions, saveIssueSession } from './store'

export async function listSessionHistory(): Promise<SessionHistoryRow[]> {
  const sessions = listIssueSessions()
  const rows: SessionHistoryRow[] = []
  const today = new Date().toISOString().slice(0, 10)

  for (const session of sessions) {
    const cached = getCachedRow(session.issueNodeId)
    if (!cached || cached.state !== 'open') continue
    if (cached.kind === 'issue' && cached.snoozedUntil && cached.snoozedUntil > today) continue

    const info = session.lastUsedAt ? null : await acp.sessionInfo(session.sessionId)
    const lastUsedAt = session.lastUsedAt ?? info?.updatedAt ?? sessionDate(session.sessionId)
    const title = cached.title
    const next = {
      ...session,
      title,
      createdAt: session.createdAt ?? info?._meta?.createdAt ?? sessionDate(session.sessionId),
      ...(session.lastUsedAt || info?.updatedAt ? { lastUsedAt } : {}),
    }
    if (next.title !== session.title || next.createdAt !== session.createdAt || next.lastUsedAt !== session.lastUsedAt) {
      saveIssueSession(next)
    }
    rows.push({
      kind: cached.kind,
      repo: cached.repo,
      issueNumber: cached.issueNumber,
      nodeId: session.issueNodeId,
      title,
      lastUsedAt,
    })
  }

  return rows.sort((left, right) => right.lastUsedAt.localeCompare(left.lastUsedAt))
}

function sessionDate(sessionId: string): string {
  const match = sessionId.match(/^(\d{4})(\d{2})(\d{2})(?:_(\d+))?/)
  if (!match) return new Date(0).toISOString()
  return new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, Number(match[4] ?? 0)),
  ).toISOString()
}
