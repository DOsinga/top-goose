import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { codexReviewPrompt, extractCodexReviewHeading, type CodexReviewHeading } from '../codexReview'
import { githubImageFromHtml } from '../githubImages'
import { useStore } from '../store'

type MdNode = { type: string; value?: string; url?: string; alt?: string; children?: MdNode[] }

function remarkGithubImages() {
  return (tree: MdNode): void => {
    replaceImages(tree)

    function replaceImages(node: MdNode): void {
      if (!node.children) return
      node.children = node.children.map((child) => {
        if (child.type === 'html' && child.value) {
          const image = githubImageFromHtml(child.value)
          if (image) return { type: 'image', url: image.url, alt: image.alt }
        }
        replaceImages(child)
        return child
      })
    }
  }
}

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

export function Markdown({ children, offerToGoose = false }: { children: string; offerToGoose?: boolean }): React.JSX.Element {
  const repo = useStore(
    (s) =>
      s.issue?.repo ?? s.pullRequest?.repo ?? s.rows.find((r) => r.nodeId === s.selectedNodeId)?.repo,
  )
  const selected = useStore((state) => state.selectedNodeId)
  const gooseInput = useStore((state) => (selected ? state.gooseInputs[selected] ?? '' : ''))
  const setGooseInput = useStore((state) => state.setGooseInput)
  const reviewHeading = extractCodexReviewHeading(children)
  const copyToGoose =
    offerToGoose && selected && reviewHeading
      ? () => {
          const prompt = codexReviewPrompt(reviewHeading)
          setGooseInput(selected, gooseInput.trim() ? `${gooseInput}\n\n${prompt}` : prompt)
        }
      : undefined
  return (
    <div className="prose-gh text-sm">
      {reviewHeading && <ReviewHeading heading={reviewHeading} copyToGoose={copyToGoose} />}
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkGithubImages, [remarkIssueRefs, { repo }]]}>
        {reviewHeading?.body ?? children}
      </ReactMarkdown>
    </div>
  )
}

const priorityClasses: Record<CodexReviewHeading['priority'], string> = {
  P0: 'border-red-200 bg-red-50 text-red-800',
  P1: 'border-orange-200 bg-orange-50 text-orange-800',
  P2: 'border-amber-200 bg-amber-50 text-amber-800',
  P3: 'border-blue-200 bg-blue-50 text-blue-800',
}

function ReviewHeading({
  heading,
  copyToGoose,
}: {
  heading: CodexReviewHeading
  copyToGoose?: () => void
}): React.JSX.Element {
  return (
    <div className={`mb-2 flex items-start gap-2 rounded-md border px-2.5 py-2 ${priorityClasses[heading.priority]}`}>
      <span className="shrink-0 rounded bg-current/10 px-1.5 py-0.5 text-[11px] font-bold leading-4">
        {heading.priority}
      </span>
      <span className="font-semibold leading-5">{heading.title}</span>
      {copyToGoose && (
        <button
          type="button"
          className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold hover:bg-current/10"
          title="Copy this finding to the Goose prompt"
          aria-label="Copy this Codex finding to the Goose prompt"
          onClick={copyToGoose}
        >
          ⇒ Goose
        </button>
      )}
    </div>
  )
}
