import { ChildProcess, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { findGoose } from './discover'

/**
 * Minimal ACP client for `goose acp`: newline-delimited JSON-RPC 2.0 over
 * stdio. One long-lived child multiplexes all sessions.
 *
 * Wire notes (verified against goose 1.41):
 *  - protocolVersion is the number 1, not "v1"
 *  - MCP servers on the wire are { type: "http", name, url,
 *    headers: [{name, value}] } — but passing them in session/new or
 *    session/load REPLACES the session's extensions on goose <= 1.47
 *    (fixed by goose#11339), so they are attached post-hoc via
 *    _goose/unstable/session/extensions/add instead
 *  - sessions persist in goose's sessions.db and resume via session/load,
 *    which replays history as session/update notifications before returning
 */

type JsonRpcRequest = { jsonrpc: '2.0'; id: number; method: string; params?: unknown }
type JsonRpcResponse = {
  jsonrpc: '2.0'
  id?: number
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string }
}

export type ContentBlock = { type: 'text'; text: string } | { type: string; [k: string]: unknown }

export type SessionUpdate =
  | { sessionUpdate: 'agent_message_chunk'; content: ContentBlock; messageId?: string }
  | { sessionUpdate: 'agent_thought_chunk'; content: ContentBlock; messageId?: string }
  | { sessionUpdate: 'user_message_chunk'; content: ContentBlock; messageId?: string }
  | {
      sessionUpdate: 'tool_call'
      toolCallId: string
      title: string
      kind?: string
      status: 'pending' | 'in_progress' | 'completed' | 'failed'
    }
  | {
      sessionUpdate: 'tool_call_update'
      toolCallId: string
      title?: string
      kind?: string
      status?: 'pending' | 'in_progress' | 'completed' | 'failed'
    }
  | { sessionUpdate: string; [k: string]: unknown }

export type McpHttpServer = {
  type: 'http'
  name: string
  url: string
  headers: { name: string; value: string }[]
}

export type SessionUpdateHandler = (sessionId: string, update: SessionUpdate) => void

const PERMISSION_ALLOW = { outcome: { outcome: 'selected', optionId: 'allow_once' } }

export class AcpClient {
  private child: ChildProcess | null = null
  private nextId = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private updateHandler: SessionUpdateHandler | null = null
  private startPromise: Promise<void> | null = null
  /** while loading a session, its replayed history accumulates here */
  private replayBuffers = new Map<string, SessionUpdate[]>()

  onSessionUpdate(handler: SessionUpdateHandler): void {
    this.updateHandler = handler
  }

  async ensureStarted(): Promise<void> {
    if (this.child && this.child.exitCode === null) return
    this.startPromise ??= this.start().finally(() => {
      this.startPromise = null
    })
    return this.startPromise
  }

  private async start(): Promise<void> {
    const goose = await findGoose()
    const child = spawn(goose.resolvedPath, ['acp'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GOOSE_MODE: 'auto',
      },
    })
    this.child = child

    // drain stderr (tracing logs) so the child cannot block on a full pipe
    createInterface({ input: child.stderr! }).on('line', (line) => {
      if (line.includes('ERROR')) console.warn('[goose-acp stderr]', line)
    })

    createInterface({ input: child.stdout! }).on('line', (line) => {
      if (!line.trim()) return
      let msg: JsonRpcResponse
      try {
        msg = JSON.parse(line)
      } catch {
        return
      }
      this.dispatch(msg)
    })

    child.on('exit', (code) => {
      console.warn(`[goose-acp] exited with code ${code}`)
      if (this.child !== child) return
      const err = new Error(`goose acp exited (code ${code})`)
      for (const p of this.pending.values()) p.reject(err)
      this.pending.clear()
      this.child = null
    })

