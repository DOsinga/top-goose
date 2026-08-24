import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { PendingDraft } from '../../shared/types'
import { setPendingDraft } from '../store'

/**
 * The draft_reply MCP endpoint, registered with each Goose session as an
 * HTTP MCP server. Lives in the main process because the handler needs the
 * issue<->session mapping and a channel to the renderer's composer.
 *
 * Security posture per the design:
 *  - bind 127.0.0.1 explicitly (Node's default binds every interface)
 *  - port 0, read the assigned port back
 *  - per-launch token required on every request, carried in a header
 *  - refuse CORS preflight so browser-originated requests cannot get through
 *
 * The random path segment carries session identity, not secrecy: draft_reply
 * takes only a body, and the target issue derives from which session called,
 * so untrusted text in the model's context cannot steer a draft into another
 * channel.
 */

const TOKEN_HEADER = 'x-top-goose-token'

let server: Server | null = null
let port = 0
const launchToken = randomBytes(32).toString('hex')

/** path key -> issue node ID */
const sessionKeys = new Map<string, string>()

let draftListener: ((draft: PendingDraft) => void) | null = null

export function onDraft(listener: (draft: PendingDraft) => void): void {
  draftListener = listener
}

/** Register (or reuse) an MCP path key for an issue's Goose session. */
export function registerSessionKey(issueNodeId: string): string {
  for (const [key, node] of sessionKeys) {
    if (node === issueNodeId) return key
  }
  const key = randomUUID()
  sessionKeys.set(key, issueNodeId)
  return key
}

export function mcpServerConfig(issueNodeId: string): {
  type: 'http'
  name: string
  url: string
  headers: { name: string; value: string }[]
} {
  if (!server) throw new Error('draft server not started')
  const key = registerSessionKey(issueNodeId)
  return {
    type: 'http',
    name: 'top-goose',
    url: `http://127.0.0.1:${port}/mcp/session/${key}`,
    headers: [{ name: 'X-Top-Goose-Token', value: launchToken }],
  }
}

export async function startDraftServer(): Promise<void> {
  if (server) return
  server = createServer((req, res) => {
    void handle(req, res).catch((err) => {
      console.error('[mcp] request failed:', err)
      if (!res.headersSent) res.writeHead(500).end()
      else res.end()
    })
  })
  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject)
    server!.listen(0, '127.0.0.1', () => resolve())
  })
  const addr = server.address()
  if (addr === null || typeof addr === 'string') throw new Error('could not read draft server port')
  port = addr.port
  console.log(`[mcp] draft_reply endpoint on 127.0.0.1:${port}`)
}

export function stopDraftServer(): void {
  server?.close()
  server = null
}

function tokenValid(req: IncomingMessage): boolean {
  const provided = req.headers[TOKEN_HEADER]
  if (typeof provided !== 'string') return false
  const a = Buffer.from(provided)
  const b = Buffer.from(launchToken)
  return a.length === b.length && timingSafeEqual(a, b)
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // no CORS headers, ever: a browser preflight gets a bare 403 and the
  // actual request is never sent
  if (req.method === 'OPTIONS') {
    res.writeHead(403).end()
    return
  }
  if (!tokenValid(req)) {
    res.writeHead(401).end()
    return
  }
  const match = req.url?.match(/^\/mcp\/session\/([0-9a-f-]+)$/)
  const issueNodeId = match ? sessionKeys.get(match[1]) : undefined
  if (!issueNodeId) {
    res.writeHead(404).end()
    return
  }
  if (req.method !== 'POST') {
    res.writeHead(405).end()
    return
  }

  const body = await readJson(req)
  // stateless per-request MCP server: cheap, and every request re-derives
  // its issue from the path
  const mcp = new McpServer({ name: 'top-goose', version: '0.1.0' })
  mcp.registerTool(
    'draft_reply',
    {
      description:
        'Put a draft reply into the reply composer of the GitHub issue this conversation is about. ' +
        'The user reviews, edits, and explicitly sends it; nothing is posted to GitHub automatically.',
      inputSchema: { body: z.string().describe('The proposed reply, GitHub-flavored markdown.') },
    },
    async ({ body: draftBody }) => {
      const draft: PendingDraft = {
        issueNodeId,
        text: draftBody,
        createdAt: new Date().toISOString(),
      }
      setPendingDraft(draft)
      draftListener?.(draft)
      return {
        content: [{ type: 'text' as const, text: 'Draft delivered to the reply composer for review.' }],
      }
    },
  )
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await mcp.connect(transport)
  await transport.handleRequest(req, res, body)
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => (data += chunk))
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : undefined)
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}
