import { existsSync } from 'node:fs'
import type {
  GooseMessage,
  GooseSessionView,
  GooseStreamEvent,
  GooseToolCall,
} from '../../shared/types'
import { mcpServerConfig } from '../mcp/draftServer'
import {
  getAuthMeta,
  getConversationRow,
  getIssueSession,
  repoConfig,
  saveIssueSession,
  settings,
  type IssueSession,
} from '../store'
import { acp, type SessionUpdate } from './acp'
import { buildContext, promptWithContext, visibleUserMessage } from './contextSync'
import { sessionInstructions } from './instructions'
import { ensureWorktree } from './worktrees'

/**
 * One persistent Goose session per GitHub issue or pull request. The mapping
 * is keyed on the GitHub node ID; Goose owns the conversation history.
 *
 * Opening an issue never causes an agent turn: if a mapping exists the
 * session is loaded (history replayed), otherwise the session is created
 * lazily on the first prompt — which also keeps merely-glanced-at issues out
 * of goose's session store and defers worktree creation to first use.
 */

type LiveSession = {
  issueNodeId: string
  sessionId: string
  messages: GooseMessage[]
  busy: boolean
  currentAgent?: { id: string; text: string; toolCalls: GooseToolCall[] }
}

const liveByIssue = new Map<string, LiveSession>()
const issueBySessionId = new Map<string, string>()
const openingByIssue = new Map<string, Promise<GooseSessionView>>()

let streamListener: ((event: GooseStreamEvent) => void) | null = null

export function onGooseStream(listener: (event: GooseStreamEvent) => void): void {
  streamListener = listener
}

function emit(event: GooseStreamEvent): void {
  streamListener?.(event)
}

// ---------- streaming updates from goose ----------

acp.onSessionUpdate((sessionId, update) => {
  const issueNodeId = issueBySessionId.get(sessionId)
  if (!issueNodeId) return
  const live = [...liveByIssue.values()].find((l) => l.sessionId === sessionId)
  if (!live) return
  applyUpdate(live, update, true)
})

function applyUpdate(live: LiveSession, update: SessionUpdate, notify: boolean): void {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk': {
      const content = update.content as { type: string; text?: string }
      if (content.type !== 'text' || !content.text) return
      const messageId = (update as { messageId?: string }).messageId ?? `agent-${live.messages.length}`
      if (!live.currentAgent || live.currentAgent.id !== messageId) {
        live.currentAgent = { id: messageId, text: '', toolCalls: [] }
        live.messages.push({ role: 'agent', id: messageId, text: '', toolCalls: live.currentAgent.toolCalls })
      }
      live.currentAgent.text += content.text
      const msg = live.messages[live.messages.length - 1]
      if (msg.role === 'agent') msg.text = live.currentAgent.text
      if (notify) {
        emit({ type: 'agent-text', issueNodeId: live.issueNodeId, messageId, delta: content.text })
      }
      break
    }
    case 'user_message_chunk': {
      if (notify) return
      const content = update.content as { type: string; text?: string }
      if (content.type !== 'text' || !content.text) return
      const messageId = (update as { messageId?: string }).messageId ?? `user-${live.messages.length}`
      appendReplayUser(live, messageId, content.text)
      break
    }
    case 'tool_call': {
      const u = update as { toolCallId: string; title: string; kind?: string; status?: GooseToolCall['status'] }
      const call: GooseToolCall = {
        toolCallId: u.toolCallId,
        title: u.title,
        kind: u.kind,
        status: u.status ?? 'pending',
      }
      ensureAgentMessage(live).toolCalls.push(call)
      if (notify) {
        emit({ type: 'tool-call', issueNodeId: live.issueNodeId, messageId: live.currentAgent!.id, call })
      }
      break
    }
    case 'tool_call_update': {
      const u = update as { toolCallId: string; title?: string; kind?: string; status?: GooseToolCall['status'] }
      for (const msg of live.messages) {
        if (msg.role !== 'agent') continue
        const call = msg.toolCalls.find((c) => c.toolCallId === u.toolCallId)
        if (call) {
          if (u.status) call.status = u.status
          if (u.title) call.title = u.title
          if (u.kind) call.kind = u.kind
          if (notify) emit({ type: 'tool-call', issueNodeId: live.issueNodeId, messageId: msg.id, call })
          break
        }
      }
      break
    }
    default:
      break
  }
}

function appendReplayUser(live: LiveSession, messageId: string, prompt: string): void {
  live.currentAgent = undefined
  live.messages.push({ role: 'user', id: messageId, text: visibleUserMessage(prompt) })
}

