import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useStore } from '../store'

type MdNode = { type: string; value?: string; url?: string; children?: MdNode[] }

/**
 * Autolink bare #123 references to the repo's issue page. GitHub redirects
 * /issues/N to the PR when N is a pull request, so no type resolution needed.
 */
function remarkIssueRefs({ repo }: { repo?: string }) {
  return (tree: MdNode): void => {
    if (!repo) return
    linkify(tree)

    function linkify(node: MdNode): void {
      // inside a link the reference is already clickable
      if (!node.children || node.type === 'link' || node.type === 'linkReference') return
      const next: MdNode[] = []
      for (const child of node.children) {
        if (child.type !== 'text' || !child.value) {
          linkify(child)
          next.push(child)
          continue
        }
        const text = child.value
        const re = /(?<![\w#&/])#(\d+)\b/g
        let last = 0
        let m: RegExpExecArray | null
        while ((m = re.exec(text))) {
          if (m.index > last) next.push({ type: 'text', value: text.slice(last, m.index) })
          next.push({
            type: 'link',
            url: `https://github.com/${repo}/issues/${m[1]}`,
            children: [{ type: 'text', value: m[0] }],
          })
          last = m.index + m[0].length
        }
        if (last === 0) next.push(child)
        else if (last < text.length) next.push({ type: 'text', value: text.slice(last) })
      }
      node.children = next
    }
  }
}

export function Markdown({ children }: { children: string }): React.JSX.Element {
  // both panes render in the context of the selected issue's repo
  const repo = useStore(
    (s) => s.issue?.repo ?? s.rows.find((r) => r.nodeId === s.selectedNodeId)?.repo,
  )
  return (
    <div className="prose-gh text-sm">
      <ReactMarkdown remarkPlugins={[remarkGfm, [remarkIssueRefs, { repo }]]}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
