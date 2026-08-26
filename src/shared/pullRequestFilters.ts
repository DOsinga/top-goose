import { coreTeam } from './coreTeam'
import type { CachedRow } from './types'

export function isUnsolicitedPullRequest(row: CachedRow): boolean {
  if (row.isDraft || coreTeam.some((member) => member.github.toLowerCase() === row.author?.toLowerCase())) {
    return false
  }
  if (!row.linkedIssues?.length) return true
  return row.linkedIssues.some((issue) => issue.workflowStatus?.toLowerCase() === 'inbox')
}