function applyReplay(live: LiveSession, updates: SessionUpdate[]): void {
  let userId: string | undefined
  let userPrompt = ''

  const flushUser = (): void => {
    if (userId) appendReplayUser(live, userId, userPrompt)
    userId = undefined
    userPrompt = ''
  }

  for (const update of updates) {
    if (update.sessionUpdate === 'user_message_chunk') {
      const content = update.content as { type: string; text?: string }
      if (content.type !== 'text' || !content.text) continue
      const messageId = (update as { messageId?: string }).messageId ?? userId ?? `user-${live.messages.length}`
      if (userId && userId !== messageId) flushUser()
      userId = messageId
      userPrompt += content.text
      continue
    }
    flushUser()
    applyUpdate(live, update, false)
  }
  flushUser()
}

function ensureAgentMessage(live: LiveSession): { id: string; text: string; toolCalls: GooseToolCall[] } {
  if (!live.currentAgent) {
    live.currentAgent = { id: `agent-${live.messages.length}`, text: '', toolCalls: [] }
    live.messages.push({
      role: 'agent',
      id: live.currentAgent.id,
      text: '',
      toolCalls: live.currentAgent.toolCalls,
    })
  }
  return live.currentAgent
}

// ---------- draft_reply attachment ----------

/**
 * goose before #11339 (>1.47.0) REPLACES a session's whole extension list
 * with any mcpServers passed at session/new or session/load — silently
 * dropping developer and every user-configured extension. So sessions are
 * created and loaded bare, and draft_reply is attached afterwards via
 * `_goose/unstable/session/extensions/add`. Binaries without that method
 * fall back to inline servers, accepting the extension loss.
 */
let canAddExtensions = true

async function attachDraftServer(sessionId: string, issueNodeId: string, cwd: string): Promise<void> {
  if (canAddExtensions) {
    if (await acp.addHttpExtension(sessionId, mcpServerConfig(issueNodeId))) return
    canAddExtensions = false
    console.warn('[goose] extensions/add unsupported; passing MCP servers inline (extensions may be dropped)')
  }
  await acp.loadSession(sessionId, cwd, [mcpServerConfig(issueNodeId)])
}

// ---------- opening (no agent turn) ----------

export function openIssueSession(issueNodeId: string): Promise<GooseSessionView> {
  const opening = openingByIssue.get(issueNodeId)
  if (opening) return opening
  const next = openIssueSessionInner(issueNodeId).finally(() => openingByIssue.delete(issueNodeId))
  openingByIssue.set(issueNodeId, next)
  return next
}

async function openIssueSessionInner(issueNodeId: string): Promise<GooseSessionView> {
  const row = getConversationRow(issueNodeId)
  const config = row ? repoConfig(row.repo) : undefined
  const noWorkspace = !config?.path

  const existing = liveByIssue.get(issueNodeId)
  if (existing) return view(existing, noWorkspace)

  const mapping = getIssueSession(issueNodeId)
  if (!mapping) {
    const live: LiveSession = { issueNodeId, sessionId: '', messages: [], busy: false }
    liveByIssue.set(issueNodeId, live)
    return view(live, noWorkspace)
  }

  // resume: load replays history before returning
  const live: LiveSession = { issueNodeId, sessionId: mapping.sessionId, messages: [], busy: false }
  liveByIssue.set(issueNodeId, live)
  issueBySessionId.set(mapping.sessionId, issueNodeId)
  try {
    const cwd = await sessionCwd(mapping)
    const replay = await acp.loadSession(mapping.sessionId, cwd, [])
    applyReplay(live, replay)
    live.currentAgent = undefined
    await attachDraftServer(mapping.sessionId, issueNodeId, cwd)
    await applyInstructions(mapping.sessionId, mapping.kind ?? 'issue')
  } catch (err) {
    liveByIssue.delete(issueNodeId)
    issueBySessionId.delete(mapping.sessionId)
    throw new Error(`Could not resume Goose session: ${message(err)}`)
  }
  return view(live, noWorkspace)
}

