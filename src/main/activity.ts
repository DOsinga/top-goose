import type { CachedRow } from '../shared/types'
import { budgetDegraded, graphql, isProjectScopeError, restGet, restSend } from './github/client'
import { extractBoardFields } from './github/projects'
import {
  clearCachedRows,
  clearPendingDrafts,
  clearSearchedRows,
  getCachedRow,
  getCachedRows,
  hasPendingDraft,
  pruneCachedRows,
  putCachedRows,
  removeCachedRow,
  repoConfig,
  settings,
  updateCachedRow,
} from './store'

/** lowercased "owner/name" of the configured repository, if any */
function settingsRepo(): string | undefined {
  return settings().get().repo?.repo.toLowerCase()
}

/**
 * Three loops with very different costs, kept separate per the design:
 *
 *  - change detection: conditional REST polling of /notifications (continuous)
 *  - reconciliation:   GraphQL search for the complete desired set (slow timer)
 *  - hydration:        one batched GraphQL query over issues that changed
 */

const RECONCILE_INTERVAL_MS = 5 * 60 * 1000
const DEFAULT_POLL_INTERVAL_S = 60

type RowsListener = (rows: CachedRow[]) => void

let rowsListener: RowsListener | null = null
let notifTimer: NodeJS.Timeout | null = null
let reconcileTimer: NodeJS.Timeout | null = null
let notifEtag: string | undefined
let generation = 0

/** notification thread IDs by issue node ID, for mark-as-read */
const threadByNode = new Map<string, string>()
const notificationUpdatedAt = new Map<string, string>()
type ConversationRef = { kind: 'issue' | 'pullRequest'; repo: string; number: number }
type DiscoveredConversation = ConversationRef & { nodeId: string; updatedAt: string }

export function onRows(listener: RowsListener): void {
  rowsListener = listener
}

function emitRows(): void {
  const rows = getCachedRows().map((r) => ({ ...r, hasPendingDraft: hasPendingDraft(r.nodeId) }))
  rowsListener?.(rows)
}

export function currentRows(): CachedRow[] {
  return getCachedRows().map((r) => ({ ...r, hasPendingDraft: hasPendingDraft(r.nodeId) }))
}

export function start(): void {
  stop()
  const currentGeneration = generation
  void reconcile(currentGeneration).catch((err) => console.warn('[reconcile] failed:', err))
  reconcileTimer = setInterval(() => {
    void reconcile(currentGeneration).catch((err) => console.warn('[reconcile] failed:', err))
  }, RECONCILE_INTERVAL_MS)
  void pollLoop(currentGeneration)
  emitRows()
}

export function stop(): void {
  generation++
  if (notifTimer) clearTimeout(notifTimer)
  if (reconcileTimer) clearInterval(reconcileTimer)
  notifTimer = null
  reconcileTimer = null
}

export function reset(): void {
  stop()
  notifEtag = undefined
  threadByNode.clear()
  notificationUpdatedAt.clear()
  pendingThreadIds.clear()
  hasProjectScope = true
  clearCachedRows()
  clearSearchedRows()
  clearPendingDrafts()
  emitRows()
}

export async function refreshNow(): Promise<void> {
  const currentGeneration = generation
  notifEtag = undefined
  await reconcile(currentGeneration, true)
  if (currentGeneration === generation) await pollNotificationsOnce(currentGeneration)
}

// ---------- Change detection: REST notifications ----------

type RestNotification = {
  id: string
  unread: boolean
  updated_at: string
  subject: { title: string; url: string | null; type: string }
  repository: { full_name: string }
}

async function pollLoop(currentGeneration: number): Promise<void> {
  let interval = DEFAULT_POLL_INTERVAL_S
  try {
    interval = (await pollNotificationsOnce(currentGeneration)) ?? interval
  } catch (err) {
    console.warn('[notifications] poll failed:', err)
  }
  if (currentGeneration !== generation) return
  notifTimer = setTimeout(() => void pollLoop(currentGeneration), interval * 1000)
}

