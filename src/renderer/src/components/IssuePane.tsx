import { useEffect, useRef } from 'react'
import type { IssueDetail } from '../../../shared/types'
import { useStore } from '../store'
import { Markdown } from './Markdown'

export function IssuePane(): React.JSX.Element {
  const issue = useStore((s) => s.issue)
  const loading = useStore((s) => s.issueLoading)
  const error = useStore((s) => s.issueError)
  const selected = useStore((s) => s.selectedNodeId)

  if (!selected) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center text-gray-400">
        Select a conversation
      </div>
    )
  }
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {issue && <IssueHeader issue={issue} />}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && !issue && <div className="p-6 text-sm text-gray-400">Loading…</div>}
        {error && <div className="p-6 text-sm text-red-600">{error}</div>}
        {issue && <Transcript issue={issue} />}
      </div>
      <Composer />
    </div>
  )
}

function IssueHeader({ issue }: { issue: IssueDetail }): React.JSX.Element {
  const setStatus = useStore((s) => s.setStatus)
  const setSnooze = useStore((s) => s.setSnooze)
  const setView = useStore((s) => s.setView)
  const url = `https://github.com/${issue.repo}/issues/${issue.issueNumber}`

  return (
    <div className="shrink-0 border-b border-gray-200 px-5 py-3">
      <div className="flex items-center gap-2">
        <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold">
          <a href={url} title={`${url} (opens in browser)`} className="hover:text-accent hover:underline">
            {issue.title}
          </a>
        </h1>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
            issue.state === 'open' ? 'bg-green-100 text-green-800' : 'bg-purple-100 text-purple-800'
          }`}
        >
          {issue.state}
        </span>
        {/* the board Status is the primary triage control: keep it on the title row */}
        {issue.availableStatuses.length > 0 ? (
          <select
            className="shrink-0 cursor-pointer appearance-none rounded-full border border-gray-300 bg-white px-2.5 py-0.5 text-[11px] font-medium text-gray-700 hover:border-accent"
            value={issue.workflowStatus ?? ''}
            onChange={(e) => void setStatus(e.target.value)}
          >
            <option value="" disabled>
              Status…
            </option>
            {issue.availableStatuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        ) : (
          <button
            onClick={() => setView('settings')}
            title="Pick a Projects V2 board in Settings to triage from here (needs read:project on the token)"
            className="shrink-0 rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[11px] text-gray-400 hover:border-gray-400 hover:text-gray-600"
          >
            no board
          </button>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-gray-500">
        <a href={url} className="hover:text-accent hover:underline">
          {issue.repo}#{issue.issueNumber}
        </a>
        <span>by {issue.author}</span>
        {issue.assignees.length > 0 && <span>→ {issue.assignees.join(', ')}</span>}
        {issue.labels.map((l) => (
          <span
            key={l.name}
            className="rounded-full border px-1.5 py-px text-[10px]"
            style={{ borderColor: `#${l.color}`, color: `#${l.color}` }}
          >
            {l.name}
          </span>
        ))}
        {issue.milestone && <span>🏁 {issue.milestone}</span>}

        {issue.availableStatuses.length > 0 && (
          <span className="flex items-center gap-1">
            <label className="text-gray-400">snooze</label>
            <input
              type="date"
              className="rounded border border-gray-300 bg-white px-1 py-px text-[11px]"
              value={issue.snoozedUntil ?? ''}
              onChange={(e) => void setSnooze(e.target.value || null)}
            />
          </span>
        )}
      </div>
    </div>
  )
}

function Transcript({ issue }: { issue: IssueDetail }): React.JSX.Element {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    endRef.current?.scrollIntoView()
  }, [issue.nodeId, issue.comments.length])

  return (
    <div className="space-y-3 px-5 py-4">
      <Bubble author={issue.author} avatar={issue.authorAvatarUrl} at={issue.createdAt} body={issue.body || '*no description*'} isOp />
      {issue.comments.map((c) => (
        <Bubble key={c.id} author={c.author} avatar={c.authorAvatarUrl} at={c.createdAt} body={c.body} />
      ))}
      <div ref={endRef} />
    </div>
  )
}

function Bubble({
  author,
  avatar,
  at,
  body,
  isOp,
}: {
  author: string
  avatar?: string
  at: string
  body: string
  isOp?: boolean
}): React.JSX.Element {
  return (
    <div className={`rounded-lg border p-3 ${isOp ? 'border-accent/30 bg-accent/5' : 'border-gray-200'}`}>
      <div className="mb-1 flex items-center gap-2">
        {avatar && <img src={avatar} className="h-5 w-5 rounded-full" alt="" />}
        <span className="text-[13px] font-semibold">{author}</span>
        <span className="text-[11px] text-gray-400">{new Date(at).toLocaleString()}</span>
      </div>
      <Markdown>{body}</Markdown>
    </div>
  )
}

function Composer(): React.JSX.Element {
  const selected = useStore((s) => s.selectedNodeId)
  const issue = useStore((s) => s.issue)
  const composer = useStore((s) => (selected ? s.composers[selected] : undefined))
  const setComposerText = useStore((s) => s.setComposerText)
  const acceptOfferedDraft = useStore((s) => s.acceptOfferedDraft)
  const discardOfferedDraft = useStore((s) => s.discardOfferedDraft)
  const reply = useStore((s) => s.reply)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  if (!selected) return <></>
  const text = composer?.text ?? ''
  const ready = issue?.nodeId === selected

  const insertDraft = (): void => {
    const draft = acceptOfferedDraft(selected)
    if (!draft || !textareaRef.current) return
    // insert through the composer's own edit history so it is undoable
    const el = textareaRef.current
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
    document.execCommand('insertText', false, (el.value && !el.value.endsWith('\n') ? '\n' : '') + draft)
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
          <button className="rounded px-2 py-0.5 hover:bg-gray-100" onClick={() => discardOfferedDraft(selected)}>
            Discard
          </button>
        </div>
      )}
      {composer?.error && <div className="mb-2 text-xs text-red-600">Could not post reply: {composer.error}</div>}
      <textarea
        ref={textareaRef}
        className="h-24 w-full resize-none rounded-lg border border-gray-300 p-3 text-sm focus:border-accent focus:outline-none"
        placeholder="Reply on GitHub… (⌘↵ to send)"
        value={text}
        disabled={!ready || composer?.sending}
        onChange={(e) => setComposerText(selected, e.target.value, true)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            void reply()
          }
        }}
      />
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
