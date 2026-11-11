import { spawn, type ChildProcess } from 'node:child_process'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'

const commands = [
  'tailscale',
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
  '/opt/homebrew/bin/tailscale',
  '/usr/local/bin/tailscale',
]

let child: ChildProcess | undefined
let remoteUrl: string | null = null
const listeners = new Set<(url: string | null) => void>()

export async function startTailscale(port: number): Promise<void> {
  const command = await findTailscale()
  if (!command) return

  child = spawn(command, ['serve', '--yes', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const read = (chunk: Buffer): void => {
    output += chunk.toString()
    const match = output.match(/https:\/\/[^\s|]+/)
    if (match) setRemoteUrl(match[0].replace(/\/$/, ''))
  }
  child.stdout?.on('data', read)
  child.stderr?.on('data', read)
  child.on('error', () => {
    child = undefined
    setRemoteUrl(null)
  })
  child.on('exit', () => {
    child = undefined
    setRemoteUrl(null)
  })
}

export function stopTailscale(): void {
  child?.kill()
  child = undefined
  setRemoteUrl(null)
}

export function getRemoteUrl(): string | null {
  return remoteUrl
}

export function onRemoteUrl(listener: (url: string | null) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

async function findTailscale(): Promise<string | null> {
  for (const command of commands) {
    try {
      if (command.includes('/')) await access(command, constants.X_OK)
      const process = spawn(command, ['version'], { stdio: 'ignore' })
      const code = await new Promise<number | null>((resolve, reject) => {
        process.on('error', reject)
        process.on('exit', resolve)
      })
      if (code === 0) return command
    } catch {
      continue
    }
  }
  return null
}

function setRemoteUrl(url: string | null): void {
  if (remoteUrl === url) return
  remoteUrl = url
  for (const listener of listeners) listener(url)
}
