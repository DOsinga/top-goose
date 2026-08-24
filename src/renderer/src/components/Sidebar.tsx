import type { CachedRow } from '../../../shared/types'
import { useStore, type SidebarFilter } from '../store'

function unreadCount(row: CachedRow): number {
  if (row.commentCountAtRead === undefined) return row.unread ? -1 : 0 // -1 = dot, count unknown
  return Math.max(0, row.commentCount - row.commentCountAtRead)
}

/** the last voice on the issue is not mine — the ball is in my court */
function isUnreplied(row: CachedRow, login?: string): boolean {
  const lastVoice = row.lastComment?.author ?? row.author
  return lastVoice !== login
}

function timeAgo(iso: string): string {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000
  if (seconds < 60) return 'now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}

export function Sidebar(): React.JSX.Element {
  const rows = useStore((s) => s.rows)
  const selected = useStore((s) => s.selectedNodeId)
  const selectIssue = useStore((s) => s.selectIssue)
  const filters = useStore((s) => s.sidebarFilters)
  const toggleFilter = useStore((s) => s.toggleSidebarFilter)
  const login = useStore((s) => s.auth?.login)

  const passes: Record<SidebarFilter, (r: CachedRow) => boolean> = {
    unread: (r) => unreadCount(r) !== 0,
    unreplied: (r) => isUnreplied(r, login),
    assigned: (r) => !!login && !!r.assignees?.includes(login),
  }
  // active filters AND together; none active = everything
  const visible = rows.filter((r) => filters.every((f) => passes[f](r)))

  return (
    <div className="flex w-72 shrink-0 flex-col border-r border-gray-200 bg-gray-50">
      <div className="flex shrink-0 gap-1 border-b border-gray-200 px-2 py-1.5">
        {(['unread', 'unreplied', 'assigned'] as const).map((f) => (
          <FilterPill
            key={f}
            label={f}
            count={rows.filter(passes[f]).length}
            active={filters.includes(f)}
            onClick={() => toggleFilter(f)}
          />
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        {visible.length === 0 && (
          <div className="p-4 text-sm text-gray-500">
            {rows.length === 0
              ? 'No open issues in this repository.'
              : 'Nothing matches the active filters.'}
          </div>
        )}
        {visible.map((row) => (
          <SidebarRow
            key={row.nodeId}
            row={row}
            selected={row.nodeId === selected}
            onClick={() => void selectIssue(row.nodeId)}
          />
        ))}
      </div>
    </div>
  )
}

function FilterPill({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count?: number
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
      {count !== undefined && count > 0 && (
        <span className={`ml-1 text-[11px] ${active ? 'text-white/80' : 'text-gray-400'}`}>{count}</span>
      )}
    </button>
  )
}

function SidebarRow({
  row,
  selected,
  onClick,
}: {
  row: CachedRow
  selected: boolean
  onClick: () => void
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
        <span
          className={`min-w-0 flex-1 truncate text-[13px] ${unread !== 0 ? 'font-semibold' : 'font-normal'}`}
        >
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
        <span className="truncate">
          {row.lastComment ? `${row.lastComment.author}: ${row.lastComment.snippet}` : row.repo}
        </span>
      </div>
    </button>
  )
}
