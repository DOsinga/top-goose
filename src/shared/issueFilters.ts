import type { CachedRow } from './types'

export type AttentionFilter = 'unread' | 'unreplied' | 'assigned'

export function unreadCount(row: CachedRow): number {
  if (row.commentCountAtRead === undefined) return row.unread ? -1 : 0
  const count = Math.max(0, row.commentCount - row.commentCountAtRead)
  return count || (row.unread ? -1 : 0)
}

export function includesLogin(values: string[] | undefined, login?: string): boolean {
  return !!login && !!values?.some((value) => value.toLowerCase() === login.toLowerCase())
}

export function isUnreplied(row: CachedRow, login?: string): boolean {
  if (!login) return false
  const participated = row.author?.toLowerCase() === login.toLowerCase() || row.viewerCommented
  if (!participated) return false
  const lastVoice = row.lastComment?.author ?? row.author
  return !!lastVoice && lastVoice.toLowerCase() !== login.toLowerCase()
}

export function matchesAttentionFilter(row: CachedRow, filter: AttentionFilter, login?: string): boolean {
  if (filter === 'unread') return unreadCount(row) !== 0
  if (filter === 'unreplied') return isUnreplied(row, login)
  return includesLogin(row.assignees, login)
}