/** Returns the server-requested poll interval, if any. */
async function pollNotificationsOnce(currentGeneration: number): Promise<number | undefined> {
  const res = await restGet<RestNotification[]>('/notifications?per_page=50', notifEtag)
  if (currentGeneration !== generation) return res.pollInterval
  if (res.status === 304) return res.pollInterval
  notifEtag = res.etag
  const changed: { ref: ConversationRef; threadId: string; updatedAt: string }[] = []
  const configured = settingsRepo()
  if (!configured) return res.pollInterval
  for (const n of res.data ?? []) {
    if (!n.subject.url || (n.subject.type !== 'Issue' && n.subject.type !== 'PullRequest')) continue
    // the app is scoped to the one configured repository
    if (n.repository.full_name.toLowerCase() !== configured) continue
    const kind = n.subject.type === 'PullRequest' ? 'pullRequest' : 'issue'
    const match = n.subject.url.match(kind === 'pullRequest' ? /\/pulls\/(\d+)$/ : /\/issues\/(\d+)$/)
    if (!match) continue
    const ref: ConversationRef = { kind, repo: n.repository.full_name, number: parseInt(match[1], 10) }
    const cached = findCachedByRef(ref)
    if (cached) {
      threadByNode.set(cached.nodeId, n.id)
      if (n.unread && !cached.unread) updateCachedRow(cached.nodeId, { unread: true })
    }
    if (!cached || notificationUpdatedAt.get(n.id) !== n.updated_at) {
      changed.push({ ref, threadId: n.id, updatedAt: n.updated_at })
      pendingThreadIds.set(refKey(ref), n.id)
    }
  }
  if (changed.length > 0) {
    const hydrated = await hydrate(changed.map(({ ref }) => ref), currentGeneration)
    if (currentGeneration !== generation) return res.pollInterval
    if (hydrated) {
      for (const notification of changed) {
        notificationUpdatedAt.set(notification.threadId, notification.updatedAt)
      }
    }
    emitRows()
  }
  return res.pollInterval
}

const pendingThreadIds = new Map<string, string>()

function refKey(ref: ConversationRef): string {
  return `${ref.kind}:${ref.repo.toLowerCase()}#${ref.number}`
}

function findCachedByRef(ref: ConversationRef): CachedRow | undefined {
  return getCachedRows().find(
    (row) => row.kind === ref.kind && row.repo.toLowerCase() === ref.repo.toLowerCase() && row.issueNumber === ref.number,
  )
}

// ---------- Row fragment shared by search and hydration ----------

/**
 * A PAT without read:project makes GitHub reject the WHOLE query (data: null,
 * not a partial response) if it mentions projectItems. Once we see that, drop
 * the selection for the rest of the run: everything works minus board fields.
 */
let hasProjectScope = true

function rowFragment(): string {
  const projectItems = hasProjectScope
    ? `
  projectItems(first: 10) {
    nodes {
      project { id }
      fieldValues(first: 20) {
        nodes {
          __typename
          ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2SingleSelectField { id } } }
          ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2Field { id } } }
        }
      }
    }
  }`
    : ''
  return `
fragment RowFields on Issue {
  id
  number
  title
  author { login }
  assignees(first: 10) { nodes { login } }
  state
  updatedAt
  repository { nameWithOwner }
  comments(last: 1) {
    totalCount
    nodes { author { login } body }
  }${projectItems}
}`
}

/** Run a RowFields query, downgrading to the no-projects fragment on a scope error. */
async function rowQuery<T>(build: (fragment: string) => string, vars: Record<string, unknown>): Promise<T> {
  try {
    return await graphql<T>(build(rowFragment()), vars)
  } catch (err) {
    if (!hasProjectScope || !isProjectScopeError(err)) throw err
    hasProjectScope = false
    console.warn('[graphql] token lacks read:project; continuing without board fields')
    return await graphql<T>(build(rowFragment()), vars)
  }
}

type GqlIssueRow = {
  id: string
  number: number
  title: string
  author: { login: string } | null
  assignees: { nodes: { login: string }[] }
  state: string
  updatedAt: string
  repository: { nameWithOwner: string }
  comments: { totalCount: number; nodes: { author: { login: string } | null; body: string }[] }
  /** absent when the token lacks read:project scope */
  projectItems?: {
    nodes: {
      project: { id: string }
      fieldValues: { nodes: ({ __typename: string } & Record<string, unknown>)[] }
    }[]
  } | null
}

