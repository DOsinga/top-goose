import { useEffect, useRef } from 'react'
import { coreTeam } from '../../../shared/coreTeam'
import type { IssueDetail } from '../../../shared/types'
import { useStore } from '../store'
import { Markdown } from './Markdown'
import { ReplyComposer } from './ReplyComposer'

export function IssuePane(): React.JSX.Element {
  const issue = useStore((state) => state.issue)
  const loading = useStore((state) => state.issueLoading)
  const error = useStore((state) => state.issueError)
  const selected = useStore((state) => state.selectedNodeId)

  if (!selected) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center text-gray-400">
        Select an issue
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
      <ReplyComposer conversation={issue} kind="issue" />
    </div>
  )
}

function IssueHeader({ issue }: { issue: IssueDetail }): React.JSX.Element {
  const setStatus = useStore((state) => state.setStatus)
  const setSnooze = useStore((state) => state.setSnooze)
  const setAssignee = useStore((state) => state.setAssignee)
  const assigneeSaving = useStore((state) => state.assigneeSaving)
  const setView = useStore((state) => state.setView)
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
        {issue.availableStatuses.length > 0 ? (
          <select
            className="shrink-0 cursor-pointer appearance-none rounded-full border border-gray-300 bg-white px-2.5 py-0.5 text-[11px] font-medium text-gray-700 hover:border-accent"
            value={issue.workflowStatus ?? ''}
            onChange={(event) => void setStatus(event.target.value)}
          >
            <option value="" disabled>
              Status…
            </option>
            {issue.availableStatuses.map((status) => (
              <option key={status} value={status}>
                {status}
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
        <span className="flex items-center gap-1">
          <label htmlFor="issue-assignee" className="text-gray-400">
            assigned
          </label>
          <select
            id="issue-assignee"
            className="cursor-pointer rounded border border-gray-300 bg-white px-1 py-px text-[11px] disabled:opacity-50"
            value={assigneeValue(issue.assignees)}
            disabled={assigneeSaving}
            onChange={(event) => void setAssignee(event.target.value || null)}
          >
            {assigneeValue(issue.assignees) === '__current__' && (
              <option value="__current__" disabled>
                {issue.assignees.join(', ')}
              </option>
            )}
            <option value="">Unassigned</option>
            {coreTeam.map((member) => (
              <option key={member.github} value={member.github}>
                {member.name} (@{member.github})
              </option>
            ))}
          </select>
        </span>
        {issue.labels.map((label) => (
          <span
            key={label.name}
            className="rounded-full border px-1.5 py-px text-[10px]"
            style={{ borderColor: `#${label.color}`, color: `#${label.color}` }}
          >
            {label.name}
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
              onChange={(event) => void setSnooze(event.target.value || null)}
            />
          </span>
        )}
      </div>
    </div>
  )
}

function assigneeValue(assignees: string[]): string {
  if (assignees.length === 0) return ''
  if (assignees.length === 1 && coreTeam.some((member) => member.github === assignees[0])) {
    return assignees[0]
  }
  return '__current__'
}

function Transcript({ issue }: { issue: IssueDetail }): React.JSX.Element {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    endRef.current?.scrollIntoView()
  }, [issue.nodeId, issue.comments.length])

  return (
    <div className="space-y-3 px-5 py-4">
      <Bubble
        author={issue.author}
        avatar={issue.authorAvatarUrl}
        at={issue.createdAt}
        body={issue.body || '*no description*'}
        highlighted
      />
      {issue.comments.map((comment) => (
        <Bubble
          key={comment.id}
          author={comment.author}
          avatar={comment.authorAvatarUrl}
          at={comment.createdAt}
          body={comment.body}
        />
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
  highlighted,
}: {
  author: string
  avatar?: string
  at: string
  body: string
  highlighted?: boolean
}): React.JSX.Element {
  return (
    <div className={`rounded-lg border p-3 ${highlighted ? 'border-accent/30 bg-accent/5' : 'border-gray-200'}`}>
      <div className="mb-1 flex items-center gap-2">
        {avatar && <img src={avatar} className="h-5 w-5 rounded-full" alt="" />}
        <span className="text-[13px] font-semibold">{author}</span>
        <span className="text-[11px] text-gray-400">{new Date(at).toLocaleString()}</span>
      </div>
      <Markdown>{body}</Markdown>
    </div>
  )
}
