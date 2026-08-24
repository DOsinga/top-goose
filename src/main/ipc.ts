import { BrowserWindow, dialog, ipcMain } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)
import type { InvokeMap } from '../shared/ipc'
import type { PendingDraft, RateBudget } from '../shared/types'
import * as activity from './activity'
import { authState, setPat, signOut } from './github/auth'
import { onBudgetChange, getBudget } from './github/client'
import { fetchIssueDetail, postComment } from './github/issues'
import { listFields, listProjects, setIssueSnooze, setIssueStatus } from './github/projects'
import { findGoose, invalidateGooseInfo } from './goose/discover'
import {
  cancelIssue,
  onGooseStream,
  openIssueSession,
  promptIssue,
  resetSessions,
  respondIssuePermission,
} from './goose/sessions'
import { onDraft } from './mcp/draftServer'
import { getAuthMeta, getCachedRow, getGitHubToken, repoConfig, settings, takePendingDraft } from './store'

function handle<C extends keyof InvokeMap>(
  channel: C,
  handler: (...args: Parameters<InvokeMap[C]>) => Promise<ReturnType<InvokeMap[C]>> | ReturnType<InvokeMap[C]>,
): void {
  ipcMain.handle(channel, (_event, ...args) => handler(...(args as Parameters<InvokeMap[C]>)))
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

export function registerIpc(): void {
  // ----- push wiring -----
  activity.onRows((rows) => broadcast('push:sidebar', rows))
  onGooseStream((event) => broadcast('push:goose', event))
  onDraft((draft: PendingDraft) => {
    broadcast('push:draft', draft)
    activity.notifyRowsChanged() // sidebar rows carry hasPendingDraft
  })
  onBudgetChange((budget: RateBudget) => broadcast('push:budget', budget))

  // ----- settings -----
  handle('settings:get', () => settings().get())
  handle('settings:update', (patch) => {
    const next = settings().update((s) => ({ ...s, ...patch }))
    invalidateGooseInfo()
    return next
  })
  handle('settings:saveRepo', async (config) => {
    const previous = settings().get().repo
    const next = settings().update((s) => ({ ...s, repo: config }))
    const workspaceChanged =
      previous?.repo.toLowerCase() !== config.repo.toLowerCase() ||
      previous.path !== config.path ||
      previous.useWorktrees !== config.useWorktrees
    if (workspaceChanged) {
      resetSessions()
      activity.reset()
      broadcast('push:reset', undefined)
      if (getGitHubToken()) activity.start()
    } else if (getGitHubToken()) {
      await activity.refreshNow()
    }
    return next
  })
  handle('settings:removeRepo', () => {
    const next = settings().update((s) => ({ ...s, repo: undefined }))
    resetSessions()
    activity.reset()
    broadcast('push:reset', undefined)
    return next
  })
  handle('repo:pickClone', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose the local clone',
      properties: ['openDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const path = result.filePaths[0]
    try {
      const { stdout } = await execFileP('git', ['remote', 'get-url', 'origin'], { cwd: path })
      const match = stdout.trim().match(/github\.com[:/]([^/]+)\/([^/\s]+?)(?:\.git)?$/)
      if (!match) return { error: `origin remote is not a GitHub repo: ${stdout.trim()}` }
      return { repo: `${match[1]}/${match[2]}`, path }
    } catch {
      return { error: `${path} does not look like a git clone (no origin remote)` }
    }
  })

  // ----- auth -----
  handle('auth:state', () => authState())
  handle('auth:setToken', async (token) => {
    const previousAccount = getAuthMeta().login
    const state = await setPat(token)
    if (state.authenticated) {
      if (previousAccount?.toLowerCase() !== state.login?.toLowerCase()) {
        resetSessions()
        activity.reset()
        broadcast('push:reset', undefined)
      }
      activity.start()
    }
    broadcast('push:auth', state)
    return state
  })
  handle('auth:signOut', () => {
    resetSessions()
    activity.reset()
    const state = signOut()
    broadcast('push:reset', undefined)
    broadcast('push:auth', state)
    return state
  })

  // ----- goose binary -----
  handle('goose:info', async () => {
    try {
      return await findGoose()
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ----- sidebar -----
  handle('sidebar:rows', () => activity.currentRows())
  handle('sidebar:refresh', async () => {
    await activity.refreshNow()
  })

  // ----- issue detail -----
  handle('issue:open', async (nodeId) => {
    const row = getCachedRow(nodeId)
    if (!row) throw new Error('unknown issue')
    return fetchIssueDetail(row.repo, row.issueNumber)
  })
  handle('issue:markRead', (nodeId) => activity.markRead(nodeId))
  handle('issue:reply', async (nodeId, body) => {
    const row = getCachedRow(nodeId)
    if (!row) throw new Error('unknown issue')
    const comment = await postComment(row.repo, row.issueNumber, body)
    // own reply counts as read
    activity.applyLocalEdit(nodeId, {
      commentCount: row.commentCount + 1,
      commentCountAtRead: row.commentCount + 1,
      lastComment: { author: comment.author, snippet: comment.body.replace(/\s+/g, ' ').slice(0, 120) },
      updatedAt: comment.createdAt,
    })
    return comment
  })
  handle('issue:setStatus', async (nodeId, status) => {
    const row = getCachedRow(nodeId)
    if (!row) throw new Error('unknown issue')
    const board = repoConfig(row.repo)?.board
    if (!board) throw new Error(`no board configured for ${row.repo}`)
    // update the cached row immediately; reconcile against the round trip
    activity.applyLocalEdit(nodeId, { workflowStatus: status })
    try {
      await setIssueStatus(board, nodeId, status)
    } catch (err) {
      activity.applyLocalEdit(nodeId, { workflowStatus: row.workflowStatus })
      throw err
    }
  })
  handle('issue:setSnooze', async (nodeId, date) => {
    const row = getCachedRow(nodeId)
    if (!row) throw new Error('unknown issue')
    const board = repoConfig(row.repo)?.board
    if (!board) throw new Error(`no board configured for ${row.repo}`)
    activity.applyLocalEdit(nodeId, { snoozedUntil: date ?? undefined })
    try {
      await setIssueSnooze(board, nodeId, date)
    } catch (err) {
      activity.applyLocalEdit(nodeId, { snoozedUntil: row.snoozedUntil })
      throw err
    }
  })

  // ----- board setup -----
  handle('board:listProjects', (repo) => listProjects(repo))
  handle('board:listFields', (projectId) => listFields(projectId))

  // ----- goose sessions -----
  handle('session:open', (issueNodeId) => openIssueSession(issueNodeId))
  handle('session:prompt', async (issueNodeId, text) => {
    await promptIssue(issueNodeId, text)
  })
  handle('session:cancel', (issueNodeId) => cancelIssue(issueNodeId))
  handle('session:permission', (issueNodeId, requestId, allow) =>
    respondIssuePermission(issueNodeId, requestId, allow),
  )

  // ----- drafts -----
  handle('draft:take', (issueNodeId) => {
    const draft = takePendingDraft(issueNodeId)
    activity.notifyRowsChanged()
    return draft
  })

  // ----- budget -----
  handle('budget:get', () => getBudget())
}
