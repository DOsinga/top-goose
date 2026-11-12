import { coreTeam } from '../../../shared/coreTeam'
import {
  matchesAssigneeFilter,
  type AssigneeFilter,
} from '../../../shared/issueFilters'
import type { CachedRow } from '../../../shared/types'
import { useStore } from '../store'

export function AssigneeFilterButton({
  rows,
  active,
  onToggle,
}: {
  rows: CachedRow[]
  active: boolean
  onToggle: () => void
}): React.JSX.Element {
  const filter = useStore((state) => state.assigneeFilter)
  const setFilter = useStore((state) => state.setAssigneeFilter)
  const chooseFilter = useStore((state) => state.chooseAssigneeFilter)
  const login = useStore((state) => state.auth?.login)
  const viewer = coreTeam.find((member) => member.github.toLowerCase() === login?.toLowerCase())
  const others = coreTeam.filter((member) => member !== viewer)
  const countFilter = active ? filter : 'viewer'
  const count = rows.filter((row) => matchesAssigneeFilter(row, countFilter, login)).length
  const label = assigneeLabel(filter, login)

  return (
    <div
      className={`inline-flex overflow-hidden rounded-full text-[12px] ${
        active ? 'bg-accent font-medium text-white' : 'text-gray-600 hover:bg-gray-200'
      }`}
    >
      <button
        type="button"
        className="py-0.5 pl-2.5 pr-1"
        onClick={() => {
          setFilter('viewer')
          onToggle()
        }}
      >
        {active ? `assigned: ${label}` : 'assigned'}
        {count > 0 && (
          <span className={`ml-1 text-[11px] ${active ? 'text-white/80' : 'text-gray-400'}`}>{count}</span>
        )}
      </button>
      <label
        className={`relative flex cursor-pointer items-center px-1.5 ${
          active ? 'border-l border-white/25' : 'border-l border-gray-300'
        }`}
      >
        <span aria-hidden="true">⌄</span>
        <select
          aria-label="Choose assignee filter"
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          value={filter}
          onChange={(event) => chooseFilter(event.target.value as AssigneeFilter)}
        >
          <optgroup label="Core team">
            <option value="viewer">{viewer ? `${viewer.name} (@${viewer.github})` : login ? `@${login}` : 'Me'}</option>
            {others.map((member) => (
              <option key={member.github} value={`login:${member.github}`}>
                {member.name} (@{member.github})
              </option>
            ))}
          </optgroup>
          <optgroup label="Assignment">
            <option value="any">Anyone</option>
            <option value="none">Unassigned</option>
          </optgroup>
        </select>
      </label>
    </div>
  )
}

function assigneeLabel(filter: AssigneeFilter, login?: string): string {
  if (filter === 'viewer') return login ?? 'me'
  if (filter === 'any') return 'anyone'
  if (filter === 'none') return 'unassigned'
  return filter.slice('login:'.length)
}
