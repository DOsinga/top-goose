import type { IssueComment, IssueDetail } from '../../shared/types'
import { repoConfig } from '../store'
import { restGet, restSend } from './client'
import { boardItemForIssue } from './projects'

type RestIssue = {
  node_id: string
  number: number
  title: string
  state: 'open' | 'closed'
  body: string | null
  user: { login: string; avatar_url: string }
  assignees: { login: string }[]
  labels: ({ name: string; color: string } | string)[]
  milestone: { title: string } | null
  created_at: string
  updated_at: string
  comments: number
}

type RestComment = {
  id: number
  node_id: string
  body: string
  user: { login: string; avatar_url: string }
  created_at: string
  updated_at: string
}

function toComment(c: RestComment): IssueComment {
  return {
    id: c.id,
    nodeId: c.node_id,
    author: c.user.login,
    authorAvatarUrl: c.user.avatar_url,
    body: c.body,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  }
}

export async function fetchIssue(repo: string, issueNumber: number): Promise<RestIssue> {
  const res = await restGet<RestIssue>(`/repos/${repo}/issues/${issueNumber}`)
  if (!res.data) throw new Error(`issue ${repo}#${issueNumber} not found`)
  return res.data
}

export async function fetchComments(
  repo: string,
  issueNumber: number,
): Promise<IssueComment[]> {
  const out: IssueComment[] = []
  for (let page = 1; ; page++) {
    const res = await restGet<RestComment[]>(
      `/repos/${repo}/issues/${issueNumber}/comments?per_page=100&page=${page}&sort=created&direction=asc`,
    )
    const batch = res.data ?? []
    out.push(...batch.map(toComment))
    if (batch.length < 100) break
  }
  return out
}

export async function fetchIssueDetail(repo: string, issueNumber: number): Promise<IssueDetail> {
  const [issue, comments] = await Promise.all([fetchIssue(repo, issueNumber), fetchComments(repo, issueNumber)])

  const config = repoConfig(repo)
  let workflowStatus: string | undefined
  let snoozedUntil: string | undefined
  if (config?.board) {
    try {
      const item = await boardItemForIssue(config.board, issue.node_id)
      workflowStatus = item?.status
      snoozedUntil = item?.snoozedUntil
    } catch (err) {
      console.warn(`board lookup failed for ${repo}#${issueNumber}:`, err)
    }
  }

  return {
    repo,
    issueNumber,
    nodeId: issue.node_id,
    title: issue.title,
    state: issue.state,
    author: issue.user.login,
    authorAvatarUrl: issue.user.avatar_url,
    assignees: issue.assignees.map((a) => a.login),
    labels: issue.labels.map((l) => (typeof l === 'string' ? { name: l, color: 'cccccc' } : l)),
    milestone: issue.milestone?.title,
    body: issue.body ?? '',
    bodyUpdatedAt: issue.updated_at,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    comments,
    workflowStatus,
    snoozedUntil,
    availableStatuses: config?.board ? Object.keys(config.board.statusOptions) : [],
  }
}

export async function postComment(repo: string, issueNumber: number, body: string): Promise<IssueComment> {
  const created = await restSend<RestComment>('POST', `/repos/${repo}/issues/${issueNumber}/comments`, { body })
  if (!created) throw new Error('comment creation returned no body')
  return toComment(created)
}
