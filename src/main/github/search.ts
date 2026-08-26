import type { CachedRow } from '../../shared/types'
import { restGet } from './client'

type RestSearchItem = {
  node_id: string
  number: number
  title: string
  state: string
  user: { login: string } | null
  assignees: { login: string }[]
  comments: number
  created_at: string
  updated_at: string
  repository_url: string
  pull_request?: unknown
}

type RestSearchResult = {
  items: RestSearchItem[]
}

export function scopedSearchQuery(repo: string, query: string): string {
  const trimmed = query.trim()
  if (/(^|\s|\()\-?(repo|org|user):/i.test(trimmed) || /(^|\s)OR(?=\s|$)/.test(trimmed)) {
    throw new Error('Search is fixed to the configured repository; remove repo, org, user, and OR qualifiers')
  }
  return `repo:${repo} ${trimmed}`
}

export async function searchConversations(repo: string, query: string): Promise<CachedRow[]> {
  const params = new URLSearchParams({
    q: scopedSearchQuery(repo, query),
    per_page: '50',
  })
  const response = await restGet<RestSearchResult>(`/search/issues?${params}`)
  const hydratedAt = new Date().toISOString()
  return (response.data?.items ?? [])
    .filter((item) => item.repository_url.toLowerCase().endsWith(`/repos/${repo.toLowerCase()}`))
    .map((item) => ({
      kind: item.pull_request ? 'pullRequest' : 'issue',
      repo,
      issueNumber: item.number,
      nodeId: item.node_id,
      title: item.title,
      author: item.user?.login ?? 'ghost',
      assignees: item.assignees.map((assignee) => assignee.login),
      state: item.state,
      commentCount: item.comments,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      hydratedAt,
    }))
}