type GqlPullRequestRow = {
  id: string
  number: number
  title: string
  author: { login: string } | null
  assignees: { nodes: { login: string }[] }
  state: string
  createdAt: string
  updatedAt: string
  isDraft: boolean
  reviewDecision: CachedRow['reviewDecision'] | null
  reviewRequests: {
    nodes: { requestedReviewer: { login?: string; slug?: string; name?: string } | null }[]
  }
  repository: { nameWithOwner: string }
  comments: { totalCount: number; nodes: { author: { login: string } | null; body: string }[] }
}

function pullRequestRowFragment(): string {
  return `
fragment PullRequestRowFields on PullRequest {
  id
  number
  title
  author { login }
  assignees(first: 10) { nodes { login } }
  state
  createdAt
  updatedAt
  isDraft
  reviewDecision
  reviewRequests(first: 100) {
    nodes {
      requestedReviewer {
        ... on User { login }
        ... on Team { name slug }
      }
    }
  }
  repository { nameWithOwner }
  comments(last: 1) {
    totalCount
    nodes { author { login } body }
  }
}`
}

function toRow(issue: GqlIssueRow): CachedRow {
  const repo = issue.repository.nameWithOwner
  const config = repoConfig(repo)
  let workflowStatus: string | undefined
  let snoozedUntil: string | undefined
  if (config?.board && issue.projectItems) {
    const item = issue.projectItems.nodes.find((n) => n.project.id === config.board!.projectId)
    if (item) {
      const fields = extractBoardFields(config.board, item.fieldValues.nodes)
      workflowStatus = fields.status
      snoozedUntil = fields.snoozedUntil
    }
  }
  const last = issue.comments.nodes[0]
  const existing = getCachedRow(issue.id)
  return {
    kind: 'issue',
    repo,
    issueNumber: issue.number,
    nodeId: issue.id,
    title: issue.title,
    author: issue.author?.login ?? 'ghost',
    assignees: issue.assignees.nodes.map((a) => a.login),
    state: issue.state.toLowerCase(),
    workflowStatus,
    snoozedUntil,
    lastComment: last
      ? { author: last.author?.login ?? 'ghost', snippet: last.body.replace(/\s+/g, ' ').slice(0, 120) }
      : undefined,
    commentCount: issue.comments.totalCount,
    commentCountAtRead: existing?.commentCountAtRead,
    updatedAt: issue.updatedAt,
    hydratedAt: new Date().toISOString(),
    unread: existing?.unread,
  }
}

function toPullRequestRow(pullRequest: GqlPullRequestRow): CachedRow {
  const last = pullRequest.comments.nodes[0]
  const existing = getCachedRow(pullRequest.id)
  return {
    kind: 'pullRequest',
    repo: pullRequest.repository.nameWithOwner,
    issueNumber: pullRequest.number,
    nodeId: pullRequest.id,
    title: pullRequest.title,
    author: pullRequest.author?.login ?? 'ghost',
    assignees: pullRequest.assignees.nodes.map((assignee) => assignee.login),
    state: pullRequest.state.toLowerCase(),
    createdAt: pullRequest.createdAt,
    isDraft: pullRequest.isDraft,
    reviewDecision: pullRequest.reviewDecision ?? undefined,
    reviewRequestedFrom: pullRequest.reviewRequests.nodes.flatMap(({ requestedReviewer }) => {
      if (!requestedReviewer) return []
      return [requestedReviewer.login ?? requestedReviewer.slug ?? requestedReviewer.name ?? 'unknown']
    }),
    lastComment: last
      ? { author: last.author?.login ?? 'ghost', snippet: last.body.replace(/\s+/g, ' ').slice(0, 120) }
      : undefined,
    commentCount: pullRequest.comments.totalCount,
    commentCountAtRead: existing?.commentCountAtRead,
    updatedAt: pullRequest.updatedAt,
    hydratedAt: new Date().toISOString(),
    unread: existing?.unread,
  }
}

