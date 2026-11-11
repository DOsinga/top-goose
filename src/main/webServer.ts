import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { request as httpsRequest } from 'node:https'
import path from 'node:path'
import type { InvokeChannel, PushChannel } from '../shared/ipc'

const remoteChannels = new Set<InvokeChannel>([
  'auth:state',
  'sidebar:rows',
  'sidebar:refresh',
  'search:conversations',
  'conversation:setStarred',
  'issue:open',
  'issue:markRead',
  'issue:reply',
  'issue:close',
  'issue:setAssignee',
  'issue:setStatus',
  'issue:setSnooze',
  'pullRequest:open',
  'pullRequest:reply',
  'pullRequest:approve',
  'pullRequest:close',
  'session:list',
  'session:open',
  'session:prompt',
  'session:cancel',
  'draft:take',
  'budget:get',
  'remote:url',
])

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
}

type WebServerOptions = {
  rendererDir: string
  devServerUrl?: string
  port?: number
  invoke: (channel: InvokeChannel, args: unknown[]) => Promise<unknown>
  onPush: (listener: (channel: PushChannel, payload: unknown) => void) => () => void
}

export type WebServer = {
  port: number
  stop: () => Promise<void>
}

export async function startWebServer(options: WebServerOptions): Promise<WebServer> {
  const clients = new Set<ServerResponse>()
  const unsubscribe = options.onPush((channel, payload) => {
    const message = `data: ${JSON.stringify({ channel, payload })}\n\n`
    for (const client of clients) client.write(message)
  })

  const server = createServer((request, response) => {
    void route(request, response, options, clients)
  })
  server.on('close', unsubscribe)

  await listen(server, options.port ?? 0)
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('web server did not bind to a TCP port')

  return {
    port: address.port,
    stop: async () => {
      for (const client of clients) client.end()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    },
  }
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  options: WebServerOptions,
  clients: Set<ServerResponse>,
): Promise<void> {
  try {
    if (!authorized(request)) return respond(response, 403, 'Forbidden')
    const url = new URL(request.url ?? '/', 'http://localhost')

    if (url.pathname === '/api/invoke') {
      if (request.method !== 'POST') return respond(response, 405, 'Method not allowed')
      if (!validOrigin(request)) return respond(response, 403, 'Forbidden')
      return await invoke(request, response, options.invoke)
    }
    if (url.pathname === '/api/events') {
      if (request.method !== 'GET') return respond(response, 405, 'Method not allowed')
      response.writeHead(200, {
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'content-type': 'text/event-stream',
        'x-accel-buffering': 'no',
      })
      response.write(': connected\n\n')
      clients.add(response)
      request.on('close', () => clients.delete(response))
      return
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return respond(response, 405, 'Method not allowed')
    }
    if (options.devServerUrl) return proxy(request, response, options.devServerUrl)
    await serveStatic(response, options.rendererDir, url.pathname, request.method === 'HEAD')
  } catch (error) {
    respond(response, 500, error instanceof Error ? error.message : String(error))
  }
}

function authorized(request: IncomingMessage): boolean {
  const host = (request.headers.host ?? '').split(':')[0]
  return host === '127.0.0.1' || host === 'localhost' || typeof request.headers['tailscale-user-login'] === 'string'
}

function validOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === request.headers.host
  } catch {
    return false
  }
}

async function invoke(
  request: IncomingMessage,
  response: ServerResponse,
  handler: WebServerOptions['invoke'],
): Promise<void> {
  const body = await readBody(request)
  const message = JSON.parse(body) as { channel?: string; args?: unknown[] }
  if (!remoteChannels.has(message.channel as InvokeChannel)) return respond(response, 403, 'Forbidden')
  if (!Array.isArray(message.args)) return respond(response, 400, 'Invalid arguments')

  try {
    const value = await handler(message.channel as InvokeChannel, message.args)
    json(response, 200, { value })
  } catch (error) {
    json(response, 400, { error: error instanceof Error ? error.message : String(error) })
  }
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    size += buffer.length
    if (size > 1024 * 1024) throw new Error('request body is too large')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function serveStatic(
  response: ServerResponse,
  rendererDir: string,
  pathname: string,
  head: boolean,
): Promise<void> {
  const relative = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html'
  const requested = path.resolve(rendererDir, relative)
  const root = path.resolve(rendererDir)
  if (requested !== root && !requested.startsWith(`${root}${path.sep}`)) return respond(response, 403, 'Forbidden')

  let file = requested
  try {
    if (!(await stat(file)).isFile()) file = path.join(root, 'index.html')
  } catch {
    file = path.join(root, 'index.html')
  }

  response.writeHead(200, {
    'cache-control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
    'content-type': contentTypes[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
  })
  if (head) {
    response.end()
    return
  }
  createReadStream(file).pipe(response)
}

function proxy(request: IncomingMessage, response: ServerResponse, target: string): void {
  const url = new URL(request.url ?? '/', target)
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest
  const upstream = send(
    url,
    { method: request.method, headers: { accept: request.headers.accept ?? '*/*' } },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers)
      upstreamResponse.pipe(response)
    },
  )
  upstream.on('error', (error) => respond(response, 502, error.message))
  request.pipe(upstream)
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}

function respond(response: ServerResponse, status: number, body: string): void {
  if (response.headersSent) {
    response.end()
    return
  }
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
  response.end(body)
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => reject(error)
    server.once('error', onError)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', onError)
      resolve()
    })
  })
}
