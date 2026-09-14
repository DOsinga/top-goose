import { useStore } from '../store'
import { timeAgo } from '../time'

export function SessionSidebar(): React.JSX.Element {
  const rows = useStore((state) => state.sessionRows)
  const loading = useStore((state) => state.sessionRowsLoading)
  const error = useStore((state) => state.sessionRowsError)
  const selected = useStore((state) => state.selectedNodeId)
  const gooseChats = useStore((state) => state.gooseChats)
  const selectSession = useStore((state) => state.selectSession)
  const load = useStore((state) => state.loadSessionHistory)

  return (
    <div className="flex w-72 shrink-0 flex-col border-r border-gray-200 bg-gray-50">
      <div className="flex h-[45px] shrink-0 items-center border-b border-gray-200 px-3">
        <span className="text-xs font-medium text-gray-700">Goose sessions</span>
        <span className="ml-1 text-[11px] text-gray-400">{rows.length}</span>
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
      <div className="flex-1 overflow-y-auto">
        {loading && rows.length === 0 && <div className="p-4 text-sm text-gray-400">Loading sessions…</div>}
        {error && <div className="p-4 text-sm text-red-600">Could not load sessions: {error}</div>}
        {!loading && !error && rows.length === 0 && (
          <div className="p-4 text-sm text-gray-500">No Goose sessions yet.</div>
        )}
        {rows.map((row) => {
          const busy = gooseChats[row.nodeId]?.busy
          return (
            <button
              key={row.nodeId}
              type="button"
              className={`block w-full border-b border-gray-100 px-3 py-2 text-left ${
                selected === row.nodeId ? 'bg-accent/10' : 'hover:bg-gray-100'
              }`}
              onClick={() => void selectSession(row)}
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
            </button>
          )
        })}
      </div>
    </div>
  )
}
