import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

/**
 * Per-issue git worktrees so concurrent sessions cannot interfere. Created
 * lazily on the first prompt for an issue; never reaped automatically.
 */
export async function ensureWorktree(clonePath: string, issueNumber: number): Promise<string> {
  const repoName = path.basename(clonePath)
  const worktreePath = path.join(path.dirname(clonePath), `${repoName}-worktrees`, `issue-${issueNumber}`)
  if (existsSync(worktreePath)) return worktreePath
  const branch = `top-goose/issue-${issueNumber}`
  try {
    await execFileP('git', ['worktree', 'add', '-b', branch, worktreePath], { cwd: clonePath })
  } catch (err) {
    // branch may already exist from a removed worktree; retry attached to it
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('already exists')) {
      await execFileP('git', ['worktree', 'add', worktreePath, branch], { cwd: clonePath })
    } else {
      throw err
    }
  }
  return worktreePath
}
