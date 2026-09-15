import type { ConversationLink } from '../../../shared/types'
import { conversationUrl, shouldNavigateInside } from '../internalLinks'
import { useStore } from '../store'

export function ConversationLinks({ links }: { links: ConversationLink[] }): React.JSX.Element | null {
  const selectIssue = useStore((state) => state.selectIssue)
  const selectPullRequest = useStore((state) => state.selectPullRequest)
  if (links.length === 0) return null

  return (
    <span className="flex flex-wrap items-center gap-1">
      <span className="text-gray-400">associated</span>
      {links.map((link) => (
        <a
          key={link.nodeId}
          href={conversationUrl(link)}
          target="_blank"
          rel="noreferrer"
          className="rounded bg-blue-50 px-1.5 py-px text-[11px] text-blue-700 hover:bg-blue-100 hover:underline"
          title={`${link.repo}#${link.issueNumber}: ${link.title} (${link.state})`}
          onClick={(event) => {
            if (!shouldNavigateInside(event)) return
            event.preventDefault()
            if (link.kind === 'issue') void selectIssue(link.nodeId)
            else void selectPullRequest(link.nodeId)
          }}
        >
          {link.kind === 'issue' ? 'Issue' : 'PR'} #{link.issueNumber}
        </a>
      ))}
    </span>
  )
}
