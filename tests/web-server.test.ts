import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PushChannel } from '../src/shared/ipc'
import { startWebServer, type WebServer } from '../src/main/webServer'

describe('web server', () => {
  let directory: string
  let server: WebServer
  let push: ((channel: PushChannel, payload: unknown) => void) | undefined
  const invoke = vi.fn()

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'top-goose-web-'))
    await writeFile(path.join(directory, 'index.html'), '<h1>Top Goose</h1>')
    invoke.mockReset()
    server = await startWebServer({
      rendererDir: directory,
      port: 0,
      invoke,
      onPush: (listener) => {
        push = listener
        return () => {
          push = undefined
        }
      },
    })
  })

  afterEach(async () => {
    await server.stop()
    await rm(directory, { recursive: true })
  })

  it('serves the renderer and its SPA fallback', async () => {
    const response = await fetch(`http://127.0.0.1:${server.port}/issues/123`)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('<h1>Top Goose</h1>')
  })

  it('allows conversation actions but not settings over the remote bridge', async () => {
    invoke.mockResolvedValue({ authenticated: true, login: 'DOsinga' })
    const allowed = await call(server.port, 'auth:state', [])
    expect(allowed.status).toBe(200)
    expect(await allowed.json()).toEqual({ value: { authenticated: true, login: 'DOsinga' } })
    expect(invoke).toHaveBeenCalledWith('auth:state', [])

    const blocked = await call(server.port, 'settings:get', [])
    expect(blocked.status).toBe(403)
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('streams live updates to the browser', async () => {
    const response = await fetch(`http://127.0.0.1:${server.port}/api/events`)
    const reader = response.body!.getReader()
    await reader.read()
    push?.('push:budget', { remaining: 42 })
    const event = new TextDecoder().decode((await reader.read()).value)
    expect(event).toContain('"channel":"push:budget"')
    expect(event).toContain('"remaining":42')
    await reader.cancel()
  })
})

function call(port: number, channel: string, args: unknown[]): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/api/invoke`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: `http://127.0.0.1:${port}`,
    },
    body: JSON.stringify({ channel, args }),
  })
}
