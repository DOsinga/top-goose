import { useEffect } from 'react'
import { GoosePane } from './components/GoosePane'
import { IssuePane } from './components/IssuePane'
import { PullRequestPane } from './components/PullRequestPane'
import { SettingsView } from './components/SettingsView'
import { Sidebar } from './components/Sidebar'
import { api } from './api'
import { useStore } from './store'

export function App(): React.JSX.Element {
  const init = useStore((s) => s.init)
  const view = useStore((s) => s.view)
  const conversationKind = useStore((s) => s.conversationKind)
  const goBack = useStore((s) => s.goBack)
  const goForward = useStore((s) => s.goForward)
  const auth = useStore((s) => s.auth)
  const mobilePane = useStore((s) => s.mobilePane)

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
      {api.isRemote && auth && !auth.authenticated ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <div>
            <img src="./top-goose.png" alt="" className="mx-auto h-16 w-16 object-contain" />
            <h1 className="mt-3 text-lg font-semibold">Finish setup in the desktop app</h1>
            <p className="mt-1 text-sm text-gray-500">
              Top Goose keeps GitHub credentials and configuration on the Mac running the app.
            </p>
          </div>
        </div>
      ) : view === 'settings' ? (
        <SettingsView />
      ) : (
        <>
          <div className="flex min-h-0 flex-1">
            <div className={`${mobilePane === 'list' ? 'flex' : 'hidden'} min-w-0 flex-1 md:contents`}>
              <Sidebar />
            </div>
            <div className={`${mobilePane === 'conversation' ? 'flex' : 'hidden'} min-w-0 flex-1 md:contents`}>
              {conversationKind === 'issue' ? <IssuePane /> : <PullRequestPane />}
            </div>
            <div className={`${mobilePane === 'goose' ? 'flex' : 'hidden'} min-w-0 flex-1 md:contents`}>
              <GoosePane />
            </div>
          </div>
          <MobileNavigation />
        </>
      )}
    </div>
  )
}

function TitleBar(): React.JSX.Element {
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const auth = useStore((s) => s.auth)
  const budget = useStore((s) => s.budget)
  const sidebarView = useStore((s) => s.sidebarView)
  const setSidebarView = useStore((s) => s.setSidebarView)

  return (
    <div className={`titlebar-drag flex h-11 shrink-0 items-center border-b border-gray-200 bg-gray-50 ${api.isRemote ? 'px-2' : 'pl-20 pr-3'}`}>
      <span className="hidden items-center gap-1.5 text-[15px] font-bold tracking-tight text-gray-800 lg:flex">
        <img src="./top-goose.png" alt="" className="h-7 w-7 object-contain" />
        Top Goose
      </span>
      <div className="mx-auto flex rounded-lg bg-gray-200 p-0.5">
        {([
          ['issue', 'Issues', 'Issues'],
          ['pullRequest', 'Pull requests', 'PRs'],
          ['conversations', 'Conversations', 'Chats'],
          ['sessions', 'Goose', 'Goose'],
        ] as const).map(([value, label, smallLabel]) => (
          <button
            key={value}
            className={`rounded-md px-2 py-1 text-xs font-medium sm:px-3 ${
              sidebarView === value
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-800'
            }`}
            onClick={() => setSidebarView(value)}
          >
            <span className="hidden sm:inline">{label}</span>
            <span className="sm:hidden">{smallLabel}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3">
        {budget && budget.degraded && (
          <span className="hidden rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800 lg:inline">
            API budget low ({budget.remaining} left) — serving cached rows
          </span>
        )}
        {auth?.authenticated && <span className="hidden text-xs text-gray-500 lg:inline">@{auth.login}</span>}
        {!api.isRemote && (
          <button
            className={`rounded px-2 py-1 text-xs ${view === 'settings' ? 'bg-gray-200' : 'hover:bg-gray-200'}`}
            onClick={() => setView(view === 'settings' ? 'main' : 'settings')}
          >
            ⚙︎ Settings
          </button>
        )}
      </div>
    </div>
  )
}

function MobileNavigation(): React.JSX.Element {
  const pane = useStore((state) => state.mobilePane)
  const setPane = useStore((state) => state.setMobilePane)
  const selected = useStore((state) => state.selectedNodeId)
  return (
    <div className="grid h-12 shrink-0 grid-cols-3 border-t border-gray-200 bg-gray-50 md:hidden">
      {([
        ['list', 'List'],
        ['conversation', 'Discussion'],
        ['goose', 'Goose'],
      ] as const).map(([value, label]) => (
        <button
          key={value}
          type="button"
          disabled={value !== 'list' && !selected}
          className={`text-xs font-medium ${pane === value ? 'text-accent' : 'text-gray-500'} disabled:opacity-30`}
          onClick={() => setPane(value)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
