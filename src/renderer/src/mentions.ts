import { coreTeam } from '../../shared/coreTeam'
import type { IssueDetail, PullRequestDetail } from '../../shared/types'

export type MentionCandidate = {
  login: string
  name?: string
  core: boolean
}

export type MentionRange = {
  start: number
  end: number
  query: string
}

export function mentionAtCursor(text: string, cursor: number): MentionRange | null {
  const match = text.slice(0, cursor).match(/(?:^|[^A-Za-z0-9-])@([A-Za-z0-9-]*)$/)
  if (!match) return null
  const query = match[1]
  return { start: cursor - query.length - 1, end: cursor, query }
}

export function mentionCandidates(conversation: IssueDetail | PullRequestDetail | null): MentionCandidate[] {
  const candidates: MentionCandidate[] = coreTeam.map((member) => ({
    login: member.github,
    name: member.name,
    core: true,
  }))
  const seen = new Set(candidates.map((candidate) => candidate.login.toLowerCase()))
  if (!conversation) return candidates

  const participants = [
    conversation.author,
    ...conversation.assignees,
    ...conversation.comments.map((comment) => comment.author),
    ...('reviews' in conversation ? conversation.reviews.map((review) => review.author) : []),
    ...('reviewThreads' in conversation
      ? conversation.reviewThreads.flatMap((thread) => thread.comments.map((comment) => comment.author))
      : []),
  ]
  for (const login of participants) {
    const key = login.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push({ login, core: false })
  }
  return candidates
}

export function matchingMentions(
  candidates: MentionCandidate[],
  query: string,
): MentionCandidate[] {
  const needle = query.toLowerCase()
  return candidates.filter(
    (candidate) =>
      candidate.login.toLowerCase().includes(needle) || candidate.name?.toLowerCase().includes(needle),
  )
}

export function insertMention(
  text: string,
  range: MentionRange,
  login: string,
): { text: string; cursor: number } {
  const mention = `@${login} `
  return {
    text: text.slice(0, range.start) + mention + text.slice(range.end),
    cursor: range.start + mention.length,
  }
}
