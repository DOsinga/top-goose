import { spawn } from 'node:child_process'
import os from 'node:os'

const RESOLVE_TIMEOUT_MS = 5_000

export function resolveLoginShellPath(): Promise<string | null> {
  if (process.platform === 'win32') return Promise.resolve(null)

  const shell = process.env.SHELL || os.userInfo().shell || 'bash'
  return new Promise((resolve) => {
    const child = spawn(shell, ['-l', '-i', '-c', 'printenv PATH'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      detached: true,
      windowsHide: true,
    })
    const timer = setTimeout(() => {
      child.kill()
      resolve(null)
    }, RESOLVE_TIMEOUT_MS)
    timer.unref()

    let stdout = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const loginPath = stdout.trim().split('\n').pop()?.trim()
      resolve(code === 0 && loginPath ? loginPath : null)
    })
  })
}

let cached: Promise<string | null> | undefined

export function getLoginShellPath(): Promise<string | null> {
  cached ??= resolveLoginShellPath()
  return cached
}
