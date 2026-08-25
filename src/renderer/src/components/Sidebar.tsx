import type { CachedRow, ConversationKind } from '../../../shared/types'
import {
  useStore,
  type PullRequestFilter,
  type PullRequestStateFilter,
  type SidebarFilter,
} from '../store'

const NO_BOARD_STATUS = '__no_board_status__'

function unreadCount(row: CachedRow): number {
  if (row.commentCountAtRead === undefined) return row.unread ? -1 : 0
  const count = Math.max(0, row.commentCount - row.commentCountAtRead)
  return count || (row.unread ? -1 : 0)
}

function isUnreplied(row: CachedRow, login?: string): boolean {
  const lastVoice = row.lastComment?.author ?? row.author
  return lastVoice?.toLowerCase() !== login?.toLowerCase()
}

function timeAgo(iso: string): string {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000
  if (seconds < 60) return 'now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}

function includesLogin(values: string[] | undefined, login?: string): boolean {
  return !!login && !!values?.some((value) => value.toLowerCase() === login.toLowerCase())
}

export function Sidebar(): React.JSX.Element {
  const kind = useStore((state) => state.conversationKind)
  const rows = useStore((state) => state.rows).filter((row) => row.kind === kind)
  const selected = useStore((state) => state.selectedNodeId)
  const selectIssue = useStore((state) => state.selectIssue)
  const selectPullRequest = useStore((state) => state.selectPullRequest)
  const login = useStore((state) => state.auth?.login)
  const issueFilters = useStore((state) => state.sidebarFilters)
  const workflowStatusFilter = useStore((state) => state.workflowStatusFilter)
  const pullRequestFilters = useStore((state) => state.pullRequestFilters)
  const pullRequestStateFilter = useStore((state) => state.pullRequestStateFilter)
  const visible =
    kind === 'issue'
      ? filterIssues(rows, issueFilters, workflowStatusFilter, login)
      : filterPullRequests(rows, pullRequestFilters, pullRequestStateFilter, login)

  return (
    <div className="flex w-72 shrink-0 flex-col border-r border-gray-200 bg-gray-50">
      {kind === 'issue' ? <IssueFilters rows={rows} /> : <PullRequestFilters rows={rows} />}
      <div className="flex-1 overflow-y-auto">
        {visible.length === 0 && (
          <div className="p-4 text-sm text-gray-500">
            {rows.length === 0
              ? `No open ${kind === 'issue' ? 'issues' : 'pull requests'} in this repository.`
              : 'Nothing matches the active filters.'}
          </div>
        )}
        {visible.map((row) => (
          <SidebarRow
            key={row.nodeId}
            row={row}
            selected={row.nodeId === selected}
            onClick={() =>
              kind === 'issue' ? void selectIssue(row.nodeId) : void selectPullRequest(row.nodeId)
            }
            kind={kind}
          />
        ))}
      </div>
    </div>
  )
}

function IssueFilters({ rows }: { rows: CachedRow[] }): React.JSX.Element {
  const filters = useStore((state) => state.sidebarFilters)
  const toggleFilter = useStore((state) => state.toggleSidebarFilter)
  const statusFilter = useStore((state) => state.workflowStatusFilter)
  const setStatusFilter = useStore((state) => state.setWorkflowStatusFilter)
  const login = useStore((state) => state.auth?.login)
  const passes: Record<SidebarFilter, (row: CachedRow) => boolean> = {
    unread: (row) => unreadCount(row) !== 0,
    unreplied: (row) => isUnreplied(row, login),
    assigned: (row) => includesLogin(row.assignees, login),
  }
  const statuses = [...new Set(rows.flatMap((row) => (row.workflowStatus ? [row.workflowStatus] : [])))].sort()
  const statusOptions =
    statusFilter && statusFilter !== NO_BOARD_STATUS && !statuses.includes(statusFilter)
      ? [statusFilter, ...statuses]
      : statuses
  const noStatusCount = rows.filter((row) => !row.workflowStatus).length
  return (
    <FilterArea>
      <div className="flex gap-1">
        {(['unread', 'unreplied', 'assigned'] as const).map((filter) => (
          <FilterPill
            key={filter}
            label={filter}
            count={rows.filter(passes[filter]).length}
            active={filters.includes(filter)}
            onClick={() => toggleFilter(filter)}
          />
        ))}
      </div>
      <select
        aria-label="Filter by board status"
        className="w-full cursor-pointer rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700"
        value={statusFilter ?? ''}
        onChange={(event) => setStatusFilter(event.target.value || null)}
      >
        <option value="">All board statuses ({rows.length})</option>
        {statusOptions.map((status) => (
          <option key={status} value={status}>
            {status} ({rows.filter((row) => row.workflowStatus === status).length})
          </option>
        ))}
        {(noStatusCount > 0 || statusFilter === NO_BOARD_STATUS) && (
          <option value={NO_BOARD_STATUS}>No board status ({noStatusCount})</option>
        )}
      </select>
    </FilterArea>
  )
}

function PullRequestFilters({ rows }: { rows: CachedRow[] }): React.JSX.Element {
  const filters = useStore((state) => state.pullRequestFilters)
  const toggleFilter = useStore((state) => state.togglePullRequestFilter)
  const stateFilter = useStore((state) => state.pullRequestStateFilter)
  const setStateFilter = useStore((state) => state.setPullRequestStateFilter)
  const login = useStore((state) => state.auth?.login)
  const passes: Record<PullRequestFilter, (row: CachedRow) => boolean> = {
    reviewRequested: (row) => includesLogin(row.reviewRequestedFrom, login),
    assigned: (row) => includesLogin(row.assignees, login),
    authored: (row) => row.author?.toLowerCase() === login?.toLowerCase(),
    olderThan7Days: (row) => isOlderThanSevenDays(row),
  }
  const passesState: Record<PullRequestStateFilter, (row: CachedRow) => boolean> = {
    ready: (row) => !row.isDraft,
    draft: (row) => !!row.isDraft,
    approved: (row) => row.reviewDecision === 'APPROVED',
    changesRequested: (row) => row.reviewDecision === 'CHANGES_REQUESTED',
    reviewRequired: (row) => row.reviewDecision === 'REVIEW_REQUIRED',
  }
  return (
    <FilterArea>
      <div className="flex flex-wrap gap-1">
        {(['reviewRequested', 'assigned', 'authored', 'olderThan7Days'] as const).map((filter) => (
          <FilterPill
            key={filter}
            label={
              filter === 'reviewRequested'
                ? 'review requested'
                : filter === 'olderThan7Days'
                  ? 'older than 7d'
                  : filter
            }
            count={rows.filter(passes[filter]).length}
            active={filters.includes(filter)}
            onClick={() => toggleFilter(filter)}
          />
        ))}
      </div>
      <select
        aria-label="Filter pull requests"
        className="w-full cursor-pointer rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700"
        value={stateFilter ?? ''}
        onChange={(event) => setStateFilter((event.target.value || null) as PullRequestStateFilter | null)}
      >
        <option value="">All pull requests ({rows.length})</option>
        <option value="ready">Ready for review ({rows.filter(passesState.ready).length})</option>
        <option value="draft">Draft ({rows.filter(passesState.draft).length})</option>
        <option value="approved">Approved ({rows.filter(passesState.approved).length})</option>
        <option value="changesRequested">
          Changes requested ({rows.filter(passesState.changesRequested).length})
        </option>
        <option value="reviewRequired">Review required ({rows.filter(passesState.reviewRequired).length})</option>
      </select>
    </FilterArea>
  )
}

function FilterArea({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  return <div className="shrink-0 space-y-1.5 border-b border-gray-200 px-2 py-1.5">{children}</div>
}

function filterIssues(
  rows: CachedRow[],
  filters: SidebarFilter[],
  statusFilter: string | null,
  login?: string,
): CachedRow[] {
  const passes: Record<SidebarFilter, (row: CachedRow) => boolean> = {
    unread: (row) => unreadCount(row) !== 0,
    unreplied: (row) => isUnreplied(row, login),
    assigned: (row) => includesLogin(row.assignees, login),
  }
  return rows.filter(
    (row) =>
      filters.every((filter) => passes[filter](row)) &&
      (statusFilter === null ||
        (statusFilter === NO_BOARD_STATUS ? !row.workflowStatus : row.workflowStatus === statusFilter)),
  )
}

function filterPullRequests(
  rows: CachedRow[],
  filters: PullRequestFilter[],
  stateFilter: PullRequestStateFilter | null,
  login?: string,
): CachedRow[] {
  const passes: Record<PullRequestFilter, (row: CachedRow) => boolean> = {
    reviewRequested: (row) => includesLogin(row.reviewRequestedFrom, login),
    assigned: (row) => includesLogin(row.assignees, login),
    authored: (row) => row.author?.toLowerCase() === login?.toLowerCase(),
    olderThan7Days: (row) => isOlderThanSevenDays(row),
  }
  const passesState: Record<PullRequestStateFilter, (row: CachedRow) => boolean> = {
    ready: (row) => !row.isDraft,
    draft: (row) => !!row.isDraft,
    approved: (row) => row.reviewDecision === 'APPROVED',
    changesRequested: (row) => row.reviewDecision === 'CHANGES_REQUESTED',
    reviewRequired: (row) => row.reviewDecision === 'REVIEW_REQUIRED',
  }
  return rows.filter(
    (row) => filters.every((filter) => passes[filter](row)) && (!stateFilter || passesState[stateFilter](row)),
  )
}

function isOlderThanSevenDays(row: CachedRow): boolean {
  return !!row.createdAt && new Date(row.createdAt).getTime() < Date.now() - 7 * 24 * 60 * 60 * 1000
}

function FilterPill({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-2.5 py-0.5 text-[12px] ${
        active ? 'bg-accent font-medium text-white' : 'text-gray-600 hover:bg-gray-200'
      }`}
    >
      {label}
      {count > 0 && (
        <span className={`ml-1 text-[11px] ${active ? 'text-white/80' : 'text-gray-400'}`}>{count}</span>
      )}
    </button>
  )
}

function SidebarRow({
  row,
  selected,
  onClick,
  kind,
}: {
  row: CachedRow
  selected: boolean
  onClick: () => void
  kind: ConversationKind
}): React.JSX.Element {
  const unread = unreadCount(row)
  const snoozed = !!row.snoozedUntil && row.snoozedUntil > new Date().toISOString().slice(0, 10)
  return (
    <button
      onClick={onClick}
      className={`block w-full border-b border-gray-100 px-3 py-2 text-left ${
        selected ? 'bg-accent/10' : 'hover:bg-gray-100'
      } ${snoozed ? 'opacity-50' : ''}`}
    >
      <div className="flex items-baseline gap-2">
        <span className={`min-w-0 flex-1 truncate text-[13px] ${unread !== 0 ? 'font-semibold' : 'font-normal'}`}>
          {row.title}
        </span>
        {row.hasPendingDraft && <span title="Goose drafted a reply">✏️</span>}
        {unread > 0 && (
          <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white">{unread}</span>
        )}
        {unread === -1 && <span className="h-2 w-2 rounded-full bg-accent" />}
        <span className="text-[11px] text-gray-400">{timeAgo(row.updatedAt)}</span>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-gray-500">
        {kind === 'issue' ? <IssueRowMeta row={row} snoozed={snoozed} /> : <PullRequestRowMeta row={row} />}
        <span className="truncate">
          {row.lastComment ? `${row.lastComment.author}: ${row.lastComment.snippet}` : `${row.repo}#${row.issueNumber}`}
        </span>
      </div>
    </button>
  )
}

function IssueRowMeta({ row, snoozed }: { row: CachedRow; snoozed: boolean }): React.JSX.Element {
  return (
    <>
      {row.workflowStatus && (
        <span className="shrink-0 rounded bg-gray-200 px-1 py-px text-[10px] font-medium text-gray-700">
          {row.workflowStatus}
        </span>
      )}
      {snoozed && (
        <span className="shrink-0 rounded bg-indigo-100 px-1 py-px text-[10px] text-indigo-700">
          zzz {row.snoozedUntil}
        </span>
      )}
    </>
  )
}

function PullRequestRowMeta({ row }: { row: CachedRow }): React.JSX.Element {
  const label = row.isDraft
    ? 'draft'
    : row.reviewDecision === 'APPROVED'
      ? 'approved'
      : row.reviewDecision === 'CHANGES_REQUESTED'
        ? 'changes requested'
        : row.reviewDecision === 'REVIEW_REQUIRED'
          ? 'review required'
          : 'ready'
  const color = row.isDraft
    ? 'bg-gray-200 text-gray-700'
    : row.reviewDecision === 'APPROVED'
      ? 'bg-green-100 text-green-700'
      : row.reviewDecision === 'CHANGES_REQUESTED'
        ? 'bg-red-100 text-red-700'
        : row.reviewDecision === 'REVIEW_REQUIRED'
          ? 'bg-amber-100 text-amber-700'
          : 'bg-blue-100 text-blue-700'
  return <span className={`shrink-0 rounded px-1 py-px text-[10px] font-medium ${color}`}>{label}</span>
}
