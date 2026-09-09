import type { CachedRow } from './types'

export function isUnreplied(row: CachedRow, login?: string): boolean {
  if (!login || !row.participants?.some((participant) => participant.toLowerCase() === login.toLowerCase())) {
    return false
  }
  const lastVoice = row.lastComment?.author ?? row.author
  return !!lastVoice && lastVoice.toLowerCase() !== login.toLowerCase()
}
