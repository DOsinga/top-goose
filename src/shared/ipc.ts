import type {
  AuthState,
  CachedRow,
  GooseInfo,
  GooseSessionView,
  GooseStreamEvent,
  IssueDetail,
  PendingDraft,
  PullRequestDetail,
  ProjectField,
  ProjectSummary,
  RateBudget,
  RepoConfig,
  Settings,
} from './types'

/**
 * Request/response channels, exposed as `window.topGoose.invoke(channel, ...args)`.
 * Every entry is handled with ipcMain.handle in src/main/ipc.ts.
 */
export type InvokeMap = {
  // settings
  'settings:get': () => Settings
  'settings:update': (patch: Partial<Settings>) => Settings
  'settings:saveRepo': (config: RepoConfig) => Settings
  'settings:removeRepo': () => Settings
  /** directory picker; derives owner/name from the clone's origin remote */
  'repo:pickClone': () => { repo: string; path: string } | { error: string } | null

  // auth
  'auth:state': () => AuthState
  'auth:setToken': (token: string) => AuthState
  'auth:signOut': () => AuthState

  // goose binary
  'goose:info': () => GooseInfo | { error: string }

  // sidebar
  'sidebar:rows': () => CachedRow[]
  'sidebar:refresh': () => void
  'search:conversations': (query: string) => CachedRow[]

  // issue detail
  'issue:open': (nodeId: string) => IssueDetail
  'issue:markRead': (nodeId: string) => void
  'issue:reply': (nodeId: string, body: string) => IssueComment_
  'issue:setAssignee': (nodeId: string, login: string | null) => string[]
  'issue:setStatus': (nodeId: string, status: string) => void
  'issue:setSnooze': (nodeId: string, date: string | null) => void

  // pull request detail
  'pullRequest:open': (nodeId: string) => PullRequestDetail
  'pullRequest:reply': (nodeId: string, body: string) => IssueComment_
  'pullRequest:approve': (nodeId: string) => PullRequestDetail

  // board setup
  'board:listProjects': (repo: string) => ProjectSummary[]
  'board:listFields': (projectId: string) => ProjectField[]

  // goose sessions
  'session:open': (issueNodeId: string) => GooseSessionView
  'session:prompt': (issueNodeId: string, text: string) => void
  'session:cancel': (issueNodeId: string) => void

  // drafts
  'draft:take': (issueNodeId: string) => PendingDraft | null

  // rate budget
  'budget:get': () => RateBudget | null
}

// IssueComment is re-exported under a private alias so this file only
// imports types (keeps the map readable above).
import type { IssueComment as IssueComment_ } from './types'

/**
 * Push channels, main -> renderer, subscribed via `window.topGoose.on(channel, cb)`.
 */
export type PushMap = {
  'push:sidebar': (rows: CachedRow[]) => void
  'push:goose': (event: GooseStreamEvent) => void
  'push:draft': (draft: PendingDraft) => void
  'push:auth': (state: AuthState) => void
  'push:budget': (budget: RateBudget) => void
  'push:reset': () => void
}

export type InvokeChannel = keyof InvokeMap
export type PushChannel = keyof PushMap

export type TopGooseApi = {
  invoke: <C extends InvokeChannel>(
    channel: C,
    ...args: Parameters<InvokeMap[C]>
  ) => Promise<Awaited<ReturnType<InvokeMap[C]>>>
  on: <C extends PushChannel>(channel: C, cb: PushMap[C]) => () => void
}
