import { useEffect } from 'react'
import { GoosePane } from './components/GoosePane'
import { IssuePane } from './components/IssuePane'
import { PullRequestPane } from './components/PullRequestPane'
import { SettingsView } from './components/SettingsView'
import { Sidebar } from './components/Sidebar'
import { useStore } from './store'

export function App(): React.JSX.Element {
  const init = useStore((s) => s.init)
  const view = useStore((s) => s.view)
  const conversationKind = useStore((s) => s.conversationKind)
  const goBack = useStore((s) => s.goBack)
  const goForward = useStore((s) => s.goForward)

  useEffect(() => init(), [init])
  useEffect(() => {
    const navigateHistory = (event: KeyboardEvent): void => {
      if (!event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return
      if (event.key === '[') {
        event.preventDefault()
        void goBack()
      } else if (event.key === ']') {
        event.preventDefault()
        void goForward()
      }
    }
    window.addEventListener('keydown', navigateHistory)
    return () => window.removeEventListener('keydown', navigateHistory)
  }, [goBack, goForward])

  return (
    <div className="flex h-full flex-col bg-white text-gray-900">
      <TitleBar />
      {view === 'settings' ? (
        <SettingsView />
      ) : (
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          {conversationKind === 'issue' ? <IssuePane /> : <PullRequestPane />}
          <GoosePane />
        </div>
      )}
    </div>
  )
}

function TitleBar(): React.JSX.Element {
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const auth = useStore((s) => s.auth)
  const budget = useStore((s) => s.budget)
  const conversationKind = useStore((s) => s.conversationKind)
  const setConversationKind = useStore((s) => s.setConversationKind)

  return (
    <div className="titlebar-drag flex h-11 shrink-0 items-center border-b border-gray-200 bg-gray-50 pl-20 pr-3">
      <span className="flex items-center gap-1.5 text-[15px] font-bold tracking-tight text-gray-800">
        <img src="./top-goose.png" alt="" className="h-7 w-7 object-contain" />
        Top Goose
      </span>
      <div className="mx-auto flex rounded-lg bg-gray-200 p-0.5">
        {([
          ['issue', 'Issues'],
          ['pullRequest', 'Pull requests'],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            className={`rounded-md px-3 py-1 text-xs font-medium ${
              conversationKind === value
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-800'
            }`}
            onClick={() => setConversationKind(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3">
        {budget && budget.degraded && (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
            API budget low ({budget.remaining} left) — serving cached rows
          </span>
        )}
        {auth?.authenticated && <span className="text-xs text-gray-500">@{auth.login}</span>}
        <button
          className={`rounded px-2 py-1 text-xs ${view === 'settings' ? 'bg-gray-200' : 'hover:bg-gray-200'}`}
          onClick={() => setView(view === 'settings' ? 'main' : 'settings')}
        >
          ⚙︎ Settings
        </button>
      </div>
    </div>
  )
}
