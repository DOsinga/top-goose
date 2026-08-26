import type {
  ConversationLink,
  PullRequestDetail,
  PullRequestReview,
  PullRequestReviewComment,
  PullRequestReviewThread,
} from '../../shared/types'
import { getAuthMeta } from '../store'
import { graphql, restGet, restSend } from './client'
import { fetchComments } from './issues'

export type RestPullRequest = {
  node_id: string
  number: number
  title: string
  state: 'open' | 'closed'
  merged_at: string | null
  draft: boolean
  body: string | null
  user: { login: string; avatar_url: string }
  assignees: { login: string }[]
  labels: { name: string; color: string }[]
  created_at: string
  updated_at: string
  base: { ref: string }
  head: { ref: string; repo: { full_name: string } | null }
}

type RestReview = {
  id: number
  node_id: string
  body: string | null
  state: PullRequestReview['state']
  user: { login: string; avatar_url: string } | null
  submitted_at: string | null
}

export type RestReviewComment = {
  id: number
  node_id: string
  in_reply_to_id?: number
  body: string
  user: { login: string; avatar_url: string } | null
  created_at: string
  updated_at: string
  path: string
  line: number | null
  original_line: number | null
  diff_hunk: string
}

type PullRequestGraph = {
  repository: {
    pullRequest: {
      reviewDecision: PullRequestDetail['reviewDecision'] | null
      mergeable: PullRequestDetail['mergeable']
      reviewRequests: {
        nodes: {
          requestedReviewer:
            | { login?: string; name?: string; slug?: string }
            | null
        }[]
      }
      reviewThreads: {
        nodes: {
          id: string
          isResolved: boolean
          comments: { nodes: { databaseId: number | null }[] }
        }[]
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
      }
      closingIssuesReferences: {
        nodes: {
          id: string
          number: number
          title: string
          state: string
          updatedAt: string
          repository: { nameWithOwner: string }
        }[]
      }
    } | null
  } | null
}

export async function fetchPullRequest(repo: string, number: number): Promise<RestPullRequest> {
  const res = await restGet<RestPullRequest>(`/repos/${repo}/pulls/${number}`)
  if (!res.data) throw new Error(`pull request ${repo}#${number} not found`)
  return res.data
}

async function fetchAll<T>(pathname: (page: number) => string): Promise<T[]> {
  const out: T[] = []
  for (let page = 1; ; page++) {
    const res = await restGet<T[]>(pathname(page))
    const batch = res.data ?? []
    out.push(...batch)
    if (batch.length < 100) return out
  }
}

export async function fetchPullRequestReviews(repo: string, number: number): Promise<PullRequestReview[]> {
  const reviews = await fetchAll<RestReview>(
    (page) => `/repos/${repo}/pulls/${number}/reviews?per_page=100&page=${page}`,
  )
  return reviews.map((review) => ({
    id: review.id,
    nodeId: review.node_id,
    author: review.user?.login ?? 'ghost',
    authorAvatarUrl: review.user?.avatar_url,
    body: review.body ?? '',
    state: review.state,
    submittedAt: review.submitted_at ?? undefined,
  }))
}

async function fetchReviewComments(repo: string, number: number): Promise<RestReviewComment[]> {
  return fetchAll<RestReviewComment>(
    (page) => `/repos/${repo}/pulls/${number}/comments?per_page=100&page=${page}&sort=created&direction=asc`,
  )
}

async function fetchPullRequestGraph(repo: string, number: number): Promise<{
  reviewDecision: PullRequestDetail['reviewDecision']
  mergeable: PullRequestDetail['mergeable']
  requestedReviewers: string[]
  threads: Map<number, { id: string; resolved: boolean }>
  linkedIssues: ConversationLink[]
}> {
  const [owner, name] = repo.split('/')
  let after: string | null = null
  let reviewDecision: PullRequestDetail['reviewDecision']
  let mergeable: PullRequestDetail['mergeable'] = 'UNKNOWN'
  let requestedReviewers: string[] = []
  const threads = new Map<number, { id: string; resolved: boolean }>()
  let linkedIssues: ConversationLink[] = []

  for (;;) {
    const data: PullRequestGraph = await graphql<PullRequestGraph>(
      `query ($owner: String!, $name: String!, $number: Int!, $after: String) {
        repository(owner: $owner, name: $name) {
          pullRequest(number: $number) {
            reviewDecision
            mergeable
            reviewRequests(first: 100) {
              nodes {
                requestedReviewer {
                  ... on User { login }
                  ... on Team { name slug }
                }
              }
            }
            reviewThreads(first: 100, after: $after) {
              nodes { id isResolved comments(first: 1) { nodes { databaseId } } }
              pageInfo { hasNextPage endCursor }
            }
            closingIssuesReferences(first: 100) {
              nodes { id number title state updatedAt repository { nameWithOwner } }
            }
          }
        }
      }`,
      { owner, name, number, after },
    )
    const pullRequest = data.repository?.pullRequest
    if (!pullRequest) throw new Error(`pull request ${repo}#${number} not found`)
    reviewDecision = pullRequest.reviewDecision ?? undefined
    mergeable = pullRequest.mergeable
    requestedReviewers = pullRequest.reviewRequests.nodes.flatMap(({ requestedReviewer }) => {
      if (!requestedReviewer) return []
      return [requestedReviewer.login ?? requestedReviewer.slug ?? requestedReviewer.name ?? 'unknown']
    })
    linkedIssues = (pullRequest.closingIssuesReferences?.nodes ?? []).map((issue) => ({
      kind: 'issue',
      repo: issue.repository.nameWithOwner,
      issueNumber: issue.number,
      nodeId: issue.id,
      title: issue.title,
      state: issue.state.toLowerCase(),
      updatedAt: issue.updatedAt,
    }))
    for (const thread of pullRequest.reviewThreads.nodes) {
      const rootId = thread.comments.nodes[0]?.databaseId
      if (rootId) threads.set(rootId, { id: thread.id, resolved: thread.isResolved })
    }
    if (!pullRequest.reviewThreads.pageInfo.hasNextPage) break
    after = pullRequest.reviewThreads.pageInfo.endCursor
  }
  return { reviewDecision, mergeable, requestedReviewers, threads, linkedIssues }
}