// ---------- Hydration: batched GraphQL over deltas only ----------

async function hydrate(refs: ConversationRef[], currentGeneration: number): Promise<boolean> {
  if (refs.length === 0) return true
  if (currentGeneration !== generation) return false
  if (budgetDegraded()) {
    console.warn('[hydrate] budget degraded; serving cached rows only')
    return false
  }
  await hydrateIssues(refs.filter((ref) => ref.kind === 'issue'), currentGeneration)
  await hydratePullRequests(refs.filter((ref) => ref.kind === 'pullRequest'), currentGeneration)
  return currentGeneration === generation
}

async function hydrateIssues(refs: ConversationRef[], currentGeneration: number): Promise<void> {
  for (let offset = 0; offset < refs.length; offset += 50) {
    const batch = refs.slice(offset, offset + 50)
    const vars: Record<string, unknown> = {}
    const selections = batch
      .map((ref, i) => {
        const [owner, name] = ref.repo.split('/')
        vars[`o${i}`] = owner
        vars[`n${i}`] = name
        vars[`i${i}`] = ref.number
        return `x${i}: repository(owner: $o${i}, name: $n${i}) { issue(number: $i${i}) { ...RowFields } }`
      })
      .join('\n')
    const varDefs = batch.map((_, i) => `$o${i}: String!, $n${i}: String!, $i${i}: Int!`).join(', ')
    const data = await rowQuery<Record<string, { issue: GqlIssueRow | null } | null>>(
      (fragment) => `query (${varDefs}) { ${selections} } ${fragment}`,
      vars,
    )
    if (currentGeneration !== generation) return
    const rows: CachedRow[] = []
    for (let i = 0; i < batch.length; i++) {
      const issue = data[`x${i}`]?.issue
      if (!issue) continue
      if (issue.state !== 'OPEN') {
        threadByNode.delete(issue.id)
        pendingThreadIds.delete(refKey(batch[i]))
        removeCachedRow(issue.id)
        continue
      }
      const row = toRow(issue)
      const threadId = pendingThreadIds.get(refKey(batch[i]))
      if (threadId) {
        threadByNode.set(row.nodeId, threadId)
        pendingThreadIds.delete(refKey(batch[i]))
        row.unread = true
      }
      rows.push(row)
    }
    putCachedRows(rows)
  }
}

async function hydratePullRequests(refs: ConversationRef[], currentGeneration: number): Promise<void> {
  for (let offset = 0; offset < refs.length; offset += 50) {
    const batch = refs.slice(offset, offset + 50)
    const vars: Record<string, unknown> = {}
    const selections = batch
      .map((ref, i) => {
        const [owner, name] = ref.repo.split('/')
        vars[`o${i}`] = owner
        vars[`n${i}`] = name
        vars[`i${i}`] = ref.number
        return `x${i}: repository(owner: $o${i}, name: $n${i}) { pullRequest(number: $i${i}) { ...PullRequestRowFields } }`
      })
      .join('\n')
    const varDefs = batch.map((_, i) => `$o${i}: String!, $n${i}: String!, $i${i}: Int!`).join(', ')
    const data = await graphql<Record<string, { pullRequest: GqlPullRequestRow | null } | null>>(
      `query (${varDefs}) { ${selections} } ${pullRequestRowFragment()}`,
      vars,
    )
    if (currentGeneration !== generation) return
    const rows: CachedRow[] = []
    for (let i = 0; i < batch.length; i++) {
      const pullRequest = data[`x${i}`]?.pullRequest
      if (!pullRequest) continue
      if (pullRequest.state !== 'OPEN') {
        threadByNode.delete(pullRequest.id)
        pendingThreadIds.delete(refKey(batch[i]))
        removeCachedRow(pullRequest.id)
        continue
      }
      const row = toPullRequestRow(pullRequest)
      const threadId = pendingThreadIds.get(refKey(batch[i]))
      if (threadId) {
        threadByNode.set(row.nodeId, threadId)
        pendingThreadIds.delete(refKey(batch[i]))
        row.unread = true
      }
      rows.push(row)
    }
    putCachedRows(rows)
  }
}