function view(live: LiveSession, noWorkspace: boolean): GooseSessionView {
  return {
    issueNodeId: live.issueNodeId,
    sessionId: live.sessionId || undefined,
    messages: live.messages,
    busy: live.busy,
    noWorkspace,
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// ---------- prompting ----------

export async function promptIssue(issueNodeId: string, text: string): Promise<void> {
  const opening = openingByIssue.get(issueNodeId)
  if (opening) await opening
  const live = liveByIssue.get(issueNodeId)
  if (!live) throw new Error('open the issue first')
  if (live.busy) throw new Error('Goose is already working on this issue')

  live.busy = true
  live.messages.push({ role: 'user', id: `local-${Date.now()}`, text })
  try {
    const mapping = await ensureSession(issueNodeId, live)
    await applyInstructions(mapping.sessionId, mapping.kind ?? 'issue')
    const isFirstTurn = mapping.lastSyncedIssueUpdatedAt === undefined
    const sync = await buildContext(mapping, isFirstTurn)

    const prompt = promptWithContext(sync.contextBlock, text)

    live.currentAgent = undefined
    const result = await acp.prompt(mapping.sessionId, prompt)
    // the prompt was accepted (even a cancelled turn saw the context), so
    // the synchronization cursor advances now and not before
    saveIssueSession({ ...mapping, ...sync.cursors })
    emit({ type: 'turn-end', issueNodeId, stopReason: result.stopReason })
  } catch (err) {
    emit({ type: 'error', issueNodeId, message: message(err) })
    throw err
  } finally {
    live.busy = false
    live.currentAgent = undefined
  }
}

export function cancelIssue(issueNodeId: string): void {
  const live = liveByIssue.get(issueNodeId)
  if (live?.sessionId) acp.cancel(live.sessionId)
}

// ---------- session creation ----------

async function ensureSession(issueNodeId: string, live: LiveSession): Promise<IssueSession> {
  const existing = getIssueSession(issueNodeId)
  if (existing && live.sessionId) return existing

  const row = getConversationRow(issueNodeId)
  if (!row) throw new Error('unknown GitHub conversation')

  if (existing) {
    // mapping exists but the session was never loaded this run
    issueBySessionId.set(existing.sessionId, issueNodeId)
    live.sessionId = existing.sessionId
    const existingCwd = await sessionCwd(existing)
    const replay = await acp.loadSession(existing.sessionId, existingCwd, [])
    applyReplay(live, replay)
    live.currentAgent = undefined
    await attachDraftServer(existing.sessionId, issueNodeId, existingCwd)
    return existing
  }

  const config = repoConfig(row.repo)
  if (!config?.path) {
    throw new Error(`Configure a local clone for ${row.repo} before asking Goose`)
  }
  let cwd = config.path
  let worktreePath: string | undefined
  if (config.useWorktrees) {
    worktreePath = await ensureWorktree(config.path, row.kind, row.issueNumber)
    cwd = worktreePath
  }

  const sessionId = await acp.newSession(cwd, [])
  await attachDraftServer(sessionId, issueNodeId, cwd)
  const mapping: IssueSession = {
    issueNodeId,
    kind: row.kind,
    host: 'github.com',
    account: getAuthMeta().login ?? 'unknown',
    repo: row.repo,
    issueNumber: row.issueNumber,
    sessionId,
    worktreePath,
  }
  saveIssueSession(mapping)
  live.sessionId = sessionId
  issueBySessionId.set(sessionId, issueNodeId)
  return mapping
}

async function sessionCwd(mapping: IssueSession): Promise<string> {
  if (mapping.worktreePath && existsSync(mapping.worktreePath)) return mapping.worktreePath
  const config = repoConfig(mapping.repo)
  if (!config?.path) throw new Error(`Configure a local clone for ${mapping.repo} before asking Goose`)
  if (config.useWorktrees) {
    const worktreePath = await ensureWorktree(config.path, mapping.kind ?? 'issue', mapping.issueNumber)
    saveIssueSession({ ...mapping, worktreePath })
    return worktreePath
  }
  return config.path
}

/**
 * Issue/PR instructions, appended to the session's system prompt.
 * Not persisted by goose, so re-applied after every load and before every
 * turn. Older binaries without the method just skip this.
 */
async function applyInstructions(sessionId: string, kind: 'issue' | 'pullRequest'): Promise<void> {
  const s = settings().get()
  try {
    await acp.setSystemPromptExtra(
      sessionId,
      'top-goose-instructions',
      sessionInstructions(s, kind),
    )
  } catch (err) {
    console.warn('[goose] could not set instructions:', err)
  }
}

export function shutdownSessions(): void {
  acp.shutdown()
}

export function resetSessions(): void {
  acp.shutdown()
  liveByIssue.clear()
  issueBySessionId.clear()
  openingByIssue.clear()
}
