import type { ConversationKind } from '../../shared/types'

type ConversationTarget = {
  kind: ConversationKind
  repo: string
  issueNumber: number
}

export function conversationUrl(target: ConversationTarget): string {
  const section = target.kind === 'issue' ? 'issues' : 'pull'
  return `https://github.com/${target.repo}/${section}/${target.issueNumber}`
}

export function shouldNavigateInside(event: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return !event.metaKey && !event.ctrlKey
}
