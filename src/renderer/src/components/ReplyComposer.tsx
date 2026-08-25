import { useEffect, useMemo, useRef, useState } from 'react'
import type { ConversationKind, IssueDetail, PullRequestDetail } from '../../../shared/types'
import {
  insertMention,
  matchingMentions,
  mentionAtCursor,
  mentionCandidates,
  type MentionCandidate,
  type MentionRange,
} from '../mentions'
import { useStore } from '../store'

export function ReplyComposer({
  conversation,
  kind,
}: {
  conversation: IssueDetail | PullRequestDetail | null
  kind: ConversationKind
}): React.JSX.Element {
  const selected = useStore((state) => state.selectedNodeId)
  const composer = useStore((state) => (selected ? state.composers[selected] : undefined))
  const setComposerText = useStore((state) => state.setComposerText)
  const acceptOfferedDraft = useStore((state) => state.acceptOfferedDraft)
  const discardOfferedDraft = useStore((state) => state.discardOfferedDraft)
  const reply = useStore((state) =>
    kind === 'issue' ? state.reply : state.replyToPullRequest,
  )
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [mention, setMention] = useState<MentionRange | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const candidates = useMemo(() => mentionCandidates(conversation), [conversation])
  const matches = mention ? matchingMentions(candidates, mention.query) : []

  useEffect(() => {
    setMention(null)
    setMentionIndex(0)
  }, [selected])

  useEffect(() => {
    setMentionIndex(0)
  }, [mention?.query])

  if (!selected) return <></>
  const text = composer?.text ?? ''
  const ready = conversation?.nodeId === selected

  const insertDraft = (): void => {
    const draft = acceptOfferedDraft(selected)
    if (!draft || !textareaRef.current) return
    const textarea = textareaRef.current
    textarea.focus()
    textarea.setSelectionRange(textarea.value.length, textarea.value.length)
    document.execCommand(
      'insertText',
      false,
      (textarea.value && !textarea.value.endsWith('\n') ? '\n' : '') + draft,
    )
  }

  const updateMention = (textarea: HTMLTextAreaElement): void => {
    setMention(mentionAtCursor(textarea.value, textarea.selectionStart))
  }

  const chooseMention = (candidate: MentionCandidate): void => {
    if (!mention) return
    const inserted = insertMention(text, mention, candidate.login)
    setComposerText(selected, inserted.text, true)
    setMention(null)
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(inserted.cursor, inserted.cursor)
    })
  }

  return (
    <div className="shrink-0 border-t border-gray-200 p-3">
      {composer?.offeredDraft && (
        <div className="mb-2 flex items-center gap-2 rounded border border-goose/40 bg-goose/5 px-3 py-2 text-[12px]">
          <span className="min-w-0 flex-1 truncate text-gray-700">
            🪿 Goose drafted a reply — <span className="italic">{composer.offeredDraft.slice(0, 80)}…</span>
          </span>
          <button className="rounded bg-goose px-2 py-0.5 text-white" onClick={insertDraft}>
            Insert
          </button>
          <button
            className="rounded px-2 py-0.5 hover:bg-gray-100"
            onClick={() => discardOfferedDraft(selected)}
          >
            Discard
          </button>
        </div>
      )}
      {composer?.error && <div className="mb-2 text-xs text-red-600">Could not post reply: {composer.error}</div>}
      <div className="relative">
        {mention && matches.length > 0 && (
          <div className="absolute bottom-full left-0 z-10 mb-1 max-h-64 w-72 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
            {matches.map((candidate, index) => (
              <button
                key={candidate.login}
                type="button"
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                  index === mentionIndex ? 'bg-accent/10 text-accent' : 'hover:bg-gray-50'
                }`}
                onMouseDown={(event) => {
                  event.preventDefault()
                  chooseMention(candidate)
                }}
              >
                <span className="min-w-0 flex-1 truncate">
                  {candidate.name ? `${candidate.name} ` : ''}
                  <span className="text-gray-500">@{candidate.login}</span>
                </span>
                <span className="text-[10px] text-gray-400">
                  {candidate.core ? 'core team' : 'in conversation'}
                </span>
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          className="h-24 w-full resize-none rounded-lg border border-gray-300 p-3 text-sm focus:border-accent focus:outline-none"
          placeholder="Reply on GitHub… (⌘↵ to send)"
          value={text}
          disabled={!ready || composer?.sending}
          onBlur={() => setMention(null)}
          onClick={(event) => updateMention(event.currentTarget)}
          onChange={(event) => {
            updateMention(event.currentTarget)
            setComposerText(selected, event.target.value, true)
          }}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              setMention(null)
              void reply()
              return
            }
            if (!mention || matches.length === 0) return
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setMentionIndex((mentionIndex + 1) % matches.length)
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setMentionIndex((mentionIndex - 1 + matches.length) % matches.length)
            } else if (event.key === 'Enter' || event.key === 'Tab') {
              event.preventDefault()
              chooseMention(matches[mentionIndex] ?? matches[0])
            } else if (event.key === 'Escape') {
              event.preventDefault()
              setMention(null)
            }
          }}
          onKeyUp={(event) => {
            if (!['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)) {
              updateMention(event.currentTarget)
            }
          }}
        />
      </div>
      <div className="mt-1 flex justify-end">
        <button
          className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          disabled={!ready || !text.trim() || composer?.sending}
          onClick={() => void reply()}
        >
          {composer?.sending ? 'Sending…' : 'Send to GitHub'}
        </button>
      </div>
    </div>
  )
}
