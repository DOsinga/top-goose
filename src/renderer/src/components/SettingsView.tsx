import { useEffect, useState } from 'react'
import type {
  BoardConfig,
  GooseInfo,
  ProjectField,
  ProjectSummary,
  RepoConfig,
  Settings,
} from '../../../shared/types'
import { useStore } from '../store'

const api = window.topGoose

export function SettingsView(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [gooseOk, setGooseOk] = useState<GooseInfo | null>(null)
  const auth = useStore((s) => s.auth)
  const setView = useStore((s) => s.setView)

  useEffect(() => {
    void api.invoke('settings:get').then(setSettings)
  }, [])
  useEffect(() => {
    void api.invoke('goose:info').then((info) => setGooseOk('version' in info ? info : null))
  }, [settings?.goosePath])

  if (!settings) return <div className="p-6 text-sm text-gray-400">Loading…</div>

  const ready = {
    auth: !!auth?.authenticated,
    goose: gooseOk !== null,
    repo: !!settings.repo?.path,
  }
  const allReady = ready.auth && ready.goose && ready.repo

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-8 px-6 py-6">
        <AuthSection />
        <GooseSection settings={settings} onSettings={setSettings} />
        <div>
          <h2 className="mb-2 text-sm font-semibold">Instructions</h2>
          <p className="mb-3 text-xs text-gray-500">
            Automatically appended to Goose's system prompt for the matching conversation type.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-medium text-gray-700">
              Issues
              <textarea
                className="mt-1 h-28 w-full rounded border border-gray-300 p-2 text-sm font-normal"
                placeholder="Instructions for issue triage and implementation…"
                defaultValue={settings.issueInstructions ?? ''}
                onBlur={(e) =>
                  void api
                    .invoke('settings:update', { issueInstructions: e.target.value || undefined })
                    .then(setSettings)
                }
              />
            </label>
            <label className="text-xs font-medium text-gray-700">
              Pull requests
              <textarea
                className="mt-1 h-28 w-full rounded border border-gray-300 p-2 text-sm font-normal"
                placeholder="Instructions for PR review and follow-up…"
                defaultValue={settings.pullRequestInstructions ?? ''}
                onBlur={(e) =>
                  void api
                    .invoke('settings:update', { pullRequestInstructions: e.target.value || undefined })
                    .then(setSettings)
                }
              />
            </label>
          </div>
        </div>
        <RepoSection settings={settings} onSettings={setSettings} />
        <div className="flex items-center gap-4 border-t border-gray-200 pt-4">
          <ul className="flex-1 space-y-0.5 text-xs">
            <ChecklistItem ok={ready.auth} okText={`Signed in as @${auth?.login}`} todoText="Sign in to GitHub" />
            <ChecklistItem
              ok={ready.goose}
              okText={`goose ${gooseOk?.version} found`}
              todoText="No usable goose binary — install one or set a path above"
            />
            <ChecklistItem
              ok={ready.repo}
              okText={`${settings.repo?.repo} at ${settings.repo?.path}`}
              todoText="Choose the repository's local clone"
            />
          </ul>
          <button
            className="rounded-lg bg-accent px-5 py-2 text-sm font-medium text-white disabled:opacity-40"
            disabled={!allReady}
            title={allReady ? undefined : 'Finish the steps on the left first'}
            onClick={() => setView('main')}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

function ChecklistItem({
  ok,
  okText,
  todoText,
}: {
  ok: boolean
  okText: string
  todoText: string
}): React.JSX.Element {
  return (
    <li className={ok ? 'text-green-700' : 'text-gray-500'}>
      {ok ? '✓' : '○'} {ok ? okText : todoText}
    </li>
  )
}

// ---------- Auth ----------

function AuthSection(): React.JSX.Element {
  const auth = useStore((s) => s.auth)
  const setAuth = useStore((s) => s.setAuth)
  const [pat, setPat] = useState('')
  const [error, setError] = useState<string | null>(null)

  const savePat = async (): Promise<void> => {
    setError(null)
    try {
      const state = await api.invoke('auth:setToken', pat.trim())
      setAuth(state)
      if (!state.authenticated) setError(state.error ?? 'Token was rejected by GitHub.')
      else setPat('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold">GitHub</h2>
      {auth?.authenticated ? (
        <div className="flex items-center gap-3 text-sm">
          <span>
            Signed in as <b>@{auth.login}</b>
          </span>
          <button
            className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-100"
            onClick={() => void api.invoke('auth:signOut').then(setAuth)}
          >
            Sign out
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              type="password"
              className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
              placeholder="GitHub personal access token (repo, project, notifications scopes)"
              value={pat}
              onChange={(e) => setPat(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && pat.trim() && void savePat()}
            />
            <button
              className="rounded bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-40"
              disabled={!pat.trim()}
              onClick={() => void savePat()}
            >
              Sign in
            </button>
          </div>
          {error && <div className="whitespace-pre-wrap font-mono text-xs text-red-600">{error}</div>}
        </div>
      )}
    </div>
  )
}

// ---------- Goose binary ----------

function GooseSection({
  settings,
  onSettings,
}: {
  settings: Settings
  onSettings: (s: Settings) => void
}): React.JSX.Element {
  const [info, setInfo] = useState<GooseInfo | { error: string } | null>(null)

  const refresh = (): void => {
    setInfo(null)
    void api.invoke('goose:info').then(setInfo)
  }
  useEffect(refresh, [settings.goosePath])

  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold">Goose</h2>
      <div className="space-y-2 text-sm">
        {info === null && <div className="text-gray-400">Locating goose…</div>}
        {info && 'error' in info && (
          <div className="whitespace-pre-wrap rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700">
            {info.error}
          </div>
        )}
        {info && 'version' in info && (
          <div className="text-xs text-gray-600">
            Using <b>goose {info.version}</b> from <code>{info.resolvedPath}</code>{' '}
            <span className="text-gray-400">({info.source})</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <input
            className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs"
            placeholder="Override goose binary path (optional)"
            defaultValue={settings.goosePath ?? ''}
            onBlur={(e) =>
              void api
                .invoke('settings:update', { goosePath: e.target.value.trim() || undefined })
                .then(onSettings)
            }
          />
        </div>
      </div>
    </div>
  )
}

// ---------- Repositories ----------

function RepoSection({
  settings,
  onSettings,
}: {
  settings: Settings
  onSettings: (s: Settings) => void
}): React.JSX.Element {
  const [error, setError] = useState<string | null>(null)

  const browse = async (): Promise<void> => {
    setError(null)
    const picked = await api.invoke('repo:pickClone')
    if (!picked) return // cancelled
    if ('error' in picked) {
      setError(picked.error)
      return
    }
    const sameRepo = settings.repo?.repo.toLowerCase() === picked.repo.toLowerCase()
    const previous = sameRepo && settings.repo ? settings.repo : { useWorktrees: true }
    onSettings(
      await api.invoke('settings:saveRepo', {
        ...previous,
        repo: picked.repo,
        path: picked.path,
      }),
    )
  }

  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold">Repository</h2>
      <p className="mb-3 text-xs text-gray-500">
        Pick your local clone — the GitHub repository is read from its origin remote. The clone gives Goose
        code access; a Projects V2 board adds workflow status and snooze.
      </p>
      {settings.repo ? (
        <RepoCard config={settings.repo} onSettings={onSettings} onBrowse={browse} />
      ) : (
        <button className="rounded bg-gray-800 px-3 py-1.5 text-sm text-white" onClick={() => void browse()}>
          Choose local clone…
        </button>
      )}
      {error && <div className="mt-2 text-xs text-red-600">{error}</div>}
    </div>
  )
}

function RepoCard({
  config,
  onSettings,
  onBrowse,
}: {
  config: RepoConfig
  onSettings: (s: Settings) => void
  onBrowse: () => Promise<void>
}): React.JSX.Element {
  const save = (patch: Partial<RepoConfig>): void => {
    void api.invoke('settings:saveRepo', { ...config, ...patch }).then(onSettings)
  }

  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-sm font-medium">{config.repo}</span>
        <label className="flex items-center gap-1 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={config.useWorktrees}
            onChange={(e) => save({ useWorktrees: e.target.checked })}
          />
          worktrees
        </label>
        <button
          className="text-xs text-red-500 hover:underline"
          onClick={() => void api.invoke('settings:removeRepo').then(onSettings)}
        >
          remove
        </button>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-gray-100 px-2 py-1 text-xs text-gray-700">
          {config.path || 'no local clone chosen'}
        </code>
        <button
          className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-100"
          onClick={() => void onBrowse()}
        >
          Browse…
        </button>
      </div>
      <BoardPicker config={config} onSave={save} />
    </div>
  )
}

function BoardPicker({
  config,
  onSave,
}: {
  config: RepoConfig
  onSave: (patch: Partial<RepoConfig>) => void
}): React.JSX.Element {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [fields, setFields] = useState<ProjectField[] | null>(null)
  const [projectId, setProjectId] = useState(config.board?.projectId ?? '')
  const [error, setError] = useState<string | null>(null)

  const loadProjects = async (): Promise<void> => {
    setError(null)
    try {
      setProjects(await api.invoke('board:listProjects', config.repo))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const pickProject = async (id: string): Promise<void> => {
    setProjectId(id)
    setFields(null)
    if (!id) return
    try {
      setFields(await api.invoke('board:listFields', id))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const finishSetup = (statusFieldId: string, snoozeFieldId: string): void => {
    const project = projects?.find((p) => p.id === projectId)
    const statusField = fields?.find((f) => f.id === statusFieldId)
    if (!project || !statusField || statusField.dataType !== 'SINGLE_SELECT') return
    const board: BoardConfig = {
      projectId,
      projectTitle: project.title,
      statusFieldId,
      snoozeFieldId,
      statusOptions: Object.fromEntries(statusField.options.map((o) => [o.name, o.id])),
    }
    onSave({ board })
    setProjects(null)
    setFields(null)
  }

  if (config.board && projects === null) {
    return (
      <div className="mt-2 flex items-center gap-2 text-xs text-gray-600">
        <span>
          Board: <b>{config.board.projectTitle}</b> ({Object.keys(config.board.statusOptions).join(', ')})
        </span>
        <button className="text-accent hover:underline" onClick={() => void loadProjects()}>
          change
        </button>
      </div>
    )
  }

  return (
    <div className="mt-2 space-y-2 text-xs">
      {projects === null ? (
        <button className="text-accent hover:underline" onClick={() => void loadProjects()}>
          Configure Projects V2 board…
        </button>
      ) : (
        <ProjectFieldsForm
          projects={projects}
          projectId={projectId}
          fields={fields}
          onPickProject={(id) => void pickProject(id)}
          onDone={finishSetup}
        />
      )}
      {error && <div className="text-red-600">{error}</div>}
    </div>
  )
}

function ProjectFieldsForm({
  projects,
  projectId,
  fields,
  onPickProject,
  onDone,
}: {
  projects: ProjectSummary[]
  projectId: string
  fields: ProjectField[] | null
  onPickProject: (id: string) => void
  onDone: (statusFieldId: string, snoozeFieldId: string) => void
}): React.JSX.Element {
  const selectFields = fields?.filter((f) => f.dataType === 'SINGLE_SELECT') ?? []
  const dateFields = fields?.filter((f) => f.dataType === 'DATE') ?? []
  const [statusFieldId, setStatusFieldId] = useState('')
  const [snoozeFieldId, setSnoozeFieldId] = useState('')

  // sensible defaults once fields load
  useEffect(() => {
    if (fields) {
      setStatusFieldId(selectFields.find((f) => f.name.toLowerCase() === 'status')?.id ?? '')
      setSnoozeFieldId(dateFields.find((f) => /snooze/i.test(f.name))?.id ?? '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields])

  return (
    <div className="space-y-1.5">
      <select
        className="w-full rounded border border-gray-300 px-1 py-1"
        value={projectId}
        onChange={(e) => onPickProject(e.target.value)}
      >
        <option value="">Pick a project…</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.title} (#{p.number})
          </option>
        ))}
      </select>
      {fields && (
        <>
          <select
            className="w-full rounded border border-gray-300 px-1 py-1"
            value={statusFieldId}
            onChange={(e) => setStatusFieldId(e.target.value)}
          >
            <option value="">Status field…</option>
            {selectFields.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <select
            className="w-full rounded border border-gray-300 px-1 py-1"
            value={snoozeFieldId}
            onChange={(e) => setSnoozeFieldId(e.target.value)}
          >
            <option value="">Snooze date field…</option>
            {dateFields.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <button
            className="rounded bg-gray-800 px-2 py-1 text-white disabled:opacity-40"
            disabled={!statusFieldId || !snoozeFieldId}
            onClick={() => onDone(statusFieldId, snoozeFieldId)}
          >
            Save board
          </button>
        </>
      )}
    </div>
  )
}