// ---------- Reconciliation: the complete desired set, on a slow timer ----------

async function reconcile(currentGeneration: number, forceHydration = false): Promise<void> {
  if (currentGeneration !== generation) return
  const configured = settingsRepo()
  if (!configured) {
    clearCachedRows()
    emitRows()
    return
  }
  const issues = await reconcileIssues(configured)
  if (!issues || currentGeneration !== generation) return
  const pullRequests = await reconcilePullRequests(configured)
  if (!pullRequests || currentGeneration !== generation) return
  const discovered = [...issues, ...pullRequests]
  const keep = new Set(discovered.map((conversation) => conversation.nodeId))
  const changed = discovered.filter((conversation) => {
    const cached = getCachedRow(conversation.nodeId)
    return forceHydration || !cached || cached.updatedAt !== conversation.updatedAt
  })
  await hydrate(changed, currentGeneration)
  if (currentGeneration !== generation) return
  pruneCachedRows(keep)
  emitRows()
}

async function reconcileIssues(configured: string): Promise<DiscoveredConversation[] | null> {
  type SearchResult = {
    search: {
      nodes: ({ id: string; number: number; updatedAt: string } | Record<string, never>)[]
      pageInfo: { hasNextPage: boolean; endCursor: string | null }
    }
  }
  const query = `is:issue repo:${configured} state:open sort:updated-desc`
  const conversations: DiscoveredConversation[] = []
  let after: string | null = null
  for (;;) {
    const data: SearchResult = await graphql<SearchResult>(
      `query ($q: String!, $after: String) {
        search(query: $q, type: ISSUE, first: 100, after: $after) {
          nodes { ... on Issue { id number updatedAt } }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { q: query, after },
    )
    for (const node of data.search.nodes) {
      if (!('id' in node)) continue
      conversations.push({ kind: 'issue', repo: configured, number: node.number, nodeId: node.id, updatedAt: node.updatedAt })
    }
    if (!data.search.pageInfo.hasNextPage) break
    if (budgetDegraded()) return null
    after = data.search.pageInfo.endCursor
  }
  return conversations
}

async function reconcilePullRequests(configured: string): Promise<DiscoveredConversation[] | null> {
  type SearchResult = {
    search: {
      nodes: ({ id: string; number: number; updatedAt: string } | Record<string, never>)[]
      pageInfo: { hasNextPage: boolean; endCursor: string | null }
    }
  }
  const query = `is:pr repo:${configured} state:open sort:updated-desc`
  const conversations: DiscoveredConversation[] = []
  let after: string | null = null
  for (;;) {
    const data: SearchResult = await graphql<SearchResult>(
      `query ($q: String!, $after: String) {
        search(query: $q, type: ISSUE, first: 100, after: $after) {
          nodes { ... on PullRequest { id number updatedAt } }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { q: query, after },
    )
    for (const node of data.search.nodes) {
      if (!('id' in node)) continue
      conversations.push({ kind: 'pullRequest', repo: configured, number: node.number, nodeId: node.id, updatedAt: node.updatedAt })
    }
    if (!data.search.pageInfo.hasNextPage) break
    if (budgetDegraded()) return null
    after = data.search.pageInfo.endCursor
  }
  return conversations
}

// ---------- Read state ----------

export async function markRead(nodeId: string): Promise<void> {
  const row = getCachedRow(nodeId)
  if (!row) return
  updateCachedRow(nodeId, { unread: false, commentCountAtRead: row.commentCount })
  const threadId = threadByNode.get(nodeId)
  if (threadId) {
    try {
      await restSend('PATCH', `/notifications/threads/${threadId}`)
    } catch (err) {
      console.warn('[markRead] failed to mark thread read:', err)
    }
  }
  emitRows()
}

/** Optimistic local update after a status/snooze edit. */
export function applyLocalEdit(nodeId: string, patch: Partial<CachedRow>): void {
  updateCachedRow(nodeId, patch)
  emitRows()
}

export function notifyRowsChanged(): void {
  emitRows()
}
