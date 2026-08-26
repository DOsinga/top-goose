import { safeStorage } from 'electron'
import type { CachedRow, PendingDraft, RepoConfig, Settings } from '../shared/types'
import { JsonFile } from './persist'

// ---------- Settings ----------

let settingsFile: JsonFile<Settings> | null = null

export function settings(): JsonFile<Settings> {
  if (settingsFile) return settingsFile
  settingsFile = new JsonFile<Settings>('settings.json', {})
  const current = settingsFile.get() as Settings & {
    globalInstructions?: string
    repo?: RepoConfig & { instructions?: string }
  }
  if ('globalInstructions' in current || (current.repo && 'instructions' in current.repo)) {
    const next = { ...current }
    delete next.globalInstructions
    if (next.repo) {
      next.repo = { ...next.repo }
      delete next.repo.instructions
    }
    settingsFile.set(next)
  }
  return settingsFile
}

export function repoConfig(repo: string): RepoConfig | undefined {
  const configured = settings().get().repo
  return configured && configured.repo.toLowerCase() === repo.toLowerCase() ? configured : undefined
}

// ---------- GitHub token (encrypted at rest via safeStorage) ----------

type TokenState = { encrypted?: string; plain?: string; login?: string }

let tokenFile: JsonFile<TokenState> | null = null

function tokens(): JsonFile<TokenState> {
  tokenFile ??= new JsonFile<TokenState>('auth.json', {})
  return tokenFile
}

export function getGitHubToken(): string | null {
  const t = tokens().get()
  if (t.encrypted && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(t.encrypted, 'base64'))
    } catch {
      return null
    }
  }
  return t.plain ?? null
}

export function setGitHubToken(token: string, login?: string): void {
  if (safeStorage.isEncryptionAvailable()) {
    tokens().set({
      encrypted: safeStorage.encryptString(token).toString('base64'),
      login,
    })
  } else {
    tokens().set({ plain: token, login })
  }
}

export function clearGitHubToken(): void {
  tokens().set({})
}

export function getAuthMeta(): { login?: string } {
  const t = tokens().get()
  return { login: t.login }
}

export function setAuthLogin(login: string): void {
  tokens().update((t) => ({ ...t, login }))
}

// ---------- Issue <-> session mapping ----------

export type IssueSession = {
  issueNodeId: string // primary key
  kind?: 'issue' | 'pullRequest'
  host: string
  account: string
  repo: string
  issueNumber: number
  sessionId: string
  lastSyncedCommentId?: number
  lastSyncedIssueUpdatedAt?: string
  lastSyncedCommentCount?: number
  lastSyncedBodyUpdatedAt?: string
  lastSyncedHistoryHash?: string
  worktreePath?: string
}

type SessionMap = { sessions: Record<string, IssueSession> }

let sessionsFile: JsonFile<SessionMap> | null = null

function sessionStore(): JsonFile<SessionMap> {
  sessionsFile ??= new JsonFile<SessionMap>('issue-sessions.json', { sessions: {} })
  return sessionsFile
}

export function getIssueSession(issueNodeId: string): IssueSession | undefined {
  const account = getAuthMeta().login
  if (!account) return undefined
  const stored = sessionStore().get().sessions
  const session = stored[issueSessionKey('github.com', account, issueNodeId)]
  if (session) return session

  const legacy = stored[issueNodeId]
  return legacy?.host === 'github.com' && legacy.account === account ? legacy : undefined
}

export function saveIssueSession(session: IssueSession): void {
  sessionStore().update((s) => ({
    sessions: { ...s.sessions, [issueSessionKey(session.host, session.account, session.issueNodeId)]: session },
  }))
}

export function issueSessionKey(host: string, account: string, issueNodeId: string): string {
  return `${host.toLowerCase()}:${account.toLowerCase()}:${issueNodeId}`
}

// ---------- Sidebar cache ----------

type SidebarCache = { rows: Record<string, CachedRow> }

let cacheFile: JsonFile<SidebarCache> | null = null

function sidebarCache(): JsonFile<SidebarCache> {
  cacheFile ??= new JsonFile<SidebarCache>('sidebar-cache.json', { rows: {} })
  return cacheFile
}

export function getCachedRows(): CachedRow[] {
  return Object.values(sidebarCache().get().rows).map((row) => ({ ...row, kind: row.kind ?? 'issue' }))
}

export function getCachedRow(nodeId: string): CachedRow | undefined {
  const row = sidebarCache().get().rows[nodeId]
  return row ? { ...row, kind: row.kind ?? 'issue' } : undefined
}

const searchedRows = new Map<string, CachedRow>()

export function putSearchedRows(rows: CachedRow[]): void {
  for (const row of rows) searchedRows.set(row.nodeId, row)
}

export function getConversationRow(nodeId: string): CachedRow | undefined {
  return getCachedRow(nodeId) ?? searchedRows.get(nodeId)
}

export function clearSearchedRows(): void {
  searchedRows.clear()
}

export function putCachedRows(rows: CachedRow[]): void {
  sidebarCache().update((c) => {
    const next = { ...c.rows }
    for (const row of rows) next[row.nodeId] = row
    return { rows: next }
  })
}

export function updateCachedRow(nodeId: string, patch: Partial<CachedRow>): CachedRow | undefined {
  let updated: CachedRow | undefined
  sidebarCache().update((c) => {
    const existing = c.rows[nodeId]
    if (!existing) return c
    updated = { ...existing, ...patch }
    return { rows: { ...c.rows, [nodeId]: updated } }
  })
  return updated
}

export function removeCachedRow(nodeId: string): void {
  sidebarCache().update((c) => {
    const next = { ...c.rows }
    delete next[nodeId]
    return { rows: next }
  })
}

/** Remove rows not in the keep set (reconciliation dropped them). */
export function pruneCachedRows(keep: Set<string>): void {
  sidebarCache().update((c) => {
    const next: Record<string, CachedRow> = {}
    for (const [id, row] of Object.entries(c.rows)) {
      if (keep.has(id)) next[id] = row
    }
    return { rows: next }
  })
}

export function clearCachedRows(): void {
  sidebarCache().set({ rows: {} })
}

// ---------- Pending drafts (in-memory; a draft does not survive restart) ----------

const pendingDrafts = new Map<string, PendingDraft>()

export function setPendingDraft(draft: PendingDraft): void {
  pendingDrafts.set(draft.issueNodeId, draft)
}

export function takePendingDraft(issueNodeId: string): PendingDraft | null {
  const draft = pendingDrafts.get(issueNodeId) ?? null
  pendingDrafts.delete(issueNodeId)
  return draft
}

export function hasPendingDraft(issueNodeId: string): boolean {
  return pendingDrafts.has(issueNodeId)
}

export function clearPendingDrafts(): void {
  pendingDrafts.clear()
}

export function flushAllStores(): void {
  settingsFile?.flush()
  tokenFile?.flush()
  sessionsFile?.flush()
  cacheFile?.flush()
}
