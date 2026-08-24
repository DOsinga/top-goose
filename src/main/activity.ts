import type { CachedRow } from '../shared/types'
import { budgetDegraded, graphql, isProjectScopeError, restGet, restSend } from './github/client'
import { extractBoardFields } from './github/projects'
import {
  getCachedRow,
  getCachedRows,
  hasPendingDraft,
  pruneCachedRows,
  putCachedRows,
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

/** notification thread IDs by issue node ID, for mark-as-read */
const threadByNode = new Map<string, string>()
/** issues discovered by notifications before we know their node ID */
type IssueRef = { repo: string; number: number }

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
  void reconcile().catch((err) => console.warn('[reconcile] failed:', err))
  reconcileTimer = setInterval(() => {
    void reconcile().catch((err) => console.warn('[reconcile] failed:', err))
  }, RECONCILE_INTERVAL_MS)
  void pollLoop()
  emitRows()
}

export function stop(): void {
  if (notifTimer) clearTimeout(notifTimer)
  if (reconcileTimer) clearInterval(reconcileTimer)
  notifTimer = null
  reconcileTimer = null
}

export async function refreshNow(): Promise<void> {
  notifEtag = undefined
  await reconcile()
  await pollNotificationsOnce()
}

// ---------- Change detection: REST notifications ----------

type RestNotification = {
  id: string
  unread: boolean
  updated_at: string
  subject: { title: string; url: string | null; type: string }
  repository: { full_name: string }
}

async function pollLoop(): Promise<void> {
  let interval = DEFAULT_POLL_INTERVAL_S
  try {
    interval = (await pollNotificationsOnce()) ?? interval
  } catch (err) {
    console.warn('[notifications] poll failed:', err)
  }
  notifTimer = setTimeout(() => void pollLoop(), interval * 1000)
}

/** Returns the server-requested poll interval, if any. */
async function pollNotificationsOnce(): Promise<number | undefined> {
  const res = await restGet<RestNotification[]>('/notifications?per_page=50', notifEtag)
  if (res.status === 304) return res.pollInterval
  notifEtag = res.etag
  const changed: IssueRef[] = []
  const configured = settingsRepo()
  for (const n of res.data ?? []) {
    // pull requests are not channels; filter their notifications out
    if (n.subject.type !== 'Issue' || !n.subject.url) continue
    // the app is scoped to the one configured repository
    if (configured && n.repository.full_name.toLowerCase() !== configured) continue
    const match = n.subject.url.match(/\/issues\/(\d+)$/)
    if (!match) continue
    const ref: IssueRef = { repo: n.repository.full_name, number: parseInt(match[1], 10) }
    const cached = findCachedByRef(ref)
    if (cached) {
      threadByNode.set(cached.nodeId, n.id)
      if (n.unread && !cached.unread) updateCachedRow(cached.nodeId, { unread: true })
    }
    // hand-rolled conditional request: hydrate only if GitHub is newer than cache
    if (!cached || n.updated_at > cached.updatedAt) {
      changed.push(ref)
      pendingThreadIds.set(refKey(ref), n.id)
    }
  }
  if (changed.length > 0) {
    await hydrate(changed)
    emitRows()
  }
  return res.pollInterval
}

const pendingThreadIds = new Map<string, string>()

function refKey(ref: IssueRef): string {
  return `${ref.repo.toLowerCase()}#${ref.number}`
}

function findCachedByRef(ref: IssueRef): CachedRow | undefined {
  return getCachedRows().find((r) => r.repo.toLowerCase() === ref.repo.toLowerCase() && r.issueNumber === ref.number)
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

// ---------- Hydration: batched GraphQL over deltas only ----------

async function hydrate(refs: IssueRef[]): Promise<void> {
  if (refs.length === 0) return
  if (budgetDegraded()) {
    console.warn('[hydrate] budget degraded; serving cached rows only')
    return
  }
  // Batched by aliased repository(...) { issue(...) } selections; notification
  // subjects do not carry node IDs, so this addresses by repo+number.
  const batch = refs.slice(0, 50)
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
  const rows: CachedRow[] = []
  for (let i = 0; i < batch.length; i++) {
    const issue = data[`x${i}`]?.issue
    if (!issue) continue
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

// ---------- Reconciliation: the complete desired set, on a slow timer ----------

async function reconcile(): Promise<void> {
  type SearchResult = { search: { nodes: (GqlIssueRow | Record<string, never>)[] } }
  const configured = settingsRepo()
  const query = configured
    ? `is:issue repo:${configured} involves:@me state:open sort:updated-desc`
    : 'is:issue involves:@me state:open sort:updated-desc'
  const data = await rowQuery<SearchResult>(
    (fragment) => `query ($q: String!) {
      search(query: $q, type: ISSUE, first: 50) {
        nodes { ...RowFields }
      }
    } ${fragment}`,
    { q: query },
  )
  const rows: CachedRow[] = []
  const keep = new Set<string>()
  for (const node of data.search.nodes) {
    if (!('id' in node)) continue
    const row = toRow(node as GqlIssueRow)
    keep.add(row.nodeId)
    rows.push(row)
  }
  putCachedRows(rows)
  pruneCachedRows(keep)
  emitRows()
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
