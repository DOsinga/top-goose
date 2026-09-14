import type { CachedRow } from './types'

export function isUnreplied(row: CachedRow, login?: string): boolean {
  if (!login) return false
  const participated = row.author?.toLowerCase() === login.toLowerCase() || row.viewerCommented
  if (!participated) return false
  const lastVoice = row.lastComment?.author ?? row.author
  return !!lastVoice && lastVoice.toLowerCase() !== login.toLowerCase()
}
