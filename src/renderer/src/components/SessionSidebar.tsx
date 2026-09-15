import { matchesAttentionFilter } from '../../../shared/issueFilters'
import type { SessionHistoryRow } from '../../../shared/types'
import { conversationUrl, shouldNavigateInside } from '../internalLinks'
import { useStore, type SidebarFilter } from '../store'
import { timeAgo } from '../time'

export function SessionSidebar(): React.JSX.Element {
  const rows = useStore((state) => state.sessionRows)
  const conversations = useStore((state) => state.rows)
  const loading = useStore((state) => state.sessionRowsLoading)
  const error = useStore((state) => state.sessionRowsError)
  const selected = useStore((state) => state.selectedNodeId)
  const filters = useStore((state) => state.gooseFilters)
  const toggleFilter = useStore((state) => state.toggleGooseFilter)
  const login = useStore((state) => state.auth?.login)
  const load = useStore((state) => state.loadSessionHistory)
  const conversationsByNode = new Map(conversations.map((row) => [row.nodeId, row]))
  const filteredRows = rows.filter((row) => {
    const conversation = conversationsByNode.get(row.nodeId)
    return !!conversation && filters.every((filter) => matchesAttentionFilter(conversation, filter, login))
  })
  const counts = Object.fromEntries(
    (['unread', 'unreplied', 'assigned'] as const).map((filter) => [
      filter,
      rows.filter((row) => {
        const conversation = conversationsByNode.get(row.nodeId)
        return !!conversation && matchesAttentionFilter(conversation, filter, login)
      }).length,
    ]),
  ) as Record<SidebarFilter, number>

  return (
    <div className="flex w-72 shrink-0 flex-col border-r border-gray-200 bg-gray-50">
      <div className="flex h-[45px] shrink-0 items-center border-b border-gray-200 px-3">
        <span className="text-xs font-medium text-gray-700">Goose</span>
        <span className="ml-1 text-[11px] text-gray-400">
          {filters.length > 0 ? `${filteredRows.length}/${rows.length}` : rows.length}
        </span>
        <button
          type="button"
          className="ml-auto rounded px-1.5 py-0.5 text-xs text-gray-400 hover:bg-gray-200 hover:text-gray-700"
          title="Refresh sessions"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? '…' : '↻'}
        </button>
      </div>
      <div className="flex shrink-0 gap-1 border-b border-gray-200 px-2 py-1.5">
        {(['unread', 'unreplied', 'assigned'] as const).map((filter) => (
          <button
            key={filter}
            type="button"
            className={`rounded-full px-2.5 py-0.5 text-[12px] ${
              filters.includes(filter)
                ? 'bg-accent font-medium text-white'
                : 'text-gray-600 hover:bg-gray-200'
            }`}
            onClick={() => toggleFilter(filter)}
          >
            {filter}
            {counts[filter] > 0 && (
              <span className={`ml-1 text-[11px] ${filters.includes(filter) ? 'text-white/80' : 'text-gray-400'}`}>
                {counts[filter]}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading && rows.length === 0 && <div className="p-4 text-sm text-gray-400">Loading sessions…</div>}
        {error && <div className="p-4 text-sm text-red-600">Could not load sessions: {error}</div>}
        {!loading && !error && rows.length === 0 && (
          <div className="p-4 text-sm text-gray-500">No Goose sessions yet.</div>
        )}
        {!loading && !error && rows.length > 0 && filteredRows.length === 0 && (
          <div className="p-4 text-sm text-gray-500">Nothing matches the active filters.</div>
        )}
        {filteredRows.map((row) => <SessionRow key={row.nodeId} row={row} selected={selected === row.nodeId} />)}
      </div>
    </div>
  )
}

function SessionRow({ row, selected }: { row: SessionHistoryRow; selected: boolean }): React.JSX.Element {
  const busy = useStore((state) => state.gooseChats[row.nodeId]?.busy)
  const selectSession = useStore((state) => state.selectSession)
  return (
    <a
      href={conversationUrl(row)}
      target="_blank"
      rel="noreferrer"
      className={`block w-full border-b border-gray-100 px-3 py-2 text-left ${
        selected ? 'bg-accent/10' : 'hover:bg-gray-100'
      }`}
      onClick={(event) => {
        if (!shouldNavigateInside(event)) return
        event.preventDefault()
        void selectSession(row)
      }}
    >
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px]">{row.title}</span>
        {busy && <span className="animate-pulse text-[11px]">🪿</span>}
        <span className="shrink-0 text-[11px] text-gray-400">{timeAgo(row.lastUsedAt)}</span>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-gray-500">
        <span className="rounded bg-gray-200 px-1 py-px">
          {row.kind === 'issue' ? 'issue' : 'PR'} #{row.issueNumber}
        </span>
        <span className="truncate">{row.repo}</span>
      </div>
    </a>
  )
}
