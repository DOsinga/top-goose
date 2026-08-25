import { useEffect, useRef } from 'react'
import type {
  IssueComment,
  PullRequestDetail,
  PullRequestReview,
  PullRequestReviewThread,
} from '../../../shared/types'
import { useStore } from '../store'
import { Markdown } from './Markdown'
import { ReplyComposer } from './ReplyComposer'

export function PullRequestPane(): React.JSX.Element {
  const pullRequest = useStore((state) => state.pullRequest)
  const loading = useStore((state) => state.pullRequestLoading)
  const error = useStore((state) => state.pullRequestError)
  const selected = useStore((state) => state.selectedNodeId)

  if (!selected) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center text-gray-400">
        Select a pull request
      </div>
    )
  }
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {pullRequest && <PullRequestHeader pullRequest={pullRequest} />}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && !pullRequest && <div className="p-6 text-sm text-gray-400">Loading…</div>}
        {error && <div className="p-6 text-sm text-red-600">{error}</div>}
        {pullRequest && <PullRequestTranscript pullRequest={pullRequest} />}
      </div>
      <ReplyComposer conversation={pullRequest} kind="pullRequest" />
    </div>
  )
}

function PullRequestHeader({ pullRequest }: { pullRequest: PullRequestDetail }): React.JSX.Element {
  const login = useStore((state) => state.auth?.login)
  const approve = useStore((state) => state.approvePullRequest)
  const saving = useStore((state) => state.approvalSaving)
  const url = `https://github.com/${pullRequest.repo}/pull/${pullRequest.pullRequestNumber}`
  const ownPullRequest = pullRequest.author.toLowerCase() === login?.toLowerCase()
  const approved = pullRequest.viewerReviewState === 'APPROVED'
  const canApprove = pullRequest.state === 'open' && !ownPullRequest && !approved
  const state = pullRequest.merged ? 'merged' : pullRequest.isDraft ? 'draft' : pullRequest.state
  const stateColor = pullRequest.merged
    ? 'bg-purple-100 text-purple-800'
    : pullRequest.isDraft
      ? 'bg-gray-200 text-gray-700'
      : 'bg-green-100 text-green-800'

  return (
    <div className="shrink-0 border-b border-gray-200 px-5 py-3">
      <div className="flex items-center gap-2">
        <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold">
          <a href={url} title={`${url} (opens in browser)`} className="hover:text-accent hover:underline">
            {pullRequest.title}
          </a>
        </h1>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${stateColor}`}>
          {state}
        </span>
        <button
          className="shrink-0 rounded-lg bg-green-600 px-3 py-1 text-xs font-medium text-white disabled:bg-gray-200 disabled:text-gray-500"
          disabled={!canApprove || saving}
          title={
            ownPullRequest
              ? 'You cannot approve your own pull request'
              : approved
                ? 'You already approved this pull request'
                : undefined
          }
          onClick={() => void approve()}
        >
          {saving ? 'Approving…' : approved ? 'Approved' : 'Approve'}
        </button>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-gray-500">
        <a href={url} className="hover:text-accent hover:underline">
          {pullRequest.repo}#{pullRequest.pullRequestNumber}
        </a>
        <span>by {pullRequest.author}</span>
        <span className="rounded bg-gray-100 px-1.5 py-px font-mono text-[11px]">
          {pullRequest.headRefName} → {pullRequest.baseRefName}
        </span>
        <MetaBadge value={mergeableLabel(pullRequest.mergeable)} tone={pullRequest.mergeable === 'CONFLICTING' ? 'red' : 'gray'} />
        {pullRequest.checks && (
          <MetaBadge
            value={`${checksLabel(pullRequest.checks.state)} (${pullRequest.checks.total})`}
            tone={pullRequest.checks.state === 'SUCCESS' ? 'green' : pullRequest.checks.state === 'PENDING' ? 'amber' : 'red'}
          />
        )}
        {pullRequest.reviewDecision && (
          <MetaBadge
            value={reviewLabel(pullRequest.reviewDecision)}
            tone={
              pullRequest.reviewDecision === 'APPROVED'
                ? 'green'
                : pullRequest.reviewDecision === 'CHANGES_REQUESTED'
                  ? 'red'
                  : 'amber'
            }
          />
        )}
        {pullRequest.requestedReviewers.length > 0 && (
          <span>review requested: {pullRequest.requestedReviewers.join(', ')}</span>
        )}
        {pullRequest.assignees.length > 0 && <span>assigned: {pullRequest.assignees.join(', ')}</span>}
      </div>
    </div>
  )
}

function MetaBadge({ value, tone }: { value: string; tone: 'gray' | 'green' | 'amber' | 'red' }): React.JSX.Element {
  const colors = {
    gray: 'bg-gray-100 text-gray-600',
    green: 'bg-green-100 text-green-700',
    amber: 'bg-amber-100 text-amber-700',
    red: 'bg-red-100 text-red-700',
  }
  return <span className={`rounded px-1.5 py-px text-[11px] ${colors[tone]}`}>{value}</span>
}

function mergeableLabel(value: PullRequestDetail['mergeable']): string {
  if (value === 'MERGEABLE') return 'mergeable'
  if (value === 'CONFLICTING') return 'conflicts'
  return 'mergeability pending'
}

function checksLabel(value: NonNullable<PullRequestDetail['checks']>['state']): string {
  if (value === 'SUCCESS') return 'checks passed'
  if (value === 'PENDING' || value === 'EXPECTED') return 'checks pending'
  return 'checks failed'
}

function reviewLabel(value: NonNullable<PullRequestDetail['reviewDecision']>): string {
  if (value === 'APPROVED') return 'approved'
  if (value === 'CHANGES_REQUESTED') return 'changes requested'
  return 'review required'
}

type TimelineItem =
  | { kind: 'comment'; at: string; value: IssueComment }
  | { kind: 'review'; at: string; value: PullRequestReview }
  | { kind: 'thread'; at: string; value: PullRequestReviewThread }

function PullRequestTranscript({ pullRequest }: { pullRequest: PullRequestDetail }): React.JSX.Element {
  const endRef = useRef<HTMLDivElement>(null)
  const timeline: TimelineItem[] = [
    ...pullRequest.comments.map((value) => ({ kind: 'comment' as const, at: value.createdAt, value })),
    ...pullRequest.reviews.map((value) => ({
      kind: 'review' as const,
      at: value.submittedAt ?? pullRequest.updatedAt,
      value,
    })),
    ...pullRequest.reviewThreads.flatMap((value) => {
      const at = value.comments[0]?.createdAt
      return at ? [{ kind: 'thread' as const, at, value }] : []
    }),
  ].sort((left, right) => left.at.localeCompare(right.at))

  useEffect(() => {
    endRef.current?.scrollIntoView()
  }, [pullRequest.nodeId, timeline.length])

  return (
    <div className="space-y-3 px-5 py-4">
      <Bubble
        author={pullRequest.author}
        avatar={pullRequest.authorAvatarUrl}
        at={pullRequest.createdAt}
        body={pullRequest.body || '*no description*'}
        highlighted
      />
      {timeline.map((item) => {
        if (item.kind === 'comment') {
          return (
            <Bubble
              key={`comment-${item.value.id}`}
              author={item.value.author}
              avatar={item.value.authorAvatarUrl}
              at={item.at}
              body={item.value.body}
            />
          )
        }
        if (item.kind === 'review') return <ReviewCard key={`review-${item.value.id}`} review={item.value} />
        return <ReviewThreadCard key={item.value.id} thread={item.value} />
      })}
      <div ref={endRef} />
    </div>
  )
}

function ReviewCard({ review }: { review: PullRequestReview }): React.JSX.Element {
  const label = review.state.toLowerCase().replaceAll('_', ' ')
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div className="mb-1 flex items-center gap-2">
        {review.authorAvatarUrl && <img src={review.authorAvatarUrl} className="h-5 w-5 rounded-full" alt="" />}
        <span className="text-[13px] font-semibold">{review.author}</span>
        <span className="rounded bg-white px-1.5 py-px text-[10px] font-medium text-gray-600">{label}</span>
        {review.submittedAt && (
          <span className="text-[11px] text-gray-400">{new Date(review.submittedAt).toLocaleString()}</span>
        )}
      </div>
      {review.body && <Markdown>{review.body}</Markdown>}
    </div>
  )
}

function ReviewThreadCard({ thread }: { thread: PullRequestReviewThread }): React.JSX.Element {
  const first = thread.comments[0]
  if (!first) return <></>
  const line = first.line ?? first.originalLine
  return (
    <div className={`rounded-lg border p-3 ${thread.resolved ? 'border-gray-200 opacity-70' : 'border-amber-200 bg-amber-50/30'}`}>
      <div className="mb-2 flex items-center gap-2 text-[11px] text-gray-500">
        <span className="font-mono text-gray-700">{first.path}{line ? `:${line}` : ''}</span>
        <span className={`rounded px-1.5 py-px ${thread.resolved ? 'bg-gray-100' : 'bg-amber-100 text-amber-700'}`}>
          {thread.resolved ? 'resolved' : 'open thread'}
        </span>
      </div>
      {first.diffHunk && (
        <pre className="mb-3 max-h-32 overflow-auto rounded bg-gray-900 p-2 text-[10px] leading-4 text-gray-200">
          {first.diffHunk}
        </pre>
      )}
      <div className="space-y-2">
        {thread.comments.map((comment) => (
          <Bubble
            key={comment.id}
            author={comment.author}
            avatar={comment.authorAvatarUrl}
            at={comment.createdAt}
            body={comment.body}
            compact
          />
        ))}
      </div>
    </div>
  )
}

function Bubble({
  author,
  avatar,
  at,
  body,
  highlighted,
  compact,
}: {
  author: string
  avatar?: string
  at: string
  body: string
  highlighted?: boolean
  compact?: boolean
}): React.JSX.Element {
  return (
    <div className={`rounded-lg border p-3 ${highlighted ? 'border-accent/30 bg-accent/5' : 'border-gray-200 bg-white'} ${compact ? 'p-2' : ''}`}>
      <div className="mb-1 flex items-center gap-2">
        {avatar && <img src={avatar} className="h-5 w-5 rounded-full" alt="" />}
        <span className="text-[13px] font-semibold">{author}</span>
        <span className="text-[11px] text-gray-400">{new Date(at).toLocaleString()}</span>
      </div>
      <Markdown>{body}</Markdown>
    </div>
  )
}