function toReviewComment(comment: RestReviewComment): PullRequestReviewComment {
  return {
    id: comment.id,
    nodeId: comment.node_id,
    author: comment.user?.login ?? 'ghost',
    authorAvatarUrl: comment.user?.avatar_url,
    body: comment.body,
    createdAt: comment.created_at,
    updatedAt: comment.updated_at,
    path: comment.path,
    line: comment.line ?? undefined,
    originalLine: comment.original_line ?? undefined,
    diffHunk: comment.diff_hunk,
  }
}

export function groupReviewThreads(
  comments: RestReviewComment[],
  metadata: Map<number, { id: string; resolved: boolean }>,
): PullRequestReviewThread[] {
  const byId = new Map(comments.map((comment) => [comment.id, comment]))
  const rootId = (comment: RestReviewComment): number => {
    let current = comment
    const seen = new Set<number>()
    while (current.in_reply_to_id && !seen.has(current.id)) {
      seen.add(current.id)
      const parent = byId.get(current.in_reply_to_id)
      if (!parent) return current.in_reply_to_id
      current = parent
    }
    return current.id
  }
  const grouped = new Map<number, PullRequestReviewComment[]>()
  for (const comment of comments) {
    const id = rootId(comment)
    grouped.set(id, [...(grouped.get(id) ?? []), toReviewComment(comment)])
  }
  return [...grouped.entries()].map(([id, threadComments]) => {
    const thread = metadata.get(id) ?? threadComments.map((comment) => metadata.get(comment.id)).find(Boolean)
    return {
      id: thread?.id ?? `review-thread-${id}`,
      resolved: thread?.resolved ?? false,
      comments: threadComments,
    }
  })
}

export async function fetchPullRequestConversation(
  repo: string,
  number: number,
  knownPullRequest?: RestPullRequest,
): Promise<{
  pullRequest: RestPullRequest
  comments: Awaited<ReturnType<typeof fetchComments>>
  reviews: PullRequestReview[]
  reviewThreads: PullRequestReviewThread[]
  graph: Awaited<ReturnType<typeof fetchPullRequestGraph>>
}> {
  const [pullRequest, comments, reviews, reviewComments, graph] = await Promise.all([
    knownPullRequest ?? fetchPullRequest(repo, number),
    fetchComments(repo, number),
    fetchPullRequestReviews(repo, number),
    fetchReviewComments(repo, number),
    fetchPullRequestGraph(repo, number),
  ])
  return {
    pullRequest,
    comments,
    reviews,
    reviewThreads: groupReviewThreads(reviewComments, graph.threads),
    graph,
  }
}

export async function fetchPullRequestDetail(repo: string, number: number): Promise<PullRequestDetail> {
  const { pullRequest, comments, reviews, reviewThreads, graph } = await fetchPullRequestConversation(repo, number)
  const login = getAuthMeta().login?.toLowerCase()
  const viewerReviewState = login
    ? [...reviews]
        .reverse()
        .find(
          (review) =>
            review.author.toLowerCase() === login &&
            review.state !== 'COMMENTED' &&
            review.state !== 'PENDING',
        )?.state
    : undefined
  return {
    repo,
    pullRequestNumber: number,
    nodeId: pullRequest.node_id,
    title: pullRequest.title,
    state: pullRequest.state,
    merged: pullRequest.merged_at !== null,
    author: pullRequest.user.login,
    authorAvatarUrl: pullRequest.user.avatar_url,
    assignees: pullRequest.assignees.map((assignee) => assignee.login),
    labels: pullRequest.labels,
    body: pullRequest.body ?? '',
    createdAt: pullRequest.created_at,
    updatedAt: pullRequest.updated_at,
    isDraft: pullRequest.draft,
    baseRefName: pullRequest.base.ref,
    headRefName: pullRequest.head.ref,
    headRepo: pullRequest.head.repo?.full_name,
    mergeable: graph.mergeable,
    reviewDecision: graph.reviewDecision,
    requestedReviewers: graph.requestedReviewers,
    viewerReviewState,
    comments,
    reviews,
    reviewThreads,
    linkedIssues: graph.linkedIssues,
  }
}

export async function approvePullRequest(repo: string, number: number): Promise<void> {
  await restSend('POST', `/repos/${repo}/pulls/${number}/reviews`, { event: 'APPROVE' })
}

export async function closePullRequest(repo: string, number: number): Promise<void> {
  await restSend('PATCH', `/repos/${repo}/pulls/${number}`, { state: 'closed' })
}
