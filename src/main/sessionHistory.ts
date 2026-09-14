import type { CachedRow, SessionHistoryRow } from '../shared/types'
import { graphql } from './github/client'
import { acp } from './goose/acp'
import {
  getCachedRow,
  listIssueSessions,
  putSearchedRows,
  saveIssueSession,
  type IssueSession,
} from './store'

type ConversationSummary = {
  __typename: 'Issue' | 'PullRequest'
  id: string
  number: number
  title: string
  repository: { nameWithOwner: string }
}

export async function listSessionHistory(): Promise<SessionHistoryRow[]> {
  const sessions = listIssueSessions()
  const missingTitles = sessions.filter((session) => !session.title && !getCachedRow(session.issueNodeId))
  const summaries = await fetchSummaries(missingTitles.map((session) => session.issueNodeId))
  const rows: SessionHistoryRow[] = []

  for (const session of sessions) {
    const cached = getCachedRow(session.issueNodeId)
    const summary = summaries.get(session.issueNodeId)
    const info = session.lastUsedAt ? null : await acp.sessionInfo(session.sessionId)
    const lastUsedAt = session.lastUsedAt ?? info?.updatedAt ?? sessionDate(session.sessionId)
    const title = cached?.title ?? summary?.title ?? session.title ?? info?.title ?? fallbackTitle(session)
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
      kind: session.kind ?? 'issue',
      repo: session.repo,
      issueNumber: session.issueNumber,
      nodeId: session.issueNodeId,
      title,
      lastUsedAt,
    })
  }

  rememberConversations(rows)
  return rows.sort((left, right) => right.lastUsedAt.localeCompare(left.lastUsedAt))
}

async function fetchSummaries(nodeIds: string[]): Promise<Map<string, ConversationSummary>> {
  const summaries = new Map<string, ConversationSummary>()
  for (let offset = 0; offset < nodeIds.length; offset += 100) {
    const ids = nodeIds.slice(offset, offset + 100)
    const data = await graphql<{ nodes: (ConversationSummary | null)[] }>(
      `query ($ids: [ID!]!) {
        nodes(ids: $ids) {
          __typename
          ... on Issue { id number title repository { nameWithOwner } }
          ... on PullRequest { id number title repository { nameWithOwner } }
        }
      }`,
      { ids },
    )
    for (const summary of data.nodes) {
      if (summary) summaries.set(summary.id, summary)
    }
  }
  return summaries
}

function rememberConversations(rows: SessionHistoryRow[]): void {
  const hydratedAt = new Date().toISOString()
  const cachedRows: CachedRow[] = rows.map((row) => ({
    kind: row.kind,
    repo: row.repo,
    issueNumber: row.issueNumber,
    nodeId: row.nodeId,
    title: row.title,
    state: 'unknown',
    commentCount: 0,
    updatedAt: row.lastUsedAt,
    hydratedAt,
  }))
  putSearchedRows(cachedRows)
}

function fallbackTitle(session: IssueSession): string {
  const kind = session.kind === 'pullRequest' ? 'Pull request' : 'Issue'
  return `${kind} #${session.issueNumber}`
}

function sessionDate(sessionId: string): string {
  const match = sessionId.match(/^(\d{4})(\d{2})(\d{2})(?:_(\d+))?/)
  if (!match) return new Date(0).toISOString()
  return new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, Number(match[4] ?? 0)),
  ).toISOString()
}
