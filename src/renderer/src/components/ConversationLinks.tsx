import type { ConversationLink } from '../../../shared/types'
import { useStore } from '../store'

export function ConversationLinks({ links }: { links: ConversationLink[] }): React.JSX.Element | null {
  const selectIssue = useStore((state) => state.selectIssue)
  const selectPullRequest = useStore((state) => state.selectPullRequest)
  if (links.length === 0) return null

  return (
    <span className="flex flex-wrap items-center gap-1">
      <span className="text-gray-400">associated</span>
      {links.map((link) => (
        <button
          key={link.nodeId}
          type="button"
          className="rounded bg-blue-50 px-1.5 py-px text-[11px] text-blue-700 hover:bg-blue-100 hover:underline"
          title={`${link.repo}#${link.issueNumber}: ${link.title} (${link.state})`}
          onClick={() =>
            link.kind === 'issue' ? void selectIssue(link.nodeId) : void selectPullRequest(link.nodeId)
          }
        >
          {link.kind === 'issue' ? 'Issue' : 'PR'} #{link.issueNumber}
        </button>
      ))}
    </span>
  )
}
