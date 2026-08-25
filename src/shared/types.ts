// Shared types between main and renderer. This file must stay
// dependency-free: it is imported from both tsconfig projects.

// ---------- Configuration ----------

export type BoardConfig = {
  projectId: string
  projectTitle: string
  statusFieldId: string
  snoozeFieldId: string
  /** status label -> single-select option ID */
  statusOptions: Record<string, string>
}

export type RepoConfig = {
  /** "owner/name" */
  repo: string
  /** local clone; empty string means "no code access" */
  path: string
  board?: BoardConfig
  useWorktrees: boolean
}

export type Settings = {
  /** explicit goose binary path override */
  goosePath?: string
  /** instructions appended to every session's system prompt */
  globalInstructions?: string
  /** instructions appended to issue sessions */
  issueInstructions?: string
  /** instructions appended to pull request sessions */
  pullRequestInstructions?: string
  /** the one repository this app is set up for */
  repo?: RepoConfig
}

export type GooseInfo = {
  path: string
  /** symlink-resolved path actually executed */
  resolvedPath: string
  version: string
  source: 'settings' | 'env' | 'desktop-app' | 'homebrew' | 'usr-local' | 'local-bin' | 'path'
}

export type AuthState = {
  authenticated: boolean
  login?: string
  /** why sign-in was rejected, with instructions where applicable */
  error?: string
}

// ---------- Sidebar ----------

export type ConversationKind = 'issue' | 'pullRequest'

export type CachedRow = {
  kind: ConversationKind
  repo: string
  issueNumber: number
  nodeId: string
  title: string
  /** issue author login; the "last voice" when there are no comments */
  author?: string
  assignees?: string[]
  state: string
  workflowStatus?: string
  snoozedUntil?: string
  lastComment?: { author: string; snippet: string }
  commentCount: number
  commentCountAtRead?: number
  createdAt?: string
  updatedAt: string
  hydratedAt: string
  /** GitHub notification thread says this issue has unread activity */
  unread?: boolean
  /** a Goose draft is waiting for this issue */
  hasPendingDraft?: boolean
  isDraft?: boolean
  linkedIssues?: { number: number; workflowStatus?: string }[]
  reviewDecision?: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED'
  reviewRequestedFrom?: string[]
}

// ---------- Issue detail (center pane) ----------

export type IssueComment = {
  id: number
  nodeId: string
  author: string
  authorAvatarUrl?: string
  body: string
  createdAt: string
  updatedAt: string
}

export type IssueDetail = {
  repo: string
  issueNumber: number
  nodeId: string
  title: string
  state: 'open' | 'closed'
  author: string
  authorAvatarUrl?: string
  assignees: string[]
  labels: { name: string; color: string }[]
  milestone?: string
  body: string
  bodyUpdatedAt: string
  createdAt: string
  updatedAt: string
  comments: IssueComment[]
  /** from board config, if the repo has one */
  workflowStatus?: string
  snoozedUntil?: string
  /** status labels available on this repo's board */
  availableStatuses: string[]
}

// ---------- Pull request detail (center pane) ----------

export type PullRequestReview = {
  id: number
  nodeId: string
  author: string
  authorAvatarUrl?: string
  body: string
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING'
  submittedAt?: string
}

export type PullRequestReviewComment = {
  id: number
  nodeId: string
  author: string
  authorAvatarUrl?: string
  body: string
  createdAt: string
  updatedAt: string
  path: string
  line?: number
  originalLine?: number
  diffHunk: string
}

export type PullRequestReviewThread = {
  id: string
  resolved: boolean
  comments: PullRequestReviewComment[]
}

export type PullRequestDetail = {
  repo: string
  pullRequestNumber: number
  nodeId: string
  title: string
  state: 'open' | 'closed'
  merged: boolean
  author: string
  authorAvatarUrl?: string
  assignees: string[]
  labels: { name: string; color: string }[]
  body: string
  createdAt: string
  updatedAt: string
  isDraft: boolean
  baseRefName: string
  headRefName: string
  headRepo?: string
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
  reviewDecision?: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED'
  requestedReviewers: string[]
  viewerReviewState?: PullRequestReview['state']
  checks?: { state: 'SUCCESS' | 'FAILURE' | 'PENDING' | 'ERROR' | 'EXPECTED'; total: number }
  comments: IssueComment[]
  reviews: PullRequestReview[]
  reviewThreads: PullRequestReviewThread[]
}

// ---------- Goose conversation (right pane) ----------

export type GooseToolCall = {
  toolCallId: string
  title: string
  kind?: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
}

export type GooseMessage =
  | { role: 'user'; id: string; text: string }
  | { role: 'agent'; id: string; text: string; toolCalls: GooseToolCall[] }

export type GooseSessionView = {
  issueNodeId: string
  sessionId?: string
  messages: GooseMessage[]
  /** a prompt turn is currently streaming */
  busy: boolean
  /** repo has no configured local clone */
  noWorkspace: boolean
  error?: string
}

/** streamed updates from main -> renderer for the right pane */
export type GooseStreamEvent =
  | { type: 'agent-text'; issueNodeId: string; messageId: string; delta: string }
  | { type: 'tool-call'; issueNodeId: string; messageId: string; call: GooseToolCall }
  | { type: 'turn-end'; issueNodeId: string; stopReason: string }
  | { type: 'error'; issueNodeId: string; message: string }

// ---------- Drafts ----------

export type PendingDraft = {
  issueNodeId: string
  text: string
  createdAt: string
}

// ---------- Board setup helpers ----------

export type ProjectSummary = { id: string; title: string; number: number }
export type ProjectField =
  | { id: string; name: string; dataType: 'SINGLE_SELECT'; options: { id: string; name: string }[] }
  | { id: string; name: string; dataType: 'DATE' }

// ---------- Rate limit ----------

export type RateBudget = {
  remaining: number
  limit: number
  resetAt: string
  lastCost: number
  degraded: boolean
}