    await this.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: {
        // leave fs/terminal false so goose does its own IO instead of
        // delegating file and shell callbacks to us
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
      clientInfo: { name: 'top-goose', version: '0.1.0' },
    })
  }

  private dispatch(msg: JsonRpcResponse): void {
    // response to one of our requests
    if (msg.id !== undefined && msg.method === undefined) {
      const pending = this.pending.get(msg.id)
      if (!pending) return
      this.pending.delete(msg.id)
      if (msg.error) pending.reject(new AcpError(msg.error.message, msg.error.code))
      else pending.resolve(msg.result)
      return
    }
    if (msg.id !== undefined && msg.method === 'session/request_permission') {
      this.respond(msg.id, PERMISSION_ALLOW)
      return
    }
    if (msg.id !== undefined && msg.method) {
      // unsupported agent->client request: return empty rather than hanging goose
      this.respond(msg.id, {})
      return
    }
    // notification
    if (msg.method === 'session/update') {
      const params = msg.params as { sessionId: string; update: SessionUpdate }
      const replay = this.replayBuffers.get(params.sessionId)
      if (replay) replay.push(params.update)
      else this.updateHandler?.(params.sessionId, params.update)
    }
  }

  private respond(id: number, result: unknown): void {
    this.child?.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
  }

  /**
   * timeoutMs guards against a wedged goose (e.g. blocked on a keychain
   * prompt it cannot show): session management should fail visibly rather
   * than hang the pane. Prompt turns legitimately run for minutes and pass 0.
   */
  async request<T = unknown>(method: string, params?: unknown, timeoutMs = 60_000): Promise<T> {
    if (method !== 'initialize') await this.ensureStarted()
    const child = this.child
    if (!child?.stdin) throw new Error('goose acp not running')
    const id = this.nextId++
    const req: JsonRpcRequest = { jsonrpc: '2.0', id, method, params }
    return new Promise<T>((resolve, reject) => {
      let timer: NodeJS.Timeout | null = null
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          this.pending.delete(id)
          reject(
            new Error(
              `goose did not answer ${method} within ${timeoutMs / 1000}s — ` +
                'it may be blocked on a provider/keychain prompt; try running `goose configure` in a terminal',
            ),
          )
        }, timeoutMs)
        timer.unref()
      }
      this.pending.set(id, {
        resolve: (v) => {
          if (timer) clearTimeout(timer)
          ;(resolve as (v: unknown) => void)(v)
        },
        reject: (e) => {
          if (timer) clearTimeout(timer)
          reject(e)
        },
      })
      child.stdin!.write(JSON.stringify(req) + '\n')
    })
  }

  notify(method: string, params?: unknown): void {
    this.child?.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
  }

  // ---------- Session operations ----------

  async newSession(cwd: string, mcpServers: McpHttpServer[]): Promise<string> {
    const result = await this.request<{ sessionId: string; _meta?: { extensionResults?: unknown } }>(
      'session/new',
      {
        cwd,
        mcpServers,
        _meta: { client: 'top-goose' },
      },
    )
    logExtensionResults(result._meta)
    return result.sessionId
  }

  /**
   * Load a persisted session. History replayed during the load is captured
   * and returned rather than streamed to the live update handler.
   */
  async loadSession(sessionId: string, cwd: string, mcpServers: McpHttpServer[]): Promise<SessionUpdate[]> {
    await this.ensureStarted()
    this.replayBuffers.set(sessionId, [])
    try {
      const result = await this.request<{ _meta?: { extensionResults?: unknown } }>('session/load', {
        sessionId,
        cwd,
        mcpServers,
      })
      logExtensionResults(result?._meta)
      return this.replayBuffers.get(sessionId) ?? []
    } finally {
      this.replayBuffers.delete(sessionId)
    }
  }

  async prompt(sessionId: string, text: string): Promise<{ stopReason: string }> {
    return this.request<{ stopReason: string }>(
      'session/prompt',
      { sessionId, prompt: [{ type: 'text', text }] },
      0, // a turn may legitimately run for many minutes
    )
  }

  cancel(sessionId: string): void {
    this.notify('session/cancel', { sessionId })
  }

  /**
   * Attach an HTTP MCP server to a live session. Returns false when the
   * binary predates `_goose/unstable/session/extensions/add`.
   */
  async addHttpExtension(sessionId: string, server: McpHttpServer): Promise<boolean> {
    try {
      await this.request('_goose/unstable/session/extensions/add', {
        sessionId,
        extension: { type: 'mcp', server },
      })
      return true
    } catch (err) {
      if (err instanceof AcpError && err.code === -32601) return false
      throw err
    }
  }

  /**
   * Per-repo/global instructions. `_goose/unstable/session/system-prompt/set`
   * may not exist on older binaries; callers treat method-not-found as
   * "unsupported" and fall back to inlining instructions in turn context.
   */
  async setSystemPromptExtra(sessionId: string, key: string, text: string): Promise<boolean> {
    try {
      await this.request('_goose/unstable/session/system-prompt/set', {
        sessionId,
        mode: 'append',
        key,
        text,
      })
      return true
    } catch (err) {
      if (err instanceof AcpError && err.code === -32601) return false // method not found
      throw err
    }
  }

  shutdown(): void {
    const child = this.child
    this.child = null
    const err = new Error('goose acp stopped')
    for (const pending of this.pending.values()) pending.reject(err)
    this.pending.clear()
    child?.kill()
  }
}

function logExtensionResults(meta?: { extensionResults?: unknown }): void {
  const results = meta?.extensionResults
  if (!Array.isArray(results)) return
  const failed = results.filter((r) => r && typeof r === 'object' && (r as { success?: boolean }).success === false)
  if (failed.length > 0) console.warn('[goose-acp] extensions failed to load:', JSON.stringify(failed))
}

export class AcpError extends Error {
  constructor(
    message: string,
    public code: number,
  ) {
    super(message)
  }
}

export const acp = new AcpClient()
