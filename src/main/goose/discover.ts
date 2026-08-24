import { execFile } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { GooseInfo } from '../../shared/types'
import { settings } from '../store'

const execFileP = promisify(execFile)

/** Minimum version that supports the ACP features Top Goose needs. */
const MIN_VERSION = [1, 41, 0] as const

type Candidate = { path: string; source: GooseInfo['source'] }

/**
 * Search order per the design. PATH is last because a macOS app launched
 * from Finder gets a minimal PATH without /opt/homebrew/bin or ~/.local/bin.
 */
function candidates(): Candidate[] {
  const home = os.homedir()
  const list: Candidate[] = []
  const explicit = settings().get().goosePath
  if (explicit) list.push({ path: explicit, source: 'settings' })
  if (process.env.GOOSE_BIN) list.push({ path: process.env.GOOSE_BIN, source: 'env' })
  list.push(
    { path: '/Applications/Goose.app/Contents/Resources/bin/goose', source: 'desktop-app' },
    { path: path.join(home, 'Applications/Goose.app/Contents/Resources/bin/goose'), source: 'desktop-app' },
    { path: '/opt/homebrew/bin/goose', source: 'homebrew' },
    // Intel-brew prefix, but on ARM Macs this is a manually installed binary
    { path: '/usr/local/bin/goose', source: 'usr-local' },
    { path: path.join(home, '.local/bin/goose'), source: 'local-bin' },
    { path: 'goose', source: 'path' },
  )
  return list
}

function versionOk(version: string): boolean {
  const parts = version.split('.').map((p) => parseInt(p, 10))
  for (let i = 0; i < 3; i++) {
    const have = parts[i] ?? 0
    if (have > MIN_VERSION[i]) return true
    if (have < MIN_VERSION[i]) return false
  }
  return true
}

let cached: GooseInfo | null = null

export function invalidateGooseInfo(): void {
  cached = null
}

export async function findGoose(): Promise<GooseInfo> {
  if (cached) return cached
  const failures: string[] = []
  for (const candidate of candidates()) {
    if (candidate.source !== 'path' && !existsSync(candidate.path)) continue
    try {
      const { stdout } = await execFileP(candidate.path, ['--version'], { timeout: 10_000 })
      const version = stdout.trim().match(/[\d.]+/)?.[0] ?? stdout.trim()
      if (!versionOk(version)) {
        failures.push(`${candidate.path}: version ${version} < ${MIN_VERSION.join('.')}`)
        continue
      }
      // resolve symlinks (Homebrew links into the Cellar) so the reported
      // path matches what actually runs
      let resolvedPath = candidate.path
      try {
        resolvedPath = realpathSync(candidate.path)
      } catch {
        // 'goose' from PATH: leave as-is
      }
      cached = { path: candidate.path, resolvedPath, version, source: candidate.source }
      return cached
    } catch (err) {
      failures.push(`${candidate.path}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  throw new Error(
    `No usable goose binary found. Tried:\n${failures.join('\n')}\n` +
      'Install Goose Desktop or `brew install block-goose-cli`, or set a path in settings.',
  )
}
